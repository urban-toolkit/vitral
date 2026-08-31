import type { edgeType, nodeType } from "@/config/types";
import { buildActivityClusters, type ActivityCluster } from "@/pages/projectEditor/canvasClusters";
import { buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import {
    NO_CANVAS_FOCUS,
    SYNTHETIC_ID_PREFIX,
    type CanvasFocusPath,
    type CanvasLevel,
} from "@/pages/projectEditor/canvasAbstraction";
import { isNodeActive, nodeLabelOf, normalizeNodeLabel } from "@/pages/projectEditor/graphSemantics";
import { toTimestampMs } from "@/pages/projectEditor/nodeHistory";

/**
 * One short code per thing worth citing, shared by the exported report and the published canvas.
 *
 * A reviewer reading a paper cannot install this app, and an exported markdown file cannot be
 * navigated. Both objections have the same answer: a code — `A3`, `R7`, `P1` — that names one
 * artifact at one **level of abstraction**, resolves to an anchor inside the document, and resolves
 * to a viewpoint on the canvas. Same code, same target, either surface.
 *
 * ## The letter is the altitude
 *
 * This is the load-bearing idea, and `LOCATOR_KIND_LEVEL` is it, expressed as data rather than as
 * prose. `P1` is a claim at Overview altitude, `A3` at Threads, `R7` at Detail. There is no
 * card-sized reading of `P1` and no phase-sized reading of `R7`, so a citation carries its own
 * granularity and the reader never has to be told which zoom to use.
 *
 * Resolution then makes Focus+Context literal rather than metaphorical: the base level stays 1 and
 * the *depth of the focus path* carries the altitude, so `R7` puts its own card at Detail, its
 * sibling threads at Threads, and the other phases at Overview — three levels on screen at once,
 * with the code having chosen which branch got which. `effectiveLevelForActivity` already does that
 * in three lines; nothing is added to the lens.
 *
 * ## Not "reference"
 *
 * `cardData.reference` already means the verbatim excerpt a card was extracted from — the thing
 * `files/referenceLocation.ts` searches for and `useReferenceHighlight.ts` paints. `referenceCitation`
 * is the blueprint paper's prose excerpt. So the domain noun here is **locator**, and the word shown
 * to a person is **code**.
 *
 * ## What is safe to point at
 *
 * Node ids and edge ids are `crypto.randomUUID()`, are never rewritten by import or duplication, and
 * are never removed — deletion writes `data.deletedAt` and leaves the object in place. So a locator
 * built on a node id cannot dangle; at worst it resolves to a tombstone, which is a thing this module
 * can *report* rather than a thing that fails.
 *
 * Everything the abstraction lens invents is off limits (`vz:c:`, `vz:e:`), and a phase is the
 * awkward case: its id is `vz:c:<earliest member>`, and *which* activity that is gets re-decided
 * every time the segmentation runs. So a phase locator points at an **anchor activity node id** and
 * is defined as "the phase containing this activity". See `LOCATOR_PHASE_CONTRACT`.
 *
 * Files point at `document_files.sha256`, not `file.id`: the id is rewritten on `.vi` import and on
 * duplication, and `ON CONFLICT (document_id, sha256)` means the id the client sent is not always the
 * id that was stored. The hash is the same bytes everywhere.
 *
 * Pure, and deliberately free of React, Redux, `fetch`, `import.meta` and any clock — it runs inside
 * the report generator and inside a plain-node test.
 */

export type LocatorKind =
    | "phase"
    | "stage"
    | "activity"
    | "event"
    | "requirement"
    | "insight"
    | "concept"
    | "object"
    | "person"
    | "blueprintComponent"
    | "file";

/**
 * Letters, chosen so no two collide and so the common ones are the initial a reader would guess.
 *
 * `P` goes to phase because a phase is the thing an author cites in a sentence about the study's
 * shape, which pushes person to `H` for human. Person cards are context rather than content
 * everywhere else in the app, so they lose that argument on the same grounds they lose the others.
 */
export const LOCATOR_KIND_LETTER: Readonly<Record<LocatorKind, string>> = {
    phase: "P",
    stage: "S",
    activity: "A",
    event: "E",
    requirement: "R",
    insight: "I",
    concept: "C",
    object: "O",
    person: "H",
    blueprintComponent: "B",
    file: "F",
};

export const LOCATOR_LETTER_KIND: Readonly<Record<string, LocatorKind>> = Object.freeze(
    Object.fromEntries(
        (Object.keys(LOCATOR_KIND_LETTER) as LocatorKind[]).map((kind) => [
            LOCATOR_KIND_LETTER[kind],
            kind,
        ]),
    ) as Record<string, LocatorKind>,
);

/**
 * The abstraction claim, as a total map. This table *is* the feature.
 *
 * Blueprint components are the honest exception at Detail: `buildActivityTreeMembership` deliberately
 * skips them, and Overview hides blueprint structure entirely, so a component has no phase and no
 * thread to be cited at. One answering several requirements has no single owner either, and inventing
 * one would be worse than admitting it.
 */
export const LOCATOR_KIND_LEVEL: Readonly<Record<LocatorKind, CanvasLevel>> = {
    phase: 1,
    stage: 1,
    activity: 2,
    event: 2,
    requirement: 3,
    insight: 3,
    concept: 3,
    object: 3,
    person: 3,
    blueprintComponent: 3,
    file: 3,
};

/** Card labels, as stored, to locator kinds. `task` is normalised to `requirement` upstream. */
const LABEL_KIND: Readonly<Record<string, LocatorKind>> = {
    activity: "activity",
    requirement: "requirement",
    insight: "insight",
    concept: "concept",
    object: "object",
    person: "person",
    blueprint_component: "blueprintComponent",
};

/**
 * What a phase code promises, written down because it is the one locator whose target is derived
 * rather than stored, and because the limits are not guessable from the outside.
 *
 * Guaranteed: it resolves to exactly one phase, at Overview, containing the same anchor activity, for
 * as long as that activity is live; and it never dangles, because the anchor is a node id.
 *
 * Not guaranteed, and the report must say so rather than implying otherwise: the phase's **extent**
 * (the segmentation is recomputed from time gaps against content affinity, so one added card can move
 * every boundary); its **label** (borrowed from a timeline stage name, else a member's title, so
 * renaming a stage renames the phase); its **position in time** (`P3` may end up chronologically
 * second); and **uniqueness** — if a boundary disappears, two phase codes resolve to the same phase.
 *
 * There is also a precondition nobody would guess: `canvasClusters` is computed only at level 1 and
 * only over the *filtered* nodes, so a phase resolved with a label chip off finds a different
 * clustering. Phase codes are therefore only meaningful over the **unfiltered live graph at the
 * latest playhead**, and both the report and the resolver must reproduce those conditions.
 */
export const LOCATOR_PHASE_CONTRACT =
    "A phase code names the phase containing its anchor activity. Phase boundaries are recomputed "
    + "from the project's own timing and content, so a phase's extent, label and position may differ "
    + "from when this was written; the anchor activity will not.";

export type Locator = {
    kind: LocatorKind;
    /** 1-based. Never 0, never reused, never renumbered downwards. */
    ordinal: number;
    code: string;
};

export type LocatorStatus =
    /** Resolves to something on the canvas right now. */
    | "live"
    /** The target exists as a tombstone: soft-deleted, nameable, not openable. */
    | "deleted"
    /** The target changed kind, so this code was superseded rather than broken. */
    | "retired"
    /** Nothing in this document answers to this code. */
    | "unknown";

export type LocatorViewpoint = {
    level: CanvasLevel;
    focus: CanvasFocusPath;
    /** The node to centre and ring, when there is one. Files and timeline entities have none. */
    nodeId: string | null;
};

export type LocatorTarget = {
    locator: Locator;
    code: string;
    /** A node id, a file `sha256`, or a timeline entity id. Never a `vz:` id. */
    targetId: string;
    title: string;
    /** The stored label or kind name, for the index's "what it is" column. */
    describedAs: string;
    level: CanvasLevel;
    viewpoint: LocatorViewpoint;
    /** `P1` for an activity in that phase; `A3` for a card in that thread. */
    parentCode: string | null;
    status: LocatorStatus;
    /** Set when `status` is `retired`: the code that names this target now. */
    supersededBy: string | null;
    /** ISO instant the target was soft-deleted, when it was. */
    deletedAt: string | null;
    /**
     * Whether the report's body anchors this target.
     *
     * False for a card the researcher marked not relevant: the canvas still draws it, but the report
     * names it only in "Set aside" as evidence of that judgement, with no anchor to link to. Without
     * this flag the index would advertise an anchor that is not there.
     */
    inDocument: boolean;
};

export type LocatorFileInput = {
    sha256: string;
    name: string;
    createdAt: string;
};

export type LocatorTimelineInput = {
    stages: Array<{ id: string; name: string; start: string; end: string }>;
    designStudyEvents: Array<{ id: string; name: string; occurredAt: string }>;
};

export type LocatorIndex = {
    /** Stable order: by letter as listed in `LOCATOR_KIND_LETTER`, then by ordinal. */
    entries: readonly LocatorTarget[];
    byCode: ReadonlyMap<string, LocatorTarget>;
    byTargetId: ReadonlyMap<string, LocatorTarget>;
    /** Which snapshot this index describes, so a printed citation can be pinned to it. */
    asOf: { version: number | null; capturedAt: string };
};

export type CodeToUrlOptions = {
    projectId: string;
    /** Must be the same value the router uses — see `resolveRouterBasename` in `src/routing.ts`. */
    basename?: string;
    /** `"https://host"`, or omitted for a path-only URL. */
    origin?: string;
    /** ISO instant to pin the link to, so the reader sees what the document described. */
    at?: string;
};

const CODE_PATTERN = /^([A-Za-z]+)(\d+)$/;

/**
 * Characters a printed code loses to a reader retyping it. Applied to the **first** character only,
 * which is unambiguous because a code never begins with a digit — so `03` can only have meant `O3`.
 */
const DIGIT_TWIN: Readonly<Record<string, string>> = { "0": "O", "1": "I", "5": "S", "8": "B" };

export function formatLocatorCode(kind: LocatorKind, ordinal: number): string {
    return `${LOCATOR_KIND_LETTER[kind]}${ordinal}`;
}

/**
 * A code out of a URL, a footnote, or something somebody typed.
 *
 * Tolerant on the way in and strict on the way out: case is folded, surrounding space is dropped,
 * leading zeros on the ordinal are accepted, and a first-character digit twin is repaired. What comes
 * back is always the canonical spelling `formatLocatorCode` would have produced.
 */
export function parseLocatorCode(raw: unknown): Locator | null {
    if (typeof raw !== "string") return null;
    let text = raw.trim();
    if (text === "") return null;

    const firstCharTwin = DIGIT_TWIN[text[0]];
    if (firstCharTwin !== undefined) text = firstCharTwin + text.slice(1);

    const match = CODE_PATTERN.exec(text);
    if (!match) return null;

    const kind = LOCATOR_LETTER_KIND[match[1].toUpperCase()];
    if (kind === undefined) return null;

    const ordinal = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) return null;

    return { kind, ordinal, code: formatLocatorCode(kind, ordinal) };
}

