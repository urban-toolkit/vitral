import OpenAI from "openai";

const CARD_LABELS = new Set([
    "person",
    "activity",
    "requirement",
    "concept",
    "insight",
    "object",
    "blueprint_component",
]);

type UnknownRecord = Record<string, unknown>;

export type NodeStructuredFilters = {
    labels?: string[];
    createdAtFrom?: string;
    createdAtTo?: string;
    titleContains?: string[];
    descriptionContains?: string[];
};

export type ParsedNodeQuery = {
    semanticQuery: string;
    structuredFilters?: NodeStructuredFilters;
};

export type CardNodeForSearch = {
    id: string;
    label: string;
    title: string;
    description: string;
    createdAt: string | null;
};

type LoggerLike = {
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const arr = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    return arr.length > 0 ? arr : undefined;
}

function parseIso(value: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractJsonObject(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? match[0] : trimmed;
}

function sanitizeStructuredFilters(value: unknown): NodeStructuredFilters | undefined {
    if (!isRecord(value)) return undefined;

    const rawLabels = normalizeStringArray(value.labels);
    const labels = rawLabels
        ?.map((label) => {
            const normalized = label.toLowerCase();
            return normalized === "task" ? "requirement" : normalized;
        })
        .filter((label) => CARD_LABELS.has(label));

    const createdAtFrom = isNonEmptyString(value.createdAtFrom) ? value.createdAtFrom.trim() : undefined;
    const createdAtTo = isNonEmptyString(value.createdAtTo) ? value.createdAtTo.trim() : undefined;
    const titleContains = normalizeStringArray(value.titleContains);
    const descriptionContains = normalizeStringArray(value.descriptionContains);

    const cleaned: NodeStructuredFilters = {};
    if (labels && labels.length > 0) cleaned.labels = Array.from(new Set(labels));
    if (createdAtFrom) cleaned.createdAtFrom = createdAtFrom;
    if (createdAtTo) cleaned.createdAtTo = createdAtTo;
    if (titleContains && titleContains.length > 0) cleaned.titleContains = titleContains;
    if (descriptionContains && descriptionContains.length > 0) cleaned.descriptionContains = descriptionContains;

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function sanitizeParsedQuery(value: unknown, fallbackSemanticQuery: string): ParsedNodeQuery {
    if (!isRecord(value)) {
        return {
            semanticQuery: fallbackSemanticQuery,
        };
    }

    const semanticQuery = isNonEmptyString(value.semanticQuery)
        ? value.semanticQuery.trim()
        : fallbackSemanticQuery;

    const structuredFilters = sanitizeStructuredFilters(value.structuredFilters);
    return {
        semanticQuery,
        structuredFilters,
    };
}

export function extractCardNodesForSearch(state: unknown): CardNodeForSearch[] {
    if (!isRecord(state)) return [];
    const flow = state.flow;
    if (!isRecord(flow) || !Array.isArray(flow.nodes)) return [];

    const nodes: CardNodeForSearch[] = [];

    for (const rawNode of flow.nodes) {
        if (!isRecord(rawNode)) continue;
        if (typeof rawNode.id !== "string" || rawNode.id.trim().length === 0) continue;
        const nodeType = typeof rawNode.type === "string" ? rawNode.type : "";
        const isSearchableType = nodeType === "card" || nodeType === "blueprintComponent";
        if (!isSearchableType) continue;

        const data = isRecord(rawNode.data) ? rawNode.data : {};
        let label = isNonEmptyString(data.label) ? data.label.trim().toLowerCase() : "";
        if (label === "task") {
            label = "requirement";
        }

        nodes.push({
            id: rawNode.id,
            label,
            title: isNonEmptyString(data.title) ? data.title.trim() : "",
            description: isNonEmptyString(data.description) ? data.description.trim() : "",
            createdAt: isNonEmptyString(data.createdAt) ? data.createdAt.trim() : null,
        });
    }

    return nodes;
}

export function applyStructuredFilters(nodes: CardNodeForSearch[], filters?: NodeStructuredFilters): CardNodeForSearch[] {
    if (!filters) return nodes;

    const labelSet = filters.labels ? new Set(filters.labels.map((label) => label.toLowerCase())) : null;
    const createdAtFrom = parseIso(filters.createdAtFrom ?? null);
    const createdAtTo = parseIso(filters.createdAtTo ?? null);
    const titleContains = filters.titleContains?.map((value) => value.toLowerCase()) ?? [];
    const descriptionContains = filters.descriptionContains?.map((value) => value.toLowerCase()) ?? [];

    return nodes.filter((node) => {
        if (labelSet && !labelSet.has(node.label)) {
            return false;
        }

        if (createdAtFrom !== null || createdAtTo !== null) {
            const nodeCreatedAt = parseIso(node.createdAt);
            if (nodeCreatedAt === null) return false;
            if (createdAtFrom !== null && nodeCreatedAt < createdAtFrom) return false;
            if (createdAtTo !== null && nodeCreatedAt > createdAtTo) return false;
        }

        if (titleContains.length > 0) {
            const haystack = node.title.toLowerCase();
            const hasTitleMatch = titleContains.some((needle) => haystack.includes(needle));
            if (!hasTitleMatch) return false;
        }

        if (descriptionContains.length > 0) {
            const haystack = node.description.toLowerCase();
            const hasDescriptionMatch = descriptionContains.some((needle) => haystack.includes(needle));
            if (!hasDescriptionMatch) return false;
        }

        return true;
    });
}

export async function parseNaturalLanguageNodeQuery(
    client: OpenAI | null,
    query: string,
    logger: LoggerLike,
): Promise<ParsedNodeQuery> {
    const fallback: ParsedNodeQuery = { semanticQuery: query.trim() };
    if (!client) return fallback;

    const parsePrompt = [
        "You parse a natural language query over knowledge cards and blueprint components into semantic and structured filters.",
        "Return ONLY a JSON object with this shape:",
        "{",
        '  "semanticQuery": "string",',
        '  "structuredFilters": {',
        '    "labels": ["person" | "activity" | "requirement" | "concept" | "insight" | "object" | "blueprint_component"],',
        '    "createdAtFrom": "ISO-8601 datetime string",',
        '    "createdAtTo": "ISO-8601 datetime string",',
        '    "titleContains": ["string"],',
        '    "descriptionContains": ["string"]',
        "  }",
        "}",
        "Rules:",
        "- Keep semanticQuery to the part that should be used in embedding similarity.",
        "- Move explicit constraints (labels, date bounds, exact textual constraints) into structuredFilters.",
        "- If query is mostly structural, semanticQuery can be an empty string.",
        "- Omit structuredFilters keys that are not present.",
        "- No markdown, no explanations, JSON only.",
        "",
        `User query: ${query}`,
    ].join("\n");

    try {
        const response = await client.responses.create({
            model: process.env.OPENAI_QUERY_PARSER_MODEL || "gpt-5-nano",
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: parsePrompt,
                        },
                    ],
                },
            ],
        });

        const rawText = response.output_text ?? "";
        const jsonText = extractJsonObject(rawText);
        const parsedUnknown = JSON.parse(jsonText) as unknown;
        return sanitizeParsedQuery(parsedUnknown, query.trim());
    } catch (error) {
        logger.warn({ error }, "Failed to parse node query with LLM. Falling back to semantic-only query.");
        return fallback;
    }
}

