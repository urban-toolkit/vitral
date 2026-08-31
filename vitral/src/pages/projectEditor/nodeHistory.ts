import type { nodeType } from "@/config/types";

/**
 * Reading the per-node edit log that `flowSlice` writes.
 *
 * `flowSlice` keeps a full-snapshot append log inside `node.data.__history` — `{at, kind, data?,
 * position?}` — seeded with two entries at the node's `createdAt` and appended to on every committed
 * change. It never rewrites an earlier entry, and it discards any `__history` arriving from the UI so
 * the store's copy stays canonical.
 *
 * The parsers live here rather than in `ProjectEditorPage` because three separate consumers now want
 * them: the playback projection, the exported report's revision history, and the locator ordering
 * below. The page currently holds near-duplicates of the first; this module is where they consolidate,
 * and nothing new should add a fourth reader of `__history`.
 *
 * Pure and dependency-free on purpose: it runs inside the report generator and inside a plain-node
 * test, neither of which has React, Redux or a clock.
 */

export const NODE_HISTORY_KEY = "__history";
export const NODE_EDIT_AT_KEY = "__editAt";

/**
 * What `ensureNodeHistory` writes when a node arrives with no parseable `createdAt`.
 *
 * Every such node keys on the same instant, so they order among themselves by id. That is stable and
 * deterministic but arbitrary, which is worth knowing before reading anything chronological into a
 * position derived from it.
 */
export const DEFAULT_HISTORY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type RawNodeHistoryEntry = {
    at?: unknown;
    kind?: unknown;
    data?: unknown;
    position?: unknown;
};

function dataOf(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

export function toTimestampMs(value: unknown): number | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** The raw log, or an empty array. Never throws on a malformed `data`. */
export function readNodeHistory(node: nodeType): RawNodeHistoryEntry[] {
    const raw = dataOf(node)[NODE_HISTORY_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is RawNodeHistoryEntry => (
        typeof entry === "object" && entry !== null
    ));
}

/**
 * When this node first entered the document, in ms — the closest thing the store has to an
 * immutable birth instant.
 *
 * It is the first parseable `at` in the log, **not** `data.createdAt`. The two start out equal, but
 * `createdAt` is a field the researcher can correct on the card (it is what positions activities on
 * the time axis, so correcting it is a normal thing to do), and correcting it appends a new entry
 * rather than rewriting entry zero. So this survives an edit that `createdAt` does not.
 *
 * It is **not** a reliable creation *order*, and callers must not assume it is: every creation path
 * stamps `createdAt` from `resolveActionTimestamp()`, which returns the playhead when the timeline is
 * scrubbed back — so a card made while looking at last month is born with last month's timestamp and
 * sorts into the middle. Fine for "when was this", wrong for "what came after what".
 */
export function firstNodeHistoryAtMs(node: nodeType): number | null {
    for (const entry of readNodeHistory(node)) {
        const at = toTimestampMs(entry.at);
        if (at !== null) return at;
    }
    return null;
}

/** The last committed change to this node, in ms, or `null` when the log says nothing. */
export function lastNodeHistoryAtMs(node: nodeType): number | null {
    const entries = readNodeHistory(node);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const at = toTimestampMs(entries[index]?.at);
        if (at !== null) return at;
    }
    return null;
}

/**
 * How many times the node's **data** was committed after it was created.
 *
 * Position entries are excluded: moving a card around the canvas is not a revision of what it says,
 * and counting it as one would make every dragged card look worked-over. The first data entry is the
 * creation snapshot, so it is excluded too — this counts edits, not existence.
 *
 * This is the number behind the report's strongest provenance claim: an AI-proposed card with zero
 * data revisions is machine text no human has ever touched.
 */
export function countNodeDataRevisions(node: nodeType): number {
    let dataEntries = 0;
    for (const entry of readNodeHistory(node)) {
        if (entry.kind !== "data") continue;
        if (toTimestampMs(entry.at) === null) continue;
        dataEntries += 1;
    }
    return dataEntries > 0 ? dataEntries - 1 : 0;
}