/**
 * The markdown anchor for a code.
 *
 * Lowercasing and nothing else, because the report gives every target a heading whose text *is* its
 * code. That keeps the slug short, ASCII and identical under GitHub, VS Code, pandoc and
 * `remark-slug` — which matters because the document has to be navigable in whatever the reader
 * happens to open it in, and `react-markdown` renders no raw HTML without `rehype-raw`.
 */
export function codeToAnchor(code: string): string {
    return code.toLowerCase();
}

/** `"/"` → `""`, `"/vitral"` → `"/vitral"`, `"/vitral/"` → `"/vitral"`. */
function basePathOf(basename: string | undefined): string {
    const raw = (basename ?? "/").trim();
    if (raw === "" || raw === "/") return "";
    const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
    return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

/**
 * The canvas URL for a code.
 *
 * Carries the code **and** the target id: the code is the half a person can read in a footnote and
 * retype, and the id is the half that is still right if the numbering ever drifted. `at` pins the
 * link to the snapshot the document described, so a citation in a submitted paper keeps showing what
 * was cited.
 */
export function codeToUrl(
    index: LocatorIndex,
    code: string,
    options: CodeToUrlOptions,
): string | null {
    const parsed = parseLocatorCode(code);
    if (!parsed) return null;
    const target = index.byCode.get(parsed.code);
    if (!target) return null;

    const params = new URLSearchParams();
    params.set("ref", target.code);
    params.set("n", target.targetId);
    if (options.at) params.set("at", options.at);

    const origin = options.origin ?? "";
    return `${origin}${basePathOf(options.basename)}/project/${options.projectId}?${params.toString()}`;
}

export function nodeToCode(index: LocatorIndex, nodeId: string): string | null {
    return index.byTargetId.get(nodeId)?.code ?? null;
}

/**
 * One sentence per status, so the document and the canvas say the same words about the same failure.
 *
 * The report calls this for an index row it cannot link, and the canvas calls it for a code it cannot
 * open. Same function, same wording — a reader who meets a dead code in both places should not have
 * to work out that they are the same problem.
 *
 * The house rule this follows: a target the project can name but cannot open is shown, inert, with
 * the reason — never hidden, and never dressed as a link. See the source icon in `Card.tsx`.
 */
export function describeLocatorStatus(target: LocatorTarget): string {
    switch (target.status) {
        case "live":
            return `${target.code} — ${target.title}`;
        case "deleted":
            return target.deletedAt
                ? `${target.code} named "${target.title}", which was deleted on ${target.deletedAt.slice(0, 10)}.`
                : `${target.code} named "${target.title}", which has been deleted.`;
        case "retired":
            return target.supersededBy
                ? `${target.code} was renumbered ${target.supersededBy}.`
                : `${target.code} has been renumbered.`;
        case "unknown":
            return `${target.code} does not name anything in this project.`;
    }
}

/**
 * Sorting key: the node's **position in the stored array**, then its id.
 *
 * Not a timestamp, and that is the whole point. Every obvious time-based key fails to be append-only:
 * `data.createdAt` is a field the researcher can correct on the card, and even the first `__history`
 * entry is no better, because every creation path stamps it from `resolveActionTimestamp()`, which
 * returns the *playhead*. A card made while the timeline is scrubbed back into last month is therefore
 * born with last month's timestamp and sorts into the middle of its kind — renumbering every later
 * code. Scrubbing back and adding a card is a designed workflow, not an edge case.
 *
 * `flow.nodes` has the property those keys lack. `addNode`/`addNodes` append; the two sorts in
 * `flowSlice` both operate on copies; `applyNodeChanges` maps existing entries in place; and soft
 * delete leaves the element where it is. So array position is the document's insertion log, it only
 * ever grows at the end, and a code derived from it survives a back-dated creation and a corrected
 * date alike.
 *
 * What it does not survive: a hard `removeNode`, which splices and shifts everything after it, and a
 * label change, which moves a node between two kind namespaces and renumbers both. The UI does
 * neither today, and `planLocatorAssignments` is the answer to both — persisting a code is what turns
 * "correct now" into "correct forever".
 */
function orderingKey(node: nodeType, indexInDocument: number): [number, string] {
    return [indexInDocument, node.id];
}

function compareOrderingKeys(a: [number, string], b: [number, string]): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1].localeCompare(b[1]);
}

