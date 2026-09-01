import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ablateGates, replay, sweepThreshold, type ReplayInput } from "@/eval/crossLinkMetrics";
import { SIMILARITY_TUNING } from "@/pages/projectEditor/similarityDecision";
import type { IterationEvidence, SimilarityMatch } from "@/pages/projectEditor/similarityDecision";
import type { EvalRunFile } from "@/eval/evalTypes";

/**
 * What each gate of the cross-link rule contributes, measured over a real corpus.
 *
 * ## Why this is an ablation and not an accuracy score
 *
 * The obvious evaluation — did the researcher keep the links the system proposed — cannot be run.
 * In the one real study available, six links were inferred and all six are soft-deleted, but every
 * deletion timestamp is byte-identical to its source card's: the researcher deleted cards and the
 * links went with them as cascades. Not one link was ever judged on its own. A harness that counted
 * them would have printed "0 of 6 kept" and would have been measuring card deletion.
 *
 * So this asks the question that *is* answerable without labels, and the one the reviewer actually
 * named: what does each gate do. Take a corpus of real shards, get their real embeddings, and run
 * the shipped decision rule over every pair with one threshold neutralised at a time. The output is
 * how many links each configuration admits and how large a hub it allows — which is exactly the
 * claim the gates exist to support.
 *
 * ## Why it spawns a project
 *
 * Embeddings live server-side, keyed to a document, and the retrieval that feeds the decision is a
 * pgvector query with a label filter and a cohort cap. Reproducing that in the harness would mean
 * reproducing the SQL, so instead the shards are saved into a throwaway project and the product's
 * own `/cards/similarity` route is asked. The candidates and baselines that come back are the ones
 * the canvas would have decided on.
 *
 * The spawned project is deleted again once its candidates have been read, because it is scaffolding
 * rather than a study and leaving one behind per run would silt up the projects list. Everything
 * needed for the analysis is in the captured file, so `--matches` re-derives every table from disk
 * with no server at all. Pass `--keep` to leave the project in place and look at it on the canvas.
 *
 * Usage:
 *   npm run eval:crosslink                       # newest run file, spawns a project
 *   npm run eval:crosslink -- --keep             # and leaves it behind to inspect
 *   npm run eval:crosslink -- --matches eval/runs/crosslink-....json   # re-analyse, no network
 */

const API = process.env.VITRAL_API_BASE ?? "http://localhost:3000/api";

type StoredMatches = {
    capturedAt: string;
    sourceRunFile: string;
    projectId: string;
    cards: Array<{ id: string; label: string; title: string; createdAtMs: number | null }>;
    matches: SimilarityMatch[];
};

function parseArgs(argv: readonly string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;
        const next = argv[index + 1];
        args[token.slice(2)] = next !== undefined && !next.startsWith("--") ? next : "true";
    }
    return args;
}

