import type { FastifyPluginAsync } from "fastify";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";

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

type QueryBody = {
    cards?: unknown;
    nodes?: unknown;
    query?: unknown;
    limit?: unknown;
};

type LoadedSystemPaper = {
    fileName: string;
    paper: SystemPaper;
};

type FieldName =
    | "PaperTitle"
    | "GranularBlockName"
    | "PaperDescription"
    | "ReferenceCitation";

type IndexedField = {
    termFreq: Map<string, number>;
    length: number;
};

type IndexedPaper = {
    fileName: string;
    paper: SystemPaper;
    fields: Record<FieldName, IndexedField>;
    termSet: Set<string>;
};

const BM25_K1 = 1.2;

const FIELD_WEIGHTS: Record<FieldName, number> = {
    PaperTitle: 3.0,
    GranularBlockName: 2.5,
    PaperDescription: 1.5,
    ReferenceCitation: 0.6,
};

const FIELD_B: Record<FieldName, number> = {
    PaperTitle: 0.75,
    GranularBlockName: 0.75,
    PaperDescription: 0.75,
    ReferenceCitation: 0.75,
};

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

function indexPaper(entry: LoadedSystemPaper): IndexedPaper {
    const granular = flattenGranularBlocks(entry.paper);

    const fieldText: Record<FieldName, string> = {
        PaperTitle: entry.paper.PaperTitle,
        GranularBlockName: granular.map((block) => block.GranularBlockName).join(" "),
        PaperDescription: granular.map((block) => block.PaperDescription).join(" "),
        ReferenceCitation: granular.map((block) => block.ReferenceCitation).join(" "),
    };

    const fields: Record<FieldName, IndexedField> = {
        PaperTitle: { termFreq: new Map(), length: 0 },
        GranularBlockName: { termFreq: new Map(), length: 0 },
        PaperDescription: { termFreq: new Map(), length: 0 },
        ReferenceCitation: { termFreq: new Map(), length: 0 },
    };

    const termSet = new Set<string>();

    for (const field of Object.keys(fieldText) as FieldName[]) {
        const tokens = tokenize(fieldText[field]);
        fields[field] = {
            termFreq: termFreq(tokens),
            length: tokens.length,
        };

        for (const token of fields[field].termFreq.keys()) {
            termSet.add(token);
        }
    }

    return {
        fileName: entry.fileName,
        paper: entry.paper,
        fields,
        termSet,
    };
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

async function loadSystemPapersFromDisk(): Promise<{
    sourceDir: string;
    papers: LoadedSystemPaper[];
    skippedFiles: string[];
}> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const defaultDir = path.resolve(here, "../../systemPapers");
    const configuredDir = process.env.SYSTEM_PAPERS_DIR?.trim();
    const sourceDir = configuredDir
        ? (path.isAbsolute(configuredDir)
            ? configuredDir
            : path.resolve(process.cwd(), configuredDir))
        : defaultDir;

    let entries: Dirent<string>[];
    try {
        entries = await readdir(sourceDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
        return { sourceDir, papers: [], skippedFiles: [] };
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

    return { sourceDir, papers, skippedFiles };
}

export const systemPapersRoutes: FastifyPluginAsync = async (app) => {
    app.post("/system-papers/query", async (request, reply) => {
        const body = (request.body ?? {}) as QueryBody;
        const queryText = extractQueryText(body);
        const queryTokens = tokenize(queryText);
        const uniqueQueryTokens = Array.from(new Set(queryTokens));

        if (uniqueQueryTokens.length === 0) {
            return reply.status(400).send({
                error: "No valid query text. Send requirement/task cards in `cards` or `nodes`.",
            });
        }

        const requestedLimit = Number(body.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(20, Math.trunc(requestedLimit)))
            : 5;

        const { sourceDir, papers, skippedFiles } = await loadSystemPapersFromDisk();
        if (papers.length === 0) {
            return {
                sourceDir,
                totalPapers: 0,
                skippedFiles,
                queryTerms: uniqueQueryTokens,
                results: [],
            };
        }

        if (skippedFiles.length > 0) {
            request.log.warn({ skippedFiles }, "Some system paper files were skipped due to invalid JSON/shape");
        }

        const indexed = papers.map(indexPaper);

        const avgFieldLen: Record<FieldName, number> = {
            PaperTitle: 0,
            GranularBlockName: 0,
            PaperDescription: 0,
            ReferenceCitation: 0,
        };

        for (const field of Object.keys(avgFieldLen) as FieldName[]) {
            avgFieldLen[field] =
                indexed.reduce((sum, paper) => sum + paper.fields[field].length, 0) /
                Math.max(1, indexed.length);
        }

        const docFreq = new Map<string, number>();
        for (const term of uniqueQueryTokens) {
            let freq = 0;
            for (const paper of indexed) {
                if (paper.termSet.has(term)) freq += 1;
            }
            docFreq.set(term, freq);
        }

        const totalDocs = indexed.length;

        const scored = indexed.map((paper) => {
            let score = 0;
            const matchedTerms: string[] = [];

            for (const term of uniqueQueryTokens) {
                const df = docFreq.get(term) ?? 0;
                if (df <= 0) continue;

                let tfPrime = 0;
                for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
                    const tf = paper.fields[field].termFreq.get(term) ?? 0;
                    if (tf <= 0) continue;

                    const avgLen = Math.max(1, avgFieldLen[field]);
                    const len = paper.fields[field].length;
                    const b = FIELD_B[field];
                    const norm = (1 - b) + b * (len / avgLen);

                    tfPrime += FIELD_WEIGHTS[field] * (tf / Math.max(norm, 1e-9));
                }

                if (tfPrime <= 0) continue;

                const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)));
                const termScore = idf * ((tfPrime * (BM25_K1 + 1)) / (BM25_K1 + tfPrime));
                score += termScore;
                matchedTerms.push(term);
            }

            const coverage = matchedTerms.length / Math.max(1, uniqueQueryTokens.length);

            return {
                fileName: paper.fileName,
                paper: paper.paper,
                score,
                coverage,
                matchedTerms,
            };
        });

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.coverage !== a.coverage) return b.coverage - a.coverage;
            return b.paper.Year - a.paper.Year;
        });

        return {
            sourceDir,
            totalPapers: papers.length,
            skippedFiles,
            queryTerms: uniqueQueryTokens,
            results: scored.slice(0, limit).map((item) => ({
                fileName: item.fileName,
                paperTitle: item.paper.PaperTitle,
                year: item.paper.Year,
                score: Number(item.score.toFixed(6)),
                coverage: Number(item.coverage.toFixed(4)),
                matchedTerms: item.matchedTerms,
                paper: item.paper,
            })),
        };
    });
};