function kindOfNode(node: nodeType): LocatorKind | null {
    if (node.type !== "card" && node.type !== "blueprintComponent") {
        // Group boxes and the legacy `blueprint` node are structure, not artifacts — nothing cites
        // "the intermediate box", and giving them codes would put unciteable rows in the index.
        if (normalizeNodeLabel(nodeLabelOf(node)) !== "blueprint_component") return null;
    }
    return LABEL_KIND[normalizeNodeLabel(nodeLabelOf(node))] ?? null;
}

function titleOf(node: nodeType): string {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const title = typeof data.title === "string" ? data.title.trim() : "";
    return title !== "" ? title : "Untitled";
}

function deletedAtOf(node: nodeType): string | null {
    const raw = (node.data ?? {} as Record<string, unknown>) as Record<string, unknown>;
    const value = raw.deletedAt;
    return typeof value === "string" && value.trim() !== "" && toTimestampMs(value) !== null
        ? value
        : null;
}

/** A code already written into the node by a previous assignment pass, if there is one. */
function persistedCodeOf(node: nodeType): Locator | null {
    const data = (node.data ?? {}) as Record<string, unknown>;
    return parseLocatorCode(data.locatorCode);
}

function retiredCodesOf(node: nodeType): Locator[] {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const raw = data.locatorCodeRetired;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((value) => parseLocatorCode(value))
        .filter((value): value is Locator => value !== null);
}

