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

/**
 * What a researcher calls a card, mapped to what the ontology calls it.
 *
 * The seven labels above are internal names. Nobody types "an object card" or "blueprint_component"
 * — they ask about documents, participants, findings, goals. Before this table the only synonym in
 * the whole pipeline was `task -> requirement`, so any question phrased in ordinary English either
 * produced no label filter (harmless) or one the sanitizer then dropped on the floor. That is most of
 * what made the assistant feel like it had to be addressed in its own vocabulary.
 *
 * **Deliberately narrow.** It is consulted from `rankNodesBySemanticQuery`, which canonicalizes every
 * token of the query, so an entry here does not only translate a card type the user named — it lifts
 * that whole card type for any question containing the word. Ordinary domain vocabulary is therefore
 * left out on purpose, however tempting the mapping reads: "data", "user", "code", "study", "result"
 * and "learning" all name a kind of card in some sentences and are ordinary content words in most
 * ("data quality", "user interface", "machine learning", "summarise the study"). Mapping those would
 * bias retrieval on nearly every question a design study asks. Semantic similarity already covers
 * them; this table exists for the words that are *only* ever a card kind.
 *
 * Entries are singular. `canonicalCardLabel` tries the word and each of its de-pluralisations, so one
 * entry covers both forms.
 */
const CARD_LABEL_SYNONYMS = new Map<string, string>(Object.entries({
    // person
    people: "person", participant: "person", interviewee: "person", stakeholder: "person",
    // activity
    event: "activity", session: "activity", meeting: "activity", interview: "activity",
    workshop: "activity",
    // requirement
    task: "requirement", goal: "requirement", need: "requirement", objective: "requirement",
    spec: "requirement", specification: "requirement", criterion: "requirement",
    criteria: "requirement",
    // concept
    idea: "concept", theme: "concept", topic: "concept",
    // insight
    finding: "insight", takeaway: "insight", observation: "insight", lesson: "insight",
    conclusion: "insight",
    // object
    artifact: "object", artefact: "object", document: "object", file: "object", dataset: "object",
    image: "object", sketch: "object", screenshot: "object", note: "object", transcript: "object",
    // blueprint_component
    component: "blueprint_component", "blueprint component": "blueprint_component",
    "system component": "blueprint_component", module: "blueprint_component",
    widget: "blueprint_component",
}));

/** Whether `value` is already one of the seven ontology labels. */
export function isCardLabel(value: string): boolean {
    return CARD_LABELS.has(value);
}

/**
 * A user's word for a card kind, as one of the seven labels — or the input, lowercased, if it is
 * neither.
 *
 * Every de-pluralisation is tried rather than the first one that applies, which is not fussiness: a
 * single `-es` rule turns "notes" into "not" and "images" into "imag", and stops there, so the words
 * most likely to be typed were the ones that failed. Trying "notes", then "not", then "note" costs
 * three map lookups and gets all of them.
 */
export function canonicalCardLabel(raw: string): string {
    const normalized = raw.trim().toLowerCase().replace(/[_\s]+/g, " ");

    const candidates = [normalized];
    if (normalized.endsWith("ies")) candidates.push(`${normalized.slice(0, -3)}y`);
    if (normalized.endsWith("es")) candidates.push(normalized.slice(0, -2));
    if (normalized.endsWith("s")) candidates.push(normalized.slice(0, -1));

    for (const candidate of candidates) {
        const underscored = candidate.replace(/ /g, "_");
        if (CARD_LABELS.has(underscored)) return underscored;
        const mapped = CARD_LABEL_SYNONYMS.get(candidate);
        if (mapped) return mapped;
    }

    return normalized;
}

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
        ?.map(canonicalCardLabel)
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
        if (nodeType === "card" && data.relevant === false) continue;
        // A card the researcher deleted is not an answer to anything.
        //
        // Soft delete is `deletedAt` on the node's data, the same marker the canvas reads to stop
        // drawing it. This used to be carried entirely by the caller: the editor page always sends
        // `scopeNodeIds` derived from the live, playback-scoped node set, so deleted cards never
        // reached the ranking in practice. That is a property of one caller rather than of this
        // function, and the chat's filter relaxation now widens back to the unfiltered candidate set
        // when a parsed constraint matches nothing — which is exactly where an unscoped caller would
        // have found the tombstones.
        if (isNonEmptyString(data.deletedAt)) continue;
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


export type CardRelationForSearch = {
    source: string;
    target: string;
    label: string;
};

