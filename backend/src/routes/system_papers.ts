import type { FastifyPluginAsync } from "fastify";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile, stat } from "node:fs/promises";

export interface SystemPaper {
    PaperTitle: string;
    Year: number;
    HighBlocks: HighBlock[];
}

export interface HighBlock {
    HighBlockName: string;
    IntermediateBlocks: IntermediateBlock[];
}

export interface IntermediateBlock {
    IntermediateBlockName: string;
    GranularBlocks: GranularBlock[];
}

export interface GranularBlock {
    GranularBlockName: string;
    ID: number;
    PaperDescription: string;
    Inputs: string[];
    Outputs: string[];
    ReferenceCitation: string;
    FeedsInto: number[];
}

/**
 * Whole papers, or the components inside them.
 *
 * The two answer different questions and cannot share a ranking. "Which system in the literature
 * covers this project?" is a question about a paper, and its evidence is spread across everything
 * the paper describes. "What has anyone built that answers *these* requirements?" is a question
 * about one block, and a paper-level score cannot tell you which block it was.
 *
 * They cannot share an IDF either: a term is rare among 101 papers and common among 1434
 * components, or the other way round, and using the wrong denominator silently mis-weights every
 * term in the query.
 */
type Granularity = "paper" | "component";

type QueryBody = {
    cards?: unknown;
    nodes?: unknown;
    query?: unknown;
    limit?: unknown;
    granularity?: unknown;
    /** Component mode only: at most this many components from any one paper. See `PER_PAPER_CAP`. */
    perPaperCap?: unknown;
};

type LoadedSystemPaper = {
    fileName: string;
    paper: SystemPaper;
};

type PaperFieldName =
    | "PaperTitle"
    | "GranularBlockName"
    | "PaperDescription"
    | "ReferenceCitation";

type ComponentFieldName =
    | "GranularBlockName"
    | "PaperDescription"
    | "InputsOutputs"
    | "ReferenceCitation"
    | "IntermediateBlockName"
    | "HighBlockName"
    | "PaperTitle";

type IndexedField = {
    termFreq: Map<string, number>;
    length: number;
};

/** One retrievable thing — a paper or a component — reduced to weighted term frequencies. */
type IndexedDoc<F extends string> = {
    fields: Record<F, IndexedField>;
    termSet: Set<string>;
};

type IndexedPaper = IndexedDoc<PaperFieldName> & {
    fileName: string;
    paper: SystemPaper;
};

type IndexedComponent = IndexedDoc<ComponentFieldName> & {
    fileName: string;
    paperTitle: string;
    year: number;
    highBlockName: string;
    intermediateBlockName: string;
    granularBlock: GranularBlock;
};

const BM25_K1 = 1.2;

const PAPER_FIELD_WEIGHTS: Record<PaperFieldName, number> = {
    PaperTitle: 3.0,
    GranularBlockName: 2.5,
    PaperDescription: 1.5,
    ReferenceCitation: 0.6,
};

/**
 * Component field weights, chosen against what the corpus actually contains rather than by analogy
 * with the paper weights above. Measured over all 101 files: 1434 components, median 14 per paper.
 *
 * - `GranularBlockName` is the name of the thing, but it is a **median of two words** and often
 *   entirely generic — "Crime", "Map 2D", "Set Operations", "Area Selection". It gets the top weight
 *   because a hit there is the most direct evidence there is, and it still cannot carry a ranking
 *   alone, which is why the ancestor fields exist at all.
 * - `InputsOutputs` and `ReferenceCitation` are where the discriminating text lives: inputs/outputs
 *   are populated on **100%** of components and name real data ("Crime event records (type,
 *   timestamp, geolocation)"), and `ReferenceCitation` is not a citation key but a prose excerpt,
 *   median 25 words and never empty. Both were indexed nowhere before — inputs and outputs were not
 *   even carried to the client.
 * - The three ancestor fields disambiguate a generic name: a "Filtering" under "Interaction" is a
 *   different component from a "Filtering" under "Data Wrangling". They are weighted low on purpose.
 *   Every component in a paper shares its `PaperTitle`, so weighting that highly would lift a whole
 *   paper's components together and turn component search back into paper search — the failure the
 *   per-paper cap also guards against.
 */