/**
 * Assign ordinals to a set of keyed items, honouring anything already claimed.
 *
 * Two rules make the result append-only: a claimed ordinal is never taken from its claimant, and a
 * newly assigned ordinal is always above every ordinal that kind has ever used — including ones held
 * by tombstones and by codes that have been retired. So adding to a project can only ever add codes.
 */
function assignOrdinals<T>(
    items: Array<{ item: T; key: [number, string]; claimed: number | null }>,
    reserved: Set<number>,
): Array<{ item: T; ordinal: number }> {
    const ordered = items.slice().sort((a, b) => compareOrderingKeys(a.key, b.key));

    const taken = new Set<number>(reserved);
    for (const entry of ordered) {
        if (entry.claimed !== null) taken.add(entry.claimed);
    }

    let next = 1;
    const nextFree = (): number => {
        while (taken.has(next)) next += 1;
        taken.add(next);
        return next;
    };

    // Claimed first, so the unclaimed cannot land on an ordinal a claim is about to want.
    const result: Array<{ item: T; ordinal: number }> = [];
    for (const entry of ordered) {
        result.push({ item: entry.item, ordinal: entry.claimed ?? -1 });
    }
    for (let index = 0; index < result.length; index += 1) {
        if (result[index].ordinal !== -1) continue;
        result[index] = { item: result[index].item, ordinal: nextFree() };
    }
    return result;
}

