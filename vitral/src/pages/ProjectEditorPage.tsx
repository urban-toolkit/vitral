import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ReactFlowProvider, useReactFlow, useStore as useReactFlowStore, type Connection, type EdgeChange, type NodeChange, type NodeProps, type NodeTypes } from "@xyflow/react";

import type { AppDispatch, RootState } from "@/store";
import type {
    cardLabel,
    edgeType,
    nodeType,
    Stage,
    BlueprintEvent,
} from "@/config/types";

import { useDocumentSync } from "@/hooks/useDocumentSync";
import { requestReportAbstractLLM } from "@/func/LLMRequest";
import {
    requestSystemScreenshotZonesLLM,
} from "@/func/LLMRequest";
import type { LlmProjectSettingsContext } from "@/func/LLMRequest";
import {
    deleteFile,
    exportProjectVi,
    loadDocument,
    loadKnowledgeProvenance,
    queryCanvasChat,
    queryDocumentNodes,
    setDocumentPublished,
    updateDocumentMeta,
    type KnowledgeBlueprintLink,
    type KnowledgeCrossTreeConnection,
    type KnowledgePillEvent,
    type KnowledgePill,
    type SystemPaperQueryCard,
} from "@/api/stateApi";
import { getGithubDocumentLink, githubStatus, type GitHubDocumentResponse } from "@/api/githubApi";
import { isLocalProjectId } from "@/api/localProjectStore";
import { useSession } from "@/auth/sessionContext";
import { getGitHubEvents } from "@/api/eventsApi";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { FreeInputZone } from "@/components/toolbar/FreeInputZone";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { Card, type CardProps } from "@/components/cards/Card";
import { CARD_LABELS, cardTypeForLabel } from "@/components/cards/cardVisuals";
import type { NoteClassification } from "@/pages/projectEditor/noteClassification";
import { autoLinkNewCards } from "@/pages/projectEditor/autoLinkCards";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { CanvasSidebar } from "@/components/sidebar/CanvasSidebar";
import { RightSidebar } from "@/components/sidebar/RightSidebar";
import { BlueprintNode } from "@/components/blueprint/BlueprintNode";
import { BlueprintComponentNode } from "@/components/blueprint/BlueprintComponentNode";
import { BlueprintGroupNode } from "@/components/blueprint/BlueprintGroupNode";
import {
    BLUEPRINT_ATTACH_MIME,
    parseBlueprintAttachPayload,
} from "@/components/blueprint/blueprintDnD";

import {
    addNode,
    connectEdges,
    detachFileIdFromAllNodes,
    detachFileIdFromNode,
    onEdgesChange,
    onNodesChange,
    setEdges,
    setNodes,
    updateEdge,
    updateNode,
} from "@/store/flowSlice";
import { removeFile, selectAllFiles } from "@/store/filesSlice";
import { selectAllGitHubEvents, setGithubEvents } from "@/store/gitEventsSlice";
import {
    addSystemScreenshotMarker,
    addDefaultStage,
    addStage,
    changeStageBoundary,
    updateSystemScreenshotMarkerImage,
    deleteStage,
    selectAllBlueprintEvents,
    selectCodebaseSubtracks,
    selectAllDesignStudyEvents,
    selectAllStages,
    selectDefaultStages,
    selectParticipants,
    selectLlmModel,
    selectSystemScreenshotMarkers,
    reconcileBlueprintCodebaseAutoLinks,
    selectTimelineStartEnd,
    updateStage,
} from "@/store/timelineSlice";

import {
    attachedComponentIds,
    canvasBlueprintEdges,
    canvasBlueprintNodes,
} from "@/pages/projectEditor/blueprintSurfaces";
import { isModelDerivedNodeData } from "@/utils/edgeProvenance";
import { resolveRouterBasename } from "@/routing";
import {
    buildLocatorIndex,
    codeToUrl,
    locatorGraphScope,
    resolveLocatorReference,
} from "@/pages/projectEditor/locators";
import {
    clearCardFilePreviewRequest,
    requestCardFilePreview,
} from "@/store/cardPreviewStore";
import {
    acceptAbstract,
    buildAbstractPayload,
    buildProjectReport,
    buildReportGraphContext,
    buildReportModel,
    type ReportAbstract,
    type ReportSnapshot,
} from "@/pages/projectEditor/report/projectReport";
import { isAllowedConnection, relationLabelFor, relationPartnersFor } from "@/utils/relationships";
import { buildActivityOrbitLayout, buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import {
    connectionKindFromEdge,
    edgeLabelFrom,
    isEdgeActive,
    isNodeActive,
    normalizeNodeLabel,
    ITERATION_OF_EDGE_LABEL,
    REFERENCED_BY_EDGE_LABEL,
} from "@/pages/projectEditor/graphSemantics";
import {
    buildAbstractedGraph,
    isSyntheticCanvasId,
    levelForZoom,
    NO_CANVAS_FOCUS,
    type CanvasFocusPath,
    type CanvasGlyphData,
    type CanvasLevel,
} from "@/pages/projectEditor/canvasAbstraction";
import { buildActivityClusters } from "@/pages/projectEditor/canvasClusters";
import { buildClusterHalos } from "@/pages/projectEditor/canvasClusterHalos";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import { CanvasLevelControl } from "@/pages/projectEditor/CanvasLevelControl";
import { ClusterGlyph, type ClusterGlyphProps } from "@/components/cards/ClusterGlyph";
import { fromDate } from "@/pages/projectEditor/dateUtils";
import type { CursorMode, GitConnectionStatus } from "@/pages/projectEditor/types";
import {
    CARD_HEIGHT_PX,
    CARD_WIDTH_PX,
    findActivityDropTarget,
    findCardAtPosition,
    findCardSpawnTarget,
    getActivityDropTargets,
    getCardSpawnTargets,
    nodeSizeOf,
    type CardSpawnTarget,
} from "@/pages/projectEditor/canvasGeometry";
import { describeBlockedRemovals, planEdgeRemovals, withArticle } from "@/pages/projectEditor/graphInvariants";
import { CanvasNotice } from "@/pages/projectEditor/CanvasNotice";
import type { ActivityDropRingsReason } from "@/pages/projectEditor/ActivityDropRings";
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, FlowCanvas } from "@/pages/projectEditor/FlowCanvas";
import { CanvasChatOverlay, type CanvasChatEntry } from "@/pages/projectEditor/CanvasChatOverlay";
import { CanvasHighlightBridge } from "@/pages/projectEditor/CanvasHighlightBridge";
import {
    getHoveredAssetFileId,
    setEmphasizedBlueprintComponentIds,
    setHoveredAssetFileId,
} from "@/store/canvasHighlightStore";
import { EdgeConnectMenu, type EdgeConnectOption } from "@/pages/projectEditor/EdgeConnectMenu";
import {
    TimelineDock,
    TIMELINE_DOCK_HEIGHT,
    TIMELINE_DOCK_TOGGLE_HEIGHT,
} from "@/pages/projectEditor/TimelineDock";
import type { KnowledgeBaseEvent } from "@/components/timeline/timelineTypes";
import type { BlueprintEventConnection } from "@/components/timeline/timelineTypes";
import {
    useFileAttachmentProcessing,
    type CanvasDropAnchor,
    type CanvasDropConnection,
} from "@/pages/projectEditor/useFileAttachmentProcessing";
import { SystemScreenshotPanel } from "@/pages/projectEditor/SystemScreenshotPanel";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiagramProject } from "@fortawesome/free-solid-svg-icons";
import { BlueprintTray } from "@/pages/projectEditor/BlueprintTray";
import trayStyles from "@/pages/projectEditor/BlueprintTray.module.css";

const SYSTEM_PAPER_CARD_LABELS = new Set<cardLabel>(["requirement"]);
const FEEDS_INTO_EDGE_LABEL = "feeds into";
const RIGHT_SIDEBAR_WIDTH_PX = 250;
/** Every node that belongs to the blueprint structure, hidden or shown as one filter. */
const BLUEPRINT_NODE_LABELS = new Set(["blueprint", "blueprint_group", "blueprint_component"]);
/**
 * Room under the minimap for the canvas control panel (level segments + follow-zoom + assistant).
 * The panel grows a row taller when something is focused, so the minimap has to step up with it —
 * these two mirror the heights in `CanvasLevelControl.module.css`.
 */
const MINIMAP_LEVEL_PANEL_CLEARANCE_PX = 100;
const MINIMAP_LEVEL_PANEL_FOCUSED_CLEARANCE_PX = 134;
const TIMELINE_TOGGLE_OFFSET_WITH_TOOLBAR_PX = 65;
const TIMELINE_TOGGLE_OFFSET_NO_TOOLBAR_PX = 20;
// Client-side cap on the canvas-chat retrieval `limit`. Must mirror the backend's
// MAX_CANVAS_CHAT_RETRIEVAL_LIMIT / CANVAS_CHAT_MAX_RETRIEVAL_LIMIT cap in
// backend/src/routes/state.ts (the backend clamps regardless); keep the two in sync.
const CANVAS_CHAT_MAX_RETRIEVAL_LIMIT = 200;

/**
 * The same array back when a filter kept everything, so the memos downstream can compare by
 * reference. `Array.prototype.filter` always allocates, which meant the derivation chain was handed
 * a brand-new array on every pass even when nothing was filtered out.
 */
function keepAll<T>(source: readonly T[], kept: T[]): T[] {
    return kept.length === source.length ? (source as T[]) : kept;
}

function readImageFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const value = reader.result;
            if (typeof value === "string") {
                resolve(value);
                return;
            }
            reject(new Error("Failed to read image"));
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error("Failed to read image"));
        };
        reader.readAsDataURL(file);
    });
}

function readImageDimensionsFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            if (width > 0 && height > 0) {
                resolve({ width, height });
                return;
            }
            reject(new Error("Failed to read image resolution"));
        };
        image.onerror = () => reject(new Error("Failed to read image resolution"));
        image.src = dataUrl;
    });
}

type PendingConnectionMenu = {
    sourceId: string;
    targetId: string;
    sourceLabel: string;
    targetLabel: string;
    defaultLabel: string;
    x: number;
    y: number;
};

/**
 * Files dropped inside an activity's ring or on a card's spawn box, waiting on the one question the
 * drop cannot answer: which relation the cards should carry.
 *
 * The whole batch is held rather than created and rewired afterwards, so a cancelled answer leaves
 * nothing behind and every file in the drop ends up with the same relation. `File` handles survive
 * the drag ending — the `DataTransfer` does not, which is why the list is copied out of it in the
 * drop handler rather than read here.
 */
type PendingFileDropMenu = {
    files: File[];
    basePosition: { x: number; y: number };
    anchor: CanvasDropAnchor;
    anchorTitle: string;
    defaultLabel: string;
    x: number;
    y: number;
};

/**
 * A card the user asked a spawn box to create, waiting on the same relation question.
 *
 * Nothing is created until it is answered, for the reason the file drop holds its batch: the card
 * and the edge that justifies its existence are one action, and a card committed before the answer
 * would be exactly the unconnected card the boxes exist to prevent. `note` is set when the note
 * tool raised the menu, in which case the card carries the researcher's sentence instead of being
 * an empty `Untitled`.
 */
type PendingCardSpawnMenu = {
    target: CardSpawnTarget;
    note: NoteClassification | null;
    x: number;
    y: number;
};

/** Menu box for the relation question, matching `EdgeConnectMenu.module.css` with a heading. */
const SPAWN_MENU_WIDTH_PX = 420;
const SPAWN_MENU_HEIGHT_PX = 76;

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function toIsoDateString(value: unknown): string {
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        return value;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }
    return "";
}