async function newestFile(directory: string, prefix: string): Promise<string> {
    const entries = (await readdir(directory))
        .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
        .sort();
    if (entries.length === 0) {
        throw new Error(`No ${prefix}*.json in ${directory}. Run \`npm run eval:run\` first.`);
    }
    return join(directory, entries[entries.length - 1]);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Every shard of one configuration, deduplicated by title.
 *
 * Repetitions are the point of the sharding benchmark and noise here: ten runs of one document would
 * otherwise hand the similarity pass ten near-identical copies of every shard, and near-identical
 * copies are precisely what the rule is built to link. The corpus would then be measuring its own
 * duplication.
 */
function corpusFrom(file: EvalRunFile, config: string) {
    const seen = new Set<string>();
    const cards: Array<{ id: string; label: string; title: string; description: string }> = [];
    for (const run of file.runs) {
        if (run.config !== config || run.error !== undefined) continue;
        for (const shard of run.shards) {
            const key = shard.title.trim().toLowerCase();
            if (key === "" || seen.has(key)) continue;
            seen.add(key);
            cards.push({
                id: crypto.randomUUID(),
                label: shard.label,
                title: shard.title,
                description: shard.description,
            });
        }
    }
    return cards;
}

async function captureMatches(
    runFile: string,
    config: string,
    keepProject: boolean,
): Promise<StoredMatches> {
    const file = JSON.parse(await readFile(runFile, "utf8")) as EvalRunFile;
    const cards = corpusFrom(file, config);
    if (cards.length === 0) throw new Error(`No shards for config "${config}" in ${runFile}.`);

    // A throwaway, unowned project: `POST /state` signed out leaves `owner_id` NULL, which is all
    // the embedding queue and the similarity route need.
    const created = await fetch(`${API}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title: `eval crosslink ${new Date().toISOString()}`,
            state: {
                flow: {
                    nodes: cards.map((card, index) => ({
                        id: card.id,
                        position: { x: (index % 8) * 320, y: Math.floor(index / 8) * 260 },
                        type: "card",
                        data: {
                            label: card.label,
                            type: "social",
                            title: card.title,
                            description: card.description,
                            createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
                            relevant: true,
                        },
                    })),
                    edges: [],
                },
            },
            timeline: {},
        }),
    });
    if (!created.ok) throw new Error(`Could not create project: ${created.status} ${await created.text()}`);
    const projectId = String(((await created.json()) as { id?: string }).id ?? "");
    if (projectId === "") throw new Error("Project was created but returned no id.");
    console.log(`project  ${projectId} — ${cards.length} shards`);

    // **One card at a time, not the whole corpus at once.**
    //
    // The cohort query ends `AND NOT (node_id = ANY($5))`, where `$5` is every id being offered: a
    // card must not match itself, nor its siblings from the same file drop, which have not been
    // judged yet either. Offering all 26 shards in one request therefore excludes all 26 from every
    // cohort and returns a full set of empty matches with `status: "ok"` — which is indistinguishable
    // from a corpus where nothing is similar, and is how the first version of this script concluded
    // that every gate admits nothing.
    //
    // One at a time is also what the product does most often: a typed note is one new card offered
    // against the whole canvas.
    const ask = async (batch: typeof cards): Promise<{ status: string; matches: SimilarityMatch[] }> => {
        const response = await fetch(`${API}/state/${projectId}/cards/similarity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newCards: batch }),
        });
        if (!response.ok) throw new Error(`Similarity failed: ${response.status} ${await response.text()}`);
        return await response.json() as { status: string; matches: SimilarityMatch[] };
    };

    // Embeddings are written from the saved state by a debounced queue, and the route backfills what
    // it finds missing, so the first few answers can legitimately be empty. Probe with one card until
    // the corpus has something to compare against.
    let settled = false;
    for (let attempt = 1; attempt <= 15 && !settled; attempt += 1) {
        const probe = await ask([cards[0]]);
        if (probe.status === "unavailable") {
            throw new Error("Similarity is unavailable — is OPENAI_API_KEY set on the backend?");
        }
        settled = (probe.matches ?? []).some((match) => (match.candidates?.length ?? 0) > 0);
        console.log(`  embeddings attempt ${attempt}: ${probe.status}, `
            + `${settled ? "ready" : "no cohort yet"}`);
        if (!settled) await sleep(2000);
    }
    if (!settled) {
        throw new Error(
            "The embedding backfill never settled after 15 attempts. "
            + "Check the backend log for `cards-similarity`.",
        );
    }

    const matches: SimilarityMatch[] = [];
    for (const card of cards) {
        const body = await ask([card]);
        for (const match of body.matches ?? []) matches.push(match);
    }
    const withCandidates = matches.filter((match) => (match.candidates?.length ?? 0) > 0).length;
    console.log(`  ${matches.length} offered, ${withCandidates} with candidates`);

    if (keepProject) {
        console.log(`  keeping project ${projectId}`);
    } else {
        // Best effort: a failed cleanup is worth a line, never a lost capture. The candidates are
        // already in hand by this point and the analysis does not need the project again.
        const deleted = await fetch(`${API}/state/${projectId}`, { method: "DELETE" });
        console.log(deleted.ok
            ? `  deleted project ${projectId}`
            : `  could not delete project ${projectId}: ${deleted.status}`);
    }

    return {
        capturedAt: new Date().toISOString(),
        sourceRunFile: runFile,
        projectId,
        cards: cards.map((card, index) => ({
            id: card.id,
            label: card.label,
            title: card.title,
            createdAtMs: Date.UTC(2026, 0, 1 + index),
        })),
        matches,
    };
}