/**
 * Every code this document uses, and what each one points at.
 *
 * `nodes` must be the **full store array including tombstones**: a soft-deleted card holds its
 * ordinal so that nothing after it shifts, and a code that named something now deleted has to keep
 * resolving to a row that says so. Filtering before calling this changes the numbering, which is the
 * one thing a citable code may not do.
 *
 * `clusters` must come from `buildActivityClusters` over the live, unfiltered nodes at the latest
 * playhead, or phase codes will not match what the canvas shows. See `LOCATOR_PHASE_CONTRACT`.
 */
export function buildLocatorIndex(input: {
    nodes: nodeType[];
    edges: edgeType[];
    files: LocatorFileInput[];
    timeline: LocatorTimelineInput;
    membership: Map<string, string>;
    clusters: ActivityCluster[];
    asOf: { version: number | null; capturedAt: string };
}): LocatorIndex {
    const { nodes, files, timeline, membership, clusters, asOf } = input;

    // --- Group the codeable nodes by kind, and collect every ordinal already spoken for.
    const byKind = new Map<LocatorKind, Array<{ node: nodeType; key: [number, string]; claimed: number | null }>>();
    const reservedByKind = new Map<LocatorKind, Set<number>>();
    const retiredByNodeId = new Map<string, Locator[]>();

    const reserve = (kind: LocatorKind, ordinal: number) => {
        const set = reservedByKind.get(kind) ?? new Set<number>();
        set.add(ordinal);
        reservedByKind.set(kind, set);
    };

    nodes.forEach((node, indexInDocument) => {
        const kind = kindOfNode(node);
        if (kind === null) return;

        const retired = retiredCodesOf(node);
        if (retired.length > 0) {
            retiredByNodeId.set(node.id, retired);
            // A retired ordinal is never handed to anything else: the paper that cited it still says
            // what it meant, and the index has to be able to answer with "renumbered", not with a
            // different artifact.
            for (const entry of retired) reserve(entry.kind, entry.ordinal);
        }

        const persisted = persistedCodeOf(node);
        const claimed = persisted !== null && persisted.kind === kind ? persisted.ordinal : null;
        // A persisted code of the *wrong* kind means the label changed since it was written; the
        // ordinal stays reserved on the old kind so nothing reuses it.
        if (persisted !== null && persisted.kind !== kind) {
            reserve(persisted.kind, persisted.ordinal);
            const known = retiredByNodeId.get(node.id) ?? [];
            if (!known.some((entry) => entry.code === persisted.code)) {
                retiredByNodeId.set(node.id, [...known, persisted]);
            }
        }

        const list = byKind.get(kind) ?? [];
        list.push({ node, key: orderingKey(node, indexInDocument), claimed });
        byKind.set(kind, list);
    });

    const entries: LocatorTarget[] = [];
    const codeByNodeId = new Map<string, string>();

    // --- Phases first, so an activity can name its parent.
    const clusterOfActivity = new Map<string, ActivityCluster>();
    for (const cluster of clusters) {
        for (const activityId of cluster.memberActivityIds) {
            clusterOfActivity.set(activityId, cluster);
        }
    }

    const phaseCodeByAnchorId = new Map<string, string>();
    clusters.forEach((cluster, index) => {
        // Phases are numbered in the order `buildActivityClusters` emits them, which is chronological
        // by construction. They are not persisted: a phase is not a stored entity, so there is nothing
        // to write a code onto, and pinning the link to a snapshot is what makes the number safe.
        const code = formatLocatorCode("phase", index + 1);
        phaseCodeByAnchorId.set(cluster.anchorActivityId, code);
        entries.push({
            locator: { kind: "phase", ordinal: index + 1, code },
            code,
            targetId: cluster.anchorActivityId,
            title: cluster.label,
            describedAs: "phase",
            level: LOCATOR_KIND_LEVEL.phase,
            viewpoint: { level: 1, focus: { clusterId: cluster.id, activityId: null }, nodeId: null },
            parentCode: null,
            status: "live",
            supersededBy: null,
            deletedAt: null,
            inDocument: true,
        });
    });

    // --- Nodes, kind by kind, in the order the letters are declared.
    const activityCodeById = new Map<string, string>();

    const emitNodeKind = (kind: LocatorKind) => {
        const list = byKind.get(kind);
        if (!list || list.length === 0) return;
        const reserved = reservedByKind.get(kind) ?? new Set<number>();
        const assigned = assignOrdinals(
            list.map(({ node, key, claimed }) => ({ item: node, key, claimed })),
            reserved,
        );

        for (const { item: node, ordinal } of assigned) {
            const code = formatLocatorCode(kind, ordinal);
            const deletedAt = deletedAtOf(node);
            const relevant = ((node.data ?? {}) as Record<string, unknown>).relevant;

            const owningActivityId = kind === "activity"
                ? node.id
                : membership.get(node.id) ?? null;
            const cluster = owningActivityId !== null
                ? clusterOfActivity.get(owningActivityId) ?? null
                : null;

            let viewpoint: LocatorViewpoint;
            if (kind === "blueprintComponent") {
                // No thread and no phase — see `LOCATOR_KIND_LEVEL`. Detail, unfocused, and the
                // resolver turns the blueprint chip on so the component is drawn at all.
                viewpoint = { level: 3, focus: NO_CANVAS_FOCUS, nodeId: node.id };
            } else if (owningActivityId === null) {
                // A card reaching no activity lives in the unassigned band, which Overview folds into
                // a single glyph. Detail is the only level that shows it as itself.
                viewpoint = { level: 3, focus: NO_CANVAS_FOCUS, nodeId: node.id };
            } else {
                viewpoint = {
                    level: 1,
                    focus: {
                        clusterId: cluster?.id ?? null,
                        activityId: owningActivityId,
                    },
                    nodeId: node.id,
                };
            }

            if (kind === "activity") activityCodeById.set(node.id, code);
            codeByNodeId.set(node.id, code);

            entries.push({
                locator: { kind, ordinal, code },
                code,
                targetId: node.id,
                title: titleOf(node),
                describedAs: normalizeNodeLabel(nodeLabelOf(node)),
                level: LOCATOR_KIND_LEVEL[kind],
                viewpoint,
                parentCode: kind === "activity"
                    ? (cluster ? phaseCodeByAnchorId.get(cluster.anchorActivityId) ?? null : null)
                    : null,
                status: deletedAt !== null ? "deleted" : "live",
                supersededBy: null,
                deletedAt,
                inDocument: relevant !== false,
            });
        }
    };

    (Object.keys(LOCATOR_KIND_LETTER) as LocatorKind[])
        .filter((kind) => kind !== "phase" && kind !== "stage" && kind !== "file" && kind !== "event")
        .forEach(emitNodeKind);

    // A card's parent is its thread, and thread codes are only known once activities are numbered.
    for (const entry of entries) {
        if (entry.locator.kind === "activity" || entry.locator.kind === "phase") continue;
        if (entry.viewpoint.focus.activityId === null) continue;
        entry.parentCode = activityCodeById.get(entry.viewpoint.focus.activityId) ?? null;
    }

    // --- Files, keyed on the content hash rather than the row id.
    const fileOrder = files
        .slice()
        .sort((a, b) => {
            const timeA = toTimestampMs(a.createdAt) ?? 0;
            const timeB = toTimestampMs(b.createdAt) ?? 0;
            if (timeA !== timeB) return timeA - timeB;
            return a.sha256.localeCompare(b.sha256);
        });
    fileOrder.forEach((file, index) => {
        const code = formatLocatorCode("file", index + 1);
        entries.push({
            locator: { kind: "file", ordinal: index + 1, code },
            code,
            targetId: file.sha256,
            title: file.name,
            describedAs: "file",
            level: LOCATOR_KIND_LEVEL.file,
            viewpoint: { level: 3, focus: NO_CANVAS_FOCUS, nodeId: null },
            parentCode: null,
            status: "live",
            supersededBy: null,
            deletedAt: null,
            inDocument: true,
        });
    });

    // --- Timeline entities. No node, so no focus — the resolver opens the dock instead.
    timeline.stages
        .slice()
        .sort((a, b) => {
            const timeA = toTimestampMs(a.start) ?? 0;
            const timeB = toTimestampMs(b.start) ?? 0;
            if (timeA !== timeB) return timeA - timeB;
            return a.id.localeCompare(b.id);
        })
        .forEach((stage, index) => {
            const code = formatLocatorCode("stage", index + 1);
            entries.push({
                locator: { kind: "stage", ordinal: index + 1, code },
                code,
                targetId: stage.id,
                title: stage.name,
                describedAs: "timeline stage",
                level: LOCATOR_KIND_LEVEL.stage,
                viewpoint: { level: 1, focus: NO_CANVAS_FOCUS, nodeId: null },
                parentCode: null,
                status: "live",
                supersededBy: null,
                deletedAt: null,
                inDocument: true,
            });
        });

    timeline.designStudyEvents
        .slice()
        .sort((a, b) => {
            const timeA = toTimestampMs(a.occurredAt) ?? 0;
            const timeB = toTimestampMs(b.occurredAt) ?? 0;
            if (timeA !== timeB) return timeA - timeB;
            return a.id.localeCompare(b.id);
        })
        .forEach((event, index) => {
            const code = formatLocatorCode("event", index + 1);
            entries.push({
                locator: { kind: "event", ordinal: index + 1, code },
                code,
                targetId: event.id,
                title: event.name,
                describedAs: "design study event",
                level: LOCATOR_KIND_LEVEL.event,
                viewpoint: { level: 2, focus: NO_CANVAS_FOCUS, nodeId: null },
                parentCode: null,
                status: "live",
                supersededBy: null,
                deletedAt: null,
                inDocument: true,
            });
        });

    // --- Retired codes become their own rows, so a citation of one is answered rather than missed.
    for (const [nodeId, retired] of retiredByNodeId) {
        const current = codeByNodeId.get(nodeId) ?? null;
        for (const entry of retired) {
            if (entries.some((existing) => existing.code === entry.code)) continue;
            entries.push({
                locator: entry,
                code: entry.code,
                targetId: nodeId,
                title: "",
                describedAs: "renumbered",
                level: LOCATOR_KIND_LEVEL[entry.kind],
                viewpoint: { level: 3, focus: NO_CANVAS_FOCUS, nodeId: nodeId },
                parentCode: null,
                status: "retired",
                supersededBy: current,
                deletedAt: null,
                inDocument: false,
            });
        }
    }

    const letterOrder = Object.keys(LOCATOR_KIND_LETTER) as LocatorKind[];
    entries.sort((a, b) => {
        const kindDelta = letterOrder.indexOf(a.locator.kind) - letterOrder.indexOf(b.locator.kind);
        if (kindDelta !== 0) return kindDelta;
        return a.locator.ordinal - b.locator.ordinal;
    });

    const byCode = new Map<string, LocatorTarget>();
    const byTargetId = new Map<string, LocatorTarget>();
    for (const entry of entries) {
        byCode.set(entry.code, entry);
        // Retired rows share a target with a live one; the live code is the useful answer, so it wins.
        if (entry.status !== "retired") byTargetId.set(entry.targetId, entry);
    }

    return { entries, byCode, byTargetId, asOf };
}