/**
 * The live relations between cards, which the responder had never been shown.
 *
 * A knowledge graph answers structural questions -- "what came out of the interviews", "which
 * requirement does this component answer", "what is this insight based on" -- and every one of them
 * needs the edges. The context block was a flat list of cards with no relationships at all, so the
 * assistant could only ever summarise a bag of retrieved text and had to be asked questions shaped
 * like retrieval. That, more than any prompt wording, is what made it feel unable to reason about
 * the study.
 *
 * Soft-deleted edges are dropped for the same reason they are not drawn: a relation the researcher
 * removed is not one the study asserts. `deletedAt` is the marker (see the frontend's
 * `graphSemantics.isEdgeActive`), and its absence means live.
 */
export function extractCardRelationsForSearch(state: unknown): CardRelationForSearch[] {
    if (!isRecord(state)) return [];
    const flow = state.flow;
    if (!isRecord(flow) || !Array.isArray(flow.edges)) return [];

    const relations: CardRelationForSearch[] = [];
    for (const rawEdge of flow.edges) {
        if (!isRecord(rawEdge)) continue;
        const source = typeof rawEdge.source === "string" ? rawEdge.source : "";
        const target = typeof rawEdge.target === "string" ? rawEdge.target : "";
        if (!source || !target) continue;

        const data = isRecord(rawEdge.data) ? rawEdge.data : {};
        if (isNonEmptyString(data.deletedAt)) continue;

        const label = isNonEmptyString(data.label)
            ? data.label.trim()
            : isNonEmptyString(rawEdge.label) ? rawEdge.label.trim() : "related to";
        relations.push({ source, target, label });
    }

    return relations;
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

        /*
         * Text constraints are matched against **either** field, not each against its own.
         *
         * They used to be two independent gates: a card had to contain one of `titleContains` in its
         * title AND one of `descriptionContains` in its description. A parser that split one idea
         * across both keys therefore demanded the same word appear twice, and a card whose title said
         * it plainly was dropped for not repeating itself. Which field a phrase landed in was never a
         * claim the user made — it was the parser guessing — so it should not be a condition.
         */
        const needles = [...titleContains, ...descriptionContains];
        if (needles.length > 0) {
            const haystack = `${node.title} ${node.description}`.toLowerCase();
            if (!needles.some((needle) => haystack.includes(needle))) return false;
        }

        return true;
    });
}

/**
 * The same filters, progressively given up on.
 *
 * Structured filtering runs *before* embedding search, and anything it removes the semantic pass
 * never gets to see. That is right for a constraint the user actually stated ("requirements from
 * March") and badly wrong for one the parser inferred: a single content word lifted into
 * `titleContains` would delete every semantically relevant card that did not happen to spell it,
 * the vector search would then be handed nothing, and the answer was "I could not find relevant
 * nodes on the current canvas" for a question the project could plainly answer.
 *
 * So the filters are tried hardest-first and the caller takes the first rung that leaves anything
 * standing. Order matters and is not arbitrary: the *text* guesses are surrendered before the
 * *label* and *date* ones, because a kind and a date range are things a user says out loud, while
 * "the title contains this word" is almost always the parser's own idea.
 */
export function relaxationLadder(filters?: NodeStructuredFilters): Array<NodeStructuredFilters | undefined> {
    if (!filters) return [undefined];

    const rungs: Array<NodeStructuredFilters | undefined> = [filters];

    const hasText = (filters.titleContains?.length ?? 0) > 0 || (filters.descriptionContains?.length ?? 0) > 0;
    const hasDates = Boolean(filters.createdAtFrom || filters.createdAtTo);
    const hasLabels = (filters.labels?.length ?? 0) > 0;

    if (hasText) {
        const { titleContains: _title, descriptionContains: _description, ...rest } = filters;
        if (Object.keys(rest).length > 0) rungs.push(rest);
    }

    if (hasDates && hasLabels) {
        rungs.push({ labels: filters.labels });
    }

    /*
     * "No filter at all" is the last rung **only when nothing the user actually said is left**.
     *
     * A label is a statement: "show me the person cards" on a project with no person cards should be
     * answered "there are none", not by quietly widening to the whole canvas and letting the reply
     * model describe activities as if they were people. Relaxing past a stated label does not make
     * the answer broader, it makes it wrong.
     *
     * A text constraint is a guess — the parser's, not the user's — so a filter made only of guesses
     * relaxes all the way, which is the case this ladder was built for.
     */
    if (!hasLabels) rungs.push(undefined);
    return rungs;
}

