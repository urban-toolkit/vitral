import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildConsensus, summariseConsensus } from "@/eval/consensus";
import {
    measureRun,
    measureYieldStability,
    poolGroundedness,
    type RunMetrics,
} from "@/eval/shardingMetrics";
import type { EvalRun, EvalRunFile } from "@/eval/evalTypes";

/**
 * Turn raw benchmark output into the tables the paper prints.
 *
 * Reads only what `eval:run` already wrote, so it is deterministic and free to re-run: a mistake in
 * a metric costs a second of compute rather than a second pass over the corpus. Every number here
 * comes from `src/eval/`, which is unit-tested against hand-computed answers — this file only groups
 * and formats.
 *
 * Two things it deliberately does not do. It does not average across documents without saying so:
 * one artifact being easy to shred and another hard is a finding, and a pooled mean hides it. And it
 * does not report a rate whose denominator is zero — a run that produced no quotable shard says
 * nothing about groundedness, and printing `0%` for it would be a fabrication of our own.
 *
 * Usage:
 *   npm run eval:report                     # newest run file
 *   npm run eval:report -- --file eval/runs/2026-09-01T....json --out eval/report.md
 */

function parseArgs(argv: readonly string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const next = argv[index + 1];
        args[key] = next !== undefined && !next.startsWith("--") ? next : "true";
    }
    return args;
}

/** Newest `shards-*.json`. The prefix matters: cross-link captures live in the same directory. */
async function newestRunFile(directory: string): Promise<string> {
    const entries = (await readdir(directory))
        .filter((name) => name.startsWith("shards-") && name.endsWith(".json"))
        .sort();
    if (entries.length === 0) {
        throw new Error(`No shards-*.json in ${directory}. Run \`npm run eval:run\` first.`);
    }
    return join(directory, entries[entries.length - 1]);
}

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const num = (value: number, places = 2): string => value.toFixed(places);

function table(headers: readonly string[], rows: readonly string[][]): string[] {
    return [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
    ];
}

/**
 * Runs grouped by document and configuration: the two things that are never averaged over.
 *
 * The pair is carried as fields rather than packed into a string key. A key would need a separator
 * no document name could contain, and every reader of it would have to remember to split on the
 * same one — for the sake of a `Map` that is only ever iterated in order.
 */
type RunGroup = {
    document: string;
    config: string;
    runs: EvalRun[];
};

function groupRuns(runs: readonly EvalRun[]): RunGroup[] {
    const groups: RunGroup[] = [];
    for (const run of runs) {
        const found = groups.find(
            (group) => group.document === run.document && group.config === run.config,
        );
        if (found) found.runs.push(run);
        else groups.push({ document: run.document, config: run.config, runs: [run] });
    }
    return groups;
}