/**
 * What to write into the document so these codes stop being derived and start being facts.
 *
 * Derivation is correct for a link generated *now* — the URL carries the target id and the snapshot
 * instant, so it cannot point at the wrong thing. What derivation cannot do is keep a bare `A3` in a
 * paragraph of prose meaning the same artifact across two exports, because creation order is not
 * append-only: `resolveActionTimestamp()` returns the playhead, so a card made while scrubbed into
 * the past is born with a past timestamp and sorts into the middle of its kind.
 *
 * Persisting the code fixes that, and it is the only way to tell "this card was renumbered" from
 * "this code never existed". Callers must write the result through a reducer that does **not** commit
 * a data snapshot — one `__history` entry per node is not what a numbering pass should cost — and
 * must carry `locatorCode` across `resolveNodeAtPlayback`, which otherwise replaces `node.data`
 * wholesale and would drop every code the moment the needle moved.
 *
 * Pure, and returns only what changed: a viewer who cannot write computes exactly the numbers an
 * owner would have written, so write-back is durability rather than the source of truth.
 */
export function planLocatorAssignments(
    index: LocatorIndex,
    nodes: nodeType[],
): Array<{ nodeId: string; code: string }> {
    const wanted = new Map<string, string>();
    for (const entry of index.entries) {
        if (entry.status === "retired") continue;
        if (entry.locator.kind === "phase" || entry.locator.kind === "stage") continue;
        if (entry.locator.kind === "file" || entry.locator.kind === "event") continue;
        wanted.set(entry.targetId, entry.code);
    }

    const assignments: Array<{ nodeId: string; code: string }> = [];
    for (const node of nodes) {
        const code = wanted.get(node.id);
        if (code === undefined) continue;
        const existing = persistedCodeOf(node);
        if (existing !== null && existing.code === code) continue;
        assignments.push({ nodeId: node.id, code });
    }
    return assignments;
}

