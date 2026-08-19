import type { edgeType, nodeType } from "@/config/types";
import { connectionKindFromEdge, isEdgeActive } from "@/pages/projectEditor/graphSemantics";

/**
 * Phases of a project, derived rather than declared.
 *
 * A phase is a run of consecutive activities that belong together, and "belong together" is decided
 * by two things at once: how close they are **in time**, and how much their activity cards talk
 * about the **same content**. Time alone splits a project wherever someone took a holiday; content
 * alone loses the narrative order that makes the canvas readable.
 *
 * Content similarity costs nothing here because it is already in the graph: `referenced_by` and
 * `iteration_of` edges were thresholded cosine similarity when the cards were created. Word overlap
 * between the activity titles is a cheap second opinion for trees that share no such edge.
 */

export type ActivityCluster = {
    /** Stable across renders: keyed to the earliest member, which only changes if that member does. */
    id: string;
    label: string;
    /** The timeline stage covering this phase, if exactly one phase falls inside it. */
    stageLabel: string | null;
    memberActivityIds: string[];
    startAt: string | null;
    endAt: string | null;
    /** Where the phase sits on the time axis. */
    anchorCreatedAt: string | null;
};

export type ClusterStage = {
    name: string;
    start: string;
    end: string;
};

/**
 * Titles the app itself writes when the user has not named a card. Borrowing one of these tells the
 * reader nothing, and worse, gives every unnamed phase the same name — so they count as no title at
 * all and the ordinal fallback takes over.
 */
const PLACEHOLDER_TITLES = new Set(["untitled", "untitled activity", "untitled phase", "new activity"]);

function borrowableTitle(raw: string): string {
    const trimmed = raw.trim();
    return PLACEHOLDER_TITLES.has(trimmed.toLowerCase()) ? "" : trimmed;
}

/** Fewer than this and clustering is noise — every activity is already its own phase. */
const MIN_ACTIVITIES_TO_CLUSTER = 3;
const MIN_CLUSTERS = 2;
const MAX_CLUSTERS = 7;

const STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "into", "onto", "was", "were", "are",
    "has", "have", "had", "its", "our", "their", "his", "her", "not", "but", "all", "any", "can",
    "how", "why", "what", "when", "where", "who", "which", "about", "over", "under", "than",
    "then", "them", "they", "she", "him", "you", "your", "out", "off", "per", "via", "new",
]);