function renderReport(stored: StoredMatches): string {
    const input: ReplayInput = {
        matches: stored.matches,
        evidence: new Map<string, IterationEvidence>(
            stored.cards.map((card) => [card.id, { title: card.title, createdAtMs: card.createdAtMs }]),
        ),
    };

    const lines: string[] = [];
    const push = (...values: string[]) => lines.push(...values);
    const table = (headers: string[], rows: string[][]) => [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
    ];
    const sim = (value: number | null) => (value === null ? "n/a" : value.toFixed(3));

    push("# Cross-link inference: what each gate contributes", "");
    push(`Captured ${stored.capturedAt} over ${stored.cards.length} shards from `
        + `\`${stored.sourceRunFile}\`, with candidates and cohort statistics from the product's own `
        + "similarity route.", "");
    push("**This measures selectivity, not accuracy.** Whether an admitted link is *correct* needs "
        + "labels the study does not have; the one project with inferred links had all of them "
        + "deleted as cascades when their cards were deleted, so no link was ever judged. What is "
        + "answerable, and what the ablation below answers, is what each gate admits and refuses.",
        "");

    push("## Gate ablation", "");
    push("Each row is the shipped decision rule with one threshold neutralised, run over the same "
        + "corpus. *Max degree* is the hub the separation gate exists to prevent.", "");
    push(...table(
        ["Configuration", "Links", "Distinct pairs", "Cards linked", "Max degree", "Mean cosine"],
        ablateGates(input).map((row) => [
            row.configuration,
            String(row.links.length),
            String(row.pairs),
            String(row.cardsLinked),
            String(row.maxDegree),
            sim(row.meanSimilarity),
        ]),
    ), "");

    push("## Threshold sensitivity", "");
    push("The shipped values were set from eight hand-checked pairs on one project. These curves say "
        + "whether they sit on a plateau, where being slightly wrong costs little, or on a cliff.",
        "");
    for (const key of ["ABSOLUTE_FLOOR", "SEPARATION_MARGIN"] as const) {
        const values = key === "ABSOLUTE_FLOOR"
            ? [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]
            : [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
        push(`**\`${key}\`** (shipped: ${SIMILARITY_TUNING[key]})`, "");
        push(...table(
            ["Value", "Links", "Distinct pairs", "Max degree"],
            sweepThreshold(input, key, values).map((row) => [
                row.shipped ? `**${row.value}**` : String(row.value),
                String(row.result.links.length),
                String(row.result.pairs),
                String(row.result.maxDegree),
            ]),
        ), "");
    }

    const shipped = replay(input, "shipped rule");
    push("## Links the shipped rule admits", "");
    if (shipped.links.length === 0) {
        push("None. On a corpus of distinct shards from one artifact that is the expected outcome: "
            + "the rule is built to find near-duplicates and revisions across a study, not to relate "
            + "everything that shares a topic.", "");
    } else {
        const titleOf = new Map(stored.cards.map((card) => [card.id, card.title]));
        push(...table(
            ["Kind", "Cosine", "Margin", "From", "To"],
            shipped.links.map((link) => [
                link.kind,
                link.similarity.toFixed(3),
                link.margin.toFixed(3),
                titleOf.get(link.sourceId) ?? link.sourceId,
                titleOf.get(link.targetId) ?? link.targetId,
            ]),
        ), "");
    }

    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const runsDir = resolve(args.runs ?? "eval/runs");

    let stored: StoredMatches;
    if (args.matches) {
        stored = JSON.parse(await readFile(resolve(args.matches), "utf8")) as StoredMatches;
    } else {
        const runFile = args.file ? resolve(args.file) : await newestFile(runsDir, "shards-");
        stored = await captureMatches(runFile, args.config ?? "baseline", args.keep === "true");
        const out = join(runsDir, `crosslink-${stored.capturedAt.replace(/[:.]/g, "-")}.json`);
        await writeFile(out, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
        console.log(`captured ${out}\n`);
    }

    const markdown = renderReport(stored);
    const outFile = resolve(args.out ?? "eval/crosslink-report.md");
    await writeFile(outFile, markdown, "utf8");
    console.log(markdown);
    console.log(`\nwrote ${outFile}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