function toTimestampMs(value: unknown): number | null {
    if (typeof value === "string" || value instanceof Date) {
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function latestHistoryEntryTimestamp(history: NodeHistoryEntry[]): number | null {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const timestamp = toTimestampMs(history[index]?.at);
        if (timestamp !== null) return timestamp;
    }
    return null;
}

function hashFold(seed: number, value: unknown): number {
    const text = typeof value === "string"
        ? value
        : (value === null || value === undefined ? "" : String(value));
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

type NodeHistoryEntry = {
    at?: unknown;
    kind?: unknown;
    data?: unknown;
    position?: unknown;
};

type ParsedNodeHistoryEntry = {
    atIso: string;
    atMs: number;
    kind: "data" | "position";
    data?: Record<string, unknown>;
    position?: { x: number; y: number };
};

const NODE_HISTORY_KEY = "__history";
const NODE_EDIT_AT_KEY = "__editAt";

function isRecordValue(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function stripNodeMeta(data: Record<string, unknown>): Record<string, unknown> {
    const next = { ...data };
    delete next[NODE_HISTORY_KEY];
    delete next[NODE_EDIT_AT_KEY];
    return next;
}

function toIsoFromTimestamp(timestampMs: number): string {
    return new Date(timestampMs).toISOString();
}

function clampTimestampMsToRange(
    timestampMs: number,
    rangeStartMs: number | null,
    rangeEndMs: number | null,
): number {
    if (rangeStartMs === null || rangeEndMs === null) return timestampMs;
    const minMs = Math.min(rangeStartMs, rangeEndMs);
    const maxMs = Math.max(rangeStartMs, rangeEndMs);
    return Math.max(minMs, Math.min(maxMs, timestampMs));
}

function normalizeNodeHistoryEntries(node: nodeType): ParsedNodeHistoryEntry[] {
    const nodeData = (node.data ?? {}) as Record<string, unknown>;
    const normalized: ParsedNodeHistoryEntry[] = [];
    const rawEntries = nodeHistoryFrom(nodeData);
    for (const entry of rawEntries) {
        const atMs = toTimestampMs(entry.at);
        if (atMs === null) continue;
        const atIso = toIsoFromTimestamp(atMs);
        if (entry.kind === "data" && isRecordValue(entry.data)) {
            normalized.push({
                atIso,
                atMs,
                kind: "data",
                data: stripNodeMeta(entry.data),
            });
            continue;
        }
        if (entry.kind === "position" && isRecordValue(entry.position)) {
            const x = Number(entry.position.x);
            const y = Number(entry.position.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            normalized.push({
                atIso,
                atMs,
                kind: "position",
                position: { x, y },
            });
        }
    }
    normalized.sort((a, b) => {
        if (a.atMs !== b.atMs) return a.atMs - b.atMs;
        if (a.kind === b.kind) return 0;
        return a.kind === "data" ? -1 : 1;
    });
    return normalized;
}

function serializeNodeHistoryEntries(history: ParsedNodeHistoryEntry[]): NodeHistoryEntry[] {
    return history.map((entry) => {
        if (entry.kind === "data") {
            return {
                at: entry.atIso,
                kind: "data",
                data: { ...(entry.data ?? {}) },
            };
        }
        return {
            at: entry.atIso,
            kind: "position",
            position: {
                x: entry.position?.x ?? 0,
                y: entry.position?.y ?? 0,
            },
        };
    });
}

function nodeDataRecord(node: nodeType): Record<string, unknown> {
    const data = node.data;
    return isRecordValue(data) ? { ...data } : {};
}

function edgeDataRecord(edge: edgeType): Record<string, unknown> {
    return edge.data && typeof edge.data === "object"
        ? { ...(edge.data as Record<string, unknown>) }
        : {};
}

function nodeHistoryFrom(data: unknown): NodeHistoryEntry[] {
    if (!data || typeof data !== "object") return [];
    const history = (data as Record<string, unknown>).__history;
    if (!Array.isArray(history)) return [];
    return history.filter((entry): entry is NodeHistoryEntry => (
        typeof entry === "object" &&
        entry !== null
    ));
}

function resolveNodeAtPlayback(node: nodeType, playbackTime: number): nodeType {
    const dataRecord = (node.data ?? {}) as Record<string, unknown>;
    const history = [...nodeHistoryFrom(dataRecord)].sort((a, b) => {
        const aAt = toTimestampMs(a.at);
        const bAt = toTimestampMs(b.at);
        if (aAt === null && bAt === null) return 0;
        if (aAt === null) return 1;
        if (bAt === null) return -1;
        if (aAt !== bAt) return aAt - bAt;
        if (a.kind === b.kind) return 0;
        if (a.kind === "data") return -1;
        if (b.kind === "data") return 1;
        return 0;
    });
    if (history.length === 0) return node;

    let resolvedData: Record<string, unknown> | null = null;
    let resolvedPosition: { x: number; y: number } | null = null;

    for (const entry of history) {
        const at = toTimestampMs(entry.at);
        if (at === null || at > playbackTime) continue;

        if (entry.kind === "data" && entry.data && typeof entry.data === "object") {
            resolvedData = { ...(entry.data as Record<string, unknown>) };
        }
        if (entry.kind === "position" && entry.position && typeof entry.position === "object") {
            const position = entry.position as Record<string, unknown>;
            const x = Number(position.x);
            const y = Number(position.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                resolvedPosition = { x, y };
            }
        }
    }

    if (!resolvedData && !resolvedPosition) return node;

    const nextData = resolvedData
        ? ({
            ...resolvedData,
            __history: history,
        } as unknown as nodeType["data"])
        : node.data;

    return {
        ...node,
        ...(resolvedPosition ? { position: resolvedPosition } : {}),
        data: nextData,
    };
}

function isKnowledgeCardNode(node: nodeType): boolean {
    const labelValue = normalizeNodeLabel(String((node.data as Record<string, unknown>)?.label ?? ""));
    return CARD_LABELS.includes(labelValue as cardLabel);
}


const FlowInnerWithProjectId = ({ projectId }: { projectId: string }) => {
    const { status, error, reviewOnly, canEdit, isOwner, published, ownerUsername } =
        useDocumentSync(projectId);
    // Publishing is an account action, so the control needs to know whether there is one — a guest
    // reading an ownerless legacy project counts as its "owner" under the pre-accounts rule, and
    // would otherwise be offered a button the server refuses.
    const { user: sessionUser, isGuest } = useSession();

    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    // Read for one thing only: `?ref=`, the other end of the links the exported report prints. See
    // the deep-link effect below.
    const [searchParams, setSearchParams] = useSearchParams();
    const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();
    // The pane's own size, for working out how far to zoom in on one node. Read from the store rather
    // than measured, because that is the same number `setCenter` divides by; a subscription costs a
    // render on resize and nothing else.
    const flowWidth = useReactFlowStore((state) => state.width);
    const flowHeight = useReactFlowStore((state) => state.height);
    /**
     * Whether React Flow has measured every node it was handed.
     *
     * Subscribed to for one reason: `<ReactFlow fitView>` in `FlowCanvas` is a **third** whole-graph
     * fit, and it is the only one outside the `nodeFocusPendingRef` protocol, because it happens
     * inside React Flow's own store — queued at init as `fitViewQueued` and resolved on the first
     * flush where this flag goes up. The two effects below can be told to stand down; this one can
     * only be waited out, and a reference arriving in the URL has to wait it out or be pulled back to
     * the whole graph one frame after it lands.
     */
    const nodesMeasured = useReactFlowStore((state) => state.nodesInitialized);

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<CursorMode>("");
    const [fileDragActive, setFileDragActive] = useState(false);
    // A card the user just created, to be brought into view once the layout has placed it.
    /**
     * A node the camera should move to once the layout has placed it.
     *
     * Two modes, because two gestures want different things. `pan` keeps the current zoom and is for
     * a card the researcher just created — the layout, not the cursor, decides where it lands, so it
     * can appear off-screen, but the reader's zoom is theirs and should not be taken. `fit` re-frames,
     * and is for arriving at a code typed into the reference box: there is no prior viewport worth
     * preserving, and "zoom to it" is the whole request.
     *
     * `deadlineAt` exists because the effect that consumes this waits for the node to appear in
     * `displayedNodes` and re-runs on every derivation until it does. Without a deadline a target
     * that never appears — filtered out, folded into a glyph, deleted between request and arrival —
     * leaves the state set forever, retrying silently on every render and reporting nothing.
     */
    const [pendingCanvasFocus, setPendingCanvasFocus] = useState<
        { nodeId: string; mode: "pan" | "fit"; deadlineAt: number } | null
    >(null);

    /** How long to keep waiting for a target to be laid out before saying it could not be reached. */
    const FOCUS_DEADLINE_MS = 4000;

    /**
     * How much of the pane the target fills when a reference lands on it, in its tighter axis.
     *
     * Not 1: arriving at a card that fills the screen answers "here it is" and nothing about where it
     * sits. Just under half leaves the ring of cards around it visible, which is the context half of
     * Focus+Context doing its job at the moment of arrival.
     */
    const FOCUS_FIT_COVERAGE = 0.44;

    /**
     * The same fact as `pendingCanvasFocus`, readable from inside a `setTimeout`.
     *
     * Two other effects refit the **whole graph** on a `setTimeout(0)` — one when the filters change,
     * one when the level or focus does — and going to a reference changes both, so all three timers
     * are queued in the same tick and the two general ones run last and win. That is what made a
     * typed `R2` land on the whole activity tree instead of on R2: the camera did go to the card, and
     * was then immediately pulled back out. A ref rather than the state because those callbacks close
     * over the render that scheduled them.
     */
    const nodeFocusPendingRef = useRef(false);

    const requestNodeFocus = useCallback((nodeId: string, mode: "pan" | "fit" = "pan") => {
        nodeFocusPendingRef.current = true;
        setPendingCanvasFocus({ nodeId, mode, deadlineAt: Date.now() + FOCUS_DEADLINE_MS });
    }, []);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [blueprintComponentsVisible, setBlueprintComponentsVisible] = useState(true);
    // Whether the model-derived layer is on the canvas at all. Turning it off leaves the record the
    // team authored by hand — every activity, every card they wrote, every artifact they attached —
    // which is the point: the extracted cards are an index over that material, not the material.
    const [modelDerivedVisible, setModelDerivedVisible] = useState(true);
    const [authoredVisible, setAuthoredVisible] = useState(true);
    // Cards can be dragged out of the position the layout gives them, for a closer look at a
    // cluster. The arrangement is deliberately session-only — the layout still owns where a card
    // belongs — so "Reset card positioning" is all it takes to put everything back.
    const [manualNodePositions, setManualNodePositions] = useState<Record<string, { x: number; y: number }>>({});
    // How abstract the canvas is drawn, and which branch of it is currently opened out. Session
    // state, like the manual positions above: nothing here belongs to the project.
    const [canvasLevel, setCanvasLevel] = useState<CanvasLevel>(3);
    const [levelFollowsZoom, setLevelFollowsZoom] = useState(false);
    const [canvasFocus, setCanvasFocus] = useState<CanvasFocusPath>(NO_CANVAS_FOCUS);
    // Creating cards, dropping files and the activity drop rings all resolve a target from what is
    // on the canvas. Above Detail that is glyphs, which have no id in the document to attach
    // anything to — so those affordances are only live on the bare graph.
    const canvasIsEditable = canvasLevel === 3;
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [selectedLabels, setSelectedLabels] = useState<cardLabel[]>([...CARD_LABELS]);
    const [activeQuery, setActiveQuery] = useState("");
    const [queryMatchedNodeIds, setQueryMatchedNodeIds] = useState<string[] | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<CanvasChatEntry[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    // Replaces the blocking `alert` the extraction path used to raise: the file is already
    // attached by the time extraction can fail, so this is a notice, not a dialog.
    const [fileProcessingError, setFileProcessingError] = useState<string | null>(null);
    // Session state, like the manual positions and the filters: whether a panel is open is not
    // something the project remembers.
    const [trayOpen, setTrayOpen] = useState(false);
    const [exportingProject, setExportingProject] = useState(false);
    const [exportingMarkdown, setExportingMarkdown] = useState(false);
    const [gitConnectionStatus, setGitConnectionStatus] = useState<GitConnectionStatus>({ connected: false });
    const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
    const [processingSystemScreenshot, setProcessingSystemScreenshot] = useState(false);
    const [knowledgePills, setKnowledgePills] = useState<KnowledgePill[]>([]);
    const [knowledgeCreationEvents, setKnowledgeCreationEvents] = useState<KnowledgePillEvent[]>([]);
    const [localDeletedKnowledgeCreationEvents, setLocalDeletedKnowledgeCreationEvents] = useState<KnowledgePillEvent[]>([]);
    const [knowledgeCrossTreeConnections, setKnowledgeCrossTreeConnections] = useState<KnowledgeCrossTreeConnection[]>([]);
    const [knowledgeBlueprintLinks, setKnowledgeBlueprintLinks] = useState<KnowledgeBlueprintLink[]>([]);
    const [playbackAt, setPlaybackAt] = useState<string | null>(null);
    const [projectGoal, setProjectGoal] = useState("");
    const [pendingConnectionMenu, setPendingConnectionMenu] = useState<PendingConnectionMenu | null>(null);
    const [pendingFileDropMenu, setPendingFileDropMenu] = useState<PendingFileDropMenu | null>(null);
    const [pendingCardSpawnMenu, setPendingCardSpawnMenu] = useState<PendingCardSpawnMenu | null>(null);
    /** Mirrors the document's `published` flag while a publish request is in flight. */
    const [publishedState, setPublishedState] = useState(false);
    const [publishBusy, setPublishBusy] = useState(false);

    // The sync hook owns the loaded value; this is the local echo that the toggle updates.
    useEffect(() => {
        setPublishedState(published);
    }, [published]);
    /**
     * Set by the pointerdown that dismisses a pending menu, and cleared by the click that follows
     * it in the same gesture.
     *
     * Clicking away is how these menus are cancelled, and `pointerdown` precedes `click` — so
     * without this the cancel click carries straight on into `onCanvasClick` and, with the card
     * tool still armed, creates the very card the user just declined to create.
     */
    const canvasClickSuppressedRef = useRef(false);
    /**
     * Why the canvas just did nothing. Paired with a counter so repeating a refused gesture
     * re-shows and re-times the same sentence instead of looking ignored.
     */
    const [canvasNotice, setCanvasNotice] = useState<{ message: string; id: number } | null>(null);
    const canvasNoticeIdRef = useRef(0);

    const showCanvasNotice = useCallback((message: string) => {
        canvasNoticeIdRef.current += 1;
        setCanvasNotice({ message, id: canvasNoticeIdRef.current });
    }, []);

    const dismissCanvasNotice = useCallback(() => setCanvasNotice(null), []);

    /**
     * Publish or unpublish this project, from the project screen.
     *
     * This is what replaced "Make review only". The two are not the same act and must not be
     * confused: publishing is reversible and only changes who can see the project, and the owner
     * keeps editing it the whole time. Only the owner sees this control at all.
     */
    const handleTogglePublished = useCallback(async () => {
        if (publishBusy) return;
        const next = !publishedState;

        if (!next) {
            const confirmed = window.confirm(
                "Unpublish this project?\n\nIt will disappear from Public projects and other accounts will lose access to it.",
            );
            if (!confirmed) return;
        }

        setPublishBusy(true);
        try {
            const updated = await setDocumentPublished(projectId, next);
            setPublishedState(Boolean(updated.published));
            showCanvasNotice(next
                ? "Published. Other accounts can now find this project under Public projects, read-only."
                : "Unpublished. This project is private again.");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update publishing.";
            showCanvasNotice(message);
        } finally {
            setPublishBusy(false);
        }
    }, [publishBusy, publishedState, projectId, showCanvasNotice]);
    const queuedPositionChangesRef = useRef<Array<NodeChange<nodeType> & { __editAt?: string }>>([]);
    const nodeChangeRafRef = useRef<number | null>(null);
    const previousNodesRef = useRef<nodeType[]>([]);
    const queryRequestIdRef = useRef(0);
    const chatRequestIdRef = useRef(0);
    const pointerPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);
    const title = useSelector((state: RootState) => state.flow.title);
    const allFiles = useSelector(selectAllFiles);
    const gitEvents = useSelector(selectAllGitHubEvents);

    const timelineStages = useSelector(selectAllStages);
    const defaultStages = useSelector(selectDefaultStages);
    const participants = useSelector(selectParticipants);
    const llmModel = useSelector(selectLlmModel);
    const timelineStartEnd = useSelector(selectTimelineStartEnd);
    const designStudyEvents = useSelector(selectAllDesignStudyEvents);
    const blueprintEvents = useSelector(selectAllBlueprintEvents);
    const systemScreenshotMarkers = useSelector(selectSystemScreenshotMarkers);
    const codebaseSubtracks = useSelector(selectCodebaseSubtracks);

    const llmProjectSettings = useMemo<LlmProjectSettingsContext>(() => {
        const participantRecords = participants.map((participant) => ({
            name: String(participant.name ?? "").trim() || "Participant",
            role: String(participant.role ?? "").trim() || "Researcher",
        }));
        const availableRoles = Array.from(new Set(participantRecords.map((participant) => participant.role)));

        return {
            llmModel,
            projectTitle: title?.trim() || "Untitled",
            projectGoal: projectGoal?.trim() || "",
            participants: participantRecords,
            availableRoles,
            timeline: {
                start: toIsoDateString(timelineStartEnd.start),
                end: toIsoDateString(timelineStartEnd.end),
                defaultStages: [...defaultStages],
                stages: timelineStages.map((stage) => ({
                    name: stage.name,
                    start: toIsoDateString(stage.start),
                    end: toIsoDateString(stage.end),
                })),
                milestones: designStudyEvents.map((eventData) => ({
                    name: eventData.name,
                    occurredAt: toIsoDateString(eventData.occurredAt),
                    generatedBy: eventData.generatedBy === "llm" ? "llm" : "manual",
                })),
            },
        };
    }, [defaultStages, designStudyEvents, llmModel, participants, projectGoal, timelineStages, timelineStartEnd.end, timelineStartEnd.start, title]);

    const mostRecentSystemScreenshotMarker = useMemo(() => {
        if (systemScreenshotMarkers.length === 0) return null;

        let latest = systemScreenshotMarkers[0];
        for (let i = 1; i < systemScreenshotMarkers.length; i++) {
            const candidate = systemScreenshotMarkers[i];
            const latestTime = new Date(latest.occurredAt).getTime();
            const candidateTime = new Date(candidate.occurredAt).getTime();
            if (Number.isNaN(latestTime) || candidateTime >= latestTime) {
                latest = candidate;
            }
        }

        return latest;
    }, [systemScreenshotMarkers]);
    const playbackAwareSystemScreenshotMarker = useMemo(() => {
        if (systemScreenshotMarkers.length === 0) return null;
        if (!playbackAt) return mostRecentSystemScreenshotMarker;

        const cutoffTime = new Date(playbackAt).getTime();
        if (Number.isNaN(cutoffTime)) return mostRecentSystemScreenshotMarker;

        let latest: typeof systemScreenshotMarkers[number] | null = null;
        let latestTime = Number.NEGATIVE_INFINITY;
        for (const marker of systemScreenshotMarkers) {
            const markerTime = new Date(marker.occurredAt).getTime();
            if (Number.isNaN(markerTime)) continue;
            if (markerTime > cutoffTime) continue;
            if (markerTime >= latestTime) {
                latest = marker;
                latestTime = markerTime;
            }
        }
        return latest;
    }, [mostRecentSystemScreenshotMarker, playbackAt, systemScreenshotMarkers]);
    const playbackAtTime = useMemo(() => {
        if (!playbackAt) return null;
        return toTimestampMs(playbackAt);
    }, [playbackAt]);
    // Deleted cards never reach the canvas, and they must not bridge two trees while working out
    // which activity a card belongs to either, so tree membership is derived from the live graph.
    // Every filter down this chain goes through `keepAll`, so a filter that removes nothing hands the
    // same array on. In the default state — nothing deleted, all labels shown, no query, no playback —
    // that makes `filteredNodes` literally `state.flow.nodes`, which is what lets `buildAbstractedGraph`
    // short-circuit at level 3 and the satellite assignment reuse its cache.
    const liveNodes = useMemo(
        () => keepAll(nodes, nodes.filter((node) => (
            toTimestampMs((node.data as Record<string, unknown>)?.deletedAt) === null
        ))),
        [nodes],
    );
    const liveEdges = useMemo(
        () => keepAll(edges, edges.filter((edge) => (
            toTimestampMs((edge.data as Record<string, unknown> | undefined)?.deletedAt) === null
        ))),
        [edges],
    );

    /**
     * What the Blueprint track draws: one marker per live component, plus any stored event that still
     * has a component behind it.
     *
     * ## Derived, not minted
     *
     * A marker is a **view of a node**, in exactly the sense contract 28 means when it says the tray
     * and the canvas are two surfaces over one graph. The component's existence, its name, its paper
     * and its date are all already in `flow.nodes`; writing a second copy of them into the timeline
     * slice buys nothing and costs three things, all of which appeared the moment the track started
     * covering unattached components as well as attached ones:
     *
     * - **Opening a project would edit it.** Back-filling a marker for every component a researcher
     *   had made but never attached is a write, and `useDocumentSync` cannot tell it from a real one:
     *   it changes the save hash, so merely opening a study would append a revision snapshot to the
     *   very provenance record this application exists to keep.
     * - **Only owners would see them.** Minting runs behind `interactionLocked`, so a guest or the
     *   reader of a published project would get the old track — and it would silently change the next
     *   time the owner happened to open the project.
     * - **A guessed date would become a fact.** A component saved before component timestamps existed
     *   has no `createdAt`, and any fallback is a guess. Derived, the guess is recomputed and can be
     *   corrected; persisted, it is indistinguishable from something the researcher recorded.
     *
     * A stored event still wins on `occurredAt` where one exists, so nothing moves on the track for a
     * project that already carries them. Everything else is read from the node, which means renaming a
     * component renames its marker with no reconciliation pass at all.
     *
     * ## Why the filter on stored events stays
     *
     * Deleting a component used to leave its event behind, and the track drew it dimmed and dashed —
     * the styling for "this component answers no requirement", which is true and useful about a
     * component that *exists*. Said about one that has been deleted it is a ghost. Filtered rather
     * than deleted from the slice, because destroying a record on a *soft* delete would be the one
     * irreversible step in a chain that is otherwise all recoverable, and because a filter also fixes
     * the projects that already carry stale rows.
     *
     * `liveNodes`, not `timelineContextNodes`: the needle gates whole activity trees and blueprint
     * structure belongs to none, so a deleted component is gone from this set whatever the playhead
     * is doing — the same answer the tray and the canvas give.
     */
    const liveBlueprintEvents = useMemo<BlueprintEvent[]>(() => {
        const liveNodeIds = new Set(liveNodes.map((node) => node.id));
        const kept = blueprintEvents.filter((eventData) => {
            const componentNodeId = typeof eventData.componentNodeId === "string"
                ? eventData.componentNodeId.trim()
                : "";
            // An event naming no component is not about one, so there is nothing to have been
            // deleted. Those are left alone.
            if (componentNodeId === "") return true;
            return liveNodeIds.has(componentNodeId);
        });

        const storedByComponentId = new Map<string, BlueprintEvent>();
        for (const eventData of kept) {
            const componentNodeId = typeof eventData.componentNodeId === "string"
                ? eventData.componentNodeId.trim()
                : "";
            if (componentNodeId !== "") storedByComponentId.set(componentNodeId, eventData);
        }

        const markers: BlueprintEvent[] = [];
        for (const node of liveNodes) {
            if (normalizeNodeLabel(String(node.data?.label ?? "")) !== "blueprint_component") continue;

            const componentData = (node.data ?? {}) as Record<string, unknown>;
            const blueprintComponent = componentData.blueprintComponent
                && typeof componentData.blueprintComponent === "object"
                ? componentData.blueprintComponent as Record<string, unknown>
                : null;
            const stored = storedByComponentId.get(node.id);
            const createdAt = typeof componentData.createdAt === "string"
                && componentData.createdAt.trim() !== ""
                ? componentData.createdAt
                : null;
            // A component with neither a stored event nor a timestamp of its own has no honest place
            // on a time axis, and guessing one would put a date on the track that nothing in the
            // document supports. Only documents predating component timestamps can reach this; every
            // creation path in the tray stamps one.
            if (!stored && createdAt === null) continue;

            markers.push({
                id: stored?.id ?? `blueprint-component:${node.id}`,
                // Read off the node every time, so a rename reaches the track without a write.
                name: typeof componentData.title === "string" && componentData.title.trim() !== ""
                    ? componentData.title
                    : "Blueprint component",
                // A stored event keeps the instant it was minted with, so an existing project's
                // markers do not move; otherwise the component's own moment. One of the two always
                // exists by the guard above.
                occurredAt: stored?.occurredAt ?? createdAt!,
                componentNodeId: node.id,
                paperDescription: blueprintComponent && typeof blueprintComponent.description === "string"
                    ? blueprintComponent.description
                    : "",
                referenceCitation: blueprintComponent && typeof blueprintComponent.referenceCitation === "string"
                    ? blueprintComponent.referenceCitation
                    : "",
                paperTitle: typeof componentData.blueprintPaperTitle === "string"
                    ? componentData.blueprintPaperTitle
                    : undefined,
                blueprintFileName: typeof componentData.blueprintFileName === "string"
                    ? componentData.blueprintFileName
                    : undefined,
            } as BlueprintEvent);
        }

        // Stored rows naming no component keep their place; every component-backed one is already
        // represented above.
        for (const eventData of kept) {
            const componentNodeId = typeof eventData.componentNodeId === "string"
                ? eventData.componentNodeId.trim()
                : "";
            if (componentNodeId !== "") continue;
            markers.push(eventData);
        }

        return markers;
    }, [blueprintEvents, liveNodes]);
    const activityTreeMembership = useMemo(
        () => buildActivityTreeMembership(liveNodes, liveEdges),
        [liveEdges, liveNodes],
    );
    const timelineRangeStartMs = useMemo(
        () => toTimestampMs(timelineStartEnd.start),
        [timelineStartEnd.start],
    );
    const timelineRangeEndMs = useMemo(
        () => toTimestampMs(timelineStartEnd.end),
        [timelineStartEnd.end],
    );
    const latestCanvasChangeTime = useMemo(() => {
        let latest: number | null = null;

        const addCandidate = (value: unknown) => {
            const timestamp = typeof value === "number" && Number.isFinite(value)
                ? value
                : toTimestampMs(value);
            if (timestamp === null) return;
            latest = latest === null ? timestamp : Math.max(latest, timestamp);
        };

        for (const node of nodes) {
            const nodeData = (node.data ?? {}) as Record<string, unknown>;
            addCandidate(nodeData.createdAt);
            addCandidate(nodeData.deletedAt);
            const dataRecord = (node.data ?? {}) as Record<string, unknown>;
            addCandidate(latestHistoryEntryTimestamp(nodeHistoryFrom(dataRecord)));
        }
        for (const edge of edges) {
            addCandidate((edge.data as Record<string, unknown> | undefined)?.createdAt);
            addCandidate((edge.data as Record<string, unknown> | undefined)?.deletedAt);
        }

        return latest;
    }, [edges, nodes]);
    // Where the needle sits never blocks editing: it only chooses which activity trees are on
    // screen, so a card that is visible is a card you can work on.
    /**
     * Everything that changes the document is gated on this.
     *
     * It used to be `reviewOnly` alone. That is no longer the whole answer: a project can now be
     * somebody else's, in which case it opens read-only for you and stays fully editable for them.
     * The server works it out per request (`can_edit`) so the two reasons — a permanent review-mode
     * conversion, and "this belongs to another account" — cannot drift apart on the client.
     */
    // `!canEdit` is the server's answer, and it is about whatever cookie the request carried. A
    // guest may edit exactly one kind of project — the `local-` ones in this browser (contract 26)
    // — so that is asserted here instead of being inferred from a session the client cannot see.
    // Without it, a browser calling itself a guest while still holding an account's cookie gets the
    // whole editor on that account's published project.
    const interactionLocked = !canEdit || (isGuest && !isLocalProjectId(projectId));
    const resolveActionTimestamp = useCallback(() => {
        if (playbackAt) {
            const parsed = new Date(playbackAt);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        const nowMs = Date.now();
        if (timelineRangeStartMs === null || timelineRangeEndMs === null) {
            return new Date(nowMs).toISOString();
        }
        const minMs = Math.min(timelineRangeStartMs, timelineRangeEndMs);
        const maxMs = Math.max(timelineRangeStartMs, timelineRangeEndMs);
        const defaultMs = (nowMs < minMs || nowMs > maxMs) ? minMs : nowMs;
        return new Date(defaultMs).toISOString();
    }, [playbackAt, timelineRangeEndMs, timelineRangeStartMs]);
    // The needle gates whole activity trees and nothing else. An activity and every card orbiting it
    // appear together the moment the activity exists and stay put from there on, so no node-level
    // history is replayed. Anything belonging to no tree — orphan cards, blueprint structure — is
    // never gated by the needle.
    const timelineContextNodes = useMemo(() => {
        if (playbackAtTime === null) return liveNodes;

        const visibleActivityIds = new Set(
            liveNodes
                .filter((node) => {
                    const nodeData = (node.data ?? {}) as Record<string, unknown>;
                    if (normalizeNodeLabel(String(nodeData.label ?? "")) !== "activity") return false;
                    const createdAt = toTimestampMs(nodeData.createdAt);
                    return createdAt === null || createdAt <= playbackAtTime;
                })
                .map((node) => node.id),
        );

        return keepAll(liveNodes, liveNodes.filter((node) => {
            const activityId = activityTreeMembership.get(node.id);
            if (activityId === undefined) return true;
            return visibleActivityIds.has(activityId);
        }));
    }, [activityTreeMembership, liveNodes, playbackAtTime]);
    const timelineContextEdges = useMemo(() => {
        const visibleNodeIds = new Set(timelineContextNodes.map((node) => node.id));
        return keepAll(liveEdges, liveEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        )));
    }, [liveEdges, timelineContextNodes]);
    const knowledgeProvenanceTriggerKey = useMemo(() => {
        let hash = 2166136261;

        for (const node of nodes) {
            const nodeData = (node.data ?? {}) as Record<string, unknown>;
            hash = hashFold(hash, node.id);
            hash = hashFold(hash, node.parentId ?? "");
            hash = hashFold(hash, normalizeNodeLabel(String(nodeData.label ?? "")));
            hash = hashFold(hash, typeof nodeData.title === "string" ? nodeData.title : "");
            hash = hashFold(hash, nodeData.relevant === false ? "0" : "1");
            hash = hashFold(hash, nodeData.createdAt);
            hash = hashFold(hash, nodeData.deletedAt);
        }

        for (const edge of edges) {
            const edgeData = (edge.data ?? {}) as Record<string, unknown>;
            hash = hashFold(hash, edge.id);
            hash = hashFold(hash, edge.source);
            hash = hashFold(hash, edge.target);
            hash = hashFold(
                hash,
                typeof edgeData.label === "string"
                    ? edgeData.label
                    : (typeof edge.label === "string" ? edge.label : ""),
            );
            hash = hashFold(hash, edgeData.from);
            hash = hashFold(hash, edgeData.to);
            hash = hashFold(hash, edgeData.createdAt);
            hash = hashFold(hash, edgeData.deletedAt);
        }

        for (const eventData of blueprintEvents) {
            hash = hashFold(hash, eventData.id);
            hash = hashFold(hash, eventData.componentNodeId ?? "");
            hash = hashFold(hash, eventData.name ?? "");
            hash = hashFold(hash, eventData.occurredAt);
        }

        return `${nodes.length}|${edges.length}|${blueprintEvents.length}|${latestCanvasChangeTime ?? 0}|${hash.toString(16)}`;
    }, [blueprintEvents, edges, latestCanvasChangeTime, nodes]);
    const lastKnowledgeProvenanceKeyRef = useRef<string>("");
    const lastKnowledgeProvenanceRequestKeyRef = useRef<string>("");
    const previousKnowledgeSyncStatusRef = useRef<string>(status);

    useEffect(() => {
        setLocalDeletedKnowledgeCreationEvents([]);
        previousNodesRef.current = [];
    }, [projectId]);

    useEffect(() => {
        const previousStatus = previousKnowledgeSyncStatusRef.current;
        const shouldForceAfterSaveSettled = previousStatus === "saving" && status === "ready";
        previousKnowledgeSyncStatusRef.current = status;

        if (status === "loading") return;
        const requestKey = `${projectId}|${knowledgeProvenanceTriggerKey}|live`;
        const didRequestKeyChange = lastKnowledgeProvenanceRequestKeyRef.current !== requestKey;
        lastKnowledgeProvenanceRequestKeyRef.current = requestKey;
        if (lastKnowledgeProvenanceKeyRef.current === requestKey && !shouldForceAfterSaveSettled && !didRequestKeyChange) return;

        let active = true;
        const loadKnowledgeProvenanceSnapshot = async () => {
            const nowMs = Date.now();
            const latestCanvasMs = latestCanvasChangeTime ?? nowMs;
            const at = new Date(Math.max(nowMs, latestCanvasMs)).toISOString();
            try {
                const provenance = await loadKnowledgeProvenance(projectId, at);
                if (!active) return;
                lastKnowledgeProvenanceKeyRef.current = requestKey;
                setKnowledgePills(Array.isArray(provenance.pills) ? provenance.pills : []);
                setKnowledgeCreationEvents(Array.isArray(provenance.events) ? provenance.events : []);
                setKnowledgeCrossTreeConnections(Array.isArray(provenance.crossTreeConnections) ? provenance.crossTreeConnections : []);
                setKnowledgeBlueprintLinks(Array.isArray(provenance.blueprintLinks) ? provenance.blueprintLinks : []);
            } catch (error) {
                if (!active) return;
                lastKnowledgeProvenanceKeyRef.current = "";
                console.warn("Failed to load knowledge provenance timeline payload.", error);
            }
        };

        const immediateTimerId = window.setTimeout(() => {
            void loadKnowledgeProvenanceSnapshot();
        }, 260);
        const settledTimerId = window.setTimeout(() => {
            void loadKnowledgeProvenanceSnapshot();
        }, 1450);

        return () => {
            active = false;
            window.clearTimeout(immediateTimerId);
            window.clearTimeout(settledTimerId);
        };
    }, [knowledgeProvenanceTriggerKey, latestCanvasChangeTime, projectId, status]);
    const cardCreatedAtByNodeId = useMemo(() => {
        const byId = new Map<string, string>();
        for (const node of nodes) {
            const data = (node.data ?? {}) as Record<string, unknown>;
            const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
            const parsed = new Date(createdAt);
            if (Number.isNaN(parsed.getTime())) continue;
            byId.set(node.id, parsed.toISOString());
        }
        return byId;
    }, [nodes]);
    const mergedKnowledgeCreationEvents = useMemo<KnowledgePillEvent[]>(() => {
        const byNodeId = new Map<string, KnowledgePillEvent>();
        const existingNodeIdSet = new Set(nodes.map((node) => node.id));
        const currentActiveNodeIdSet = new Set(
            nodes
                .filter((node) => {
                    const nodeData = (node.data ?? {}) as Record<string, unknown>;
                    return toTimestampMs(nodeData.deletedAt) === null;
                })
                .map((node) => node.id)
        );
        const readNodeId = (eventData: KnowledgePillEvent): string => (
            typeof eventData.nodeId === "string" ? eventData.nodeId.trim() : ""
        );
        const addServerEvent = (eventData: KnowledgePillEvent) => {
            const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId.trim() : "";
            if (!nodeId) return;
            if (!existingNodeIdSet.has(nodeId)) return;
            byNodeId.set(nodeId, eventData);
        };
        for (const eventData of knowledgeCreationEvents) {
            addServerEvent(eventData);
        }
        for (const localDeletedEvent of localDeletedKnowledgeCreationEvents) {
            const nodeId = readNodeId(localDeletedEvent);
            if (!nodeId) continue;
            if (!existingNodeIdSet.has(nodeId)) continue;
            if (currentActiveNodeIdSet.has(nodeId)) continue;
            const serverEvent = byNodeId.get(nodeId);
            if (!serverEvent) {
                byNodeId.set(nodeId, localDeletedEvent);
                continue;
            }
            // Keep locally-deleted tombstones visible while server payload is still stale.
            if (serverEvent.isDeleted !== true && localDeletedEvent.isDeleted === true) {
                byNodeId.set(nodeId, localDeletedEvent);
            }
        }

        // Ensure newly-created local cards appear in timeline immediately,
        // even before server provenance refresh includes them.
        for (const node of nodes) {
            const nodeId = String(node.id ?? "").trim();
            if (!nodeId) continue;
            if (byNodeId.has(nodeId)) continue;

            const nodeData = (node.data ?? {}) as Record<string, unknown>;
            const labelValue = normalizeNodeLabel(String(nodeData.label ?? ""));
            if (!CARD_LABELS.includes(labelValue as cardLabel)) continue;

            const titleValue = typeof nodeData.title === "string" && nodeData.title.trim() !== ""
                ? nodeData.title
                : "Untitled";
            const descriptionValue = typeof nodeData.description === "string"
                ? nodeData.description
                : "";
            const createdAtValue = cardCreatedAtByNodeId.get(nodeId) ?? new Date().toISOString();
            const isDeleted = toTimestampMs(nodeData.deletedAt) !== null;

            byNodeId.set(nodeId, {
                id: `synthetic-created:${nodeId}`,
                occurredAt: createdAtValue,
                eventType: "created",
                isDeleted,
                nodeId,
                cardLabel: labelValue,
                cardTitle: titleValue,
                cardDescription: descriptionValue,
                treeId: labelValue === "activity" ? nodeId : null,
                treeTitle: labelValue === "activity" ? titleValue : null,
                metadata: {
                    deleted: isDeleted,
                    synthetic: true,
                    relevant: nodeData.relevant !== false,
                },
            });
        }
        return Array.from(byNodeId.values()).sort((a, b) => {
            const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
            if (delta !== 0) return delta;
            return a.id.localeCompare(b.id);
        });
    }, [cardCreatedAtByNodeId, knowledgeCreationEvents, localDeletedKnowledgeCreationEvents, nodes]);

    const knowledgeBaseEvents = useMemo<KnowledgeBaseEvent[]>(() => {
        return mergedKnowledgeCreationEvents.map((eventData) => {
            const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId : "";
            const occurredAt = nodeId && cardCreatedAtByNodeId.has(nodeId)
                ? cardCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt
                : eventData.occurredAt;

            return {
            id: eventData.id,
            occurredAt,
            kind: "knowledge",
            subtype: eventData.eventType,
            isDeleted: eventData.isDeleted === true,
            label: eventData.cardTitle || "Untitled",
            description: `Card label: ${eventData.cardLabel}`,
            treeId: eventData.treeId ?? undefined,
            treeTitle: eventData.treeTitle ?? undefined,
            events: [{
                id: eventData.id,
                occurredAt,
                eventType: eventData.eventType,
                isDeleted: eventData.isDeleted,
                nodeId: eventData.nodeId,
                cardLabel: eventData.cardLabel,
                cardTitle: eventData.cardTitle,
                cardDescription: eventData.cardDescription,
                metadata: eventData.metadata,
            }],
            };
        });
    }, [cardCreatedAtByNodeId, mergedKnowledgeCreationEvents]);
    const normalizedKnowledgeTreePills = useMemo(() => {
        const existingNodeIdSet = new Set(nodes.map((node) => node.id));
        const pillsByTreeId = new Map<string, KnowledgePill>();

        for (const pill of knowledgePills) {
            const normalizedEvents = Array.isArray(pill.events)
                ? pill.events
                    .filter((eventData) => {
                        const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId.trim() : "";
                        return nodeId !== "" && existingNodeIdSet.has(nodeId);
                    })
                    .map((eventData) => {
                        const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId : "";
                        const occurredAt = nodeId && cardCreatedAtByNodeId.has(nodeId)
                            ? cardCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt
                            : eventData.occurredAt;
                        return {
                            ...eventData,
                            occurredAt,
                        };
                    })
                : [];
            if (normalizedEvents.length === 0) continue;

            const parsedPillOccurredAt = new Date(pill.occurredAt).getTime();
            const fallbackOccurredAt = Number.isNaN(parsedPillOccurredAt)
                ? pill.occurredAt
                : new Date(parsedPillOccurredAt).toISOString();
            const earliestEventOccurredAt = normalizedEvents.reduce<string | null>((earliest, eventData) => {
                const parsed = new Date(eventData.occurredAt).getTime();
                if (Number.isNaN(parsed)) return earliest;
                if (!earliest) return new Date(parsed).toISOString();
                const earliestTime = new Date(earliest).getTime();
                return parsed < earliestTime ? new Date(parsed).toISOString() : earliest;
            }, null);

            pillsByTreeId.set(pill.treeId, {
                ...pill,
                occurredAt: earliestEventOccurredAt ?? fallbackOccurredAt,
                events: normalizedEvents,
            });
        }

        for (const eventData of mergedKnowledgeCreationEvents) {
            const treeId = typeof eventData.treeId === "string" ? eventData.treeId.trim() : "";
            const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId.trim() : "";
            if (!treeId || !nodeId) continue;
            if (!existingNodeIdSet.has(nodeId)) continue;

            const occurredAt = cardCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt;
            const normalizedEvent: KnowledgePillEvent = {
                ...eventData,
                occurredAt,
            };

            const existingPill = pillsByTreeId.get(treeId);
            if (!existingPill) {
                const inferredTreeTitle = eventData.treeTitle
                    ?? (eventData.cardLabel === "activity" && nodeId === treeId ? eventData.cardTitle : null)
                    ?? "Activity";
                pillsByTreeId.set(treeId, {
                    treeId,
                    treeTitle: inferredTreeTitle,
                    occurredAt,
                    events: [normalizedEvent],
                });
                continue;
            }

            const alreadyPresent = existingPill.events.some((existingEvent) => existingEvent.nodeId === nodeId);
            if (alreadyPresent) continue;
            existingPill.events.push(normalizedEvent);
            const existingTime = new Date(existingPill.occurredAt).getTime();
            const nextTime = new Date(occurredAt).getTime();
            if (Number.isNaN(existingTime) || (!Number.isNaN(nextTime) && nextTime < existingTime)) {
                existingPill.occurredAt = occurredAt;
            }
        }

        return Array.from(pillsByTreeId.values())
            .map((pill) => ({
                ...pill,
                events: [...pill.events].sort((a, b) => {
                    const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                    if (delta !== 0) return delta;
                    return a.id.localeCompare(b.id);
                }),
            }))
            .sort((a, b) => {
                const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                if (delta !== 0) return delta;
                return a.treeId.localeCompare(b.treeId);
            });
    }, [cardCreatedAtByNodeId, knowledgePills, mergedKnowledgeCreationEvents, nodes]);
    const filteredKnowledgeCrossTreeConnections = useMemo(() => {
        const existingNodeIdSet = new Set(nodes.map((node) => node.id));
        return knowledgeCrossTreeConnections.filter((connection) => (
            existingNodeIdSet.has(connection.sourceNodeId) &&
            existingNodeIdSet.has(connection.targetNodeId)
        ));
    }, [knowledgeCrossTreeConnections, nodes]);
    const filteredKnowledgeBlueprintLinks = useMemo(() => {
        const existingNodeIdSet = new Set(nodes.map((node) => node.id));
        // Unlike the blueprint-to-blueprint arcs and the codebase links, the chart binds these
        // straight to the array without resolving the event first, so a link to an event the track
        // no longer draws would be a curve ending at an empty spot on the blueprint lane. Dropped
        // here, where the "does the card still exist" half of the same question already lives.
        const drawnBlueprintEventIds = new Set(liveBlueprintEvents.map((eventData) => eventData.id));
        return knowledgeBlueprintLinks.filter((connection) => (
            existingNodeIdSet.has(connection.cardNodeId)
            && drawnBlueprintEventIds.has(connection.blueprintEventId)
        ));
    }, [knowledgeBlueprintLinks, liveBlueprintEvents, nodes]);

    const {
        onAttachFile,
        onAttachFileToCanvas,
    } = useFileAttachmentProcessing({
        projectId,
        dispatch,
        nodes,
        edges,
        projectSettings: llmProjectSettings,
        actionTimestamp: playbackAt,
        setLoading,
        onExtractionError: setFileProcessingError,
    });

    useEffect(() => {
        if (!fileProcessingError) return;
        const timer = window.setTimeout(() => setFileProcessingError(null), 10_000);
        return () => window.clearTimeout(timer);
    }, [fileProcessingError]);

    const onAttachFileForNode = useCallback((nodeId: string, file: File) => {
        if (interactionLocked) return;
        // Same rule as `resetFiltersForCanvasCreation`: extraction is about to create cards, and a
        // creation must never be silently invisible. The cards it makes are model-derived by
        // definition, so the provenance filter is the one that would swallow them.
        setModelDerivedVisible(true);
        void onAttachFile(nodeId, file);
    }, [interactionLocked, onAttachFile]);

    const onAttachFileForCanvas = useCallback(async (
        file: File,
        dropPosition: { x: number; y: number },
        anchor?: CanvasDropAnchor | null,
        connection?: CanvasDropConnection | null,
    ): Promise<string | null> => {
        if (interactionLocked) return null;
        return await onAttachFileToCanvas(file, dropPosition, anchor, connection);
    }, [interactionLocked, onAttachFileToCanvas]);

    const flushQueuedPositionChanges = useCallback(() => {
        nodeChangeRafRef.current = null;
        if (interactionLocked) {
            queuedPositionChangesRef.current = [];
            return;
        }
        if (queuedPositionChangesRef.current.length === 0) return;
        const queuedChanges = queuedPositionChangesRef.current;
        queuedPositionChangesRef.current = [];

        setManualNodePositions((previous) => {
            const next = { ...previous };
            for (const change of queuedChanges) {
                if (change.type !== "position" || !change.position) continue;
                next[change.id] = { x: change.position.x, y: change.position.y };
            }
            return next;
        });
    }, [interactionLocked]);

    const rememberDeletedKnowledgeEventFromNode = useCallback((targetNode: nodeType | undefined) => {
        if (!targetNode) return;
        const nodeId = targetNode.id;

        const nodeData = (targetNode.data ?? {}) as Record<string, unknown>;
        const labelValue = normalizeNodeLabel(String(nodeData.label ?? ""));
        if (!CARD_LABELS.includes(labelValue as cardLabel)) return;

        const createdAtRaw = typeof nodeData.createdAt === "string" ? nodeData.createdAt : "";
        const parsedCreatedAt = new Date(createdAtRaw);
        const occurredAt = Number.isNaN(parsedCreatedAt.getTime())
            ? resolveActionTimestamp()
            : parsedCreatedAt.toISOString();
        const titleValue = typeof nodeData.title === "string" && nodeData.title.trim() !== ""
            ? nodeData.title
            : "Untitled";
        const descriptionValue = typeof nodeData.description === "string"
            ? nodeData.description
            : "";
        const treeId = labelValue === "activity" ? nodeId : null;
        const treeTitle = labelValue === "activity" ? titleValue : null;

        setLocalDeletedKnowledgeCreationEvents((existing) => {
            const nextEvent: KnowledgePillEvent = {
                id: `local-created:${nodeId}`,
                occurredAt,
                eventType: "created",
                isDeleted: true,
                nodeId,
                cardLabel: labelValue,
                cardTitle: titleValue,
                cardDescription: descriptionValue,
                treeId,
                treeTitle,
                metadata: {
                    deleted: true,
                    localGhost: true,
                },
            };
            const existingIndex = existing.findIndex((eventData) => eventData.nodeId === targetNode.id);
            if (existingIndex === -1) {
                return [...existing, nextEvent];
            }
            const next = [...existing];
            next[existingIndex] = nextEvent;
            return next;
        });
    }, [resolveActionTimestamp]);
    /**
     * The live graph, read through refs rather than closures.
     *
     * Anything invoked from a memoised node's props needs this. A node component reads its handlers
     * from `handlersRef.current` at *its own* render time, and React Flow only re-renders a node when
     * something about that node changes — so a handler that closed over `nodes` or `edges` can be
     * arbitrarily old by the time it runs. That is not a hypothetical: it is what left a deleted
     * blueprint component's `tackled in` edge alive, because the delete handler the node was holding
     * had been created before the edge existed.
     *
     * Also read by `handleNodesChange`'s dev-only dimension check and by `autoLinkNewCards` after its
     * round trip, both of which must not take the arrays as dependencies — that would give the
     * callbacks a new identity on every graph change and take the memoised canvas down with them.
     */
    const nodesRef = useRef(nodes);
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const edgesRef = useRef(edges);
    useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    const softDeleteNode = useCallback((nodeId: string) => {
        // `nodesRef`/`edgesRef`, never the closure: see the note above them. A stale `edges` here does
        // not fail loudly — it silently leaves the deleted node's connections alive, which is how a
        // document came to say a component was deleted and still show a relation pointing at it.
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!targetNode) return;
        const nodeData = (targetNode.data ?? {}) as Record<string, unknown>;
        if (toTimestampMs(nodeData.deletedAt) !== null) return;

        const deletedAt = resolveActionTimestamp();
        rememberDeletedKnowledgeEventFromNode(targetNode);
        dispatch(updateNode({
            ...targetNode,
            data: {
                ...nodeData,
                deletedAt,
                __editAt: deletedAt,
            } as unknown as nodeType["data"],
        }));

        for (const edge of edgesRef.current) {
            if (edge.source !== nodeId && edge.target !== nodeId) continue;
            const edgeData = (edge.data as Record<string, unknown> | undefined) ?? {};
            if (toTimestampMs(edgeData.deletedAt) !== null) continue;
            dispatch(updateEdge({
                ...edge,
                data: {
                    ...edgeData,
                    deletedAt,
                },
            }));
        }
    }, [dispatch, rememberDeletedKnowledgeEventFromNode, resolveActionTimestamp]);

    useEffect(() => {
        if (status !== "ready") {
            previousNodesRef.current = nodes;
            return;
        }
        const previousNodes = previousNodesRef.current;
        if (previousNodes.length === 0) {
            previousNodesRef.current = nodes;
            return;
        }

        const currentNodeIdSet = new Set(nodes.map((node) => node.id));
        for (const previousNode of previousNodes) {
            if (currentNodeIdSet.has(previousNode.id)) continue;
            rememberDeletedKnowledgeEventFromNode(previousNode);
        }

        previousNodesRef.current = nodes;
    }, [nodes, rememberDeletedKnowledgeEventFromNode, status]);

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        if (interactionLocked) return;

        // Glyphs are drawn by the abstraction lens, not stored. A drag or a delete aimed at one
        // names an id that does not exist in the document, and letting it through would soft-delete
        // nothing or strand a position on a node that vanishes at the next level change.
        const realChanges = changes.filter((change) => (
            !("id" in change) || !isSyntheticCanvasId(change.id)
        ));
        if (realChanges.length === 0) return;

        const immediateChanges = realChanges.filter((change) => change.type !== "position");
        const positionChanges = realChanges.filter((change) => change.type === "position");

        if (immediateChanges.length > 0) {
            const removeChanges = immediateChanges.filter((change) => change.type === "remove");
            for (const change of removeChanges) {
                const removedNodeId = typeof change.id === "string" ? change.id : "";
                if (!removedNodeId) continue;
                softDeleteNode(removedNodeId);
            }
            // Measured pixels belong to React Flow's own lookup, which `updateNodeInternals` has
            // already written by the time this fires. Letting them into the document made a level flip
            // — which changes a glyph's size while it keeps its activity's real id — rewrite
            // `flow.nodes`, re-run the whole derivation chain, and POST the document twice. Every size
            // this app cares about is declared in `canvasGeometry`, not measured.
            const passthroughChanges = immediateChanges.filter((change) => (
                change.type !== "remove" && change.type !== "dimensions"
            ));
            if (import.meta.env.DEV) {
                // If the DOM ever disagrees with the declared size, dropping the measurement would
                // leave the edges aiming at the wrong box. Say so rather than quietly mis-drawing.
                for (const change of immediateChanges) {
                    if (change.type !== "dimensions" || !change.dimensions) continue;
                    const node = nodesRef.current.find((candidate) => candidate.id === change.id);
                    if (!node) continue;
                    const declared = nodeSizeOf(node);
                    if (Math.abs(declared.width - change.dimensions.width) < 1
                        && Math.abs(declared.height - change.dimensions.height) < 1) continue;
                    console.warn(
                        `[canvas] node ${change.id} measured ${change.dimensions.width}x${change.dimensions.height}`
                        + ` but canvasGeometry declares ${declared.width}x${declared.height};`
                        + " floating edges will aim at the declared box.",
                    );
                }
            }
            if (passthroughChanges.length > 0) {
                dispatch(onNodesChange(passthroughChanges));
            }
        }

        if (positionChanges.length > 0) {
            queuedPositionChangesRef.current.push(...positionChanges);
            if (nodeChangeRafRef.current === null) {
                nodeChangeRafRef.current = window.requestAnimationFrame(flushQueuedPositionChanges);
            }
        }
    }, [dispatch, interactionLocked, flushQueuedPositionChanges, softDeleteNode]);

    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => {
        if (interactionLocked) return;
        // Same reasoning as `handleNodesChange`: a collapsed edge stands for several real ones and
        // has an invented id, so deleting it must not reach the store.
        const realChanges = changes.filter((change) => (
            !("id" in change) || !isSyntheticCanvasId(change.id)
        ));
        if (realChanges.length === 0) return;

        const removeChanges = realChanges.filter((change) => change.type === "remove");
        const passthroughChanges = realChanges.filter((change) => change.type !== "remove");

        if (passthroughChanges.length > 0) {
            dispatch(onEdgesChange(passthroughChanges));
        }

        if (removeChanges.length === 0) return;
        const deletedAt = resolveActionTimestamp();
        for (const change of removeChanges) {
            const edgeId = typeof change.id === "string" ? change.id : "";
            if (!edgeId) continue;
            const edge = edges.find((candidate) => candidate.id === edgeId);
            if (!edge) continue;

            const edgeData = (edge.data as Record<string, unknown> | undefined) ?? {};
            const existingDeletedAt = toTimestampMs(edgeData.deletedAt);
            if (existingDeletedAt !== null) continue;

            dispatch(updateEdge({
                ...edge,
                data: {
                    ...edgeData,
                    deletedAt,
                },
            }));
        }
    }, [dispatch, edges, interactionLocked, resolveActionTimestamp]);

    /**
     * React Flow's veto on a delete gesture, and the single place the connection rule is enforced.
     *
     * It has to live here rather than in `handleEdgesChange` because it is the only point that sees
     * the *whole* deletion at once: `deleteElements` hands over the selected edges together with the
     * selected nodes and every edge those nodes drag with them, and it fires the edge changes before
     * the node changes — so a handler watching edges alone cannot tell "the user cut this card
     * loose" from "this card is going away and its edges with it", and would refuse the second.
     *
     * Deleting a *card* is left alone: it is a different gesture with a different expectation, and
     * refusing to delete an activity because its whole tree hangs off it would be unusable.
     */
    const handleBeforeDelete = useCallback(async ({ nodes: deletingNodes, edges: deletingEdges }: {
        nodes: nodeType[];
        edges: edgeType[];
    }) => {
        if (interactionLocked) return { nodes: deletingNodes, edges: deletingEdges };

        const deletingNodeIds = new Set(deletingNodes.map((node) => node.id));
        // A collapsed edge stands for several real ones under an invented id; `handleEdgesChange`
        // drops those anyway, so they pass through here unjudged rather than being matched against
        // a store edge that does not exist.
        const guardable = deletingEdges
            .map((edge) => edge.id)
            .filter((edgeId) => !isSyntheticCanvasId(edgeId));

        const { blocked } = planEdgeRemovals(nodes, edges, guardable, { deletingNodeIds });
        if (blocked.length === 0) return { nodes: deletingNodes, edges: deletingEdges };

        showCanvasNotice(describeBlockedRemovals(blocked));
        const blockedEdgeIds = new Set(blocked.map((entry) => entry.edgeId));
        return {
            nodes: deletingNodes,
            edges: deletingEdges.filter((edge) => !blockedEdgeIds.has(edge.id)),
        };
    }, [edges, interactionLocked, nodes, showCanvasNotice]);

    // `ensureVisibleLabel` re-enables the sidebar label chip for a card we are about to create.
    // Without it, creating a card whose label is filtered out silently produces nothing visible —
    // which matters most for the drop/ring paths, where the label is always `object`.
    const resetFiltersForCanvasCreation = useCallback((ensureVisibleLabel?: cardLabel) => {
        setActiveQuery("");
        setQueryMatchedNodeIds(null);
        if (ensureVisibleLabel) {
            setSelectedLabels((previous) => (
                previous.includes(ensureVisibleLabel) ? previous : [...previous, ensureVisibleLabel]
            ));
        }
    }, []);

    const handleConnectSelection = useCallback((option: EdgeConnectOption) => {
        if (interactionLocked) return;
        setPendingConnectionMenu((pending) => {
            if (!pending) return null;

            const label = option === "default"
                ? pending.defaultLabel
                : option === "referenced_by"
                    ? REFERENCED_BY_EDGE_LABEL
                    : ITERATION_OF_EDGE_LABEL;
            const kind = option === "default" ? undefined : option;

            const alreadyConnected = edges.some((edge) => (
                edge.source === pending.sourceId &&
                edge.target === pending.targetId &&
                toTimestampMs((edge.data as Record<string, unknown> | undefined)?.deletedAt) === null &&
                edgeLabelFrom(edge) === label
            ));
            if (!alreadyConnected) {
                const createdAt = resolveActionTimestamp();
                dispatch(connectEdges([{
                    id: crypto.randomUUID(),
                    source: pending.sourceId,
                    target: pending.targetId,
                    type: "relation",
                    label,
                    data: {
                        label,
                        from: pending.sourceLabel,
                        to: pending.targetLabel,
                        createdAt,
                        // The researcher dragged this edge themselves. Automatic similarity edges
                        // carry `autoLinked`, but LLM-extracted tree edges carry no marker at all,
                        // so the absence of `autoLinked` says nothing -- without this flag "a human
                        // asserted this link" is unrecoverable from the stored graph.
                        manual: true,
                        ...(kind ? { kind } : {}),
                    },
                }]));
            }


            return null;
        });
    }, [dispatch, interactionLocked, edges, resolveActionTimestamp]);

    const handleConnect = useCallback((connection: Connection) => {
        if (interactionLocked) return;
        if (!connection.source || !connection.target) return;

        // A card's own two handles are both live targets for a drag started on either of them, and
        // every self pair in the relation table would accept the result. A loop connects a card to
        // nothing: it satisfies no reading of the graph, the orbit layout cannot walk it, and it
        // would count as the connection that keeps the card off the unassigned band.
        if (connection.source === connection.target) {
            showCanvasNotice("A card cannot be connected to itself.");
            return;
        }

        const sourceNode = nodes.find((node) => node.id === connection.source);
        const targetNode = nodes.find((node) => node.id === connection.target);
        const sourceLabel = normalizeNodeLabel(String(sourceNode?.data?.label ?? ""));
        const targetLabel = normalizeNodeLabel(String(targetNode?.data?.label ?? ""));

        const defaultLabel = isAllowedConnection(sourceLabel, targetLabel)
            ? relationLabelFor(sourceLabel, targetLabel)
            : undefined;
        if (!defaultLabel) {
            // The drag completes visually, so a bare `return` reads as the app dropping the
            // gesture. Every other refusal in the connection rule says why; this one used to be
            // the exception.
            showCanvasNotice(
                `There is no relation between ${withArticle(sourceLabel)} card and`
                + ` ${withArticle(targetLabel)} card, so they cannot be connected.`,
            );
            return;
        }

        const { x: pointerX, y: pointerY } = pointerPositionRef.current;
        const menuWidth = 380;
        const menuHeight = 44;
        const x = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, pointerX - (menuWidth / 2)));
        const y = Math.max(12, Math.min(window.innerHeight - menuHeight - 12, pointerY - menuHeight - 8));

        setPendingConnectionMenu({
            sourceId: connection.source,
            targetId: connection.target,
            sourceLabel,
            targetLabel,
            defaultLabel,
            x,
            y,
        });
    }, [nodes, interactionLocked, showCanvasNotice]);

    const onDataPropertyChange = useCallback((nodeProps: nodeType, value: unknown, propertyName: string) => {
        if (interactionLocked) return;
        const data = { ...nodeProps.data } as Record<string, unknown> & nodeType["data"];
        if (propertyName === "label" && typeof value === "string") {
            data.type = cardTypeForLabel(value);
        }

        data[propertyName] = value;
        data.__editAt = resolveActionTimestamp();

        dispatch(updateNode({
            ...nodeProps,
            data: data as nodeType["data"],
        }));
    }, [dispatch, interactionLocked, resolveActionTimestamp]);

    const handleBlueprintComponentTitleChange = useCallback((nodeId: string, titleValue: string) => {
        if (interactionLocked) return;
        const targetNode = nodes.find((node) => node.id === nodeId);
        if (!targetNode) return;

        const data = { ...(targetNode.data as Record<string, unknown>) };
        const nextTitle = titleValue.trim() || "Blueprint component";
        data.title = nextTitle;
        data.__editAt = resolveActionTimestamp();

        if (data.blueprintComponent && typeof data.blueprintComponent === "object") {
            data.blueprintComponent = {
                ...(data.blueprintComponent as Record<string, unknown>),
                name: nextTitle,
            };
        }

        dispatch(updateNode({
            ...targetNode,
            data: data as nodeType["data"],
        }));
    }, [dispatch, interactionLocked, nodes, resolveActionTimestamp]);

    const handleBlueprintComponentAttachCodebasePath = useCallback((nodeId: string, filePath: string) => {
        if (interactionLocked) return;
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) return;

        const targetNode = nodes.find((node) => node.id === nodeId);
        if (!targetNode) return;

        const data = { ...(targetNode.data as Record<string, unknown>) };
        const currentPaths = Array.isArray(data.codebaseFilePaths)
            ? data.codebaseFilePaths.filter((path): path is string => typeof path === "string")
            : [];
        if (currentPaths.includes(normalizedPath)) return;

        data.codebaseFilePaths = [...currentPaths, normalizedPath];
        data.__editAt = resolveActionTimestamp();

        dispatch(updateNode({
            ...targetNode,
            data: data as nodeType["data"],
        }));
    }, [dispatch, interactionLocked, nodes, resolveActionTimestamp]);

    const handleBlueprintComponentDetachCodebasePath = useCallback((nodeId: string, filePath: string) => {
        if (interactionLocked) return;
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) return;

        const targetNode = nodes.find((node) => node.id === nodeId);
        if (!targetNode) return;

        const data = { ...(targetNode.data as Record<string, unknown>) };
        const currentPaths = Array.isArray(data.codebaseFilePaths)
            ? data.codebaseFilePaths.filter((path): path is string => typeof path === "string")
            : [];
        const nextPaths = currentPaths.filter((path) => normalizePath(path) !== normalizedPath);
        if (nextPaths.length === currentPaths.length) return;

        data.codebaseFilePaths = nextPaths;
        data.__editAt = resolveActionTimestamp();

        dispatch(updateNode({
            ...targetNode,
            data: data as nodeType["data"],
        }));
    }, [dispatch, interactionLocked, nodes, resolveActionTimestamp]);

    const onDeleteNode = useCallback((nodeId: string) => {
        if (interactionLocked) return;
        softDeleteNode(nodeId);
    }, [interactionLocked, softDeleteNode]);

    /**
     * The same soft delete, for a batch — the tray's delete-key handling and its Clear button.
     *
     * A batch rather than a loop at the call site so the tray never has to know that deleting is
     * `deletedAt` on the node plus `deletedAt` on every edge that touched it. That knowledge lives
     * in `softDeleteNode` and nowhere else, which is what makes a component's deletion mean the same
     * thing whichever of the two surfaces it was clicked on.
     */
    const onDeleteNodes = useCallback((nodeIds: readonly string[]) => {
        if (interactionLocked) return;
        for (const nodeId of nodeIds) softDeleteNode(nodeId);
    }, [interactionLocked, softDeleteNode]);

    const onDetachFile = useCallback((nodeId: string, fileId: string) => {
        if (interactionLocked) return;
        dispatch(detachFileIdFromNode({
            nodeId,
            fileId,
            editAt: resolveActionTimestamp(),
        }));
    }, [dispatch, interactionLocked, resolveActionTimestamp]);

    const participantNames = useMemo(() => {
        const seen = new Set<string>();
        const names: string[] = [];
        for (const participant of participants) {
            const name = String(participant?.name ?? "").trim();
            const role = String(participant?.role ?? "").trim();
            if (!name) continue;
            const formatted = role ? `${name} (${role})` : name;
            if (seen.has(formatted)) continue;
            seen.add(formatted);
            names.push(formatted);
        }
        return names;
    }, [participants]);

    // --- Abstraction level and focus.
    //
    // Changing the level always drops the focus: a focus path names a phase or an activity in the
    // keyspace of the level it was opened at, and carrying it across would point at nothing.
    const canvasLevelRef = useRef(canvasLevel);
    const levelFollowsZoomRef = useRef(levelFollowsZoom);
    useEffect(() => {
        canvasLevelRef.current = canvasLevel;
    }, [canvasLevel]);
    useEffect(() => {
        levelFollowsZoomRef.current = levelFollowsZoom;
    }, [levelFollowsZoom]);

    const handleCanvasLevelChange = useCallback((next: CanvasLevel) => {
        canvasLevelRef.current = next;
        setCanvasLevel(next);
        setCanvasFocus(NO_CANVAS_FOCUS);
    }, []);

    /**
     * Fires on every animation frame of every pan and zoom, so it does as little as possible: two
     * ref reads and an early return unless the zoom actually crossed a level threshold. Deliberately
     * not a `useViewport()` subscription — that would re-render this component ~60 times a second.
     */
    const handleViewportMove = useCallback((_event: unknown, viewport: { zoom: number }) => {
        if (!levelFollowsZoomRef.current) return;
        const next = levelForZoom(viewport.zoom, canvasLevelRef.current);
        if (next === canvasLevelRef.current) return;
        canvasLevelRef.current = next;
        setCanvasLevel(next);
        setCanvasFocus(NO_CANVAS_FOCUS);
    }, []);

    const handleLevelFollowsZoomChange = useCallback((value: boolean) => {
        setLevelFollowsZoom(value);
        if (!value) return;
        // Snap to whatever the current viewport already implies rather than waiting for a gesture.
        const next = levelForZoom(getZoom(), canvasLevelRef.current);
        canvasLevelRef.current = next;
        setCanvasLevel(next);
        setCanvasFocus(NO_CANVAS_FOCUS);
    }, [getZoom]);


    /**
     * Go to a reference.
     *
     * The reader's half of the shared reference system: somebody has `C3` from a paper, a colleague or
     * the exported report, and wants to see the thing it names. The code carries its own level of
     * abstraction and the optional suffix carries the reader's, so this does not merely centre a node
     * — it puts the canvas at the altitude that was asked for, opens the branch the target sits in,
     * and leaves the rest of the study abstract. That is Focus+Context arrived at by citation rather
     * than by clicking. `resolveLocatorReference` owns the whole of that decision; everything below is
     * the reveal.
     *
     * The index is built on demand rather than memoised. It is O(n log n) over the whole graph and
     * would otherwise be recomputed on every card edit for a lookup that happens when somebody types
     * — and it has to be built over the **unfiltered live graph** anyway (`locatorGraphScope`), which
     * is not what any of the canvas memos hold.
     *
     * The reveal order matters, and every step is here because skipping it is a way to fail silently:
     * a needle gates whole activity trees, a label chip hides the target outright, a provenance chip
     * does the same, blueprint components are not drawn at all unless their chip is on, and
     * `levelFollowsZoom` would re-derive the level from the zoom the fit produces and throw the focus
     * away on arrival. Only after all of that is the camera asked to move.
     *
     * **Every filter comes back on, not just the target's own.** `LOCATOR_PHASE_CONTRACT` says phase
     * codes are only meaningful over the unfiltered live graph at the latest playhead, and the canvas
     * builds its clusters over the *filtered* nodes — so with a chip off, the `vz:c:` id the index
     * resolved and the one the canvas drew are two different phases and `R7P` lands nowhere. Restoring
     * the whole set is what makes the two agree. A reference is an address into the project, not into
     * the current screen; clearing what could hide it is the point rather than a side effect.
     */
    const handleGoToLocatorCode = useCallback((
        raw: string,
        /**
         * The node the link was written against, from `?n=`. A claim to check, never a destination
         * in itself — `resolveLocatorReference` decides what to do when it and the code disagree.
         * Omitted by the reference box, where a typed code is the only claim there is.
         */
        expectedTargetId?: string | null,
    ): boolean => {
        const typed = raw.trim();
        if (typed === "") return false;

        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        const stages = timelineStages.map((stage) => ({
            name: String(stage.name ?? ""),
            start: toIsoDateString(stage.start),
            end: toIsoDateString(stage.end),
        }));
        const scope = locatorGraphScope(nodes, edges, stages);
        const index = buildLocatorIndex({
            nodes,
            edges,
            files: allFiles.map((file) => {
                const record = file as unknown as Record<string, unknown>;
                return {
                    sha256: typeof record.sha256 === "string" ? record.sha256 : file.id,
                    name: file.name,
                    createdAt: toIsoDateString(record.createdAt),
                };
            }),
            timeline: {
                stages: timelineStages.map((stage) => ({
                    id: stage.id,
                    name: String(stage.name ?? ""),
                    start: toIsoDateString(stage.start),
                    end: toIsoDateString(stage.end),
                })),
                designStudyEvents: designStudyEvents.map((eventData) => ({
                    id: eventData.id,
                    name: eventData.name,
                    occurredAt: toIsoDateString(eventData.occurredAt),
                })),
            },
            membership: scope.membership,
            clusters: scope.clusters,
            asOf: { version: null, capturedAt: new Date().toISOString() },
        });

        // Parsing, the lens, the status guard and the viewpoint are all one decision, and it is the
        // report's decision too — so it is made in `locators.ts`, where the document can reach it.
        const resolution = resolveLocatorReference(index, typed, expectedTargetId);
        if (!resolution.ok) {
            showCanvasNotice(resolution.reason);
            return false;
        }
        const { target, viewpoint, openAttachmentOf } = resolution;

        // A file lens that names a card holding nothing is refused *before* the canvas moves. Moving
        // and then saying "there is no file" would leave the reader somewhere they did not ask to be,
        // with no way to tell whether the reference or the card was wrong.
        let attachmentFileId: string | null = null;
        if (openAttachmentOf !== null) {
            const owner = nodes.find((node) => node.id === openAttachmentOf);
            const ownerData = (owner?.data ?? {}) as Record<string, unknown>;
            const ids = Array.isArray(ownerData.attachmentIds)
                ? ownerData.attachmentIds.filter((id): id is string => typeof id === "string")
                : [];
            // The same choice `Card` makes: the first id that still resolves to a stored file. A card
            // holds one attachment now, but projects saved before that rule can carry several.
            attachmentFileId = ids.find((id) => allFiles.some((file) => file.id === id)) ?? null;
            if (attachmentFileId === null) {
                const ownerCode = index.byTargetId.get(openAttachmentOf)?.code ?? target.code;
                showCanvasNotice(`${resolution.reference} — ${ownerCode} has no file attached to it.`);
                return false;
            }
        }

        // 1. The needle gates whole activity trees, so a scrubbed playhead can hide the target's tree
        //    with no explanation.
        setPlaybackAt(null);

        // 2. Clear the search filter, and restore every label chip — see the note above about phase
        //    ids being derived from whatever set the canvas was left filtered to.
        resetFiltersForCanvasCreation();
        setSelectedLabels([...CARD_LABELS]);

        // 3. The provenance chips and the blueprint chip hide cards independently of the label chips.
        //    Both provenance chips go on for the same reason all the label chips do: the index was
        //    numbered over the unfiltered graph, so the canvas has to be showing it.
        setModelDerivedVisible(true);
        setAuthoredVisible(true);
        const label = normalizeNodeLabel(target.describedAs);
        if (label === "blueprint_component" || label === "blueprint_group" || label === "blueprint") {
            setBlueprintComponentsVisible(true);
        }

        // 4. Non-negotiable: with follow-zoom on, the fit below re-derives the level from the zoom it
        //    produces and resets the focus to nothing, which would undo everything this just set.
        setLevelFollowsZoom(false);

        // 5. Level and focus in one commit. Deliberately not `handleCanvasLevelChange`, which clears
        //    the focus — correctly, because that handler is the user clicking a level segment, where
        //    starting from nowhere is the right behaviour.
        canvasLevelRef.current = viewpoint.level;
        setCanvasLevel(viewpoint.level);
        setCanvasFocus(viewpoint.focus);

        // 6. The camera, once the layout has actually placed the target.
        if (viewpoint.nodeId) requestNodeFocus(viewpoint.nodeId, "fit");

        // 7. And the file, if one was asked for. The request waits in its own store until the card
        //    mounts — which is well after this returns, since the level change, the filter reset and
        //    the relayout all have to land first.
        if (openAttachmentOf !== null && attachmentFileId !== null) {
            requestCardFilePreview(openAttachmentOf, attachmentFileId);
        } else {
            // A reference that is not asking for a file supersedes one that was: two panels opening
            // from two references in a row is nobody's intent.
            clearCardFilePreviewRequest();
        }

        // 8. Last, because a later and more serious failure should replace it rather than queue
        //    behind it: if the camera then times out, "that card could not be shown" is the sentence
        //    that matters. The reader is looking at the right artifact under a number their document
        //    does not use, and nothing on screen can tell them that on its own.
        if (resolution.renumberedFrom !== null) {
            showCanvasNotice(
                `${resolution.renumberedFrom} was renumbered ${target.code} since that link was`
                + ` written. Showing what it named then: ${target.title}.`,
            );
        }
        return true;
    }, [
        allFiles,
        designStudyEvents,
        requestNodeFocus,
        resetFiltersForCanvasCreation,
        showCanvasNotice,
        timelineStages,
    ]);

    const handleClearCanvasFocus = useCallback(() => {
        setCanvasFocus(NO_CANVAS_FOCUS);
    }, []);

    /** Opening a glyph goes exactly one level deeper: a phase into its activities, an activity into its cards. */
    const handleOpenCluster = useCallback((glyph: CanvasGlyphData) => {
        setCanvasFocus((current) => {
            if (glyph.kind === "phase") {
                if (current.clusterId === glyph.focusClusterId && current.activityId === null) {
                    return NO_CANVAS_FOCUS;
                }
                return { clusterId: glyph.focusClusterId, activityId: null };
            }
            if (glyph.kind === "activity") {
                if (current.activityId === glyph.focusActivityId) {
                    // Closing an activity falls back to its phase rather than all the way out.
                    return { clusterId: current.clusterId, activityId: null };
                }
                return { clusterId: glyph.focusClusterId ?? current.clusterId, activityId: glyph.focusActivityId };
            }
            return current;
        });
    }, []);

    const clusterGlyphHandlersRef = useRef<{ onOpenCluster: typeof handleOpenCluster }>({
        onOpenCluster: handleOpenCluster,
    });
    useEffect(() => {
        clusterGlyphHandlersRef.current = { onOpenCluster: handleOpenCluster };
    }, [handleOpenCluster]);

    const cardNodeHandlersRef = useRef<{
        onAttachFile: typeof onAttachFileForNode;
        onDetachFile: typeof onDetachFile;
        onDataPropertyChange: typeof onDataPropertyChange;
        onDeleteNode: typeof onDeleteNode;
        readOnly: boolean;
        participantOptions: string[];
    }>({
        onAttachFile: onAttachFileForNode,
        onDetachFile,
        onDataPropertyChange,
        onDeleteNode,
        // Carried on the same ref as the handlers so `nodeTypes` keeps its identity: a new
        // `nodeTypes` object remounts every node on the canvas.
        readOnly: interactionLocked,
        participantOptions: participantNames,
    });
    useEffect(() => {
        cardNodeHandlersRef.current = {
            onAttachFile: onAttachFileForNode,
            onDetachFile,
            onDataPropertyChange,
            onDeleteNode,
            readOnly: interactionLocked,
            participantOptions: participantNames,
        };
    }, [onAttachFileForNode, onDataPropertyChange, onDeleteNode, onDetachFile, interactionLocked, participantNames]);

    const blueprintComponentHandlersRef = useRef<{
        onRenameTitle: typeof handleBlueprintComponentTitleChange;
        onAttachCodebaseFilePath: typeof handleBlueprintComponentAttachCodebasePath;
        onDetachCodebaseFilePath: typeof handleBlueprintComponentDetachCodebasePath;
        onDelete: typeof onDeleteNode;
        readOnly: boolean;
    }>({
        onRenameTitle: handleBlueprintComponentTitleChange,
        onAttachCodebaseFilePath: handleBlueprintComponentAttachCodebasePath,
        onDetachCodebaseFilePath: handleBlueprintComponentDetachCodebasePath,
        onDelete: onDeleteNode,
        // On the same ref as the handlers so `nodeTypes` keeps its identity — a new `nodeTypes`
        // object remounts every node on the canvas.
        readOnly: interactionLocked,
    });
    useEffect(() => {
        blueprintComponentHandlersRef.current = {
            onRenameTitle: handleBlueprintComponentTitleChange,
            onAttachCodebaseFilePath: handleBlueprintComponentAttachCodebasePath,
            onDetachCodebaseFilePath: handleBlueprintComponentDetachCodebasePath,
            onDelete: onDeleteNode,
            readOnly: interactionLocked,
        };
    }, [
        handleBlueprintComponentAttachCodebasePath,
        handleBlueprintComponentDetachCodebasePath,
        handleBlueprintComponentTitleChange,
        interactionLocked,
        onDeleteNode,
    ]);

    const nodeTypes = useMemo<NodeTypes>(() => ({
        card: (nodeProps: NodeProps) => {
            const handlers = cardNodeHandlersRef.current;
            const cardProps = {
                ...(nodeProps as unknown as CardProps),
                onAttachFile: handlers.onAttachFile,
                onDetachFile: handlers.onDetachFile,
                onDataPropertyChange: handlers.onDataPropertyChange,
                onDeleteNode: handlers.onDeleteNode,
                readOnly: handlers.readOnly,
                participantOptions: handlers.participantOptions,
            };

            return <Card {...cardProps} />;
        },
        clusterGlyph: (nodeProps: NodeProps) => {
            const handlers = clusterGlyphHandlersRef.current;
            return (
                <ClusterGlyph
                    {...(nodeProps as unknown as ClusterGlyphProps)}
                    onOpenCluster={handlers.onOpenCluster}
                />
            );
        },
        blueprint: BlueprintNode as unknown as NodeTypes[string],
        blueprintGroup: BlueprintGroupNode as unknown as NodeTypes[string],
        blueprintComponent: (nodeProps: NodeProps) => {
            const handlers = blueprintComponentHandlersRef.current;
            return (
                <BlueprintComponentNode
                    {...(nodeProps as NodeProps<nodeType>)}
                    onRenameTitle={handlers.onRenameTitle}
                    onAttachCodebaseFilePath={handlers.onAttachCodebaseFilePath}
                    onDetachCodebaseFilePath={handlers.onDetachCodebaseFilePath}
                    onDelete={handlers.readOnly ? undefined : handlers.onDelete}
                />
            );
        },
    }), []);

    const edgeTypes = useMemo(() => ({
        relation: RelationEdge,
    }), []);

    const selectedLabelSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);
    const queryMatchedNodeSet = useMemo(
        () => (queryMatchedNodeIds ? new Set(queryMatchedNodeIds) : null),
        [queryMatchedNodeIds],
    );
    const labelFilteredNodes = useMemo(() => {
        return keepAll(timelineContextNodes, timelineContextNodes.filter((node) => {
            // Provenance is asked first because it is orthogonal to the label: `autoGenerated` marks
            // a card a model wrote, whatever kind of card it turned out to be. Only the LLM paths
            // set it — a card the user dragged in from a file carries `origin` but not this.
            const isModelDerived = isModelDerivedNodeData(node.data);
            if (!modelDerivedVisible && isModelDerived) return false;
            // The mirror image. Turning this off leaves only what the model proposed, which is what
            // the canvas looked like before anyone touched it.
            if (!authoredVisible && !isModelDerived) return false;
            const rawLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
            // Only attached components reach this far, so the chip now answers a narrower question
            // than it used to: whether to draw the answers alongside the requirements, or read the
            // study on its own.
            if (BLUEPRINT_NODE_LABELS.has(rawLabel)) return blueprintComponentsVisible;
            if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
            return selectedLabelSet.has(rawLabel as cardLabel);
        }));
    }, [authoredVisible, blueprintComponentsVisible, modelDerivedVisible, selectedLabelSet, timelineContextNodes]);

    /**
     * Which components answer a requirement, as the **timeline** sees it — playback-scoped, exactly
     * as this was before the tray, because it decides which blueprint events the track draws as
     * connected. It is deliberately not the canvas surface set: a sidebar chip must not restyle the
     * blueprint track.
     */
    const emphasizedBlueprintComponentIds = useMemo(
        () => attachedComponentIds(timelineContextNodes, timelineContextEdges),
        [timelineContextEdges, timelineContextNodes],
    );

    /**
     * The same question asked of the whole document, for the tray.
     *
     * The tray is a workbench, not a view of the study: it shows the system design whatever the
     * needle is doing, so the mark saying "this one already answers something" has to be
     * document-scoped too. Scrubbing the timeline must not make badges blink on and off in a panel
     * that is not showing history.
     */
    const trayAttachedComponentIds = useMemo(
        () => attachedComponentIds(liveNodes, liveEdges),
        [liveEdges, liveNodes],
    );
    const connectedBlueprintComponentNodeIds = useMemo(
        () => Array.from(emphasizedBlueprintComponentIds),
        [emphasizedBlueprintComponentIds]
    );
    const blueprintEventConnections = useMemo<BlueprintEventConnection[]>(() => {
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const blueprintEventByComponentNodeId = new Map<string, typeof blueprintEvents[number]>();

        // The drawn events, not every stored one: a wire whose end is a deleted component has
        // nothing to join. The chart drops unresolvable arcs anyway, so this is about not asking it
        // to — the two ends of a connection and the triangles they land on come from one list.
        for (const eventData of liveBlueprintEvents) {
            const componentNodeId = typeof eventData.componentNodeId === "string"
                ? eventData.componentNodeId.trim()
                : "";
            if (!componentNodeId) continue;
            blueprintEventByComponentNodeId.set(componentNodeId, eventData);
        }

        const connections: BlueprintEventConnection[] = [];
        for (const edge of edges) {
            // Soft-deleted wiring is wiring the researcher removed. Nothing else in this memo looked
            // at `deletedAt`, which was survivable only while an unattached component had no marker
            // for an arc to land on.
            if (!isEdgeActive(edge)) continue;

            const sourceNode = nodeById.get(edge.source);
            const targetNode = nodeById.get(edge.target);
            if (!sourceNode || !targetNode) continue;

            const sourceLabel = normalizeNodeLabel(String(sourceNode.data?.label ?? ""));
            const targetLabel = normalizeNodeLabel(String(targetNode.data?.label ?? ""));
            if (sourceLabel !== "blueprint_component" || targetLabel !== "blueprint_component") continue;

            /**
             * Both ends have to answer a requirement.
             *
             * `feeds into` is a claim about the system, not about the study: `canvasBlueprintEdges`
             * refuses to draw it and `buildActivityTreeMembership` refuses to walk it, both on the
             * grounds that it belongs to the tray. Until markers were derived, "both ends have an
             * event" happened to mean "both ends are attached", and that coincidence was the only
             * thing keeping a dropped paper's internal wiring off the timeline. Now every live
             * component has a marker, so the real condition has to be asked directly.
             */
            if (!emphasizedBlueprintComponentIds.has(sourceNode.id)) continue;
            if (!emphasizedBlueprintComponentIds.has(targetNode.id)) continue;

            const sourceEvent = blueprintEventByComponentNodeId.get(sourceNode.id);
            const targetEvent = blueprintEventByComponentNodeId.get(targetNode.id);
            if (!sourceEvent || !targetEvent) continue;

            const kind = connectionKindFromEdge(edge);
            const label = edgeLabelFrom(edge) || (
                kind === "referenced_by"
                    ? REFERENCED_BY_EDGE_LABEL
                    : kind === "iteration_of"
                        ? ITERATION_OF_EDGE_LABEL
                        : FEEDS_INTO_EDGE_LABEL
            );

            connections.push({
                id: edge.id,
                kind,
                label,
                sourceBlueprintEventId: sourceEvent.id,
                sourceBlueprintEventName: sourceEvent.name || "Blueprint component",
                sourceComponentNodeId: sourceNode.id,
                targetBlueprintEventId: targetEvent.id,
                targetBlueprintEventName: targetEvent.name || "Blueprint component",
                targetComponentNodeId: targetNode.id,
            });
        }

        return connections;
    }, [edges, emphasizedBlueprintComponentIds, liveBlueprintEvents, nodes]);
    // Highlight used to be injected here as `node.style`, which cloned node objects and so invalidated
    // salience, clustering, abstraction and the layout on every hover. It now reaches the nodes
    // through `canvasHighlightStore`, leaving this memo to do only what its name says.
    const queryFilteredNodes = useMemo(() => (
        queryMatchedNodeSet
            ? keepAll(labelFilteredNodes, labelFilteredNodes.filter((node) => queryMatchedNodeSet.has(node.id)))
            : labelFilteredNodes
    ), [labelFilteredNodes, queryMatchedNodeSet]);

    /**
     * The surface split: what of the blueprint this canvas is entitled to draw.
     *
     * A component appears exactly when it answers a requirement that is **itself still on screen**;
     * group boxes never do, and neither does the `feeds into` wiring between components. Everything
     * else about the blueprint lives in the tray, which reads the store directly.
     *
     * It has to run *last*, after the needle, the label chips and the chat query have each had their
     * say. Attachment is a claim about a pair, and `filteredEdges` below drops any edge with a
     * filtered-out endpoint — so judging attachment earlier would leave a component on the canvas
     * with its requirement filtered away, orbiting nothing, in the unassigned band this whole change
     * exists to get it out of. Switching the `requirement` chip off is enough to reach that.
     *
     * A component answering several requirements survives while *any* of them does, which is the
     * other reason this is a filter here rather than activity-tree membership: membership can only
     * name one tree.
     */
    const filteredNodes = useMemo(
        () => canvasBlueprintNodes(queryFilteredNodes, timelineContextEdges),
        [queryFilteredNodes, timelineContextEdges],
    );

    // Structural, not hover-driven, so it belongs to the graph — but it reaches the blueprint nodes as
    // a class rather than an injected `opacity`, for the same reason as above.
    useEffect(() => {
        setEmphasizedBlueprintComponentIds(trayAttachedComponentIds);
    }, [trayAttachedComponentIds]);


    const filteredEdges = useMemo(() => {
        const surfaceEdges = canvasBlueprintEdges(filteredNodes, timelineContextEdges);
        const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
        return keepAll(surfaceEdges, surfaceEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        )));
    }, [filteredNodes, timelineContextEdges]);


    // --- Focus + context lens. Sits after every filter, so a glyph always describes what is
    // actually on screen, and before the layout, so synthetic glyphs get placed by it.
    const cardSalience = useMemo(
        () => buildSalienceIndex(filteredNodes, filteredEdges, activityTreeMembership).score,
        [filteredNodes, filteredEdges, activityTreeMembership],
    );

    const canvasClusters = useMemo(() => {
        // Only Overview groups activities into phases; below that the work would be thrown away.
        if (canvasLevel !== 1) return [];
        return buildActivityClusters({
            activities: filteredNodes.filter((node) => (
                normalizeNodeLabel(String(node.data?.label ?? "")) === "activity"
            )),
            edges: filteredEdges,
            membership: activityTreeMembership,
            score: cardSalience,
            stages: timelineStages.map((stage) => ({
                name: String(stage.name ?? ""),
                start: fromDate(stage.start),
                end: fromDate(stage.end),
            })),
        });
    }, [canvasLevel, filteredNodes, filteredEdges, activityTreeMembership, cardSalience, timelineStages]);

    // Edges are resolved before the layout runs, because the layout uses them to work out which
    // activity each card orbits.
    const { nodes: abstractedNodes, edges: displayedEdges } = useMemo(() => buildAbstractedGraph({
        nodes: filteredNodes,
        edges: filteredEdges,
        level: canvasLevel,
        focus: canvasFocus,
        membership: activityTreeMembership,
        clusters: canvasClusters,
        score: cardSalience,
    }), [filteredNodes, filteredEdges, canvasLevel, canvasFocus, activityTreeMembership, canvasClusters, cardSalience]);

    /** What the breadcrumb on the level control says, or null when nothing is opened out. */
    const canvasFocusLabel = useMemo(() => {
        if (canvasFocus.activityId !== null) {
            const activity = filteredNodes.find((node) => node.id === canvasFocus.activityId);
            const title = String((activity?.data as Record<string, unknown> | undefined)?.title ?? "").trim();
            return title !== "" ? title : "Opened activity";
        }
        if (canvasFocus.clusterId !== null) {
            const cluster = canvasClusters.find((entry) => entry.id === canvasFocus.clusterId);
            return cluster?.label ?? "Opened phase";
        }
        return null;
    }, [canvasFocus, canvasClusters, filteredNodes]);

    const { displayedNodes, hasManualNodePositions } = useMemo<{
        displayedNodes: nodeType[];
        hasManualNodePositions: boolean;
    }>(() => {
        const laidOut = buildActivityOrbitLayout(abstractedNodes, displayedEdges);
        let moved = false;

        const positioned = laidOut.map((node) => {
            // A synthetic glyph is not a node anyone can have dragged, and its id is reused across
            // levels — honouring a stored position for one would strand it at a stale coordinate.
            const manual = isSyntheticCanvasId(node.id) ? undefined : manualNodePositions[node.id];
            if (!manual) return node;
            // A drag that ends where it started is not an arrangement, so it must not raise the
            // reset button.
            if (manual.x === node.position.x && manual.y === node.position.y) return node;
            moved = true;
            return { ...node, position: manual };
        });

        return { displayedNodes: positioned, hasManualNodePositions: moved };
    }, [abstractedNodes, displayedEdges, manualNodePositions]);

    // The layout — not the cursor — decides where a card lands, so the target may not be on screen or
    // even drawn yet when the request is made. Wait for it to appear, then move; and give up out loud
    // rather than retrying for the rest of the session if it never does.
    useEffect(() => {
        if (!pendingCanvasFocus) return;

        const target = displayedNodes.find((node) => node.id === pendingCanvasFocus.nodeId);
        if (!target) {
            // The deadline needs a timer of its own. This effect only re-runs when one of its
            // dependencies changes, and a target that never arrives is very often a target whose
            // arrival would have been the only thing left to change — so without this the request
            // would sit here, `nodeFocusPendingRef` would stay raised, and the next whole-graph refit
            // would be skipped for a focus that had already given up.
            if (Date.now() < pendingCanvasFocus.deadlineAt) {
                const wake = window.setTimeout(
                    () => setPendingCanvasFocus((current) => (current ? { ...current } : current)),
                    Math.max(16, pendingCanvasFocus.deadlineAt - Date.now()),
                );
                return () => window.clearTimeout(wake);
            }
            nodeFocusPendingRef.current = false;
            setPendingCanvasFocus(null);
            clearCardFilePreviewRequest();
            showCanvasNotice(
                "That card could not be shown. It may be hidden by a filter, by the timeline needle,"
                + " folded into a summary, or no longer part of the study.",
            );
            // The refit this focus stood down (see `nodeFocusPendingRef`) never happened, and the
            // level or filter change that asked for it still needs framing.
            window.setTimeout(() => {
                if (nodeFocusPendingRef.current) return;
                fitView({ padding: 0.2, duration: 350 });
            }, 0);
            return;
        }

        const size = nodeSizeOf(target);
        const mode = pendingCanvasFocus.mode;
        let release: number | null = null;
        const timer = window.setTimeout(() => {
            /**
             * One node, centred, at a zoom worked out here — deliberately not `fitView`.
             *
             * `fitView` looks like the right call and is not usable for this. It does not move the
             * viewport: it sets `fitViewQueued` on React Flow's store and pushes a no-op onto the node
             * batch, and the fit happens later, if a subsequent `setNodes` reaches `resolveFitView`
             * while the flag is still up. On a controlled `nodes` prop that is not guaranteed — the
             * batched update produces no diff, so the fallback is a `requestAnimationFrame` that has
             * to survive every other write to the store in between. In practice a typed reference
             * resolved and the camera never moved. Worse, the queued options are global and
             * last-writer-wins, so a second `fitView` anywhere in the same tick silently replaces
             * "this node" with "everything".
             *
             * `setCenter` writes the viewport there and then. The arithmetic below is what `fitView`
             * would have done — the node at `FOCUS_FIT_COVERAGE` of the pane in its tighter axis,
             * clamped to the same zoom bounds the canvas itself uses.
             */
            const zoom = mode === "fit"
                ? Math.min(
                    CANVAS_MAX_ZOOM,
                    Math.max(
                        CANVAS_MIN_ZOOM,
                        Math.min(
                            (flowWidth * FOCUS_FIT_COVERAGE) / size.width,
                            (flowHeight * FOCUS_FIT_COVERAGE) / size.height,
                        ),
                    ),
                )
                : getZoom();
            void setCenter(
                target.position.x + (size.width / 2),
                target.position.y + (size.height / 2),
                { zoom, duration: 420 },
            );
            // Released from a timer of its own, not here.
            //
            // The two whole-graph refits schedule their timers in the same commit as this one, from
            // effects declared *below* it, so the queue already holds them behind this callback.
            // Scheduling the release now therefore puts it behind both of them, and they are
            // guaranteed to read the flag while it is still set. Dropping it inline instead loses the
            // race in the worst way — non-deterministically, because React Flow's `fitView` is queued
            // rather than immediate (it sets `fitViewQueued` and waits for the next node flush), so
            // whether the whole-graph fit overwrote this one depended on when a microtask ran.
            release = window.setTimeout(() => {
                nodeFocusPendingRef.current = false;
                setPendingCanvasFocus(null);
            }, 0);
        }, 0);

        return () => {
            window.clearTimeout(timer);
            if (release !== null) window.clearTimeout(release);
        };
    }, [pendingCanvasFocus, displayedNodes, setCenter, getZoom, fitView, flowWidth, flowHeight, showCanvasNotice]);

    /** Raised the moment the link is acted on, resolved or refused, so it is acted on exactly once. */
    const deepLinkHandledRef = useRef(false);

    /**
     * A reader arriving from a link in an exported report.
     *
     * `codeToUrl` has always printed `?ref=R7&n=<target id>&at=<instant>` into every card entry of
     * the markdown, and nothing ever read it back: following one opened the project at Detail with no
     * focus, and the reader had to retype the code they had just clicked. This is the other end of
     * that link, and it is deliberately nothing more than typing the code for them — the reveal, and
     * every filter it has to put back, stays in `handleGoToLocatorCode`. Two implementations of it is
     * exactly how a document and the application it describes come to disagree.
     *
     * **Why it waits for `nodesMeasured` and not for `status === "ready"` alone.** Two things sit
     * between a loaded document and a camera that can move. `useDocumentSync` dispatches the graph
     * before it awaits the file list, so there is a commit where the nodes are in the store, the
     * status is still `loading`, and the early return above `<FlowCanvas>` means React Flow is not
     * mounted at all — firing there hands `setCenter` a 0x0 pane and clamps the arrival zoom to
     * `CANVAS_MIN_ZOOM`. And `<ReactFlow fitView>` fits the whole graph once on init, from inside
     * React Flow's store, where `nodeFocusPendingRef` cannot reach it; that fit resolves on the flush
     * that raises `nodesInitialized`, so waiting for the flag is what puts the arrival after it.
     *
     * **`at` is read and deliberately not honoured.** Honouring it means setting the playhead, which
     * would undo step 1 of the reveal — and it is not the snapshot it looks like: the needle gates
     * whole activity trees and replays no node history, so it cannot reproduce what the document
     * described. What it *can* do is make `canvasClusters` disagree with the index the phase codes
     * were numbered over, which is the precise failure restoring the filters exists to prevent, and
     * arm `resolveActionTimestamp` to stamp a past instant on the next card an owner creates.
     */
    useEffect(() => {
        if (deepLinkHandledRef.current) return;
        if (status !== "ready") return;

        const reference = searchParams.get("ref");
        if (reference === null || reference.trim() === "") {
            deepLinkHandledRef.current = true;
            return;
        }

        // An empty canvas never raises `nodesInitialized` — React Flow starts it at `nodes.length >
        // 0` — so waiting on it there would hang forever, silently. There is also nothing to wait
        // for: with nothing live the code cannot resolve, and the call below produces only the
        // sentence saying so, which is what the reader needs. `displayedNodes` rather than `nodes`,
        // because a project whose cards were all deleted has nodes and an empty canvas, and deserves
        // to be told which card was deleted rather than to wait.
        if (displayedNodes.length > 0 && !nodesMeasured) return;

        deepLinkHandledRef.current = true;
        handleGoToLocatorCode(reference, searchParams.get("n"));

        // Stripped only now, so a load that failed leaves the reference in the address bar to retry
        // with. Through the router rather than `history.replaceState`: `createBrowserRouter` holds
        // its own location and re-reads `window.location` only on `popstate`, so a raw call would
        // leave the router holding a query string the address bar no longer shows — and
        // `RequireSession` builds its post-login return path out of exactly that. `replace`, so the
        // back button does not step onto a URL meaning "jump to R7" and fire it again.
        const remaining = new URLSearchParams(searchParams);
        remaining.delete("ref");
        remaining.delete("n");
        remaining.delete("at");
        setSearchParams(remaining, { replace: true });
    }, [
        displayedNodes.length,
        handleGoToLocatorCode,
        nodesMeasured,
        searchParams,
        setSearchParams,
        status,
    ]);

    // Rings are shown while a file is dragged over the canvas and while the card tool is armed,
    // because both actions create a card that gets connected to the activity underneath.
    const activityDropReason = useMemo<ActivityDropRingsReason | null>(() => {
        if (interactionLocked) return null;
        // An abstracted canvas has glyphs where activities were, and a ring drawn around one would
        // invite dropping a card onto a node that does not exist in the document.
        if (!canvasIsEditable) return null;
        if (fileDragActive) return "drag";
        // The note tool connects to the activity underneath exactly as the card tool does, so the
        // connect-vs-float choice has to be visible before the click, not after.
        if (cursorMode === "node" || cursorMode === "text") return "tool";
        return null;
    }, [canvasIsEditable, cursorMode, fileDragActive, interactionLocked]);

    /**
     * A disc around each phase or thread, with its title set large enough to survive being zoomed
     * away from. Built from the *displayed* graph, so it describes exactly what is on screen.
     *
     * Not gated on the zoom here: whether a halo is *visible* is decided in CSS from the attribute
     * `useCanvasLod` writes on the pan/zoom frame, because a React gate would remount the overlay in
     * the middle of the gesture that crossed the boundary. It is gated on the *level*, because at
     * Detail there are no glyphs and therefore nothing to circle.
     */
    const clusterHalos = useMemo(() => (
        canvasLevel === 3 ? null : buildClusterHalos(displayedNodes, displayedEdges)
    ), [canvasLevel, displayedNodes, displayedEdges]);

    const activityDropTargets = useMemo(() => (
        activityDropReason ? getActivityDropTargets(displayedNodes) : null
    ), [activityDropReason, displayedNodes]);

    /**
     * Spawn boxes on the handles of every non-activity card, shown alongside the rings and for the
     * same three triggers.
     *
     * A dragged file is always going to become an `object` card, so the boxes are narrowed to the
     * cards `object` may legally attach to — a drag never offers a target that would be refused on
     * release. The two tools cannot know their label yet (the card tool derives it from the anchor,
     * the note tool from what gets typed), so they get every box.
     */
    const cardSpawnTargets = useMemo(() => {
        if (!activityDropReason) return null;
        return getCardSpawnTargets(
            displayedNodes,
            activityDropReason === "drag" ? { spawnLabel: "object" } : {},
        );
    }, [activityDropReason, displayedNodes]);

    /** Flow-coordinate hit test shared by all three creation paths. Boxes win over rings. */
    const resolveCreationTarget = useCallback((position: { x: number; y: number }, spawnLabel?: string) => {
        const spawnTarget = findCardSpawnTarget(
            getCardSpawnTargets(displayedNodes, spawnLabel ? { spawnLabel } : {}),
            position,
        );
        if (spawnTarget) return { spawnTarget, activityTarget: null };
        const activityTarget = findActivityDropTarget(getActivityDropTargets(displayedNodes), position);
        return { spawnTarget: null, activityTarget };
    }, [displayedNodes]);

    /** Keeps a fixed-position menu fully on screen, above and centred on the gesture that raised it. */
    const placeMenuAbove = useCallback((clientX: number, clientY: number, width: number, height: number) => ({
        x: Math.max(12, Math.min(window.innerWidth - width - 12, clientX - (width / 2))),
        y: Math.max(12, Math.min(window.innerHeight - height - 12, clientY - height - 8)),
    }), []);

    /**
     * Creates the card a spawn box promised, together with the edge that justifies its existence.
     *
     * The two are one action on purpose. A card committed before the relation question is answered
     * would be exactly the unconnected card the boxes exist to prevent — so the whole thing waits in
     * `pendingCardSpawnMenu` and a dismissed menu leaves the canvas as it was.
     */
    const commitCardSpawn = useCallback((pending: PendingCardSpawnMenu, option: EdgeConnectOption) => {
        if (interactionLocked) return;

        const { target, note } = pending;

        // The menu can outlive its anchor — the card is still selected while the menu is open, so
        // Delete reaches it. Committing against a deleted card would create the loose card this
        // whole affordance exists to prevent.
        const anchorNode = nodes.find((node) => node.id === target.nodeId);
        if (!anchorNode || !isNodeActive(anchorNode)) {
            showCanvasNotice(
                `“${target.anchorTitle}” is no longer on the canvas, so there is nothing to connect`
                + " the new card to. Nothing was created.",
            );
            return;
        }

        const spawnLabel = target.spawnLabel as cardLabel;
        const relationLabel = option === "default"
            ? target.relationLabel
            : option === "referenced_by"
                ? REFERENCED_BY_EDGE_LABEL
                : ITERATION_OF_EDGE_LABEL;
        const kind = option === "default" ? undefined : option;

        resetFiltersForCanvasCreation(spawnLabel);

        const createdAt = resolveActionTimestamp();
        const nodeId = crypto.randomUUID();
        const spawnedNode: nodeType = {
            id: nodeId,
            // Stored only as a record of where the box was; the orbit layout decides where the card
            // actually renders, which is why the camera is sent after it below.
            position: {
                x: target.center.x - (CARD_WIDTH_PX / 2),
                y: target.center.y - (CARD_HEIGHT_PX / 2),
            },
            type: "card",
            data: {
                label: spawnLabel,
                type: cardTypeForLabel(spawnLabel),
                title: note ? note.title : "Untitled",
                ...(note ? { description: note.description } : {}),
                createdAt,
                relevant: true,
            },
        };
        dispatch(addNode(spawnedNode));

        // `outgoing` is the box on the card's source handle, so the anchor is the edge's source.
        // The relation label is the same either way — the table is keyed by an unordered pair — so
        // the side of the card the user clicked is the only thing carrying the direction.
        const anchorIsSource = target.direction === "outgoing";
        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: anchorIsSource ? target.nodeId : nodeId,
            target: anchorIsSource ? nodeId : target.nodeId,
            type: "relation",
            label: relationLabel,
            data: {
                label: relationLabel,
                from: anchorIsSource ? target.anchorLabel : spawnLabel,
                to: anchorIsSource ? spawnLabel : target.anchorLabel,
                createdAt,
                // Same reasoning as the drag-connect gesture: the absence of `autoLinked` says
                // nothing on its own, so "a human asserted this link" is recorded explicitly.
                manual: true,
                ...(kind ? { kind } : {}),
            },
        }]));

        requestNodeFocus(nodeId);

        // A note carries a sentence worth comparing against the rest of the canvas; an `Untitled`
        // card from the card tool has nothing to be similar about yet, and `autoLinkNewCards` would
        // drop it before the request anyway.
        if (note) {
            // The card exists now, so the note input has nothing left to protect. Disarming the
            // tool unmounts `FreeInputZone`, which is what closes and clears it — the same thing
            // that happens when a note is committed straight into an activity's ring.
            setCursorMode("");
            void autoLinkNewCards({
                projectId,
                newNodes: [spawnedNode],
                nodesRef,
                edgesRef,
                dispatch,
                createdAt,
            });
        }
    }, [dispatch, interactionLocked, nodes, projectId, requestNodeFocus, resetFiltersForCanvasCreation, resolveActionTimestamp, showCanvasNotice]);

    const handleCardSpawnSelection = useCallback((option: EdgeConnectOption) => {
        const pending = pendingCardSpawnMenu;
        setPendingCardSpawnMenu(null);
        if (!pending) return;
        commitCardSpawn(pending, option);
    }, [commitCardSpawn, pendingCardSpawnMenu]);


    const onCanvasClick = useCallback((e: React.MouseEvent) => {
        if (canvasClickSuppressedRef.current) {
            canvasClickSuppressedRef.current = false;
            return;
        }
        if (interactionLocked) return;
        if (!canvasIsEditable) return;
        if (cursorMode !== "node") return;

        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

        // Three places a click can land, in order of how specific they are. A spawn box wins over
        // an activity ring it happens to sit inside: the box is an offer about one card, the ring
        // an offer about a whole neighbourhood, and the box is what is under the cursor.
        const { spawnTarget, activityTarget } = resolveCreationTarget(position);

        if (spawnTarget) {
            // Nothing is created yet. The card and the edge that justifies it are one action, and
            // the relation is the part of it the click cannot answer.
            setPendingCardSpawnMenu({
                target: spawnTarget,
                note: null,
                ...placeMenuAbove(e.clientX, e.clientY, SPAWN_MENU_WIDTH_PX, SPAWN_MENU_HEIGHT_PX),
            });
            return;
        }

        // Clicking inside an activity's drop ring creates an object card wired to that activity;
        // clicking empty canvas still creates a root activity card, which is the one card allowed
        // to stand on its own. Resolve the target before resetting filters, so we can un-hide the
        // label of whichever card we are about to create.
        resetFiltersForCanvasCreation(activityTarget ? "object" : "activity");
        const createdAt = resolveActionTimestamp();

        if (activityTarget) {
            const nodeId = crypto.randomUUID();
            dispatch(addNode({
                id: nodeId,
                // Stored only as a record of where the card was created; the orbit layout decides
                // where it actually renders.
                position: { x: position.x - (CARD_WIDTH_PX / 2), y: position.y - (CARD_HEIGHT_PX / 2) },
                type: "card",
                data: {
                    label: "object",
                    type: "social",
                    title: "Untitled",
                    createdAt,
                    relevant: true,
                },
            }));

            const relationLabel = relationLabelFor("activity", "object");
            if (relationLabel) {
                dispatch(connectEdges([{
                    id: crypto.randomUUID(),
                    source: activityTarget.nodeId,
                    target: nodeId,
                    type: "relation",
                    label: relationLabel,
                    data: {
                        label: relationLabel,
                        from: "activity",
                        to: "object",
                        createdAt,
                    },
                }]));
            }
            requestNodeFocus(nodeId);
            return;
        }

        const activityNodeId = crypto.randomUUID();
        requestNodeFocus(activityNodeId);
        dispatch(addNode({
            id: activityNodeId,
            position: { x: position.x - (CARD_WIDTH_PX / 2), y: position.y - (CARD_HEIGHT_PX / 2) },
            type: "card",
            data: {
                label: "activity",
                type: "social",
                title: "Untitled",
                createdAt,
                relevant: true,
            },
        }));
    }, [canvasIsEditable, cursorMode, dispatch, interactionLocked, placeMenuAbove, requestNodeFocus, resetFiltersForCanvasCreation, resolveActionTimestamp, resolveCreationTarget, screenToFlowPosition]);

    /**
     * Attach a tray component to the requirement under the cursor, or say why not.
     *
     * The whole "attach" gesture is this one edge. A `tackled in` relation is what puts the
     * component on the canvas at all (`blueprintSurfaces.canvasBlueprintNodes`), what stops its
     * timeline marker being drawn as "answers nothing yet", and what the researcher removes to
     * detach — so there is nothing else to create, and nothing to keep in sync with the tray.
     *
     * It no longer *mints* that marker: the Blueprint track derives one per live component from the
     * moment it exists (`liveBlueprintEvents`). Detaching must therefore not delete anything on the
     * timeline; the component still exists, and its marker goes back to the dashed state.
     *
     * The hit test reads `displayedNodes`, never the store `nodes`: the layout owns rendered
     * positions and the two coordinate spaces stopped agreeing when it did.
     */
    const attachComponentToRequirementAt = useCallback((
        payload: { nodeId: string; title: string },
        position: { x: number; y: number },
    ) => {
        const componentNode = nodes.find((node) => node.id === payload.nodeId);
        if (!componentNode) return;

        const requirementNode = findCardAtPosition(displayedNodes, position, { label: "requirement" });
        if (!requirementNode) {
            showCanvasNotice(
                `Drop "${payload.title || "the component"}" onto a requirement card to say it answers that requirement.`,
            );
            return;
        }

        const label = relationLabelFor("blueprint_component", "requirement");
        if (!label) return;

        const alreadyConnected = edges.some((edge) => (
            ((edge.source === componentNode.id && edge.target === requirementNode.id)
                || (edge.source === requirementNode.id && edge.target === componentNode.id))
            && toTimestampMs((edge.data as Record<string, unknown> | undefined)?.deletedAt) === null
            && edgeLabelFrom(edge) === label
        ));
        if (alreadyConnected) {
            showCanvasNotice(
                `"${payload.title || "That component"}" already answers this requirement.`,
            );
            return;
        }

        // Direction is not cosmetic here. `routes/state.ts` builds the report's blueprint links from
        // `card -> blueprint_component` rows only ("Enforce directional links only"), so an edge
        // drawn the other way is accepted by the canvas, the timeline and provenance and then
        // silently missing from the markdown report. The relation table is unordered and this
        // gesture always knows which end is which, so it always writes the direction that survives.
        const createdAt = resolveActionTimestamp();
        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: requirementNode.id,
            target: componentNode.id,
            type: "relation",
            label,
            data: {
                label,
                from: "requirement",
                to: "blueprint_component",
                createdAt,
                manual: true,
            },
        }]));

        requestNodeFocus(componentNode.id);
    }, [
        displayedNodes,
        dispatch,
        edges,
        requestNodeFocus,
        nodes,
        resolveActionTimestamp,
        showCanvasNotice,
    ]);

    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        if (interactionLocked) return;
        const dragTypes = Array.from(e.dataTransfer?.types ?? []);
        const hasFiles = dragTypes.includes("Files");
        // A whole paper is no longer droppable here: blueprint structure lives in the tray, and the
        // only blueprint gesture the canvas takes is attaching one component to one requirement.
        const hasBlueprintAttach = dragTypes.includes(BLUEPRINT_ATTACH_MIME);
        const hasGitHubFile = dragTypes.includes("application/x-vitral-github-file");
        if (!hasFiles && !hasBlueprintAttach && !hasGitHubFile) return;

        e.preventDefault();
        // `dropEffect` has to be one of the operations the *drag source* allowed, or the browser
        // resolves the operation to "none" and never fires `drop` at all — a silent refusal with no
        // handler of ours involved. The attach grip starts its drag with `effectAllowed = "copyLink"`
        // because attaching is a link, not a copy; answering "copy" to it dropped the gesture on the
        // floor. Every other drag the canvas takes really is a copy.
        e.dataTransfer.dropEffect = hasBlueprintAttach ? "link" : "copy";
    }, [interactionLocked]);

    /**
     * Uploads a batch of dropped files and turns each into a card, one at a time.
     *
     * Sequential on purpose: the cards are `object` cards named after the file and the uploads are
     * the slow part, so racing them only reorders the canvas. `connection` is the relation chosen
     * once for the whole batch and applies to every card in it. `anchor` is never null any more —
     * an `object` card has to attach to something — but the parameter is kept nullable so the one
     * place that decides that stays the drop handler.
     */
    const runCanvasFileDrop = useCallback(async (
        files: File[],
        basePosition: { x: number; y: number },
        anchor: CanvasDropAnchor | null,
        connection: CanvasDropConnection | null,
    ) => {
        for (let index = 0; index < files.length; index++) {
            const dropPosition = anchor
                ? basePosition
                : {
                    x: basePosition.x - (CARD_WIDTH_PX / 2) + (index * (CARD_WIDTH_PX + 100)),
                    y: basePosition.y - (CARD_HEIGHT_PX / 2),
                };
            const createdNodeId = await onAttachFileForCanvas(files[index], dropPosition, anchor, connection);

            // Only the first card pulls the camera; panning once per file in a multi-file drop
            // would yank the canvas around while the uploads finish.
            if (index === 0 && createdNodeId) requestNodeFocus(createdNodeId);

            // Un-hide the card's label only once the card exists. Clearing a filter re-runs the
            // explore-mode fitView, and doing that up front — before the upload resolves — would
            // frame the graph *without* the new card, so a card dropped outside those bounds
            // ended up off-screen with only an unexplained camera move to show for it.
            if (index === 0) resetFiltersForCanvasCreation("object");
        }
    }, [onAttachFileForCanvas, requestNodeFocus, resetFiltersForCanvasCreation]);

    /** Answer to the drop-ring relation question: create the whole batch with the chosen edge. */
    const handleFileDropConnectSelection = useCallback((option: EdgeConnectOption) => {
        const pending = pendingFileDropMenu;
        setPendingFileDropMenu(null);
        if (!pending) return;
        if (interactionLocked) return;

        const connection: CanvasDropConnection = option === "default"
            ? { label: pending.defaultLabel }
            : option === "referenced_by"
                ? { label: REFERENCED_BY_EDGE_LABEL, kind: "referenced_by" }
                : { label: ITERATION_OF_EDGE_LABEL, kind: "iteration_of" };

        void runCanvasFileDrop(pending.files, pending.basePosition, pending.anchor, connection);
    }, [interactionLocked, pendingFileDropMenu, runCanvasFileDrop]);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        if (interactionLocked) return;
        if (!canvasIsEditable) return;
        const attachRaw = e.dataTransfer?.getData(BLUEPRINT_ATTACH_MIME);
        if (attachRaw) {
            e.preventDefault();

            const payload = parseBlueprintAttachPayload(attachRaw);
            if (!payload) return;

            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            attachComponentToRequirementAt(payload, position);
            return;
        }

        const githubFileRaw = e.dataTransfer?.getData("application/x-vitral-github-file");
        if (githubFileRaw) {
            e.preventDefault();
            return;
        }

        const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
        if (droppedFiles.length === 0) return;

        e.preventDefault();

        const basePosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        // A dropped file always becomes an `object` card, so the boxes were already narrowed to the
        // cards `object` may legally attach to — whatever is under the cursor here can take it. The
        // placement of each card is then resolved next to its anchor, not at the cursor.
        const { spawnTarget, activityTarget } = resolveCreationTarget(basePosition, "object");
        const anchor: CanvasDropAnchor | null = spawnTarget
            ? { nodeId: spawnTarget.nodeId, direction: spawnTarget.direction }
            : activityTarget
                ? { nodeId: activityTarget.nodeId, direction: "outgoing" }
                : null;

        if (!anchor) {
            // Refused rather than dropped loose: an `object` card is a claim about a study, and one
            // with nothing attached is the card this rule exists to keep off the canvas. Nothing is
            // uploaded, so the file is still there to drop again a few pixels away.
            showCanvasNotice(
                "A dropped file becomes an object card, and only activity cards can stand on their own."
                + " Drop it inside an activity's ring, or on the + box beside a card.",
            );
            return;
        }

        // An edge is about to be created, so the same question the manual connect gesture asks
        // gets asked here — once, for the whole batch. Nothing is uploaded until it is
        // answered, so dismissing the menu leaves the canvas exactly as it was.
        const defaultLabel = spawnTarget?.relationLabel
            ?? relationLabelFor("activity", "object")
            ?? "related to";
        setPendingFileDropMenu({
            files: droppedFiles,
            basePosition,
            anchor,
            anchorTitle: spawnTarget?.anchorTitle ?? activityTarget?.title ?? "Untitled",
            defaultLabel,
            ...placeMenuAbove(e.clientX, e.clientY, SPAWN_MENU_WIDTH_PX, SPAWN_MENU_HEIGHT_PX),
        });
    }, [attachComponentToRequirementAt, canvasIsEditable, interactionLocked, placeMenuAbove, resolveCreationTarget, screenToFlowPosition, showCanvasNotice]);

    // A typed note becomes one card, deterministically. The label is guessed from keyword cues in
    // `noteClassification.ts` -- never by the model, because this is a reading-path affordance and
    // because a round trip would put a spinner between having a thought and seeing it on the
    // canvas. The note itself is stored verbatim as the description; only the title is derived.
    const onFreeInputSubmit = useCallback((x: number, y: number, note: NoteClassification): boolean => {
        if (interactionLocked) return false;
        // Cards are created at Detail only: at Threads and Overview the thing under the cursor is
        // a glyph, and a card wired to it would be wired to a node the document does not contain.
        if (!canvasIsEditable) return false;
        if (!note.description.trim()) return false;

        const position = screenToFlowPosition({ x, y });
        const { spawnTarget, activityTarget } = resolveCreationTarget(position);

        // A note written on a card's spawn box is about *that card*, so it joins the graph there.
        // The note brings its own label, which the box could not know in advance, so the pair has
        // to be checked now rather than assumed — the box was offered for the label the card tool
        // would have picked.
        if (spawnTarget) {
            const relationLabel = relationLabelFor(spawnTarget.anchorLabel, note.label);
            if (!relationLabel) {
                // Filtered to the labels the card-type `<select>` actually offers: the relation
                // table also pairs `requirement` with `blueprint_component`, and naming that here
                // would send the researcher looking for a choice the UI does not have.
                const partners = relationPartnersFor(spawnTarget.anchorLabel)
                    .map((partner) => partner.label)
                    .filter((label) => CARD_LABELS.includes(label as cardLabel))
                    .join(", ");
                showCanvasNotice(
                    `There is no relation between ${withArticle(note.label)} card and`
                    + ` ${withArticle(spawnTarget.anchorLabel)} card. From here you can add:`
                    + ` ${partners} — change the card type, or write the note somewhere else.`,
                );
                // The note is kept open with its text intact, so a refusal costs a re-aim and not
                // the sentence the researcher just wrote.
                return false;
            }

            setPendingCardSpawnMenu({
                target: { ...spawnTarget, spawnLabel: note.label, relationLabel },
                note,
                ...placeMenuAbove(x, y, SPAWN_MENU_WIDTH_PX, SPAWN_MENU_HEIGHT_PX),
            });
            // Deliberately `false`: the card does not exist until the relation is answered, and
            // the note input holds the only copy of the sentence until it does. `commitCardSpawn`
            // disarms the note tool once the card exists, which unmounts the input; cancelling the
            // menu instead leaves the researcher back in their note with the text intact.
            return false;
        }

        if (!activityTarget && normalizeNodeLabel(note.label) !== "activity") {
            showCanvasNotice(
                `Only activity cards can stand on their own, and this is ${withArticle(note.label)}`
                + " card. Write the note inside an activity's ring, or on the + box beside a card.",
            );
            return false;
        }

        setCursorMode("");
        resetFiltersForCanvasCreation(note.label);

        const createdAt = resolveActionTimestamp();
        const nodeId = crypto.randomUUID();
        const noteNode: nodeType = {
            id: nodeId,
            // Stored only as a record of where the note was written; the orbit layout decides where
            // the card actually renders.
            position: { x: position.x - (CARD_WIDTH_PX / 2), y: position.y - (CARD_HEIGHT_PX / 2) },
            type: "card",
            data: {
                label: note.label,
                type: cardTypeForLabel(note.label),
                title: note.title,
                description: note.description,
                createdAt,
                relevant: true,
            },
        };
        dispatch(addNode(noteNode));

        // Writing the note inside an activity's ring says which activity it is about, so the card
        // joins that tree instead of falling into the unassigned band.
        if (activityTarget) {
            const relationLabel = relationLabelFor("activity", note.label);
            if (relationLabel) {
                dispatch(connectEdges([{
                    id: crypto.randomUUID(),
                    source: activityTarget.nodeId,
                    target: nodeId,
                    type: "relation",
                    label: relationLabel,
                    data: {
                        label: relationLabel,
                        from: "activity",
                        to: note.label,
                        createdAt,
                    },
                }]));
            }
        }

        requestNodeFocus(nodeId);

        // A note is a claim about the study, so it belongs against whatever the canvas already says
        // about the same thing. This is the same pass the file drop runs, with the same evidence
        // gates -- an authored card earns its automatic relations exactly as an extracted one does.
        void autoLinkNewCards({
            projectId,
            newNodes: [noteNode],
            nodesRef,
            edgesRef,
            dispatch,
            createdAt,
        });

        return true;
    }, [canvasIsEditable, dispatch, interactionLocked, placeMenuAbove, projectId, requestNodeFocus, resetFiltersForCanvasCreation, resolveActionTimestamp, resolveCreationTarget, screenToFlowPosition, showCanvasNotice]);

    const fetchGithubEvents = useCallback(async (connected: boolean) => {
        if (!reviewOnly && !connected) return;

        if (!reviewOnly) {
            const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
            if (!info.github_repo) return;
        }

        try {
            const events = await getGitHubEvents(projectId, { limit: 5000 });
            dispatch(setGithubEvents(events));
        } catch (error) {
            if (reviewOnly) {
                dispatch(setGithubEvents([]));
                return;
            }
            throw error;
        }
    }, [dispatch, projectId, reviewOnly]);

    const checkGitStatus = useCallback(async () => {
        const status = await githubStatus();
        setGitConnectionStatus(status);
        await fetchGithubEvents(status.connected);
    }, [fetchGithubEvents]);

    useEffect(() => {
        if (interactionLocked) return;
        const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
        const pairKey = (blueprintEventId: string, codebaseSubtrackId: string) =>
            `${blueprintEventId}::${codebaseSubtrackId}`;

        const subtrackIdsByFilePath = new Map<string, Set<string>>();
        for (const subtrack of codebaseSubtracks) {
            for (const rawPath of subtrack.filePaths) {
                const normalizedPath = normalizePath(rawPath);
                if (!normalizedPath) continue;
                if (!subtrackIdsByFilePath.has(normalizedPath)) {
                    subtrackIdsByFilePath.set(normalizedPath, new Set<string>());
                }
                subtrackIdsByFilePath.get(normalizedPath)?.add(subtrack.id);
            }
        }

        const blueprintEventIdByComponentNodeId = new Map<string, string>();
        for (const eventData of blueprintEvents) {
            if (typeof eventData.componentNodeId === "string" && eventData.componentNodeId.trim() !== "") {
                blueprintEventIdByComponentNodeId.set(eventData.componentNodeId, eventData.id);
            }
        }

        const requiredAutoLinks: Array<{ blueprintEventId: string; codebaseSubtrackId: string }> = [];
        const requiredAutoLinkKeys = new Set<string>();

        for (const node of nodes) {
            const nodeLabel = String(node.data?.label ?? "").toLowerCase();
            if (nodeLabel !== "blueprint_component") continue;

            const componentData = node.data as Record<string, unknown>;
            const attachedPaths = Array.isArray(componentData.codebaseFilePaths)
                ? componentData.codebaseFilePaths
                    .filter((path): path is string => typeof path === "string")
                    .map((path) => normalizePath(path))
                    .filter((path) => path !== "")
                : [];
            if (attachedPaths.length === 0 || !isNodeActive(node)) continue;

            // The marker's id, not a marker. Every live component has one on the track already
            // (`liveBlueprintEvents` derives them), and the id is a pure function of the node — so
            // this pass only has to name it in order to link it to a codebase subtrack. Minting one
            // here would make opening a project a document edit; see the note on that memo.
            const blueprintEventId = blueprintEventIdByComponentNodeId.get(node.id)
                ?? `blueprint-component:${node.id}`;
            blueprintEventIdByComponentNodeId.set(node.id, blueprintEventId);

            for (const attachedPath of attachedPaths) {
                const subtrackIds = subtrackIdsByFilePath.get(attachedPath);
                if (!subtrackIds || subtrackIds.size === 0) continue;

                for (const subtrackId of subtrackIds) {
                    const key = pairKey(blueprintEventId, subtrackId);
                    if (requiredAutoLinkKeys.has(key)) continue;
                    requiredAutoLinkKeys.add(key);
                    requiredAutoLinks.push({
                        blueprintEventId,
                        codebaseSubtrackId: subtrackId,
                    });
                }
            }
        }

        dispatch(reconcileBlueprintCodebaseAutoLinks(requiredAutoLinks));
    }, [codebaseSubtracks, dispatch, interactionLocked, nodes, blueprintEvents]);

    useEffect(() => {
        dispatch(setGithubEvents([]));
        void checkGitStatus();
    }, [dispatch, checkGitStatus]);

    useEffect(() => {
        let active = true;

        void (async () => {
            try {
                const document = await loadDocument(projectId);
                if (!active) return;
                setProjectGoal(typeof document.description === "string" ? document.description : "");
            } catch {
                if (!active) return;
                setProjectGoal("");
            }
        })();

        return () => {
            active = false;
        };
    }, [projectId]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            pointerPositionRef.current = { x: event.clientX, y: event.clientY };
        };

        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        return () => window.removeEventListener("pointermove", handlePointerMove);
    }, []);

    useEffect(() => {
        if (!pendingConnectionMenu) return;

        const handleWindowPointerDown = () => {
            canvasClickSuppressedRef.current = true;
            setPendingConnectionMenu(null);
        };
        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setPendingConnectionMenu(null);
            }
        };

        window.addEventListener("pointerdown", handleWindowPointerDown);
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => {
            window.removeEventListener("pointerdown", handleWindowPointerDown);
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, [pendingConnectionMenu]);

    // Same dismissal contract as the connect menu: clicking away or pressing Escape cancels. The
    // files are only held in state, so cancelling uploads nothing and leaves no card behind.
    useEffect(() => {
        if (!pendingFileDropMenu) return;

        const handleWindowPointerDown = () => {
            canvasClickSuppressedRef.current = true;
            setPendingFileDropMenu(null);
        };
        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPendingFileDropMenu(null);
        };

        window.addEventListener("pointerdown", handleWindowPointerDown);
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => {
            window.removeEventListener("pointerdown", handleWindowPointerDown);
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, [pendingFileDropMenu]);

    // Same dismissal contract again. The card does not exist yet either, so cancelling here leaves
    // the canvas untouched exactly as the file drop does.
    useEffect(() => {
        if (!pendingCardSpawnMenu) return;

        const handleWindowPointerDown = () => {
            canvasClickSuppressedRef.current = true;
            setPendingCardSpawnMenu(null);
        };
        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPendingCardSpawnMenu(null);
        };

        window.addEventListener("pointerdown", handleWindowPointerDown);
        window.addEventListener("keydown", handleWindowKeyDown);
        return () => {
            window.removeEventListener("pointerdown", handleWindowPointerDown);
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, [pendingCardSpawnMenu]);

    // A drop or spawn menu left open across a level change or a review-mode switch would create
    // cards the canvas can no longer accept, so it is dropped with the affordance that raised it.
    useEffect(() => {
        if (canvasIsEditable && !interactionLocked) return;
        setPendingFileDropMenu(null);
        setPendingCardSpawnMenu(null);
    }, [canvasIsEditable, interactionLocked]);

    useEffect(() => {
        if (!interactionLocked) return;
        if (cursorMode !== "") {
            setCursorMode("");
        }
    }, [cursorMode, interactionLocked]);

    // Single source of truth for "a file is being dragged", which drives the activity drop rings.
    // Capture phase matters: card attach zones call stopPropagation on drag events, so a
    // bubble-phase window listener would miss both a drag entering a card and the drop that ends
    // it — leaving the rings stuck on screen. `activityDropReason` applies the review-mode and
    // view-mode gating, so this flag only has to track the drag itself.
    useEffect(() => {
        const options: AddEventListenerOptions = { capture: true };
        const stopFileDrag = () => setFileDragActive(false);

        const handleWindowDragOver = (event: DragEvent) => {
            setFileDragActive(Array.from(event.dataTransfer?.types ?? []).includes("Files"));
        };
        const handleWindowDragLeave = (event: DragEvent) => {
            // `relatedTarget === null` means the pointer left the window entirely.
            if (event.relatedTarget === null) setFileDragActive(false);
        };
        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setFileDragActive(false);
        };

        window.addEventListener("dragover", handleWindowDragOver, options);
        window.addEventListener("dragleave", handleWindowDragLeave, options);
        window.addEventListener("dragend", stopFileDrag, options);
        window.addEventListener("drop", stopFileDrag, options);
        window.addEventListener("keydown", handleWindowKeyDown);

        return () => {
            window.removeEventListener("dragover", handleWindowDragOver, options);
            window.removeEventListener("dragleave", handleWindowDragLeave, options);
            window.removeEventListener("dragend", stopFileDrag, options);
            window.removeEventListener("drop", stopFileDrag, options);
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, []);

    useEffect(() => {
        switch (cursorMode) {
            case "text":
                document.body.style.cursor = "text";
                break;
            case "node":
                document.body.style.cursor = "pointer";
                break;
            default:
                document.body.style.cursor = "";
                break;
        }
    }, [cursorMode]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
                event.preventDefault();
                setChatOpen((prev) => !prev);
                return;
            }

            if (event.key === "Escape") {
                setChatOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Changing what is on screen changes how much room it needs, so refit to it — **unless somebody
    // has asked for one particular node**. A reference names a card; a refit names everything; and the
    // more specific instruction has to win, or going to `R2` shows the tree R2 is in. See
    // `nodeFocusPendingRef`.
    useEffect(() => {
        const t = window.setTimeout(() => {
            if (nodeFocusPendingRef.current) return;
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [authoredVisible, blueprintComponentsVisible, modelDerivedVisible, selectedLabels, queryMatchedNodeIds, fitView]);

    // A level or focus change can resize the whole canvas, so refit to it — but only when the user
    // asked for that level by hand. In follow-zoom mode writing the viewport would fight the very
    // gesture that triggered the change, and could bounce the zoom back across the threshold.
    const skipInitialLevelFitRef = useRef(true);
    useEffect(() => {
        if (skipInitialLevelFitRef.current) {
            skipInitialLevelFitRef.current = false;
            return;
        }
        if (levelFollowsZoom) return;

        const t = window.setTimeout(() => {
            if (nodeFocusPendingRef.current) return;
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [canvasLevel, canvasFocus, levelFollowsZoom, fitView]);

    useEffect(() => {
        return () => {
            if (nodeChangeRafRef.current !== null) {
                window.cancelAnimationFrame(nodeChangeRafRef.current);
            }
            // A standing `R7F` request is a module singleton and outlives this route, so leaving one
            // behind would have it opened by whatever card happens to mount next — in another project.
            clearCardFilePreviewRequest();
        };
    }, []);

    const handleToggleSidebar = useCallback(() => {
        setSidebarCollapsed((prev) => !prev);
    }, []);

    const computeLabelScopedNodeIds = useCallback((labels: cardLabel[]) => {
        const labelSet = new Set(labels);
        return timelineContextNodes
            .filter((node) => {
                const rawLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
                if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
                return labelSet.has(rawLabel as cardLabel);
            })
            .map((node) => node.id);
    }, [timelineContextNodes]);

    const runNaturalLanguageQuery = useCallback(async (queryText: string, scopeNodeIds: string[]) => {
        const trimmed = queryText.trim();
        if (!trimmed) {
            setActiveQuery("");
            setQueryMatchedNodeIds(null);
            return;
        }

        const requestId = ++queryRequestIdRef.current;

        try {
            const response = await queryDocumentNodes(projectId, {
                query: trimmed,
                scopeNodeIds,
                limit: Math.max(1, Math.min(200, scopeNodeIds.length || 60)),
                minScore: 0.3,
                at: playbackAt ?? undefined,
            });
            if (requestId !== queryRequestIdRef.current) return;
            setActiveQuery(trimmed);
            setQueryMatchedNodeIds(response.matchedNodeIds);
        } catch (error) {
            if (requestId !== queryRequestIdRef.current) return;
            console.error("Failed to refresh filtered nodes for the current query.", error);
        }
    }, [playbackAt, projectId]);

    const clearCanvasFilter = useCallback(() => {
        setActiveQuery("");
        setQueryMatchedNodeIds(null);
        setChatError(null);
    }, []);

    const handleOpenChat = useCallback(() => {
        setChatOpen(true);
    }, []);

    // Takes the text rather than reading it from state: the draft belongs to `CanvasChatOverlay`, so
    // a keystroke neither re-renders this component nor gives this callback a new identity.
    const handleSendChatMessage = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed || chatLoading) return;

        const requestId = ++chatRequestIdRef.current;
        const userEntry: CanvasChatEntry = {
            id: crypto.randomUUID(),
            role: "user",
            content: trimmed,
        };
        const conversationPayload = [
            ...chatMessages.map((message) => ({ role: message.role, content: message.content })),
            { role: "user" as const, content: trimmed },
        ].slice(-20);

        setChatMessages((prev) => [...prev, userEntry]);
        setChatError(null);
        setChatLoading(true);

        const scopeNodeIds = labelFilteredNodes.map((node) => node.id);

        void (async () => {
            try {
                const response = await queryCanvasChat(projectId, {
                    message: trimmed,
                    conversation: conversationPayload,
                    scopeNodeIds,
                    limit: Math.max(1, Math.min(CANVAS_CHAT_MAX_RETRIEVAL_LIMIT, scopeNodeIds.length || 60)),
                    minScore: 0.3,
                    at: playbackAt ?? undefined,
                });
                if (requestId !== chatRequestIdRef.current) return;

                const assistantEntry: CanvasChatEntry = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: response.reply,
                };
                setChatMessages((prev) => [...prev, assistantEntry].slice(-40));

                if (response.applyFilter) {
                    setActiveQuery(trimmed);
                    setQueryMatchedNodeIds(response.matchedNodeIds);
                }
            } catch (error) {
                if (requestId !== chatRequestIdRef.current) return;
                const message = error instanceof Error ? error.message : "Failed to chat with canvas assistant.";
                setChatError(message);
            } finally {
                if (requestId === chatRequestIdRef.current) {
                    setChatLoading(false);
                }
            }
        })();
    }, [chatLoading, chatMessages, labelFilteredNodes, playbackAt, projectId]);

    /**
     * The requirement cards each search is scoped to.
     *
     * `requirementSearchCards` is every requirement in the project, which is what the blueprint
     * search asks about — "which published system covers this work". It reads `liveNodes` and drops
     * anything marked irrelevant: the previous version read the raw store, so a soft-deleted card
     * and one the researcher had explicitly labelled noise both still shaped the query.
     *
     * `selectedRequirementCards` is the subset selected on the canvas, which is what the component
     * search asks about. Selection is React Flow's own — `flowSlice.onNodesChange` has always
     * written `selected` onto the store nodes through `applyNodeChanges`, and until now nothing read
     * it. `dropNoOpSelectChanges` already keeps clicking an already-selected card from churning the
     * array, so this memo settles as soon as the selection does.
     */
    const requirementSearchCards = useMemo<SystemPaperQueryCard[]>(() => (
        liveNodes
            .filter((node) => (
                SYSTEM_PAPER_CARD_LABELS.has(
                    normalizeNodeLabel(String(node.data?.label ?? "")) as cardLabel,
                )
                && (node.data as Record<string, unknown> | undefined)?.relevant !== false
            ))
            .map((node) => ({
                label: "requirement",
                title: String(node.data?.title ?? ""),
                description: String(node.data?.description ?? ""),
            }))
    ), [liveNodes]);

    /**
     * How many components are waiting in the tray, shown on the chip that reopens it.
     *
     * Without it a closed tray is indistinguishable from an empty one, and a researcher who has
     * dragged a whole paper in has no sign that anything happened — the canvas deliberately does not
     * change until something is attached.
     */
    const trayComponentCount = useMemo(
        () => liveNodes.filter((node) => (
            normalizeNodeLabel(String(node.data?.label ?? "")) === "blueprint_component"
        )).length,
        [liveNodes],
    );

    const selectedRequirementCards = useMemo<SystemPaperQueryCard[]>(() => (
        liveNodes
            .filter((node) => (
                node.selected === true
                && SYSTEM_PAPER_CARD_LABELS.has(
                    normalizeNodeLabel(String(node.data?.label ?? "")) as cardLabel,
                )
                && (node.data as Record<string, unknown> | undefined)?.relevant !== false
            ))
            .map((node) => ({
                label: "requirement",
                title: String(node.data?.title ?? ""),
                description: String(node.data?.description ?? ""),
            }))
    ), [liveNodes]);

    /**
     * The exported report.
     *
     * Almost all of this used to live here: 260 lines that made two semantic searches over hardcoded
     * English strings, asked a model to write seven sections of prose, and stitched them under fixed
     * headings with a base64 screenshot inlined at the top. The reviewers' verdict — brief,
     * superficial, and not doing justice to the project's provenance — was a fair reading of a
     * document whose factual content was three lines and whose prompts were forbidden from citing
     * anything.
     *
     * What is left is the impure half, which is all this layer should ever have owned: read the store,
     * stamp the instant, number the artifacts, hand it to a pure function, save the file.
     * `buildProjectReport` is deterministic and tested (`npm run test:report`), so what the document
     * says can be checked against the canvas rather than taken on trust.
     *
     * Deliberately **not** gated on `interactionLocked`. Exporting writes nothing, and somebody
     * reading a published study is exactly the reader this document is for; the gate belongs on the
     * abstract's model call, not on the export.
     */
    const handleExportMarkdown = useCallback(() => {
        if (exportingMarkdown) return;
        setExportingMarkdown(true);

        void (async () => {
        try {
            const generatedAtIso = new Date().toISOString();
            const capturedAtIso = latestCanvasChangeTime !== null
                ? new Date(latestCanvasChangeTime).toISOString()
                : generatedAtIso;

            const reportStages = timelineStages.map((stage) => ({
                id: stage.id,
                name: String(stage.name ?? ""),
                startIso: toIsoDateString(stage.start),
                endIso: toIsoDateString(stage.end),
            }));

            const reportFiles = allFiles.map((file) => {
                const record = file as unknown as Record<string, unknown>;
                return {
                    id: file.id,
                    // Content-addressed, so a file's code survives a `.vi` round trip, which rewrites
                    // file ids but never the bytes.
                    sha256: typeof record.sha256 === "string" ? record.sha256 : file.id,
                    name: file.name,
                    ext: typeof record.ext === "string" ? record.ext : "",
                    mimeType: typeof record.mimeType === "string" ? record.mimeType : "",
                    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
                    createdAtIso: toIsoDateString(record.createdAt),
                };
            });

            const snapshot: ReportSnapshot = {
                generatedAtIso,
                projectId,
                projectTitle: title?.trim() || "Untitled",
                projectGoal: projectGoal?.trim() ?? "",
                // The same fingerprint the knowledge-provenance request is keyed on, so two exports of
                // one graph are recognisably of one graph.
                contentVersion: knowledgeProvenanceTriggerKey,
                asOf: { version: null, capturedAtIso },
                // Full arrays, tombstones included: the removal log needs them, and the numbering
                // needs their slots so nothing after a deletion is renumbered.
                nodes,
                edges,
                timeline: {
                    startIso: timelineStartEnd.start ? toIsoDateString(timelineStartEnd.start) : null,
                    endIso: timelineStartEnd.end ? toIsoDateString(timelineStartEnd.end) : null,
                    stages: reportStages,
                    participants: participants.map((participant) => ({
                        id: participant.id,
                        name: participant.name,
                        role: participant.role,
                    })),
                    designStudyEvents: designStudyEvents.map((eventData) => ({
                        id: eventData.id,
                        name: eventData.name,
                        occurredAtIso: toIsoDateString(eventData.occurredAt),
                        generatedBy: eventData.generatedBy === "llm"
                            ? "llm" as const
                            : eventData.generatedBy === "manual" ? "manual" as const : null,
                    })),
                    // `liveBlueprintEvents`, not the raw slice: an event whose component was deleted is
                    // no longer part of the study, which is the rule the timeline track uses too.
                    blueprintEvents: liveBlueprintEvents.map((eventData) => ({
                        id: eventData.id,
                        name: eventData.name,
                        occurredAtIso: toIsoDateString(eventData.occurredAt),
                        componentNodeId: typeof eventData.componentNodeId === "string"
                            ? eventData.componentNodeId
                            : null,
                        paperTitle: eventData.paperTitle ?? null,
                        referenceCitation: eventData.referenceCitation ?? null,
                    })),
                    codebaseSubtracks: codebaseSubtracks.map((subtrack) => ({
                        id: subtrack.id,
                        name: subtrack.name,
                        filePaths: Array.isArray(subtrack.filePaths) ? subtrack.filePaths : [],
                        // Carried, because a finished subtrack narrated as live is a small lie.
                        inactive: subtrack.inactive === true,
                    })),
                    // Instants only. A marker's image is a multi-megabyte data URL, and inlining one is
                    // what made the old export unreadable by every other markdown tool.
                    screenshotMarkers: systemScreenshotMarkers.map((marker) => ({
                        id: marker.id,
                        occurredAtIso: toIsoDateString(marker.occurredAt),
                        zoneCount: Array.isArray(marker.zones) ? marker.zones.length : 0,
                    })),
                    llmModel: llmModel ?? null,
                },
                files: reportFiles,
            };

            // One derivation of the report's graph, shared by the numbering and the document. Computed
            // twice, the index could cluster one graph and the prose another, and `P1` would name two
            // different phases in one file.
            const reportContext = buildReportGraphContext(snapshot);

            const codes = buildLocatorIndex({
                nodes,
                edges,
                files: reportFiles.map((file) => ({
                    sha256: file.sha256,
                    name: file.name,
                    createdAt: file.createdAtIso,
                })),
                timeline: {
                    stages: reportStages.map((stage) => ({
                        id: stage.id,
                        name: stage.name,
                        start: stage.startIso,
                        end: stage.endIso,
                    })),
                    designStudyEvents: snapshot.timeline.designStudyEvents.map((eventData) => ({
                        id: eventData.id,
                        name: eventData.name,
                        occurredAt: eventData.occurredAtIso,
                    })),
                },
                // Both of these are computed over the whole live graph with no label chip, no query and
                // no playhead applied. Phase codes are only meaningful under exactly those conditions —
                // see `LOCATOR_PHASE_CONTRACT` — so the report reproduces them rather than reusing the
                // canvas memos, which are scoped to whatever the researcher last clicked.
                membership: reportContext.membership,
                clusters: reportContext.clusters,
                asOf: { version: null, capturedAt: capturedAtIso },
            });

            /**
             * The abstract, written from the requirements and the concepts.
             *
             * Requested every time, and never allowed to block: the deterministic document is already
             * complete when this runs, so a refused or unavailable paragraph costs one italic line
             * rather than an export. `acceptAbstract` throws the whole paragraph away if it cites a
             * code the payload never contained, because a fabricated citation is the one failure a
             * reader cannot check for themselves.
             */
            let abstract: ReportAbstract | null = null;
            try {
                const model = buildReportModel(snapshot, codes, reportContext);
                const payload = buildAbstractPayload(model);
                const raw = await requestReportAbstractLLM(payload, llmModel ?? undefined);
                const prose = acceptAbstract(raw, new Set(codes.entries.map((entry) => entry.code)));
                if (prose !== null) {
                    abstract = { prose, model: llmModel ?? "unknown", prompt: "ReportAbstract" };
                } else {
                    showCanvasNotice(
                        "The report was exported without a written abstract: the model's paragraph"
                        + " referred to something this project does not contain.",
                    );
                }
            } catch (caught) {
                const reason = caught instanceof Error ? caught.message : "the request failed";
                showCanvasNotice(`The report was exported without a written abstract (${reason}).`);
            }

            const report = buildProjectReport(snapshot, {
                codes,
                canvasUrlForCode: (code) => codeToUrl(codes, code, {
                    projectId,
                    basename: resolveRouterBasename(),
                    origin: window.location.origin,
                    // Pinned, so a citation keeps showing what was cited.
                    at: capturedAtIso,
                }),
                abstract,
                includeAppendices: true,
            });

            const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = report.fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (caught) {
            // A notice rather than `window.alert`: this is a canvas action and the canvas has a place
            // to say so. The old handler's alert was the only signal that anything had gone wrong.
            const message = caught instanceof Error ? caught.message : "Could not build the report.";
            showCanvasNotice(`The report could not be exported. ${message}`);
        } finally {
            setExportingMarkdown(false);
        }
        })();
    }, [
        allFiles,
        codebaseSubtracks,
        designStudyEvents,
        edges,
        exportingMarkdown,
        knowledgeProvenanceTriggerKey,
        latestCanvasChangeTime,
        liveBlueprintEvents,
        llmModel,
        nodes,
        participants,
        projectGoal,
        projectId,
        showCanvasNotice,
        systemScreenshotMarkers,
        timelineStages,
        timelineStartEnd.end,
        timelineStartEnd.start,
        title,
    ]);

    const handleExportProject = useCallback(() => {
        if (exportingProject) return;

        const includeGithubData = window.confirm(
            "Include GitHub commit/event history in this .vi export?\n\n" +
            "Press OK to include the GitHub commit timeline and repository snapshot file list.\n" +
            "Press Cancel to export without that GitHub history.\n\n" +
            "Note: your timeline and any codebase files pinned to tracks are always included."
        );

        setExportingProject(true);

        void (async () => {
            try {
                const blob = await exportProjectVi(projectId, { includeGithubData });
                const projectTitle = title?.trim() || "project";
                const safeName = projectTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "") || "project";
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${safeName}.vi`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : "Failed to export project.";
                window.alert(message);
            } finally {
                setExportingProject(false);
            }
        })();
    }, [exportingProject, projectId, title]);

    const handleToggleLabelWithQueryRefresh = useCallback((label: cardLabel) => {
        setSelectedLabels((prev) => {
            const next = prev.includes(label)
                ? prev.filter((current) => current !== label)
                : [...prev, label];

            if (activeQuery.trim().length > 0) {
                const scopeNodeIds = computeLabelScopedNodeIds(next);
                void runNaturalLanguageQuery(activeQuery, scopeNodeIds);
            }

            return next;
        });
    }, [activeQuery, computeLabelScopedNodeIds, runNaturalLanguageQuery]);

    const handleResetNodePositions = useCallback(() => {
        queuedPositionChangesRef.current = [];
        if (nodeChangeRafRef.current !== null) {
            window.cancelAnimationFrame(nodeChangeRafRef.current);
            nodeChangeRafRef.current = null;
        }
        setManualNodePositions({});
    }, []);

    const handleToggleBlueprintComponents = useCallback(() => {
        setBlueprintComponentsVisible((previous) => !previous);
    }, []);

    const handleToggleModelDerived = useCallback(() => {
        setModelDerivedVisible((previous) => !previous);
    }, []);

    const handleToggleAuthored = useCallback(() => {
        setAuthoredVisible((previous) => !previous);
    }, []);

    const handleToggleTimeline = useCallback(() => {
        setTimelineOpen((prev) => !prev);
    }, []);

    const handleSetTitle = useCallback((newTitle: string) => {
        if (interactionLocked) return;
        void updateDocumentMeta(projectId, { title: newTitle });
    }, [interactionLocked, projectId]);

    const handleOpenSettings = useCallback(() => {
        navigate(`/project/${projectId}/setup`);
    }, [navigate, projectId]);

    const handleGoHome = useCallback(() => {
        navigate("/projects");
    }, [navigate]);

    /**
     * Clicking a timeline entity to see the card it is about (contract 11).
     *
     * Routed through `requestNodeFocus` rather than calling `fitView` itself, so it waits for the
     * node to be laid out, says so out loud when it never appears, and stands the whole-graph refits
     * down while it moves. It used to call `fitView({nodes: [...]})` directly, which quietly did
     * nothing whenever anything else refit in the same tick — see the note in the effect that
     * consumes `pendingCanvasFocus`.
     */
    const focusNodeById = useCallback((targetNodeId: string) => {
        requestNodeFocus(targetNodeId, "fit");
    }, [requestNodeFocus]);

    const handleKnowledgeEventNavigate = useCallback((eventData: KnowledgeBaseEvent) => {
        const candidateIds: string[] = [];
        const treeId = typeof eventData.treeId === "string" ? eventData.treeId.trim() : "";
        if (treeId) candidateIds.push(treeId);

        const cardEvents = Array.isArray(eventData.events) ? eventData.events : [];
        for (const cardEvent of cardEvents) {
            const nodeId = typeof cardEvent.nodeId === "string" ? cardEvent.nodeId.trim() : "";
            if (!nodeId) continue;
            candidateIds.push(nodeId);
        }

        if (candidateIds.length === 0) return;

        const existingNodeIds = new Set(nodes.map((node) => String(node.id ?? "")));
        const targetNodeId = candidateIds.find((nodeId) => existingNodeIds.has(nodeId));
        if (!targetNodeId) return;

        focusNodeById(targetNodeId);
    }, [focusNodeById, nodes]);

    /**
     * Clicking a Blueprint marker to see the component it stands for.
     *
     * The canvas draws a component only while it answers a requirement that is itself on screen
     * (contract 28), and the track now marks **every** component from the moment it is made — so most
     * markers name something the canvas will not show. Asking the camera to go there anyway would
     * spend the four-second focus deadline finding nothing and then blame a filter, which is the one
     * explanation that is certainly wrong. It is refused here instead, with the actual reason.
     */
    const handleBlueprintEventNavigate = useCallback((eventData: BlueprintEvent) => {
        const componentNodeId = typeof eventData.componentNodeId === "string"
            ? eventData.componentNodeId.trim()
            : "";
        if (!componentNodeId) return;

        const componentNode = nodes.find((node) => node.id === componentNodeId);
        if (!componentNode || !isNodeActive(componentNode)) return;

        if (!trayAttachedComponentIds.has(componentNodeId)) {
            showCanvasNotice(
                `"${eventData.name || "This component"}" answers no requirement yet, so the canvas does`
                + " not draw it. Open the blueprint tray to work on it, or drag it onto a requirement"
                + " to bring it onto the canvas.",
            );
            return;
        }

        focusNodeById(componentNodeId);
    }, [focusNodeById, nodes, showCanvasNotice, trayAttachedComponentIds]);

    const handleFreeInputClicked = useCallback(() => {
        if (interactionLocked) return;
        setCursorMode("text");
    }, [interactionLocked]);

    const handleNodeInputClicked = useCallback(() => {
        if (interactionLocked) return;
        setCursorMode("node");
    }, [interactionLocked]);

    const handlePointerClicked = useCallback(() => {
        setCursorMode("");
    }, []);

    const handleStageUpdate = useCallback((stage: Stage) => {
        if (interactionLocked) return;
        dispatch(updateStage({
            ...stage,
            start: fromDate(stage.start),
            end: fromDate(stage.end),
        }));
    }, [dispatch, interactionLocked]);

    const handleStageCreation = useCallback((name: string) => {
        if (interactionLocked) return;
        dispatch(addDefaultStage(name));
    }, [dispatch, interactionLocked]);

    const handleStageLaneCreation = useCallback((name: string) => {
        if (interactionLocked) return;
        dispatch(addStage(name));
    }, [dispatch, interactionLocked]);

    const handleStageLaneDeletion = useCallback((id: string) => {
        if (interactionLocked) return;
        dispatch(deleteStage(id));
    }, [dispatch, interactionLocked]);

    const handleStageBoundaryChange = useCallback((prevId: string, nextId: string, date: Date) => {
        if (interactionLocked) return;
        dispatch(changeStageBoundary({
            prevId,
            nextId,
            date: fromDate(date),
        }));
    }, [dispatch, interactionLocked]);

    const handleSyncCodebaseEvents = useCallback(async () => {
        if (interactionLocked) return;
        await checkGitStatus();
    }, [checkGitStatus, interactionLocked]);

    const handleAddSystemScreenshotMarker = useCallback(() => {
        if (interactionLocked) return;
        const markerOccurredAt = resolveActionTimestamp();
        dispatch(addSystemScreenshotMarker({
            id: crypto.randomUUID(),
            occurredAt: markerOccurredAt,
            imageDataUrl: "",
        }));
    }, [dispatch, interactionLocked, resolveActionTimestamp]);

    const handleUploadSystemScreenshotForLatestMarker = useCallback(async (file: File) => {
        if (interactionLocked) return;
        setProcessingSystemScreenshot(true);
        try {
            const imageDataUrl = await readImageFileAsDataUrl(file);
            const { width: imageWidth, height: imageHeight } = await readImageDimensionsFromDataUrl(imageDataUrl);

            const markerOccurredAt = resolveActionTimestamp();
            let markerId = playbackAwareSystemScreenshotMarker?.id;
            if (!markerId) {
                markerId = crypto.randomUUID();
                dispatch(addSystemScreenshotMarker({
                    id: markerId,
                    occurredAt: markerOccurredAt,
                    imageDataUrl,
                    imageWidth,
                    imageHeight,
                    zones: [],
                }));
            } else {
                dispatch(updateSystemScreenshotMarkerImage({
                    markerId,
                    imageDataUrl,
                    imageWidth,
                    imageHeight,
                    zones: [],
                }));
            }

            const zones = await requestSystemScreenshotZonesLLM({
                projectId,
                projectTitle: title?.trim() || "Untitled",
                projectGoal: projectGoal?.trim() || "",
                imageDataUrl,
                imageWidth,
                imageHeight,
                codebaseSubtracks: codebaseSubtracks.map((subtrack) => ({
                    id: subtrack.id,
                    name: subtrack.name,
                    filePaths: Array.isArray(subtrack.filePaths) ? subtrack.filePaths : [],
                })),
                llmModel,
            });

            dispatch(updateSystemScreenshotMarkerImage({
                markerId,
                zones,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load screenshot.";
            window.alert(message);
        } finally {
            setProcessingSystemScreenshot(false);
        }
    }, [codebaseSubtracks, dispatch, interactionLocked, llmModel, playbackAwareSystemScreenshotMarker?.id, projectGoal, projectId, resolveActionTimestamp, title]);

    const handleDeleteAsset = useCallback(async (file: { id: string; name: string }) => {
        if (interactionLocked) return;
        setDeletingAssetId(file.id);
        try {
            await deleteFile(projectId, file.id);
            dispatch(detachFileIdFromAllNodes(file.id));
            dispatch(removeFile(file.id));
            if (getHoveredAssetFileId() === file.id) {
                setHoveredAssetFileId(null);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete asset.";
            window.alert(message);
        } finally {
            setDeletingAssetId((current) => (current === file.id ? null : current));
        }
    }, [dispatch, interactionLocked, projectId]);

    const clearKnowledgeEditsAroundPlayback = useCallback((
        direction: "before" | "after",
        cutoffOverrideIso?: string
    ) => {
        // `interactionLocked`, not `reviewOnly`: this deletes edits, and it must be as closed to
        // somebody reading another account's published project as it is in review mode.
        if (interactionLocked) return;
        let cutoffIso = resolveActionTimestamp();
        if (typeof cutoffOverrideIso === "string" && cutoffOverrideIso.trim() !== "") {
            const parsedOverride = new Date(cutoffOverrideIso);
            if (!Number.isNaN(parsedOverride.getTime())) {
                cutoffIso = parsedOverride.toISOString();
            }
        }
        const rawCutoffMs = toTimestampMs(cutoffIso);
        if (rawCutoffMs === null) return;
        const cutoffMs = clampTimestampMsToRange(
            rawCutoffMs,
            timelineRangeStartMs,
            timelineRangeEndMs,
        );
        cutoffIso = toIsoFromTimestamp(cutoffMs);

        const knowledgeNodeIds = new Set(
            nodes
                .filter((node) => isKnowledgeCardNode(node))
                .map((node) => node.id)
        );
        if (knowledgeNodeIds.size === 0) return;

        const nextNodes: nodeType[] = [];

        for (const node of nodes) {
            const shouldProcessNode = knowledgeNodeIds.has(node.id) || direction === "after";
            if (!shouldProcessNode) {
                nextNodes.push(node);
                continue;
            }

            const currentData = nodeDataRecord(node);
            const history = normalizeNodeHistoryEntries(node);
            const createdAtMs = toTimestampMs(currentData.createdAt);
            const inferredCreatedAtMs = history.length > 0 ? history[0].atMs : null;
            const effectiveCreatedAtMs = createdAtMs ?? inferredCreatedAtMs;
            const deletedAtMs = toTimestampMs(currentData.deletedAt);

            if (direction === "before") {
                const createdAfterCutoff = effectiveCreatedAtMs !== null && effectiveCreatedAtMs > cutoffMs;
                const activeAtCutoff =
                    (effectiveCreatedAtMs === null || effectiveCreatedAtMs <= cutoffMs) &&
                    (deletedAtMs === null || deletedAtMs > cutoffMs);

                if (createdAfterCutoff) {
                    const trimmedHistory = history.filter((entry) => entry.atMs >= cutoffMs);
                    const nextData = stripNodeMeta(currentData);
                    if (effectiveCreatedAtMs !== null) {
                        nextData.createdAt = toIsoFromTimestamp(effectiveCreatedAtMs);
                    }
                    if (deletedAtMs !== null) {
                        nextData.deletedAt = toIsoFromTimestamp(deletedAtMs);
                    } else {
                        delete nextData.deletedAt;
                    }
                    nextNodes.push({
                        ...node,
                        data: {
                            ...(nextData as nodeType["data"]),
                            [NODE_HISTORY_KEY]: serializeNodeHistoryEntries(trimmedHistory),
                        } as nodeType["data"],
                    });
                    continue;
                }

                if (!activeAtCutoff) {
                    continue;
                }

                const resolvedAtCutoff = resolveNodeAtPlayback(node, cutoffMs);
                const resolvedData = stripNodeMeta(nodeDataRecord(resolvedAtCutoff));
                const futureHistory = history
                    .filter((entry) => entry.atMs > cutoffMs)
                    .map((entry) => {
                        if (entry.kind !== "data") return entry;
                        const nextEntryData = stripNodeMeta(entry.data ?? {});
                        nextEntryData.createdAt = cutoffIso;
                        return {
                            ...entry,
                            data: nextEntryData,
                        };
                    });
                const rebasedCurrentData = stripNodeMeta(currentData);
                rebasedCurrentData.createdAt = cutoffIso;
                if (deletedAtMs !== null && deletedAtMs > cutoffMs) {
                    rebasedCurrentData.deletedAt = toIsoFromTimestamp(deletedAtMs);
                } else {
                    delete rebasedCurrentData.deletedAt;
                }
                const rebasedBaselineData: Record<string, unknown> = {
                    ...resolvedData,
                    createdAt: cutoffIso,
                };
                if (deletedAtMs !== null && deletedAtMs > cutoffMs) {
                    rebasedBaselineData.deletedAt = toIsoFromTimestamp(deletedAtMs);
                } else {
                    delete rebasedBaselineData.deletedAt;
                }

                const rebasedHistory: ParsedNodeHistoryEntry[] = [
                    {
                        atIso: cutoffIso,
                        atMs: cutoffMs,
                        kind: "data",
                        data: rebasedBaselineData,
                    },
                    {
                        atIso: cutoffIso,
                        atMs: cutoffMs,
                        kind: "position",
                        position: {
                            x: resolvedAtCutoff.position.x,
                            y: resolvedAtCutoff.position.y,
                        },
                    },
                    ...futureHistory,
                ];

                nextNodes.push({
                    ...node,
                    data: {
                        ...(rebasedCurrentData as nodeType["data"]),
                        [NODE_HISTORY_KEY]: serializeNodeHistoryEntries(rebasedHistory),
                    } as nodeType["data"],
                });
                continue;
            }

            const createdAfterCutoff = effectiveCreatedAtMs !== null && effectiveCreatedAtMs > cutoffMs;
            if (createdAfterCutoff) {
                continue;
            }
            const activeAtCutoff =
                (effectiveCreatedAtMs === null || effectiveCreatedAtMs <= cutoffMs) &&
                (deletedAtMs === null || deletedAtMs > cutoffMs);
            if (!activeAtCutoff) {
                continue;
            }

            const resolvedAtCutoff = resolveNodeAtPlayback(node, cutoffMs);
            const resolvedData = stripNodeMeta(nodeDataRecord(resolvedAtCutoff));
            const createdAtIso = effectiveCreatedAtMs === null ? cutoffIso : toIsoFromTimestamp(effectiveCreatedAtMs);
            const trimmedHistory = history
                .filter((entry) => entry.atMs <= cutoffMs)
                .map((entry) => {
                    if (entry.kind !== "data") return entry;
                    const nextEntryData = stripNodeMeta(entry.data ?? {});
                    nextEntryData.createdAt = createdAtIso;
                    return {
                        ...entry,
                        data: nextEntryData,
                    };
                });

            let finalHistory = trimmedHistory;
            if (finalHistory.length === 0) {
                finalHistory = [
                    {
                        atIso: createdAtIso,
                        atMs: cutoffMs,
                        kind: "data",
                        data: {
                            ...resolvedData,
                            createdAt: createdAtIso,
                        },
                    },
                    {
                        atIso: createdAtIso,
                        atMs: cutoffMs,
                        kind: "position",
                        position: {
                            x: resolvedAtCutoff.position.x,
                            y: resolvedAtCutoff.position.y,
                        },
                    },
                ];
            }

            const nextNodeData: Record<string, unknown> = {
                ...resolvedData,
                createdAt: createdAtIso,
            };
            delete nextNodeData.deletedAt;

            nextNodes.push({
                ...node,
                position: {
                    x: resolvedAtCutoff.position.x,
                    y: resolvedAtCutoff.position.y,
                },
                data: {
                    ...(nextNodeData as nodeType["data"]),
                    [NODE_HISTORY_KEY]: serializeNodeHistoryEntries(finalHistory),
                } as nodeType["data"],
            });
        }

        const nextNodeIdSet = new Set(nextNodes.map((node) => node.id));
        const nextEdges: edgeType[] = [];
        for (const edge of edges) {
            const relatedToKnowledge =
                knowledgeNodeIds.has(edge.source) ||
                knowledgeNodeIds.has(edge.target);
            if (!relatedToKnowledge && direction === "before") {
                if (!nextNodeIdSet.has(edge.source) || !nextNodeIdSet.has(edge.target)) {
                    continue;
                }
                nextEdges.push(edge);
                continue;
            }

            const edgeData = edgeDataRecord(edge);
            const createdAtMs = toTimestampMs(edgeData.createdAt);
            const deletedAtMs = toTimestampMs(edgeData.deletedAt);

            if (direction === "before") {
                const createdAfterCutoff = createdAtMs !== null && createdAtMs > cutoffMs;
                const activeAtCutoff =
                    (createdAtMs === null || createdAtMs <= cutoffMs) &&
                    (deletedAtMs === null || deletedAtMs > cutoffMs);
                if (!createdAfterCutoff && !activeAtCutoff) {
                    continue;
                }
                const nextEdgeData = { ...edgeData };
                if (!createdAfterCutoff) {
                    nextEdgeData.createdAt = cutoffIso;
                } else if (createdAtMs !== null) {
                    nextEdgeData.createdAt = toIsoFromTimestamp(createdAtMs);
                }
                if (deletedAtMs !== null && deletedAtMs > cutoffMs) {
                    nextEdgeData.deletedAt = toIsoFromTimestamp(deletedAtMs);
                } else {
                    delete nextEdgeData.deletedAt;
                }
                if (!nextNodeIdSet.has(edge.source) || !nextNodeIdSet.has(edge.target)) {
                    continue;
                }
                nextEdges.push({
                    ...edge,
                    data: nextEdgeData,
                });
                continue;
            }

            if (createdAtMs !== null && createdAtMs > cutoffMs) {
                continue;
            }
            if (deletedAtMs !== null && deletedAtMs <= cutoffMs) {
                continue;
            }

            const nextEdgeData = { ...edgeData };
            if (createdAtMs !== null) {
                nextEdgeData.createdAt = toIsoFromTimestamp(createdAtMs);
            }
            if (deletedAtMs !== null && deletedAtMs > cutoffMs) {
                delete nextEdgeData.deletedAt;
            }
            if (!nextNodeIdSet.has(edge.source) || !nextNodeIdSet.has(edge.target)) {
                continue;
            }
            nextEdges.push({
                ...edge,
                data: nextEdgeData,
            });
        }

        dispatch(setNodes(nextNodes));
        dispatch(setEdges(nextEdges));

        const nextKnowledgeNodes = nextNodes.filter((node) => isKnowledgeCardNode(node));
        const nextKnowledgeNodeIdSet = new Set(nextKnowledgeNodes.map((node) => node.id));
        const nextKnowledgeDeletedNodeIdSet = new Set<string>();
        const nextKnowledgeCreatedAtByNodeId = new Map<string, string>();
        for (const node of nextKnowledgeNodes) {
            const nodeData = nodeDataRecord(node);
            const createdAtMs = toTimestampMs(nodeData.createdAt);
            if (createdAtMs !== null) {
                nextKnowledgeCreatedAtByNodeId.set(node.id, toIsoFromTimestamp(createdAtMs));
            }
            if (toTimestampMs(nodeData.deletedAt) !== null) {
                nextKnowledgeDeletedNodeIdSet.add(node.id);
            }
        }

        setKnowledgeCreationEvents((previous) => previous
            .filter((eventData) => nextKnowledgeNodeIdSet.has(String(eventData.nodeId ?? "")))
            .map((eventData) => {
                const nodeId = String(eventData.nodeId ?? "");
                const nextOccurredAt = nextKnowledgeCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt;
                const isDeleted = nextKnowledgeDeletedNodeIdSet.has(nodeId);
                const metadata = isRecordValue(eventData.metadata) ? eventData.metadata : {};
                return {
                    ...eventData,
                    occurredAt: nextOccurredAt,
                    isDeleted,
                    metadata: {
                        ...metadata,
                        deleted: isDeleted,
                    },
                };
            })
            .sort((a, b) => {
                const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                if (delta !== 0) return delta;
                return a.id.localeCompare(b.id);
            })
        );
        setLocalDeletedKnowledgeCreationEvents((previous) => previous
            .filter((eventData) => nextKnowledgeDeletedNodeIdSet.has(String(eventData.nodeId ?? "")))
            .map((eventData) => {
                const nodeId = String(eventData.nodeId ?? "");
                const nextOccurredAt = nextKnowledgeCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt;
                return {
                    ...eventData,
                    occurredAt: nextOccurredAt,
                };
            })
            .sort((a, b) => {
                const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                if (delta !== 0) return delta;
                return a.id.localeCompare(b.id);
            })
        );
        setKnowledgePills((previous) => {
            const nextPills: KnowledgePill[] = [];
            for (const pill of previous) {
                const nextEvents = Array.isArray(pill.events)
                    ? pill.events
                        .filter((eventData) => nextKnowledgeNodeIdSet.has(String(eventData.nodeId ?? "")))
                        .map((eventData) => {
                            const nodeId = String(eventData.nodeId ?? "");
                            const nextOccurredAt = nextKnowledgeCreatedAtByNodeId.get(nodeId) ?? eventData.occurredAt;
                            return {
                                ...eventData,
                                occurredAt: nextOccurredAt,
                                isDeleted: nextKnowledgeDeletedNodeIdSet.has(nodeId),
                            };
                        })
                    : [];
                if (nextEvents.length === 0) continue;
                const earliestOccurredAt = nextEvents.reduce<string>((earliest, eventData) => {
                    if (!earliest) return eventData.occurredAt;
                    const currentTime = new Date(eventData.occurredAt).getTime();
                    const earliestTime = new Date(earliest).getTime();
                    return currentTime < earliestTime ? eventData.occurredAt : earliest;
                }, "");
                nextPills.push({
                    ...pill,
                    occurredAt: earliestOccurredAt || pill.occurredAt,
                    events: nextEvents,
                });
            }
            return nextPills;
        });
        setKnowledgeCrossTreeConnections((previous) => previous.filter((connection) => (
            nextKnowledgeNodeIdSet.has(connection.sourceNodeId) &&
            nextKnowledgeNodeIdSet.has(connection.targetNodeId)
        )));
        setKnowledgeBlueprintLinks((previous) => previous.filter((connection) => (
            nextKnowledgeNodeIdSet.has(connection.cardNodeId)
        )));
    }, [dispatch, edges, interactionLocked, nodes, resolveActionTimestamp, timelineRangeEndMs, timelineRangeStartMs]);

    const handleClearKnowledgePreviousEdits = useCallback((cutoffIso?: string) => {
        clearKnowledgeEditsAroundPlayback("before", cutoffIso);
    }, [clearKnowledgeEditsAroundPlayback]);

    const handleClearKnowledgeNextEdits = useCallback((cutoffIso?: string) => {
        clearKnowledgeEditsAroundPlayback("after", cutoffIso);
    }, [clearKnowledgeEditsAroundPlayback]);

    const handlePlaybackAtChange = useCallback((value: string | null) => {
        if (!value) {
            setPlaybackAt(null);
            return;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return;
        setPlaybackAt(parsed.toISOString());
    }, []);

    // `FlowCanvas` is memoised, and a fresh element here defeated it: every one of this component's
    // state setters — a keystroke in the chat box, an asset hover, a knowledge pill arriving from the
    // network — re-rendered the whole `<ReactFlow>` subtree with it. Every dependency below is either
    // a `useCallback` or changes only on a deliberate user action.
    const levelControlElement = useMemo(() => (
        <CanvasLevelControl
            level={canvasLevel}
            followZoom={levelFollowsZoom}
            onLevelChange={handleCanvasLevelChange}
            onFollowZoomChange={handleLevelFollowsZoomChange}
            focusLabel={canvasFocusLabel}
            onClearFocus={handleClearCanvasFocus}
            onGoToCode={handleGoToLocatorCode}
            shifted={timelineOpen}
            chatOpen={chatOpen}
            onOpenChat={handleOpenChat}
        />
    ), [
        canvasLevel,
        levelFollowsZoom,
        handleCanvasLevelChange,
        handleLevelFollowsZoomChange,
        canvasFocusLabel,
        handleClearCanvasFocus,
        handleGoToLocatorCode,
        timelineOpen,
        chatOpen,
        handleOpenChat,
    ]);

    if (status === "loading") return <div>Loading...</div>;
    if (status === "error") return <div>Error: {error}</div>;

    const canvasSidebarBottomOffset = timelineOpen
        ? TIMELINE_DOCK_HEIGHT + TIMELINE_DOCK_TOGGLE_HEIGHT
        : 0;

    return (
        <>
            <CanvasHighlightBridge />

            <FlowCanvas
                projectId={projectId}
                nodes={displayedNodes}
                edges={displayedEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={!interactionLocked}
                cursorMode={cursorMode}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onBeforeDelete={handleBeforeDelete}
                onClick={onCanvasClick}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                activityDropTargets={activityDropTargets}
                clusterHalos={clusterHalos}
                cardSpawnTargets={cardSpawnTargets}
                activityDropReason={activityDropReason ?? "drag"}
                onResetNodePositions={hasManualNodePositions ? handleResetNodePositions : null}
                miniMapBottomOffsetPx={canvasSidebarBottomOffset + (canvasFocusLabel
                    ? MINIMAP_LEVEL_PANEL_FOCUSED_CLEARANCE_PX
                    : MINIMAP_LEVEL_PANEL_CLEARANCE_PX)}
                miniMapRightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX}
                onMove={handleViewportMove}
                levelControlRightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX}
                levelControl={levelControlElement}
            />

            <EdgeConnectMenu
                x={pendingConnectionMenu?.x ?? 0}
                y={pendingConnectionMenu?.y ?? 0}
                defaultLabel={pendingConnectionMenu?.defaultLabel ?? "related to"}
                open={!interactionLocked && pendingConnectionMenu !== null}
                onClose={() => setPendingConnectionMenu(null)}
                onSelect={handleConnectSelection}
            />

            <EdgeConnectMenu
                x={pendingFileDropMenu?.x ?? 0}
                y={pendingFileDropMenu?.y ?? 0}
                defaultLabel={pendingFileDropMenu?.defaultLabel ?? "generated by"}
                heading={pendingFileDropMenu
                    ? `Connect ${pendingFileDropMenu.files.length} ${pendingFileDropMenu.files.length === 1 ? "card" : "cards"} to “${pendingFileDropMenu.anchorTitle}” with:`
                    : undefined}
                open={!interactionLocked && pendingFileDropMenu !== null}
                onCancel={() => setPendingFileDropMenu(null)}
                onClose={() => setPendingFileDropMenu(null)}
                onSelect={handleFileDropConnectSelection}
            />

            <EdgeConnectMenu
                x={pendingCardSpawnMenu?.x ?? 0}
                y={pendingCardSpawnMenu?.y ?? 0}
                defaultLabel={pendingCardSpawnMenu?.target.relationLabel ?? "related to"}
                heading={pendingCardSpawnMenu
                    ? `Connect a new ${pendingCardSpawnMenu.target.spawnLabel} to “${pendingCardSpawnMenu.target.anchorTitle}” with:`
                    : undefined}
                open={!interactionLocked && pendingCardSpawnMenu !== null}
                onCancel={() => setPendingCardSpawnMenu(null)}
                onClose={() => setPendingCardSpawnMenu(null)}
                onSelect={handleCardSpawnSelection}
            />

            <CanvasNotice
                message={canvasNotice?.message ?? null}
                noticeId={canvasNotice?.id ?? 0}
                onDismiss={dismissCanvasNotice}
                /* Steps below the file-processing banner, which owns this slot when it is up. */
                topOffsetPx={fileProcessingError ? 116 : 64}
            />

            <CanvasSidebar
                title={title}
                onSetTitle={handleSetTitle}
                onGoHome={handleGoHome}
                onOpenSettings={interactionLocked ? undefined : handleOpenSettings}
                onExportProject={handleExportProject}
                exportingProject={exportingProject}
                onExportMarkdown={handleExportMarkdown}
                exportingMarkdown={exportingMarkdown}
                bottomOffsetPx={canvasSidebarBottomOffset}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                blueprintComponentsVisible={blueprintComponentsVisible}
                onToggleBlueprintComponents={handleToggleBlueprintComponents}
                modelDerivedVisible={modelDerivedVisible}
                authoredVisible={authoredVisible}
                onToggleAuthored={handleToggleAuthored}
                onToggleModelDerived={handleToggleModelDerived}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabelWithQueryRefresh}
            />

            {/*
              * The blueprint tray, docked bottom-left.
              *
              * Always mounted, and merely translated away when closed: the tray holds its own React
              * Flow viewport and the search results, and unmounting would throw both away every time
              * the researcher glanced at the canvas underneath. `content-visibility: hidden` makes
              * that free — the whole subtree is skipped for layout, style and paint while it is off
              * screen. Same reasoning as `TimelineDock`.
              *
              * It sits under the left sidebar rather than over the canvas centre, because the attach
              * gesture is a drag from here onto a card: a panel covering the canvas would be
              * covering its own drop target.
              */}
            <BlueprintTray
                open={trayOpen}
                onToggleOpen={() => setTrayOpen((previous) => !previous)}
                interactionLocked={interactionLocked}
                bottomOffsetPx={canvasSidebarBottomOffset}
                requirementCards={requirementSearchCards}
                selectedRequirementCards={selectedRequirementCards}
                resolveActionTimestamp={resolveActionTimestamp}
                onDeleteNodes={onDeleteNodes}
            />

            {!trayOpen ? (
                <button
                    type="button"
                    className={trayStyles.reopen}
                    style={{ bottom: canvasSidebarBottomOffset + 12 }}
                    onClick={() => setTrayOpen(true)}
                    title="Open the blueprint tray"
                >
                    <FontAwesomeIcon icon={faDiagramProject} />
                    <span>Blueprint</span>
                    {trayComponentCount > 0 ? (
                        <span className={trayStyles.reopenCount}>{trayComponentCount}</span>
                    ) : null}
                </button>
            ) : null}

            {fileProcessingError ? (
                <div
                    style={{
                        position: "fixed",
                        // Clear of the "Reset card positioning" panel, which owns the top edge.
                        top: 64,
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 41,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        maxWidth: 520,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #e3c9c9",
                        background: "#fdf3f3",
                        color: "#8a2f2f",
                        fontSize: 13,
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
                    }}
                >
                    <span>File attached. {fileProcessingError}</span>
                    <button
                        type="button"
                        onClick={() => setFileProcessingError(null)}
                        aria-label="Dismiss"
                        style={{
                            border: 0,
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            fontWeight: 700,
                            fontSize: 15,
                            lineHeight: 1,
                        }}
                    >
                        x
                    </button>
                </div>
            ) : null}

            {interactionLocked ? (
                <div
                    style={{
                        position: "fixed",
                        top: 12,
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 40,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #dedede",
                        background: "#fff8ef",
                        color: "#7a4a14",
                        fontSize: 13,
                        fontWeight: 600,
                        pointerEvents: "none",
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
                    }}
                >
                    {/* Two different reasons, two different things the reader can do about it. */}
                    {reviewOnly
                        ? "You are in review mode. No editing allowed."
                        : sessionUser
                            ? `Published by ${ownerUsername ?? "another account"}. Read-only — duplicate it to make changes.`
                            // A guest has no account to duplicate it into, so pointing them at
                            // Duplicate would name a button that is not on their screen.
                            : `Published by ${ownerUsername ?? "another account"}. Read-only.`}
                </div>
            ) : null}

            {/* The publish toggle, offered only to the person who can actually act on it — never
                for a guest project (no account behind it to publish under), and never to a viewer
                without an account. */}
            {isOwner && sessionUser && !reviewOnly && status === "ready" && !isLocalProjectId(projectId) ? (
                <button
                    type="button"
                    onClick={() => void handleTogglePublished()}
                    disabled={publishBusy}
                    style={{
                        position: "fixed",
                        top: 12,
                        right: RIGHT_SIDEBAR_WIDTH_PX + 12,
                        zIndex: 40,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: publishedState ? "1px solid #b7ddc4" : "1px solid #c9c9c9",
                        background: publishedState ? "#dcf1e3" : "#ffffff",
                        color: publishedState ? "#2f6b40" : "#444",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: publishBusy ? "default" : "pointer",
                        opacity: publishBusy ? 0.6 : 1,
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
                    }}
                    title={publishedState
                        ? "This project is visible to every account under Public projects. You can still edit it."
                        : "Make this project visible to every account, read-only for them."}
                >
                    {publishBusy
                        ? (publishedState ? "Unpublishing..." : "Publishing...")
                        : (publishedState ? "Published" : "Publish")}
                </button>
            ) : null}

            {/* <div style={{ position: "fixed", right: "350px", top: "30px", opacity: 0.5 }}>
                <img src="/vitral/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div> */}

            {!interactionLocked ? (
                <Toolbar
                    onFreeInputClicked={handleFreeInputClicked}
                    onNodeInputClicked={handleNodeInputClicked}
                    onPointerClicked={handlePointerClicked}
                    activeMode={cursorMode}
                    shifted={timelineOpen}
                />
            ) : null}

            <SystemScreenshotPanel
                rightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX + 12}
                latestImageDataUrl={playbackAwareSystemScreenshotMarker?.imageDataUrl ?? ""}
                processing={processingSystemScreenshot}
                readOnly={interactionLocked}
                onAddMarker={handleAddSystemScreenshotMarker}
                onUploadForLatestMarker={handleUploadSystemScreenshotForLatestMarker}
            />

            <RightSidebar
                projectId={projectId}
                connectionStatus={gitConnectionStatus}
                assetsRecords={allFiles}
                reviewOnly={reviewOnly}
                readOnly={interactionLocked}
                bottomOffsetPx={canvasSidebarBottomOffset}
                onAssetHover={setHoveredAssetFileId}
                deletingAssetId={deletingAssetId}
                onDeleteAsset={interactionLocked ? undefined : handleDeleteAsset}
            />

            <CanvasChatOverlay
                open={chatOpen}
                loading={chatLoading}
                error={chatError}
                filterActive={activeQuery.trim().length > 0}
                messages={chatMessages}
                onSend={handleSendChatMessage}
                onClose={() => setChatOpen(false)}
                onClearFilter={clearCanvasFilter}
            />

            {cursorMode === "text" && canvasIsEditable && !interactionLocked ? (
                <FreeInputZone participants={participants} onInputSubmit={onFreeInputSubmit} />
            ) : null}

            <LoadSpinner loading={loading} />

            <TimelineDock
                projectId={projectId}
                open={timelineOpen}
                onToggleOpen={handleToggleTimeline}
                closedBottomOffsetPx={interactionLocked
                    ? TIMELINE_TOGGLE_OFFSET_NO_TOOLBAR_PX
                    : TIMELINE_TOGGLE_OFFSET_WITH_TOOLBAR_PX}
                readOnly={interactionLocked}
                allowKnowledgeTrackClearMenu={!interactionLocked}
                startMarker={timelineStartEnd.start}
                endMarker={timelineStartEnd.end}
                projectName={title}
                projectGoal={projectGoal}
                codebaseEvents={gitEvents}
                knowledgeBaseEvents={knowledgeBaseEvents}
                knowledgeTreePills={normalizedKnowledgeTreePills}
                knowledgeCrossTreeConnections={filteredKnowledgeCrossTreeConnections}
                knowledgeBlueprintLinks={filteredKnowledgeBlueprintLinks}
                playbackAt={playbackAt}
                onPlaybackAtChange={handlePlaybackAtChange}
                onKnowledgeEventNavigate={handleKnowledgeEventNavigate}
                onBlueprintEventNavigate={handleBlueprintEventNavigate}
                onClearKnowledgePreviousEdits={handleClearKnowledgePreviousEdits}
                onClearKnowledgeNextEdits={handleClearKnowledgeNextEdits}
                designStudyEvents={designStudyEvents}
                blueprintEvents={liveBlueprintEvents}
                blueprintEventConnections={blueprintEventConnections}
                connectedBlueprintComponentNodeIds={connectedBlueprintComponentNodeIds}
                stages={timelineStages}
                defaultStages={defaultStages}
                onStageUpdate={handleStageUpdate}
                onStageCreation={handleStageCreation}
                onStageLaneCreation={handleStageLaneCreation}
                onStageLaneDeletion={handleStageLaneDeletion}
                onStageBoundaryChange={handleStageBoundaryChange}
                onSyncCodebaseEvents={handleSyncCodebaseEvents}
            />
        </>
    );
};

const FlowInner = () => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div>Missing project id</div>;

    return <FlowInnerWithProjectId projectId={projectId} />;
};

export function ProjectEditorPage() {
    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <ReactFlowProvider>
                <FlowInner />
            </ReactFlowProvider>
        </div>
    );
}