function dataOf(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function timestampOf(node: nodeType): number | null {
    const raw = dataOf(node).createdAt;
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function isoOf(node: nodeType): string | null {
    const raw = dataOf(node).createdAt;
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function contentTokens(node: nodeType): Set<string> {
    const data = dataOf(node);
    const text = `${String(data.title ?? "")} ${String(data.description ?? "")}`.toLowerCase();
    const tokens = new Set<string>();
    for (const raw of text.split(/[^a-z0-9]+/)) {
        if (raw.length < 3) continue;
        if (STOPWORDS.has(raw)) continue;
        tokens.add(raw);
    }
    return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of small) {
        if (large.has(token)) shared += 1;
    }
    const union = a.size + b.size - shared;
    return union === 0 ? 0 : shared / union;
}

/** Activities in the order the canvas lays them out: by time, undated last, id as the tiebreak. */
export function sortActivitiesChronologically(activities: nodeType[]): nodeType[] {
    return activities.slice().sort((a, b) => {
        const timeA = timestampOf(a);
        const timeB = timestampOf(b);
        if (timeA !== timeB) {
            if (timeA === null) return 1;
            if (timeB === null) return -1;
            return timeA - timeB;
        }
        return a.id.localeCompare(b.id);
    });
}

/** Similarity edges spanning two activity trees — the frozen-in-the-graph half of the affinity. */
function buildTreeAffinity(
    edges: edgeType[],
    membership: Map<string, string>,
): Map<string, number> {
    const affinity = new Map<string, number>();

    for (const edge of edges) {
        if (!isEdgeActive(edge)) continue;
        if (connectionKindFromEdge(edge) === "regular") continue;

        const sourceTree = membership.get(edge.source);
        const targetTree = membership.get(edge.target);
        if (sourceTree === undefined || targetTree === undefined) continue;
        if (sourceTree === targetTree) continue;

        const key = sourceTree < targetTree
            ? `${sourceTree}|${targetTree}`
            : `${targetTree}|${sourceTree}`;
        affinity.set(key, (affinity.get(key) ?? 0) + 1);
    }

    return affinity;
}

function stageLabelFor(
    stages: ClusterStage[],
    startAt: string | null,
    endAt: string | null,
): string | null {
    if (startAt === null || endAt === null) return null;
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    for (const stage of stages) {
        const stageStart = Date.parse(String(stage.start));
        const stageEnd = Date.parse(String(stage.end));
        if (!Number.isFinite(stageStart) || !Number.isFinite(stageEnd)) continue;
        // Only when the stage covers the whole phase. On a partial overlap the stage name would be
        // put on work that happened outside it.
        if (start >= stageStart && end <= stageEnd) {
            const name = String(stage.name ?? "").trim();
            if (name !== "") return name;
        }
    }

    return null;
}

export function buildActivityClusters(params: {
    activities: nodeType[];
    edges: edgeType[];
    membership: Map<string, string>;
    score: Map<string, number>;
    stages?: ClusterStage[];
}): ActivityCluster[] {
    const { edges, membership, score, stages = [] } = params;
    const ordered = sortActivitiesChronologically(params.activities);
    if (ordered.length === 0) return [];

    const treeAffinity = buildTreeAffinity(edges, membership);
    const tokensById = new Map<string, Set<string>>();
    for (const activity of ordered) {
        tokensById.set(activity.id, contentTokens(activity));
    }

    // --- Score every seam between two consecutive activities. High score = likely phase boundary.
    const gaps: number[] = [];
    const affinities: number[] = [];
    for (let index = 0; index < ordered.length - 1; index += 1) {
        const left = ordered[index];
        const right = ordered[index + 1];

        const leftTime = timestampOf(left);
        const rightTime = timestampOf(right);
        gaps.push(leftTime === null || rightTime === null ? 0 : Math.max(0, rightTime - leftTime));

        const key = left.id < right.id ? `${left.id}|${right.id}` : `${right.id}|${left.id}`;
        const edgeAffinity = treeAffinity.get(key) ?? 0;
        const wordAffinity = jaccard(
            tokensById.get(left.id) ?? new Set<string>(),
            tokensById.get(right.id) ?? new Set<string>(),
        );
        affinities.push(edgeAffinity + wordAffinity);
    }

    const maxGap = gaps.reduce((max, value) => Math.max(max, value), 0);
    const maxAffinity = affinities.reduce((max, value) => Math.max(max, value), 0);

    const boundaries = gaps.map((gap, index) => ({
        index,
        score: (maxGap > 0 ? gap / maxGap : 0) - (maxAffinity > 0 ? affinities[index] / maxAffinity : 0),
    }));

    // --- Cut at the strongest seams.
    //
    // The count is capped by project size, but the real gate is `score > 0`: cut only where time
    // separates the two activities *more* than their content binds them together. A fixed target
    // alone would keep slicing a project that genuinely has three phases into four, because it
    // would have to spend its budget somewhere.
    const ranked = boundaries
        .slice()
        // Index as the tiebreak keeps the choice deterministic when two seams score alike.
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

    let selected: typeof ranked = [];
    if (ordered.length >= MIN_ACTIVITIES_TO_CLUSTER) {
        const target = Math.min(MAX_CLUSTERS, Math.max(MIN_CLUSTERS, Math.ceil(Math.sqrt(ordered.length))));
        selected = ranked.slice(0, Math.max(0, target - 1)).filter((boundary) => boundary.score > 0);

        // A project with no seam worth cutting still should not be one undifferentiated blob at
        // Overview, so past a certain size take the single best seam anyway.
        if (selected.length === 0 && ordered.length >= MIN_ACTIVITIES_TO_CLUSTER * 2 && ranked.length > 0) {
            selected = ranked.slice(0, 1);
        }
    }

    const cuts = new Set(selected.map((boundary) => boundary.index));

    // --- Materialise the runs.
    const clusters: ActivityCluster[] = [];
    let current: nodeType[] = [];

    const flush = () => {
        if (current.length === 0) return;

        const members = current;
        const timestamps = members.map(isoOf).filter((value): value is string => value !== null);
        const startAt = timestamps.length > 0 ? timestamps[0] : null;
        const endAt = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;

        const best = members.slice().sort((a, b) => {
            const scoreA = score.get(a.id) ?? 0;
            const scoreB = score.get(b.id) ?? 0;
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.id.localeCompare(b.id);
        })[0];

        const borrowedTitle = borrowableTitle(String(dataOf(best).title ?? ""));

        clusters.push({
            id: `vz:c:${members[0].id}`,
            // Provisional. Both candidate labels are kept so the pass below can reject a stage name
            // that would end up on more than one phase. An ordinal is the last resort rather than
            // "Untitled": with nothing to borrow, two phases must at least be told apart, and the
            // glyph already shows the date range that says which is which.
            label: borrowedTitle !== "" ? borrowedTitle : `Phase ${clusters.length + 1}`,
            stageLabel: stageLabelFor(stages, startAt, endAt),
            memberActivityIds: members.map((activity) => activity.id),
            startAt,
            endAt,
            // The middle member's timestamp, so the phase lands where its activities were.
            anchorCreatedAt: isoOf(members[Math.floor((members.length - 1) / 2)]) ?? startAt,
        });

        current = [];
    };

    ordered.forEach((activity, index) => {
        current.push(activity);
        if (index < ordered.length - 1 && cuts.has(index)) flush();
    });
    flush();

    // A stage name is only worth borrowing if it identifies one phase. Two phases inside the same
    // stage would both be called "Formative", which tells the reader nothing and makes the two
    // glyphs indistinguishable — so in that case both keep their own activity's title.
    const stageUse = new Map<string, number>();
    for (const cluster of clusters) {
        if (!cluster.stageLabel) continue;
        stageUse.set(cluster.stageLabel, (stageUse.get(cluster.stageLabel) ?? 0) + 1);
    }
    for (const cluster of clusters) {
        if (cluster.stageLabel && stageUse.get(cluster.stageLabel) === 1) {
            cluster.label = cluster.stageLabel;
        }
    }

    return clusters;
}