/**
 * The narrowest rung of the ladder that still matches something, and what it matched.
 *
 * `relaxed` says whether anything was given up, so the caller can tell the reply model that the
 * question was answered more broadly than it was asked.
 */
export function applyStructuredFiltersWithFallback(
    nodes: CardNodeForSearch[],
    filters?: NodeStructuredFilters,
): { nodes: CardNodeForSearch[]; applied?: NodeStructuredFilters; relaxed: boolean } {
    const ladder = relaxationLadder(filters);
    for (let index = 0; index < ladder.length; index += 1) {
        const rung = ladder[index];
        const matched = applyStructuredFilters(nodes, rung);
        if (matched.length > 0) return { nodes: matched, applied: rung, relaxed: index > 0 };
    }
    // Every rung empty means the project itself has nothing to offer, not that the filters were bad.
    return { nodes: [], applied: undefined, relaxed: ladder.length > 1 };
}

/**
 * What each card kind means, in the words a reader would use.
 *
 * Shared by both model calls in the chat pipeline -- the parser, so it can map "findings" onto
 * `insight` unaided, and the responder, so it can talk about what it retrieved. Neither model can be
 * expected to guess that a "concept" here is a study's own vocabulary rather than any old idea, and
 * both were previously handed the bare label names and nothing else.
 */
export const CARD_LABEL_GLOSSARY: ReadonlyArray<{ label: string; meaning: string }> = [
    { label: "activity", meaning: "something the researchers did, at a point in time - an interview, a workshop, a session, a phase of the study" },
    { label: "person", meaning: "a participant, stakeholder, expert or collaborator involved in the study" },
    { label: "requirement", meaning: "something the design has to satisfy - a goal, a need, a task, a design objective" },
    { label: "concept", meaning: "a domain idea, theme or piece of vocabulary the study works with" },
    { label: "insight", meaning: "something learned - a finding, an observation, a takeaway, a conclusion" },
    { label: "object", meaning: "an artifact: a document, file, dataset, sketch, screenshot, transcript, image or piece of code" },
    { label: "blueprint_component", meaning: "a component of the system being designed, usually taken from a published system in the literature" },
];

function glossaryLines(): string[] {
    return CARD_LABEL_GLOSSARY.map(({ label, meaning }) => `- ${label}: ${meaning}`);
}

export async function parseNaturalLanguageNodeQuery(
    client: OpenAI | null,
    query: string,
    logger: LoggerLike,
    /**
     * The last few turns, so a follow-up can be parsed at all.
     *
     * "And which of those are recent?" carries none of its own subject: parsed cold it yields an
     * empty semantic query and no filters, and retrieval starts again from nothing. The parser was
     * the one step in the pipeline never shown the conversation the responder below it already read.
     */
    conversation: ReadonlyArray<{ role: "user" | "assistant"; content: string }> = [],
): Promise<ParsedNodeQuery> {
    const fallback: ParsedNodeQuery = { semanticQuery: query.trim() };
    if (!client) return fallback;

    const historyText = conversation
        .slice(-6)
        .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
        .join("\n");

    const parsePrompt = [
        "You parse a natural language query over a design-study knowledge graph into semantic and structured filters.",
        "",
        "The graph is made of cards. The seven kinds, and what each one means:",
        ...glossaryLines(),
        "",
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
        "- Map the user's own words onto the labels above, and return the label rather than the user's",
        "  word: findings/takeaways/observations are insight; goals/tasks/needs/objectives are",
        "  requirement; people/participants/stakeholders are person; documents/files/artifacts/datasets",
        "  are object; interviews/workshops/sessions/meetings are activity; components/modules are",
        "  blueprint_component; ideas/themes/topics are concept.",
        "- Put as much of the query as possible in semanticQuery. It is matched by meaning, so it does",
        "  not need the user's exact words to find the right cards.",
        "- titleContains and descriptionContains are LITERAL substring matches that EXCLUDE every card",
        "  not containing the string. Use them ONLY for a quoted phrase, a proper noun, or a term the",
        "  user clearly insists on. Never put an ordinary topic word there - that belongs in",
        "  semanticQuery. When in doubt, omit them.",
        "- Only set date bounds the user actually stated or clearly implied.",
        "- Omit structuredFilters keys that are not present, and omit structuredFilters entirely when",
        "  the query states no constraint at all.",
        '- Resolve references like "those", "them" or "the ones you mentioned" against the conversation.',
        "- No markdown, no explanations, JSON only.",
        "",
        "Conversation so far:",
        historyText || "(none)",
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