const COMPONENT_FIELD_WEIGHTS: Record<ComponentFieldName, number> = {
    GranularBlockName: 3.0,
    InputsOutputs: 1.6,
    PaperDescription: 1.5,
    ReferenceCitation: 0.9,
    IntermediateBlockName: 0.8,
    HighBlockName: 0.6,
    PaperTitle: 0.4,
};

const DEFAULT_FIELD_B = 0.75;

/** Component mode: how many components one paper may contribute before the rest are passed over. */
const PER_PAPER_CAP = 3;

const TASK_CARD_LABELS = new Set(["requirement", "task"]);

const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function safeString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function safeNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function safeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

function safeNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => safeNumber(item, Number.NaN))
        .filter((item) => Number.isFinite(item));
}

function tokenize(text: string): string[] {
    const normalized = text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");

    return normalized
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function termFreq(tokens: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const token of tokens) {
        out.set(token, (out.get(token) ?? 0) + 1);
    }
    return out;
}

function normalizeGranularBlock(raw: unknown): GranularBlock | null {
    if (!isRecord(raw)) return null;
    return {
        GranularBlockName: safeString(raw.GranularBlockName),
        ID: safeNumber(raw.ID, 0),
        PaperDescription: safeString(raw.PaperDescription),
        Inputs: safeStringArray(raw.Inputs),
        Outputs: safeStringArray(raw.Outputs),
        ReferenceCitation: safeString(raw.ReferenceCitation),
        FeedsInto: safeNumberArray(raw.FeedsInto),
    };
}

function normalizeIntermediateBlock(raw: unknown): IntermediateBlock | null {
    if (!isRecord(raw)) return null;
    const granularRaw = Array.isArray(raw.GranularBlocks) ? raw.GranularBlocks : [];
    const granular = granularRaw
        .map(normalizeGranularBlock)
        .filter((item): item is GranularBlock => item !== null);

    return {
        IntermediateBlockName: safeString(raw.IntermediateBlockName),
        GranularBlocks: granular,
    };
}

function normalizeHighBlock(raw: unknown): HighBlock | null {
    if (!isRecord(raw)) return null;
    const intermediateRaw = Array.isArray(raw.IntermediateBlocks) ? raw.IntermediateBlocks : [];
    const intermediate = intermediateRaw
        .map(normalizeIntermediateBlock)
        .filter((item): item is IntermediateBlock => item !== null);

    return {
        HighBlockName: safeString(raw.HighBlockName),
        IntermediateBlocks: intermediate,
    };
}

function normalizeSystemPaper(raw: unknown, fallbackTitle: string): SystemPaper | null {
    if (!isRecord(raw)) return null;
    const highBlocksRaw = Array.isArray(raw.HighBlocks) ? raw.HighBlocks : [];
    const highBlocks = highBlocksRaw
        .map(normalizeHighBlock)
        .filter((item): item is HighBlock => item !== null);

    return {
        PaperTitle: safeString(raw.PaperTitle) || fallbackTitle,
        Year: safeNumber(raw.Year, 0),
        HighBlocks: highBlocks,
    };
}

function flattenGranularBlocks(paper: SystemPaper): GranularBlock[] {
    const granular: GranularBlock[] = [];
    for (const high of paper.HighBlocks) {
        for (const intermediate of high.IntermediateBlocks) {
            granular.push(...intermediate.GranularBlocks);
        }
    }
    return granular;
}

/** Turn a map of field name to raw text into the term frequencies BM25F scores over. */
function indexFields<F extends string>(fieldText: Record<F, string>): IndexedDoc<F> {
    const fields = {} as Record<F, IndexedField>;
    const termSet = new Set<string>();

    for (const field of Object.keys(fieldText) as F[]) {
        const tokens = tokenize(fieldText[field]);
        fields[field] = {
            termFreq: termFreq(tokens),
            length: tokens.length,
        };

        for (const token of fields[field].termFreq.keys()) {
            termSet.add(token);
        }
    }

    return { fields, termSet };
}