/**
 * The graph codes are numbered over, and the derivations a phase code needs.
 *
 * One function because two callers must not each decide for themselves: the exported report, and the
 * canvas when somebody types a code into it. Phase codes are only meaningful over the **unfiltered
 * live graph at the latest playhead** — `canvasClusters` in the editor is computed only at level 1 and
 * only over the *filtered* nodes, so resolving a code against that would find a different clustering
 * and `P1` would mean two different phases depending on which surface asked.
 */
export type LocatorGraphScope = {
    liveNodes: nodeType[];
    liveEdges: edgeType[];
    membership: Map<string, string>;
    salience: ReturnType<typeof buildSalienceIndex>;
    clusters: ActivityCluster[];
};

export function locatorGraphScope(
    nodes: nodeType[],
    edges: edgeType[],
    stages: Array<{ name: string; start: string; end: string }> = [],
): LocatorGraphScope {
    const liveNodes = nodes.filter(isNodeActive);
    const liveEdges = edges.filter((edge) => {
        const deletedAt = (edge.data as Record<string, unknown> | undefined)?.deletedAt;
        return typeof deletedAt !== "string" || deletedAt.trim() === "" || toTimestampMs(deletedAt) === null;
    });
    const membership = buildActivityTreeMembership(liveNodes, liveEdges);
    const salience = buildSalienceIndex(liveNodes, liveEdges, membership);
    const activities = liveNodes.filter((node) => (
        normalizeNodeLabel(nodeLabelOf(node)) === "activity"
    ));
    const clusters = buildActivityClusters({
        activities,
        edges: liveEdges,
        membership,
        score: salience.score,
        stages,
    });
    return { liveNodes, liveEdges, membership, salience, clusters };
}

/** Guard for anything that might hand a lens-invented id to a locator. */
export function isLocatableId(id: unknown): boolean {
    return typeof id === "string" && id !== "" && !id.startsWith(SYNTHETIC_ID_PREFIX);
}

/** Live, codeable nodes, as the index wants them counted. Exported for the report and the tests. */
export function liveLocatableNodes(nodes: nodeType[]): nodeType[] {
    return nodes.filter((node) => kindOfNode(node) !== null && isNodeActive(node));
}
