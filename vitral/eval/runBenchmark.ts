import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { parseFile } from "@/func/FileParser";
import { requestCardsLLMObserved, type LlmProjectSettingsContext } from "@/func/LLMRequest";
import { normalizeArtifactEntity } from "@/pages/projectEditor/graphSemantics";
import type { EvalRun, EvalRunFile, EvalShard } from "@/eval/evalTypes";

/**
 * Push a fixed corpus through the real sharding pipeline, many times, and write down what happened.
 *
 * ## Why repetition rather than labelling
 *
 * The reviewer asked how well sharding performs. Answering with ratings is what drew the objection,
 * and answering with a hand-coded gold set costs a labelling study. Repetition answers a narrower
 * question honestly and for free: run the same artifact ten times and see what survives. A shard the
 * sharder finds every time is a finding; one it finds once is a coin toss, whatever a rater would
 * have said about it in isolation. Nothing here needs a label, and the only ground truth is the
 * input document.
 *
 * ## Why it drives the product's own code
 *
 * `requestCardsLLMObserved` is `requestCardsLLM` with the request payload handed back — the same
 * function, not a copy — so prompt assembly, the docling round trip, the JSON recovery, the field
 * coercion and the entity normalisation are all the shipped path. A benchmark that rebuilt any of
 * that would be measuring the rebuild. `parseFile` is likewise the product's, which is possible
 * because it touches no browser API for the formats this corpus uses.
 *
 * Images are excluded on purpose: `buildFilePromptRequest` compresses them through a `canvas`, which
 * has no headless equivalent here. Say so in the paper rather than quietly benchmarking five formats
 * and calling it six.
 *
 * ## Two commands, not one
 *
 * This writes raw output and computes nothing. `report.ts` reads it. The split is not tidiness: the
 * run costs money and cannot be repeated identically, so the numbers have to be re-derivable from
 * what one run produced, and a bug in a metric must not mean paying for the corpus again.
 *
 * Usage:
 *   npm run eval:run -- --runs 10 --corpus ../examples --configs baseline,no-context
 */

type Config = {
    name: string;
    model: string | undefined;
    /** Whether to send `projectSettings` at all. The context block is one of the ablations. */
    withProjectSettings: boolean;
};

const DEFAULT_CONFIGS: Config[] = [
    // `baseline` leaves the model unset, so the backend picks it — today that is `gpt-5-nano`, not
    // the model the paper reports. Pin it explicitly when the number is going into print.
    { name: "baseline", model: undefined, withProjectSettings: true },
    { name: "gpt-5.2", model: "gpt-5.2", withProjectSettings: true },
    { name: "no-context", model: undefined, withProjectSettings: false },
    { name: "gpt-5-mini", model: "gpt-5-mini", withProjectSettings: true },
];

/**
 * Formats the harness can drive end to end. `pdf` and `docx` go through docling, which is a service
 * call and works headlessly; images do not, for the reason above.
 */
const SUPPORTED = new Set(["md", "txt", "csv", "json", "ipynb", "py", "js", "ts", "html", "css", "pdf", "docx"]);

const MIME_BY_EXT: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    ipynb: "application/json",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * A fixed, invented study context.
 *
 * Constant across every run and every document, because it rides in the prompt: letting it vary
 * would put a second uncontrolled variable next to the one being measured. Deliberately plausible
 * but not real, so the corpus can be published with the paper.
 */
const PROJECT_SETTINGS: LlmProjectSettingsContext = {
    projectTitle: "Benchmark study",
    projectGoal: "Evaluate how reliably artifacts are decomposed into knowledge shards.",
    participants: [{ name: "P01", role: "domain expert" }],
    availableRoles: ["domain expert", "designer"],
    timeline: {
        start: "2026-01-01",
        end: "2026-06-30",
        defaultStages: [],
        stages: [],
        milestones: [],
    },
};

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

/**
 * A corpus directory documents itself, and `README.md` is a supported extension, so without this the
 * harness benchmarks its own instructions and puts a row for them in the paper's table.
 */
const NOT_CORPUS = new Set(["readme.md", "readme.txt"]);

async function loadCorpus(directory: string): Promise<Array<{ name: string; bytes: Buffer }>> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: Array<{ name: string; bytes: Buffer }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile()) continue;
        if (NOT_CORPUS.has(entry.name.toLowerCase())) continue;
        const ext = extname(entry.name).replace(".", "").toLowerCase();
        if (!SUPPORTED.has(ext)) continue;
        files.push({ name: entry.name, bytes: await readFile(join(directory, entry.name)) });
    }
    return files;
}