function indexPaper(entry: LoadedSystemPaper): IndexedPaper {
    const granular = flattenGranularBlocks(entry.paper);

    return {
        fileName: entry.fileName,
        paper: entry.paper,
        ...indexFields<PaperFieldName>({
            PaperTitle: entry.paper.PaperTitle,
            GranularBlockName: granular.map((block) => block.GranularBlockName).join(" "),
            PaperDescription: granular.map((block) => block.PaperDescription).join(" "),
            ReferenceCitation: granular.map((block) => block.ReferenceCitation).join(" "),
        }),
    };
}

function indexComponents(entry: LoadedSystemPaper): IndexedComponent[] {
    const out: IndexedComponent[] = [];

    for (const high of entry.paper.HighBlocks) {
        for (const intermediate of high.IntermediateBlocks) {
            for (const granular of intermediate.GranularBlocks) {
                out.push({
                    fileName: entry.fileName,
                    paperTitle: entry.paper.PaperTitle,
                    year: entry.paper.Year,
                    highBlockName: high.HighBlockName,
                    intermediateBlockName: intermediate.IntermediateBlockName,
                    granularBlock: granular,
                    ...indexFields<ComponentFieldName>({
                        GranularBlockName: granular.GranularBlockName,
                        PaperDescription: granular.PaperDescription,
                        InputsOutputs: [...granular.Inputs, ...granular.Outputs].join(" "),
                        ReferenceCitation: granular.ReferenceCitation,
                        IntermediateBlockName: intermediate.IntermediateBlockName,
                        HighBlockName: high.HighBlockName,
                        PaperTitle: entry.paper.PaperTitle,
                    }),
                });
            }
        }
    }

    return out;
}

type Scored<T> = {
    doc: T;
    score: number;
    coverage: number;
    matchedTerms: string[];
};

/**
 * BM25F over a set of documents, shared by both granularities.
 *
 * The corpus passed in **is** the IDF corpus: rarity is a property of the population being searched,
 * so scoring components against paper-level document frequencies would weight every term wrongly.
 * That is the whole reason this takes the docs rather than reading a module-level index.
 */
function scoreDocs<F extends string, T extends IndexedDoc<F>>(
    docs: T[],
    queryTokens: string[],
    fieldWeights: Record<F, number>,
): Scored<T>[] {
    const fieldNames = Object.keys(fieldWeights) as F[];

    const avgFieldLen = {} as Record<F, number>;
    for (const field of fieldNames) {
        avgFieldLen[field] = docs.reduce((sum, doc) => sum + doc.fields[field].length, 0)
            / Math.max(1, docs.length);
    }

    const docFreq = new Map<string, number>();
    for (const term of queryTokens) {
        let freq = 0;
        for (const doc of docs) {
            if (doc.termSet.has(term)) freq += 1;
        }
        docFreq.set(term, freq);
    }

    const totalDocs = docs.length;

    return docs.map((doc) => {
        let score = 0;
        const matchedTerms: string[] = [];

        for (const term of queryTokens) {
            const df = docFreq.get(term) ?? 0;
            if (df <= 0) continue;

            let tfPrime = 0;
            for (const field of fieldNames) {
                const tf = doc.fields[field].termFreq.get(term) ?? 0;
                if (tf <= 0) continue;

                const avgLen = Math.max(1, avgFieldLen[field]);
                const len = doc.fields[field].length;
                const norm = (1 - DEFAULT_FIELD_B) + DEFAULT_FIELD_B * (len / avgLen);

                tfPrime += fieldWeights[field] * (tf / Math.max(norm, 1e-9));
            }

            if (tfPrime <= 0) continue;

            const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)));
            score += idf * ((tfPrime * (BM25_K1 + 1)) / (BM25_K1 + tfPrime));
            matchedTerms.push(term);
        }

        return {
            doc,
            score,
            coverage: matchedTerms.length / Math.max(1, queryTokens.length),
            matchedTerms,
        };
    });
}

function keepCardByLabel(cardLike: Record<string, unknown>): boolean {
    const label = cardLike.label;
    if (typeof label !== "string") return true;
    const normalized = label.trim().toLowerCase();
    if (!normalized) return true;
    return TASK_CARD_LABELS.has(normalized);
}

function extractTextFromCardLike(value: unknown): string {
    if (!isRecord(value)) return "";
    if (!keepCardByLabel(value)) return "";

    const chunks = [
        safeString(value.title),
        safeString(value.description),
        safeString(value.text),
        safeString(value.content),
    ].filter(Boolean);

    return chunks.join(" ").trim();
}

