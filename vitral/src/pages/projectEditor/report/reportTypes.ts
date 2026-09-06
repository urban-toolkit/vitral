import type { edgeType, nodeType } from "@/config/types";
import type { LocatorIndex } from "@/pages/projectEditor/locators";
// Type-only, so it erases: `reportAbstract` imports `reportModel`, which imports this file, and a
// value import here would close that ring at runtime.
import type { ReportCardTypeNotes } from "./reportAbstract";

/**
 * What the report generator is given, and what it hands back.
 *
 * The shapes are deliberately narrow and already normalised: ISO strings rather than `Date`, plain
 * arrays rather than the timeline's `{byId, allIds}`, and exactly one piece of base64 — the single
 * screenshot printed above the abstract, which a one-file export can carry no other way, and which
 * the caller has already bounded in size. Everything that needs a clock, a
 * store, a network or `Date` parsing of a locale string happens at the call site in
 * `ProjectEditorPage`; the generator below it is a pure function of this object, which is what lets
 * the whole document be tested with no React and no server.
 */

/** One timeline stage, as the report reads it. */
export type ReportStage = { id: string; name: string; startIso: string; endIso: string };

export type ReportTimelineInput = {
    startIso: string | null;
    endIso: string | null;
    stages: ReportStage[];
    participants: Array<{ id: string; name: string; role: string }>;
    designStudyEvents: Array<{
        id: string;
        name: string;
        occurredAtIso: string;
        /** The one explicit authorship field the timeline carries. */
        generatedBy: "manual" | "llm" | null;
    }>;
    blueprintEvents: Array<{
        id: string;
        name: string;
        occurredAtIso: string;
        componentNodeId: string | null;
        paperTitle: string | null;
        referenceCitation: string | null;
    }>;
    codebaseSubtracks: Array<{
        id: string;
        name: string;
        filePaths: string[];
        inactive: boolean;
    }>;
    /**
     * Screenshot markers, by instant only.
     *
     * Still instants: this is the list the "system screenshots recorded" sentence counts, and every
     * marker's image inlined at full size is what once made the export unreadable by every markdown
     * tool other than this app. Exactly one image is carried, separately, below.
     */
    screenshotMarkers: Array<{ id: string; occurredAtIso: string; zoneCount: number }>;
    /**
     * The most recent screenshot that actually has an image, printed above the abstract.
     *
     * One image, not the set, and that is the whole design: a report opens on what the system looked
     * like when the study stopped, which is the one picture a reader needs before any prose, while
     * the cost stays bounded by a single figure rather than growing with the study.
     *
     * `imageDataUrl` is a `data:` URL because a `.md` export is one file with nothing beside it —
     * there is no asset directory to point at. The caller is responsible for handing over something
     * of a sane size (`ProjectEditorPage` re-encodes it down); this module inlines whatever it gets.
     *
     * `null` when the project has no screenshot, or has markers that were never given an image — and
     * then nothing at all is emitted, not a placeholder.
     */
    latestScreenshot: { occurredAtIso: string; imageDataUrl: string } | null;
    /** Which model the project is configured to use, for the machine-involvement statement. */
    llmModel: string | null;
};

export type ReportFile = {
    id: string;
    sha256: string;
    name: string;
    ext: string;
    mimeType: string;
    sizeBytes: number;
    createdAtIso: string;
};

export type ReportSnapshot = {
    /** Stamped by the caller. The generator never reads a clock. */
    generatedAtIso: string;
    projectId: string;
    projectTitle: string;
    /** The author's own words for what the project is for — `documents.description`. */
    projectGoal: string;
    /** A content fingerprint of the graph, so two exports of the same study are recognisable. */
    contentVersion: string;
    /**
     * The instant this describes, so a printed citation can be pinned to it.
     *
     * `version` is the server's revision counter when the caller knows it, and `null` when it does
     * not — the editor page holds the document's own last-changed clock but not its revision number,
     * and printing "revision 0" would be worse than printing nothing.
     */
    asOf: { version: number | null; capturedAtIso: string };
    /**
     * The **full** store arrays, tombstones included. The removal log needs the soft-deleted rows and
     * the locator numbering needs their slots; filtering before this point would lose both.
     */
    nodes: nodeType[];
    edges: edgeType[];
    timeline: ReportTimelineInput;
    files: ReportFile[];
};

/** Machine-written framing, already validated, or nothing. */
export type ReportAbstract = {
    prose: string;
    model: string;
    prompt: string;
};

export type ReportOptions = {
    /** Every code in the index, and the levels they claim. */
    codes: LocatorIndex;
    /**
     * Turns a code into a canvas URL. Optional on purpose: with it absent the document is still
     * completely navigable by its own anchors, which is what an offline export has to be.
     */
    canvasUrlForCode: ((code: string) => string | null) | null;
    /** The abstract, when one was requested, produced and accepted. */
    abstract: ReportAbstract | null;
    /**
     * One paragraph per kind of card, printed together at the top. Same standing as the abstract:
     * requested every export, validated kind by kind, and never required — the document is complete
     * without it, so `null` costs one italic line.
     */
    cardTypeNotes: ReportCardTypeNotes | null;
    /** Appendices are most of the length; a caller may want the body alone. */
    includeAppendices: boolean;
};

export type ProjectReport = {
    markdown: string;
    fileName: string;
    stats: {
        cards: number;
        authoredCards: number;
        modelProposedCards: number;
        relations: number;
        phases: number;
        threads: number;
        removedNodes: number;
        setAsideCards: number;
        /** How many of `cards` the document prints in full, rather than only naming. */
        emphasisedCards: number;
        codes: number;
    };
};

/**
 * Bumped when the document's shape changes, so a stored report can be read back knowingly.
 *
 * 2: the card-type notes at the top, and the two registers in Appendix A — full entries for the
 * emphasised cards, `Also indexed` for the rest.
 * 3: the latest system screenshot, inline above the abstract.
 */
export const REPORT_FORMAT_VERSION = 3;