function toShards(cards: Array<{ entity: string; title: string; description?: string; reference?: string }>): EvalShard[] {
    return cards.map((card) => ({
        entity: String(card.entity ?? ""),
        label: normalizeArtifactEntity(card.entity),
        title: String(card.title ?? ""),
        description: String(card.description ?? ""),
        reference: String(card.reference ?? ""),
    }));
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const repetitions = Number(args.runs ?? 10);
    const corpusDir = resolve(args.corpus ?? "eval/corpus");
    const outDir = resolve(args.out ?? "eval/runs");
    const configs = args.configs === undefined
        ? DEFAULT_CONFIGS
        : DEFAULT_CONFIGS.filter((config) => args.configs.split(",").includes(config.name));

    if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
        throw new Error(`--runs must be a positive integer, got ${args.runs}`);
    }
    if (configs.length === 0) {
        throw new Error(`No configuration matched --configs ${args.configs}`);
    }

    const corpus = await loadCorpus(corpusDir);
    if (corpus.length === 0) {
        throw new Error(`No supported documents in ${corpusDir}. Supported: ${[...SUPPORTED].join(", ")}`);
    }

    console.log(`corpus   ${corpus.length} document(s) from ${corpusDir}`);
    console.log(`configs  ${configs.map((config) => config.name).join(", ")}`);
    console.log(`runs     ${repetitions} per document per configuration`);
    console.log(`total    ${corpus.length * configs.length * repetitions} model calls\n`);

    const runs: EvalRun[] = [];
    for (const document of corpus) {
        for (const config of configs) {
            for (let runIndex = 0; runIndex < repetitions; runIndex += 1) {
                const label = `${document.name} ${config.name} #${runIndex}`;
                const startedAt = Date.now();
                try {
                    // A fresh `File` per run: `parseFile` reads it, and a consumed stream would make
                    // the second run of a document silently different from the first.
                    const ext = extname(document.name).replace(".", "").toLowerCase();
                    const file = new File([new Uint8Array(document.bytes)], document.name, {
                        type: MIME_BY_EXT[ext] ?? "application/octet-stream",
                    });
                    const pending = await parseFile(file);

                    const settings = config.withProjectSettings
                        ? { ...PROJECT_SETTINGS, llmModel: config.model }
                        : undefined;
                    const { cards, payload } = await requestCardsLLMObserved(pending, settings);

                    // The exact strings the model was handed, recovered from the payload rather than
                    // rebuilt. This is what makes the groundedness verdict exact.
                    const sent = JSON.parse(payload.userText) as Record<string, unknown>;
                    const { content, ...context } = sent;

                    runs.push({
                        document: document.name,
                        runIndex,
                        config: config.name,
                        model: config.model ?? "default",
                        promptName: payload.prompt,
                        sourceText: String(content ?? ""),
                        contextText: JSON.stringify(context),
                        shards: toShards(cards),
                        elapsedMs: Date.now() - startedAt,
                    });
                    console.log(`ok    ${label}  ${runs[runs.length - 1].shards.length} shards`);
                } catch (caught) {
                    // Recorded rather than thrown: one failed call must not cost the whole corpus,
                    // and a configuration that fails often is itself a result.
                    const message = caught instanceof Error ? caught.message : String(caught);
                    runs.push({
                        document: document.name,
                        runIndex,
                        config: config.name,
                        model: config.model ?? "default",
                        promptName: "",
                        sourceText: "",
                        contextText: "",
                        shards: [],
                        elapsedMs: Date.now() - startedAt,
                        error: message,
                    });
                    console.log(`FAIL  ${label}  ${message}`);
                }
            }
        }
    }

    const payload: EvalRunFile = {
        startedAt: new Date().toISOString(),
        repetitions,
        runs,
    };

    await mkdir(outDir, { recursive: true });
    // `shards-` so the cross-link captures written beside these stay distinguishable: both are
    // JSON in `eval/runs/`, and "the newest one" is not a safe way to tell them apart.
    const outFile = join(outDir, `shards-${payload.startedAt.replace(/[:.]/g, "-")}.json`);
    await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const failed = runs.filter((run) => run.error !== undefined).length;
    console.log(`\nwrote ${basename(outFile)} — ${runs.length} run(s), ${failed} failed`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