function extractQueryText(body: QueryBody): string {
    const chunks: string[] = [];

    if (typeof body.query === "string") {
        chunks.push(body.query);
    }

    if (Array.isArray(body.cards)) {
        for (const card of body.cards) {
            const text = extractTextFromCardLike(card);
            if (text) chunks.push(text);
        }
    }

    if (Array.isArray(body.nodes)) {
        for (const node of body.nodes) {
            if (!isRecord(node)) continue;
            const data = isRecord(node.data) ? node.data : node;
            const text = extractTextFromCardLike(data);
            if (text) chunks.push(text);
        }
    }

    return chunks.join(" ").trim();
}

function resolveSourceDir(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const defaultDir = path.resolve(here, "../../systemPapers");
    const configuredDir = process.env.SYSTEM_PAPERS_DIR?.trim();
    if (!configuredDir) return defaultDir;
    return path.isAbsolute(configuredDir)
        ? configuredDir
        : path.resolve(process.cwd(), configuredDir);
}

async function loadSystemPapersFromDisk(sourceDir: string): Promise<{
    papers: LoadedSystemPaper[];
    skippedFiles: string[];
}> {
    let entries: Dirent<string>[];
    try {
        entries = await readdir(sourceDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
        return { papers: [], skippedFiles: [] };
    }

    const jsonFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const papers: LoadedSystemPaper[] = [];
    const skippedFiles: string[] = [];

    for (const fileName of jsonFiles) {
        try {
            const fullPath = path.join(sourceDir, fileName);
            const rawText = await readFile(fullPath, "utf8");
            const parsed = JSON.parse(rawText) as unknown;
            const fallbackTitle = fileName.replace(/\.json$/i, "");
            const normalized = normalizeSystemPaper(parsed, fallbackTitle);
            if (!normalized) {
                skippedFiles.push(fileName);
                continue;
            }

            papers.push({ fileName, paper: normalized });
        } catch {
            skippedFiles.push(fileName);
        }
    }

    return { papers, skippedFiles };
}

type CorpusIndex = {
    sourceDir: string;
    papers: LoadedSystemPaper[];
    skippedFiles: string[];
    indexedPapers: IndexedPaper[];
    indexedComponents: IndexedComponent[];
};

/**
 * The corpus, read and tokenised once rather than on every request.
 *
 * It used to be re-read and re-indexed per call: 101 files off disk, then every field of every paper
 * re-tokenised, to answer a query that changes far less often than that. The corpus is static —
 * ~1400 components of roughly 55 words each, a few megabytes of maps — so it belongs in memory.
 *
 * Invalidation is the directory's own mtime, which moves whenever a file is added, removed or
 * renamed. A paper edited **in place** does not touch it, so a developer changing one file restarts
 * the backend; that is the trade for not stat-ing 101 files per request. `SYSTEM_PAPERS_DIR` is read
 * on every call, so pointing the env var somewhere else takes effect without a restart.
 */
let corpusCache: { key: string; index: CorpusIndex } | null = null;
let corpusInFlight: Promise<CorpusIndex> | null = null;

async function loadCorpus(): Promise<CorpusIndex> {
    const sourceDir = resolveSourceDir();

    let key = `${sourceDir}|missing`;
    try {
        const info = await stat(sourceDir);
        key = `${sourceDir}|${info.mtimeMs}`;
    } catch {
        // Left as "missing": an absent directory still answers, with no papers.
    }

    if (corpusCache && corpusCache.key === key) return corpusCache.index;

    // Two requests arriving cold would otherwise both read and index the whole corpus.
    if (corpusInFlight) {
        const pending = await corpusInFlight;
        if (corpusCache && corpusCache.key === key) return corpusCache.index;
        return pending;
    }

    corpusInFlight = (async () => {
        const { papers, skippedFiles } = await loadSystemPapersFromDisk(sourceDir);
        const index: CorpusIndex = {
            sourceDir,
            papers,
            skippedFiles,
            indexedPapers: papers.map(indexPaper),
            indexedComponents: papers.flatMap(indexComponents),
        };
        corpusCache = { key, index };
        return index;
    })();

    try {
        return await corpusInFlight;
    } finally {
        corpusInFlight = null;
    }
}

function resolveGranularity(value: unknown): Granularity {
    return value === "component" ? "component" : "paper";
}

export const systemPapersRoutes: FastifyPluginAsync = async (app) => {
    app.post("/system-papers/query", async (request, reply) => {
        const body = (request.body ?? {}) as QueryBody;
        const granularity = resolveGranularity(body.granularity);
        const queryText = extractQueryText(body);
        const queryTokens = tokenize(queryText);
        const uniqueQueryTokens = Array.from(new Set(queryTokens));

        if (uniqueQueryTokens.length === 0) {
            return reply.status(400).send({
                error: granularity === "component"
                    ? "No valid query text. Select at least one requirement card with a title or description."
                    : "No valid query text. Send requirement/task cards in `cards` or `nodes`.",
            });
        }

        const requestedLimit = Number(body.limit);
        const defaultLimit = granularity === "component" ? 12 : 5;
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(40, Math.trunc(requestedLimit)))
            : defaultLimit;

        const corpus = await loadCorpus();
        const base = {
            sourceDir: corpus.sourceDir,
            totalPapers: corpus.papers.length,
            skippedFiles: corpus.skippedFiles,
            granularity,
            queryTerms: uniqueQueryTokens,
        };

        if (corpus.papers.length === 0) {
            return { ...base, totalComponents: 0, results: [] };
        }

        if (corpus.skippedFiles.length > 0) {
            request.log.warn(
                { skippedFiles: corpus.skippedFiles },
                "Some system paper files were skipped due to invalid JSON/shape",
            );
        }

        if (granularity === "component") {
            const requestedCap = Number(body.perPaperCap);
            const perPaperCap = Number.isFinite(requestedCap)
                ? Math.max(1, Math.min(40, Math.trunc(requestedCap)))
                : PER_PAPER_CAP;

            const scored = scoreDocs(corpus.indexedComponents, uniqueQueryTokens, COMPONENT_FIELD_WEIGHTS)
                .filter((item) => item.score > 0)
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
                    if (b.doc.year !== a.doc.year) return b.doc.year - a.doc.year;
                    return a.doc.granularBlock.GranularBlockName
                        .localeCompare(b.doc.granularBlock.GranularBlockName);
                });

            // One well-matched paper contributes fourteen components, which would fill the list and
            // turn this back into the paper search it exists to be an alternative to. Taking the
            // best few from each spreads the answer across the literature, which is what a
            // researcher looking for a component to borrow is actually after.
            const takenByPaper = new Map<string, number>();
            const results = [];
            for (const item of scored) {
                if (results.length >= limit) break;
                const taken = takenByPaper.get(item.doc.fileName) ?? 0;
                if (taken >= perPaperCap) continue;
                takenByPaper.set(item.doc.fileName, taken + 1);

                results.push({
                    fileName: item.doc.fileName,
                    paperTitle: item.doc.paperTitle,
                    year: item.doc.year,
                    highBlockName: item.doc.highBlockName,
                    intermediateBlockName: item.doc.intermediateBlockName,
                    score: Number(item.score.toFixed(6)),
                    coverage: Number(item.coverage.toFixed(4)),
                    matchedTerms: item.matchedTerms,
                    granularBlock: item.doc.granularBlock,
                });
            }

            return {
                ...base,
                totalComponents: corpus.indexedComponents.length,
                perPaperCap,
                results,
            };
        }

        const scored = scoreDocs(corpus.indexedPapers, uniqueQueryTokens, PAPER_FIELD_WEIGHTS)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.coverage !== a.coverage) return b.coverage - a.coverage;
                return b.doc.paper.Year - a.doc.paper.Year;
            });

        return {
            ...base,
            totalComponents: corpus.indexedComponents.length,
            results: scored.slice(0, limit).map((item) => ({
                fileName: item.doc.fileName,
                paperTitle: item.doc.paper.PaperTitle,
                year: item.doc.paper.Year,
                score: Number(item.score.toFixed(6)),
                coverage: Number(item.coverage.toFixed(4)),
                matchedTerms: item.matchedTerms,
                paper: item.doc.paper,
            })),
        };
    });
};