function render(file: EvalRunFile): string {
    const lines: string[] = [];
    const push = (...values: string[]) => lines.push(...values);

    const succeeded = file.runs.filter((run) => run.error === undefined);
    const failed = file.runs.length - succeeded.length;

    push("# Sharding, cross-link and hallucination benchmark", "");
    push(`Captured ${file.startedAt}. ${file.runs.length} runs, ${failed} failed, `
        + `${file.repetitions} repetitions per document per configuration.`, "");
    push("Every figure below is computed from stored output by `src/eval/`, whose arithmetic is "
        + "pinned by `npm run test:eval-metrics`. Rates are never averaged across documents: an "
        + "artifact that is easy to decompose and one that is hard are two findings, not one mean.",
        "");

    const groups = groupRuns(succeeded);
    const measured = groups.map((group) => ({
        document: group.document,
        config: group.config,
        runs: group.runs,
        metrics: group.runs.map(measureRun),
    }));

    // --- A. Reliability under repetition ---------------------------------------------------------
    push("## A. Sharding reliability", "");
    push("Runs of the same artifact are compared with each other, so no labelling is involved. A "
        + "shard is matched across runs by the span its quotation occupies in the source, not by its "
        + "title, which is reworded every run.", "");

    const reliabilityRows: string[][] = [];
    for (const group of measured) {
        const { document, config, runs } = group;
        const clusters = buildConsensus(runs);
        const summary = summariseConsensus(clusters, runs.map((run) => run.runIndex));
        const stability = measureYieldStability(group.metrics);
        reliabilityRows.push([
            document,
            config,
            String(summary.repetitions),
            `${num(stability.meanShards, 1)} ± ${num(stability.sdShards, 1)}`,
            stability.coefficientOfVariation === null ? "n/a" : pct(stability.coefficientOfVariation),
            String(summary.clusters),
            pct(summary.clusters === 0 ? null : summary.unanimous / summary.clusters),
            pct(summary.clusters === 0 ? null : summary.singleton / summary.clusters),
            pct(summary.meanSupport),
            pct(summary.meanPairwiseAgreement),
        ]);
    }
    push(...table(
        ["Document", "Config", "Runs", "Shards/run", "CV", "Distinct", "Unanimous", "Once only", "Mean support", "Run agreement"],
        reliabilityRows,
    ), "");
    push("*Distinct* is how many different shards the runs found between them; *unanimous* the share "
        + "found by every run and *once only* the share found by a single run. A shard found once in "
        + "ten is, by the system's own behaviour, not a finding.", "");

    // --- A3. Coverage ------------------------------------------------------------------------------
    push("## B. Coverage and redundancy", "");
    push("How much of each artifact reaches the canvas, and how often the same passage is shredded "
        + "twice. Both are measured over located quotations only, so a fabricated excerpt covers "
        + "nothing.", "");
    const coverageRows: string[][] = [];
    for (const { document, config, metrics: runs } of measured) {
        coverageRows.push([
            document,
            config,
            pct(runs.reduce((sum, run) => sum + run.coverage, 0) / runs.length),
            num(runs.reduce((sum, run) => sum + run.redundancy, 0) / runs.length),
        ]);
    }
    push(...table(["Document", "Config", "Mean coverage", "Mean redundancy"], coverageRows), "");

    // --- C. Groundedness ----------------------------------------------------------------------------
    push("## C. Hallucination: are the quotations real?", "");
    push("Every shard claims a verbatim excerpt and nothing in the product checks it. Each claim is "
        + "tested against **the exact string the model was given**, captured at request time.", "");
    push("Five outcomes, because a citation that fails to resolve and a claim the model invented are "
        + "different failures with different fixes:", "");
    push("- **Exact** — present verbatim, up to case and whitespace.",
        "- **Drifted** — a long contiguous run is present; the quote wandered at an edge.",
        "- **Reassembled** — no run resolves, but nearly every word is the document's: the "
        + "model stitched real passages together. The content is grounded; the citation is broken.",
        "- **Context** — the words belong to the injected study-settings block rather than to "
        + "the artifact. The model cited the wrong half of its input; the fix is in the prompt.",
        "- **Absent** — in neither. This is the fabrication rate.", "");
    push("The two rightmost columns are the ones to quote. *Unresolved* is what the product promises "
        + "against — the share of citations that highlight nothing when a reader clicks "
        + "through. *Fabricated* is what the model is culpable for. The first is always the larger, "
        + "and collapsing them into one number would misstate both.", "");
    const groundRows: string[][] = [];
    for (const { document, config, metrics: runs } of measured) {
        const pooled = poolGroundedness(runs);
        const share = (count: number) => pct(
            pooled.pooled.claimed === 0 ? null : count / pooled.pooled.claimed,
        );
        groundRows.push([
            document,
            config,
            String(pooled.pooled.claimed),
            share(pooled.pooled.exact),
            share(pooled.pooled.partial),
            share(pooled.pooled.reassembled),
            share(pooled.pooled.context),
            pct(pooled.pooled.unresolvedRate),
            pooled.meanAbsentRate === null
                ? pct(pooled.pooled.absentRate)
                : `${pct(pooled.pooled.absentRate)} (per run ${pct(pooled.meanAbsentRate)} ± ${num(pooled.sdAbsentRate * 100, 1)}pp)`,
        ]);
    }
    push(...table(
        ["Document", "Config", "Claims", "Exact", "Drifted", "Reassembled", "Context",
            "Unresolved", "Fabricated"],
        groundRows,
    ), "");

    // --- D. Unsupported numbers and defects -----------------------------------------------------------
    push("## D. Written prose, and what the pipeline does not check", "");
    push("A shard's title and description are written rather than quoted, so a figure in them can be "
        + "invented. Numbers are compared as token sets against the source; thousands separators are "
        + "normalised away. Small numbers often match by coincidence, so this understates fabrication "
        + "rather than overstating it.", "");
    const defectRows: string[][] = [];
    for (const { document, config, metrics: runs } of measured) {
        const shards = runs.reduce((sum, run) => sum + run.shards, 0);
        const sum = (pick: (run: RunMetrics) => number) => runs.reduce((total, run) => total + pick(run), 0);
        defectRows.push([
            document,
            config,
            String(shards),
            pct(shards === 0 ? null : sum((run) => run.shardsWithUnsupportedNumber) / shards),
            String(sum((run) => run.defects.outOfVocabulary)),
            String(sum((run) => run.defects.emptyTitle)),
            String(sum((run) => run.defects.emptyDescription)),
            String(sum((run) => run.defects.duplicate)),
        ]);
    }
    push(...table(
        ["Document", "Config", "Shards", "With unsupported number", "Bad entity", "Empty title", "Empty description", "Duplicates"],
        defectRows,
    ), "");
    push("*Bad entity*, *empty title* and *duplicates* are all reachable today: the response is "
        + "coerced rather than rejected, the model's raw entity string is stored, and nothing "
        + "dedupes shards within a document.", "");

    // --- Failures --------------------------------------------------------------------------------------
    if (failed > 0) {
        push("## E. Failed runs", "");
        push(...table(
            ["Document", "Config", "Run", "Error"],
            file.runs
                .filter((run) => run.error !== undefined)
                .map((run) => [run.document, run.config, String(run.runIndex), run.error ?? ""]),
        ), "");
    }

    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const runsDir = resolve(args.runs ?? "eval/runs");
    const inputFile = args.file ? resolve(args.file) : await newestRunFile(runsDir);
    const outFile = resolve(args.out ?? "eval/report.md");

    const file = JSON.parse(await readFile(inputFile, "utf8")) as EvalRunFile;
    const markdown = render(file);

    await writeFile(outFile, markdown, "utf8");
    console.log(markdown);
    console.log(`\nwrote ${outFile}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
