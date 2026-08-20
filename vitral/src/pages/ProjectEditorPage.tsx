import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange, type NodeProps, type NodeTypes } from "@xyflow/react";

import type { AppDispatch, RootState } from "@/store";
import type {
    cardLabel,
    cardType,
    edgeType,
    llmCardData,
    llmConnectionData,
    nodeType,
    Stage,
    BlueprintComponent,
    BlueprintData,
    BlueprintEvent,
    BlueprintHighBlock,
    BlueprintIntermediate,
} from "@/config/types";

import { useDocumentSync } from "@/hooks/useDocumentSync";
import {
    llmCardsToNodes,
    llmConnectionsToEdges,
    requestCardsLLMTextInput,
    requestMarkdownReportSectionLLM,
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
    querySystemPapers,
    updateDocumentMeta,
    type KnowledgeBlueprintLink,
    type KnowledgeCrossTreeConnection,
    type KnowledgePillEvent,
    type KnowledgePill,
    type QuerySystemPapersResult,
} from "@/api/stateApi";
import { getGithubDocumentLink, githubStatus, type GitHubDocumentResponse } from "@/api/githubApi";
import { getGitHubEvents } from "@/api/eventsApi";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { FreeInputZone } from "@/components/toolbar/FreeInputZone";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { Card, type CardProps } from "@/components/cards/Card";
import { CARD_LABELS } from "@/components/cards/cardVisuals";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { CanvasSidebar } from "@/components/sidebar/CanvasSidebar";
import { RightSidebar } from "@/components/sidebar/RightSidebar";
import { BlueprintNode } from "@/components/blueprint/BlueprintNode";
import { BlueprintComponentNode } from "@/components/blueprint/BlueprintComponentNode";
import { BlueprintGroupNode } from "@/components/blueprint/BlueprintGroupNode";
import {
    BLUEPRINT_DRAG_MIME,
    parseBlueprintDragPayload,
    type BlueprintDragPayload,
} from "@/components/blueprint/blueprintDnD";

import {
    addNode,
    addNodes,
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
    addBlueprintEvent,
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
    selectHighlightedKnowledgeNodeIds,
    selectParticipants,
    selectLlmModel,
    selectSystemScreenshotMarkers,
    selectHoveredCodebaseFilePath,
    reconcileBlueprintCodebaseAutoLinks,
    selectTimelineStartEnd,
    updateBlueprintEvent,
    updateStage,
} from "@/store/timelineSlice";

import { isAllowedConnection, relationLabelFor } from "@/utils/relationships";
import { buildActivityOrbitLayout, buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import {
    connectionKindFromEdge,
    edgeLabelFrom,
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
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import { CanvasLevelControl } from "@/pages/projectEditor/CanvasLevelControl";
import { ClusterGlyph, type ClusterGlyphProps } from "@/components/cards/ClusterGlyph";
import { fromDate } from "@/pages/projectEditor/dateUtils";
import type { CursorMode, GitConnectionStatus } from "@/pages/projectEditor/types";
import {
    CARD_HEIGHT_PX,
    CARD_WIDTH_PX,
    findActivityDropTarget,
    getActivityDropTargets,
    nodeSizeOf,
} from "@/pages/projectEditor/canvasGeometry";
import type { ActivityDropRingsReason } from "@/pages/projectEditor/ActivityDropRings";
import { FlowCanvas } from "@/pages/projectEditor/FlowCanvas";
import { CanvasChatOverlay, type CanvasChatEntry } from "@/pages/projectEditor/CanvasChatOverlay";
import { EdgeConnectMenu, type EdgeConnectOption } from "@/pages/projectEditor/EdgeConnectMenu";
import {
    TimelineDock,
    TIMELINE_DOCK_HEIGHT,
    TIMELINE_DOCK_TOGGLE_HEIGHT,
} from "@/pages/projectEditor/TimelineDock";
import type { KnowledgeBaseEvent } from "@/components/timeline/timelineTypes";
import type { BlueprintEventConnection } from "@/components/timeline/timelineTypes";
import { useFileAttachmentProcessing } from "@/pages/projectEditor/useFileAttachmentProcessing";
import { SystemScreenshotPanel } from "@/pages/projectEditor/SystemScreenshotPanel";

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

function readNodeOpacity(style: { opacity?: unknown } | null | undefined): number | undefined {
    const raw = style?.opacity;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
    if (typeof raw === "string") {
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
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

type ReportCardSnapshot = {
    id: string;
    label: string;
    title: string;
    description: string;
    createdAt: string;
    reference: string;
};

type ReportBlueprintComponentSnapshot = {
    id: string;
    title: string;
    paperTitle: string;
    blueprintFileName: string;
    highBlockName: string;
    intermediateBlockName: string;
    parentBoxes: Array<{
        title: string;
        level: string;
        paperTitle: string;
    }>;
};

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

function readNodeString(node: nodeType, key: string): string {
    const data = node.data as Record<string, unknown>;
    const value = data[key];
    return typeof value === "string" ? value : "";
}

function getCardSnapshots(nodes: nodeType[]): ReportCardSnapshot[] {
    const snapshots: ReportCardSnapshot[] = [];
    for (const node of nodes) {
        if (node.type === "card") {
            const nodeData = node.data as Record<string, unknown>;
            if (nodeData.relevant === false) continue;
        }

        const label = normalizeNodeLabel(readNodeString(node, "label"));
        if (!label) continue;
        if (
            label !== "person" &&
            label !== "activity" &&
            label !== "requirement" &&
            label !== "concept" &&
            label !== "insight" &&
            label !== "object"
        ) {
            continue;
        }

        const title = readNodeString(node, "title").trim();
        const description = readNodeString(node, "description").trim();
        snapshots.push({
            id: node.id,
            label,
            title: title || "Untitled",
            description,
            createdAt: readNodeString(node, "createdAt"),
            reference: readNodeString(node, "reference"),
        });
    }
    return snapshots;
}

function getBlueprintComponentSnapshots(nodes: nodeType[]): ReportBlueprintComponentSnapshot[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const snapshots: ReportBlueprintComponentSnapshot[] = [];

    for (const node of nodes) {
        const label = normalizeNodeLabel(readNodeString(node, "label"));
        if (label !== "blueprint_component") continue;

        const data = node.data as Record<string, unknown>;
        const blueprintComponent = (
            data.blueprintComponent &&
            typeof data.blueprintComponent === "object"
        )
            ? data.blueprintComponent as Record<string, unknown>
            : {};

        const parentBoxes: Array<{ title: string; level: string; paperTitle: string }> = [];
        let currentParentId = node.parentId;
        while (typeof currentParentId === "string" && currentParentId.trim() !== "") {
            const parent = byId.get(currentParentId);
            if (!parent) break;
            const parentLabel = normalizeNodeLabel(readNodeString(parent, "label"));
            if (parentLabel !== "blueprint_group") break;
            parentBoxes.push({
                title: readNodeString(parent, "title") || "Blueprint group",
                level: readNodeString(parent, "blueprintGroupLevel") || "",
                paperTitle: readNodeString(parent, "blueprintPaperTitle") || "",
            });
            currentParentId = parent.parentId;
        }

        snapshots.push({
            id: node.id,
            title: readNodeString(node, "title") || "Blueprint component",
            paperTitle: readNodeString(node, "blueprintPaperTitle"),
            blueprintFileName: readNodeString(node, "blueprintFileName"),
            highBlockName: typeof blueprintComponent.highBlockName === "string"
                ? blueprintComponent.highBlockName
                : "",
            intermediateBlockName: typeof blueprintComponent.intermediateBlockName === "string"
                ? blueprintComponent.intermediateBlockName
                : "",
            parentBoxes,
        });
    }

    return snapshots;
}

function toBlueprintData(payload: BlueprintDragPayload): BlueprintData {
    const highBlocks: BlueprintHighBlock[] = payload.paper.HighBlocks.map((high) => ({
        name: high.HighBlockName,
        intermediates: high.IntermediateBlocks.map((intermediate): BlueprintIntermediate => ({
            name: intermediate.IntermediateBlockName,
            components: intermediate.GranularBlocks.map((granular): BlueprintComponent => ({
                id: granular.ID,
                name: granular.GranularBlockName,
                feedsInto: Array.isArray(granular.FeedsInto) ? granular.FeedsInto : [],
                description: granular.PaperDescription,
                referenceCitation: granular.ReferenceCitation,
                highBlockName: high.HighBlockName,
                intermediateBlockName: intermediate.IntermediateBlockName,
            })),
        })),
    }));

    const components = highBlocks.flatMap((high) =>
        high.intermediates.flatMap((intermediate) => intermediate.components),
    );

    return {
        fileName: payload.fileName,
        paperTitle: payload.paperTitle,
        year: payload.year,
        highBlocks,
        components,
    };
}

function buildBlueprintComponentGraph(
    payload: BlueprintDragPayload,
    dropPosition: { x: number; y: number },
    createdAt?: string,
): { nodes: nodeType[]; edges: edgeType[] } {
    const blueprint = toBlueprintData(payload);

    const nodes: nodeType[] = [];
    const edges: edgeType[] = [];
    const nodeIdByComponentId = new Map<number, string>();
    const edgeKeySet = new Set<string>();

    const HIGH_BLOCK_GAP_X = 120;
    const PAPER_PADDING_X = 28;
    const PAPER_CONTENT_TOP = 54;
    const PAPER_PADDING_BOTTOM = 24;
    const PAPER_MIN_WIDTH = 360;
    const PAPER_MIN_HEIGHT = 220;
    const HIGH_PADDING_X = 22;
    const HIGH_CONTENT_TOP = 46;
    const HIGH_PADDING_BOTTOM = 22;
    const INTERMEDIATE_GAP_X = 28;
    const INTERMEDIATE_GAP_Y = 28;
    const INTERMEDIATE_PADDING_X = 18;
    const INTERMEDIATE_CONTENT_TOP = 42;
    const INTERMEDIATE_PADDING_BOTTOM = 18;
    const COMPONENT_SIZE = 112;
    const COMPONENT_GAP_X = 24;
    const COMPONENT_GAP_Y = 24;

    const getIntermediateColumns = (count: number): number => {
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        return 3;
    };

    const getComponentColumns = (count: number): number => {
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        if (count <= 9) return 3;
        return 4;
    };

    type IntermediateLayout = {
        intermediate: BlueprintIntermediate;
        componentColumns: number;
        width: number;
        height: number;
    };

    type HighLayout = {
        high: BlueprintHighBlock;
        intermediateColumns: number;
        intermediateLayouts: IntermediateLayout[];
        columnOffsets: number[];
        rowOffsets: number[];
        highWidth: number;
        highHeight: number;
    };

    const highLayouts: HighLayout[] = [];

    for (let highIndex = 0; highIndex < blueprint.highBlocks.length; highIndex++) {
        const high = blueprint.highBlocks[highIndex];
        const intermediateColumns = getIntermediateColumns(high.intermediates.length);
        const intermediateRows = Math.max(1, Math.ceil(high.intermediates.length / intermediateColumns));

        const intermediateLayouts: IntermediateLayout[] = high.intermediates.map((intermediate) => {
            const componentCount = intermediate.components.length;
            const componentColumns = getComponentColumns(componentCount);
            const componentRows = Math.max(1, Math.ceil(componentCount / componentColumns));
            const componentAreaWidth = (
                componentColumns * COMPONENT_SIZE +
                Math.max(0, componentColumns - 1) * COMPONENT_GAP_X
            );
            const componentAreaHeight = (
                componentRows * COMPONENT_SIZE +
                Math.max(0, componentRows - 1) * COMPONENT_GAP_Y
            );
            const width = INTERMEDIATE_PADDING_X * 2 + componentAreaWidth;
            const height = INTERMEDIATE_CONTENT_TOP + componentAreaHeight + INTERMEDIATE_PADDING_BOTTOM;

            return {
                intermediate,
                componentColumns,
                width,
                height,
            };
        });

        const columnWidths = new Array<number>(intermediateColumns).fill(0);
        const rowHeights = new Array<number>(intermediateRows).fill(0);

        for (let intermediateIndex = 0; intermediateIndex < intermediateLayouts.length; intermediateIndex++) {
            const intermediateCol = intermediateIndex % intermediateColumns;
            const intermediateRow = Math.floor(intermediateIndex / intermediateColumns);
            const layout = intermediateLayouts[intermediateIndex];
            columnWidths[intermediateCol] = Math.max(columnWidths[intermediateCol], layout.width);
            rowHeights[intermediateRow] = Math.max(rowHeights[intermediateRow], layout.height);
        }

        const columnOffsets = new Array<number>(intermediateColumns).fill(0);
        for (let index = 1; index < intermediateColumns; index++) {
            columnOffsets[index] = (
                columnOffsets[index - 1] +
                columnWidths[index - 1] +
                INTERMEDIATE_GAP_X
            );
        }

        const rowOffsets = new Array<number>(intermediateRows).fill(0);
        for (let index = 1; index < intermediateRows; index++) {
            rowOffsets[index] = (
                rowOffsets[index - 1] +
                rowHeights[index - 1] +
                INTERMEDIATE_GAP_Y
            );
        }

        const intermediateGridWidth = (
            columnWidths.reduce((total, width) => total + width, 0) +
            Math.max(0, intermediateColumns - 1) * INTERMEDIATE_GAP_X
        );
        const intermediateGridHeight = (
            rowHeights.reduce((total, height) => total + height, 0) +
            Math.max(0, intermediateRows - 1) * INTERMEDIATE_GAP_Y
        );

        const highWidth = HIGH_PADDING_X * 2 + intermediateGridWidth;
        const highHeight = HIGH_CONTENT_TOP + intermediateGridHeight + HIGH_PADDING_BOTTOM;
        highLayouts.push({
            high,
            intermediateColumns,
            intermediateLayouts,
            columnOffsets,
            rowOffsets,
            highWidth,
            highHeight,
        });
    }

    const totalHighWidth = (
        highLayouts.reduce((total, layout) => total + layout.highWidth, 0) +
        Math.max(0, highLayouts.length - 1) * HIGH_BLOCK_GAP_X
    );
    const tallestHigh = highLayouts.reduce(
        (maxHeight, layout) => Math.max(maxHeight, layout.highHeight),
        0,
    );
    const paperWidth = Math.max(PAPER_MIN_WIDTH, PAPER_PADDING_X * 2 + totalHighWidth);
    const paperHeight = Math.max(PAPER_MIN_HEIGHT, PAPER_CONTENT_TOP + tallestHigh + PAPER_PADDING_BOTTOM);
    const paperTitle = Number.isFinite(blueprint.year) && blueprint.year > 0
        ? `${blueprint.paperTitle} (${blueprint.year})`
        : blueprint.paperTitle;
    const paperNodeId = crypto.randomUUID();

    nodes.push({
        id: paperNodeId,
        position: {
            x: dropPosition.x,
            y: dropPosition.y,
        },
        type: "blueprintGroup",
        style: {
            width: paperWidth,
            height: paperHeight,
        },
        zIndex: 0,
        data: {
            label: "blueprint_group",
            type: "technical",
            title: paperTitle,
            description: "System Paper",
            ...(createdAt ? { createdAt } : {}),
            blueprintGroupLevel: "paper",
            blueprintPaperTitle: blueprint.paperTitle,
            blueprintFileName: blueprint.fileName,
        },
    });

    let highCursorX = PAPER_PADDING_X;
    for (let highIndex = 0; highIndex < highLayouts.length; highIndex++) {
        const highLayout = highLayouts[highIndex];
        const highNodeId = crypto.randomUUID();

        nodes.push({
            id: highNodeId,
            parentId: paperNodeId,
            extent: "parent",
            position: {
                x: highCursorX,
                y: PAPER_CONTENT_TOP,
            },
            type: "blueprintGroup",
            style: {
                width: highLayout.highWidth,
                height: highLayout.highHeight,
            },
            zIndex: 1,
            data: {
                label: "blueprint_group",
                type: "technical",
                title: highLayout.high.name,
                description: "High Block",
                ...(createdAt ? { createdAt } : {}),
                blueprintGroupLevel: "high",
                blueprintPaperTitle: blueprint.paperTitle,
                blueprintFileName: blueprint.fileName,
            },
        });

        for (let intermediateIndex = 0; intermediateIndex < highLayout.intermediateLayouts.length; intermediateIndex++) {
            const intermediateLayout = highLayout.intermediateLayouts[intermediateIndex];
            const intermediate = intermediateLayout.intermediate;
            const intermediateCol = intermediateIndex % highLayout.intermediateColumns;
            const intermediateRow = Math.floor(intermediateIndex / highLayout.intermediateColumns);
            const intermediateNodeId = crypto.randomUUID();

            nodes.push({
                id: intermediateNodeId,
                parentId: highNodeId,
                extent: "parent",
                position: {
                    x: HIGH_PADDING_X + highLayout.columnOffsets[intermediateCol],
                    y: HIGH_CONTENT_TOP + highLayout.rowOffsets[intermediateRow],
                },
                type: "blueprintGroup",
                style: {
                    width: intermediateLayout.width,
                    height: intermediateLayout.height,
                },
                zIndex: 2,
                data: {
                    label: "blueprint_group",
                    type: "technical",
                    title: intermediate.name,
                    description: "Intermediate Block",
                    ...(createdAt ? { createdAt } : {}),
                    blueprintGroupLevel: "intermediate",
                    blueprintPaperTitle: blueprint.paperTitle,
                    blueprintFileName: blueprint.fileName,
                },
            });

            for (let componentIndex = 0; componentIndex < intermediate.components.length; componentIndex++) {
                const component = intermediate.components[componentIndex];
                const componentCol = componentIndex % intermediateLayout.componentColumns;
                const componentRow = Math.floor(componentIndex / intermediateLayout.componentColumns);
                const nodeId = crypto.randomUUID();

                nodes.push({
                    id: nodeId,
                    parentId: intermediateNodeId,
                    extent: "parent",
                    position: {
                        x: INTERMEDIATE_PADDING_X + componentCol * (COMPONENT_SIZE + COMPONENT_GAP_X),
                        y: INTERMEDIATE_CONTENT_TOP + componentRow * (COMPONENT_SIZE + COMPONENT_GAP_Y),
                    },
                    type: "blueprintComponent",
                    zIndex: 3,
                    data: {
                        label: "blueprint_component",
                        type: "technical",
                        title: component.name,
                        codebaseFilePaths: [],
                        description: `${component.highBlockName} / ${component.intermediateBlockName}`,
                        ...(createdAt ? { createdAt } : {}),
                        blueprintComponent: component,
                        blueprintPaperTitle: blueprint.paperTitle,
                        blueprintFileName: blueprint.fileName,
                    },
                });

                if (!nodeIdByComponentId.has(component.id)) {
                    nodeIdByComponentId.set(component.id, nodeId);
                }
            }
        }

        highCursorX += highLayout.highWidth + HIGH_BLOCK_GAP_X;
    }

    for (const component of blueprint.components) {
        const sourceNodeId = nodeIdByComponentId.get(component.id);
        if (!sourceNodeId) continue;

        for (const targetComponentId of component.feedsInto) {
            const targetNodeId = nodeIdByComponentId.get(targetComponentId);
            if (!targetNodeId || targetNodeId === sourceNodeId) continue;

            const key = `${sourceNodeId}->${targetNodeId}`;
            if (edgeKeySet.has(key)) continue;
            edgeKeySet.add(key);

            edges.push({
                id: crypto.randomUUID(),
                source: sourceNodeId,
                target: targetNodeId,
                type: "relation",
                label: "feeds into",
                data: {
                    label: "feeds into",
                    from: "blueprint_component",
                    to: "blueprint_component",
                    ...(createdAt ? { createdAt } : {}),
                },
            });
        }
    }

    return { nodes, edges };
}

const FlowInnerWithProjectId = ({ projectId }: { projectId: string }) => {
    const { status, error, reviewOnly } = useDocumentSync(projectId);

    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<CursorMode>("");
    const [fileDragActive, setFileDragActive] = useState(false);
    // A card the user just created, to be brought into view once the layout has placed it.
    const [pendingFocusNodeId, setPendingFocusNodeId] = useState<string | null>(null);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [blueprintComponentsVisible, setBlueprintComponentsVisible] = useState(true);
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
    const [chatInput, setChatInput] = useState("");
    const [chatMessages, setChatMessages] = useState<CanvasChatEntry[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    // Replaces the blocking `alert` the extraction path used to raise: the file is already
    // attached by the time extraction can fail, so this is a notice, not a dialog.
    const [fileProcessingError, setFileProcessingError] = useState<string | null>(null);
    const [systemPaperResults, setSystemPaperResults] = useState<QuerySystemPapersResult[]>([]);
    const [systemPapersLoading, setSystemPapersLoading] = useState(false);
    const [systemPapersError, setSystemPapersError] = useState<string | null>(null);
    const [exportingProject, setExportingProject] = useState(false);
    const [exportingMarkdown, setExportingMarkdown] = useState(false);
    const [gitConnectionStatus, setGitConnectionStatus] = useState<GitConnectionStatus>({ connected: false });
    const [hoveredAssetFileId, setHoveredAssetFileId] = useState<string | null>(null);
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
    const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);
    const highlightedKnowledgeNodeIds = useSelector(selectHighlightedKnowledgeNodeIds);

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
    const liveNodes = useMemo(
        () => nodes.filter((node) => (
            toTimestampMs((node.data as Record<string, unknown>)?.deletedAt) === null
        )),
        [nodes],
    );
    const liveEdges = useMemo(
        () => edges.filter((edge) => (
            toTimestampMs((edge.data as Record<string, unknown> | undefined)?.deletedAt) === null
        )),
        [edges],
    );
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
    const interactionLocked = reviewOnly;
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

        return liveNodes.filter((node) => {
            const activityId = activityTreeMembership.get(node.id);
            if (activityId === undefined) return true;
            return visibleActivityIds.has(activityId);
        });
    }, [activityTreeMembership, liveNodes, playbackAtTime]);
    const timelineContextEdges = useMemo(() => {
        const visibleNodeIds = new Set(timelineContextNodes.map((node) => node.id));
        return liveEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
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
        return knowledgeBlueprintLinks.filter((connection) => (
            existingNodeIdSet.has(connection.cardNodeId)
        ));
    }, [knowledgeBlueprintLinks, nodes]);

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
        void onAttachFile(nodeId, file);
    }, [interactionLocked, onAttachFile]);

    const onAttachFileForCanvas = useCallback(async (
        file: File,
        dropPosition: { x: number; y: number },
        targetActivityNodeId?: string | null,
    ): Promise<string | null> => {
        if (interactionLocked) return null;
        return await onAttachFileToCanvas(file, dropPosition, targetActivityNodeId);
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
    const softDeleteNode = useCallback((nodeId: string) => {
        const targetNode = nodes.find((node) => node.id === nodeId);
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

        for (const edge of edges) {
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
    }, [dispatch, edges, nodes, rememberDeletedKnowledgeEventFromNode, resolveActionTimestamp]);

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
            const passthroughChanges = immediateChanges.filter((change) => change.type !== "remove");
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

    const maybeCreateBlueprintEventFromConnection = useCallback((
        sourceNode: nodeType | undefined,
        targetNode: nodeType | undefined,
        sourceLabel: string,
        targetLabel: string,
    ) => {
        if (interactionLocked) return;
        const sourceIsTaskOrRequirement = sourceLabel === "requirement";
        const targetIsTaskOrRequirement = targetLabel === "requirement";
        const sourceIsBlueprintComponent = sourceLabel === "blueprint_component";
        const targetIsBlueprintComponent = targetLabel === "blueprint_component";

        if (
            !((
                sourceIsTaskOrRequirement && targetIsBlueprintComponent
            ) || (
                targetIsTaskOrRequirement && sourceIsBlueprintComponent
            ))
        ) {
            return;
        }

        const componentNode = sourceIsBlueprintComponent ? sourceNode : targetNode;
        if (!componentNode) return;

        const eventId = `blueprint-component:${componentNode.id}`;
        const hasEvent = blueprintEvents.some((event) => event.id === eventId);
        if (hasEvent) return;

        const componentData = componentNode.data as Record<string, unknown>;
        const blueprintComponent = (
            componentData.blueprintComponent &&
            typeof componentData.blueprintComponent === "object"
        )
            ? (componentData.blueprintComponent as Record<string, unknown>)
            : null;

        dispatch(addBlueprintEvent({
            id: eventId,
            name: typeof componentData.title === "string" && componentData.title.trim() !== ""
                ? componentData.title
                : "Blueprint component",
            occurredAt: resolveActionTimestamp(),
            componentNodeId: componentNode.id,
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
        }));
    }, [dispatch, blueprintEvents, interactionLocked, resolveActionTimestamp]);

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
            const sourceNode = nodes.find((node) => node.id === pending.sourceId);
            const targetNode = nodes.find((node) => node.id === pending.targetId);

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
                        ...(kind ? { kind } : {}),
                    },
                }]));
            }

            maybeCreateBlueprintEventFromConnection(
                sourceNode,
                targetNode,
                pending.sourceLabel,
                pending.targetLabel,
            );

            return null;
        });
    }, [dispatch, interactionLocked, edges, nodes, maybeCreateBlueprintEventFromConnection, resolveActionTimestamp]);

    const handleConnect = useCallback((connection: Connection) => {
        if (interactionLocked) return;
        if (!connection.source || !connection.target) return;

        const sourceNode = nodes.find((node) => node.id === connection.source);
        const targetNode = nodes.find((node) => node.id === connection.target);
        const sourceLabel = normalizeNodeLabel(String(sourceNode?.data?.label ?? ""));
        const targetLabel = normalizeNodeLabel(String(targetNode?.data?.label ?? ""));

        if (!isAllowedConnection(sourceLabel, targetLabel)) return;

        const defaultLabel = relationLabelFor(sourceLabel, targetLabel);
        if (!defaultLabel) return;

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
    }, [nodes, interactionLocked]);

    const onDataPropertyChange = useCallback((nodeProps: nodeType, value: unknown, propertyName: string) => {
        if (interactionLocked) return;
        const data = { ...nodeProps.data } as Record<string, unknown> & nodeType["data"];
        if (propertyName === "label" && typeof value === "string") {
            let resolvedType: cardType = "social";
            if (value === "requirement" || value === "insight") {
                resolvedType = "technical";
            }
            data.type = resolvedType;
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
        participantOptions: string[];
    }>({
        onAttachFile: onAttachFileForNode,
        onDetachFile,
        onDataPropertyChange,
        onDeleteNode,
        participantOptions: participantNames,
    });
    useEffect(() => {
        cardNodeHandlersRef.current = {
            onAttachFile: onAttachFileForNode,
            onDetachFile,
            onDataPropertyChange,
            onDeleteNode,
            participantOptions: participantNames,
        };
    }, [onAttachFileForNode, onDataPropertyChange, onDeleteNode, onDetachFile, participantNames]);

    const blueprintComponentHandlersRef = useRef<{
        onRenameTitle: typeof handleBlueprintComponentTitleChange;
        onAttachCodebaseFilePath: typeof handleBlueprintComponentAttachCodebasePath;
        onDetachCodebaseFilePath: typeof handleBlueprintComponentDetachCodebasePath;
    }>({
        onRenameTitle: handleBlueprintComponentTitleChange,
        onAttachCodebaseFilePath: handleBlueprintComponentAttachCodebasePath,
        onDetachCodebaseFilePath: handleBlueprintComponentDetachCodebasePath,
    });
    useEffect(() => {
        blueprintComponentHandlersRef.current = {
            onRenameTitle: handleBlueprintComponentTitleChange,
            onAttachCodebaseFilePath: handleBlueprintComponentAttachCodebasePath,
            onDetachCodebaseFilePath: handleBlueprintComponentDetachCodebasePath,
        };
    }, [
        handleBlueprintComponentAttachCodebasePath,
        handleBlueprintComponentDetachCodebasePath,
        handleBlueprintComponentTitleChange,
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
    const highlightedKnowledgeNodeIdSet = useMemo(
        () => new Set(highlightedKnowledgeNodeIds),
        [highlightedKnowledgeNodeIds],
    );

    const labelFilteredNodes = useMemo(() => {
        return timelineContextNodes.filter((node) => {
            const rawLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
            if (BLUEPRINT_NODE_LABELS.has(rawLabel)) return blueprintComponentsVisible;
            if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
            return selectedLabelSet.has(rawLabel as cardLabel);
        });
    }, [blueprintComponentsVisible, selectedLabelSet, timelineContextNodes]);

    const emphasizedBlueprintComponentIds = useMemo(() => {
        const nodeById = new Map(timelineContextNodes.map((node) => [node.id, node]));
        const emphasized = new Set<string>();

        for (let index = 0; index < timelineContextEdges.length; index++) {
            const edge = timelineContextEdges[index];
            const sourceNode = nodeById.get(edge.source);
            const targetNode = nodeById.get(edge.target);
            if (!sourceNode || !targetNode) continue;

            const sourceLabel = normalizeNodeLabel(String(sourceNode.data?.label ?? ""));
            const targetLabel = normalizeNodeLabel(String(targetNode.data?.label ?? ""));
            const sourceIsComponent = sourceLabel === "blueprint_component";
            const targetIsComponent = targetLabel === "blueprint_component";
            const sourceIsTaskOrRequirement = sourceLabel === "requirement";
            const targetIsTaskOrRequirement = targetLabel === "requirement";

            if (sourceIsComponent && targetIsTaskOrRequirement) {
                emphasized.add(sourceNode.id);
            }
            if (targetIsComponent && sourceIsTaskOrRequirement) {
                emphasized.add(targetNode.id);
            }
        }

        return emphasized;
    }, [timelineContextEdges, timelineContextNodes]);
    const connectedBlueprintComponentNodeIds = useMemo(
        () => Array.from(emphasizedBlueprintComponentIds),
        [emphasizedBlueprintComponentIds]
    );
    const blueprintEventConnections = useMemo<BlueprintEventConnection[]>(() => {
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const blueprintEventByComponentNodeId = new Map<string, typeof blueprintEvents[number]>();

        for (const eventData of blueprintEvents) {
            const componentNodeId = typeof eventData.componentNodeId === "string"
                ? eventData.componentNodeId.trim()
                : "";
            if (!componentNodeId) continue;
            blueprintEventByComponentNodeId.set(componentNodeId, eventData);
        }

        const connections: BlueprintEventConnection[] = [];
        for (const edge of edges) {
            const sourceNode = nodeById.get(edge.source);
            const targetNode = nodeById.get(edge.target);
            if (!sourceNode || !targetNode) continue;

            const sourceLabel = normalizeNodeLabel(String(sourceNode.data?.label ?? ""));
            const targetLabel = normalizeNodeLabel(String(targetNode.data?.label ?? ""));
            if (sourceLabel !== "blueprint_component" || targetLabel !== "blueprint_component") continue;

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
    }, [blueprintEvents, edges, nodes]);
    const normalizedHoveredCodebasePath = useMemo(
        () => (hoveredCodebaseFilePath ? normalizePath(hoveredCodebaseFilePath) : ""),
        [hoveredCodebaseFilePath]
    );

    const filteredNodes = useMemo(() => {
        const baseNodes = queryMatchedNodeSet
            ? labelFilteredNodes.filter((node) => queryMatchedNodeSet.has(node.id))
            : labelFilteredNodes;

        return baseNodes.map((node) => {
            const nodeLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
            const nodeData = node.data as Record<string, unknown>;
            const isCardNode = CARD_LABELS.includes(nodeLabel as cardLabel);
            const isKnowledgeHighlighted = isCardNode && highlightedKnowledgeNodeIdSet.has(node.id);
            const knowledgeHighlightStyle = isKnowledgeHighlighted
                ? {
                    outline: "3px solid #5bbad6", 
                    outlineOffset: "2px",
                    borderRadius: "10px"
                }
                : null;
            if (nodeLabel === "blueprint_component") {
                const attachedCodebasePaths = Array.isArray(nodeData.codebaseFilePaths)
                    ? nodeData.codebaseFilePaths
                        .filter((path): path is string => typeof path === "string")
                        .map((path) => normalizePath(path))
                    : [];
                const isHoveredByFile = normalizedHoveredCodebasePath !== "" &&
                    attachedCodebasePaths.includes(normalizedHoveredCodebasePath);
                const isEmphasized = emphasizedBlueprintComponentIds.has(node.id) || isHoveredByFile;
                const desiredOpacity = isEmphasized ? 1 : 0.5;
                const currentOpacity = readNodeOpacity(node.style);
                if (currentOpacity === desiredOpacity) {
                    return node;
                }
                return {
                    ...node,
                    style: {
                        ...(node.style ?? {}),
                        opacity: desiredOpacity,
                    },
                };
            }

            if (isCardNode && hoveredAssetFileId) {
                const attachmentIds = Array.isArray(nodeData.attachmentIds)
                    ? nodeData.attachmentIds.filter((id): id is string => typeof id === "string")
                    : [];
                if (attachmentIds.includes(hoveredAssetFileId)) {
                    const assetShadow = "0 0 0 3px rgba(0, 168, 219, 0.85)";
                    const combinedShadow = isKnowledgeHighlighted
                        ? `${assetShadow}, 0 0 0 6px rgba(231, 127, 35, 0.65)`
                        : assetShadow;
                    return {
                        ...node,
                        style: {
                            ...(node.style ?? {}),
                            ...(knowledgeHighlightStyle ?? {}),
                            boxShadow: combinedShadow,
                            borderRadius: 18,
                        },
                    };
                }
            }

            if (knowledgeHighlightStyle) {
                return {
                    ...node,
                    style: {
                        ...(node.style ?? {}),
                        ...knowledgeHighlightStyle,
                    },
                };
            }

            return node;
        });
    }, [
        labelFilteredNodes,
        queryMatchedNodeSet,
        emphasizedBlueprintComponentIds,
        normalizedHoveredCodebasePath,
        hoveredAssetFileId,
        highlightedKnowledgeNodeIdSet,
    ]);


    const filteredEdges = useMemo(() => {
        const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
        return timelineContextEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [timelineContextEdges, filteredNodes]);


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

    // The layout — not the cursor — decides where a new card lands, so a card created by the card
    // tool or a file drop can appear anywhere, including off-screen. Pan to it once it is placed,
    // keeping the current zoom so the move is a pan rather than a jarring re-fit.
    useEffect(() => {
        if (!pendingFocusNodeId) return;

        const target = displayedNodes.find((node) => node.id === pendingFocusNodeId);
        if (!target) return;

        const size = nodeSizeOf(target);
        const timer = window.setTimeout(() => {
            void setCenter(
                target.position.x + (size.width / 2),
                target.position.y + (size.height / 2),
                { zoom: getZoom(), duration: 420 },
            );
            setPendingFocusNodeId(null);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [pendingFocusNodeId, displayedNodes, setCenter, getZoom]);

    // Rings are shown while a file is dragged over the canvas and while the card tool is armed,
    // because both actions create a card that gets connected to the activity underneath.
    const activityDropReason = useMemo<ActivityDropRingsReason | null>(() => {
        if (interactionLocked) return null;
        // An abstracted canvas has glyphs where activities were, and a ring drawn around one would
        // invite dropping a card onto a node that does not exist in the document.
        if (!canvasIsEditable) return null;
        if (fileDragActive) return "drag";
        if (cursorMode === "node") return "tool";
        return null;
    }, [canvasIsEditable, cursorMode, fileDragActive, interactionLocked]);

    const activityDropTargets = useMemo(() => (
        activityDropReason ? getActivityDropTargets(displayedNodes) : null
    ), [activityDropReason, displayedNodes]);

    // Hit-tests a canvas point against blueprint parent boxes. This must read the *displayed* nodes:
    // the layout translates the blueprint block, so stored positions are in a different space than
    // the flow coordinates a click resolves to.
    const isInsideSystemBlueprintParentBox = useCallback((position: { x: number; y: number }) => {
        const nodes = displayedNodes;
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const absolutePositionById = new Map<string, { x: number; y: number }>();
        const resolveAbsolutePosition = (nodeId: string): { x: number; y: number } => {
            const cached = absolutePositionById.get(nodeId);
            if (cached) return cached;
            const node = nodeById.get(nodeId);
            if (!node) return { x: 0, y: 0 };
            if (!node.parentId) {
                const root = { x: node.position.x, y: node.position.y };
                absolutePositionById.set(nodeId, root);
                return root;
            }
            const parentAbs = resolveAbsolutePosition(node.parentId);
            const abs = { x: parentAbs.x + node.position.x, y: parentAbs.y + node.position.y };
            absolutePositionById.set(nodeId, abs);
            return abs;
        };

        for (const node of nodes) {
            const nodeData = node.data as Record<string, unknown>;
            const label = String(nodeData.label ?? "").toLowerCase();
            if (label !== "blueprint_group") continue;
            if (typeof nodeData.blueprintFileName !== "string" || nodeData.blueprintFileName.trim() === "") continue;

            const absolute = resolveAbsolutePosition(node.id);
            const style = node.style as Record<string, unknown> | undefined;
            const width = typeof style?.width === "number"
                ? style.width
                : Number.parseFloat(String(style?.width ?? "0")) || 0;
            const height = typeof style?.height === "number"
                ? style.height
                : Number.parseFloat(String(style?.height ?? "0")) || 0;
            if (width <= 0 || height <= 0) continue;

            const insideX = position.x >= absolute.x && position.x <= absolute.x + width;
            const insideY = position.y >= absolute.y && position.y <= absolute.y + height;
            if (insideX && insideY) return true;
        }

        return false;
    }, [displayedNodes]);

    const onCanvasClick = useCallback((e: React.MouseEvent) => {
        if (interactionLocked) return;
        if (!canvasIsEditable) return;
        if (cursorMode !== "node" && cursorMode !== "blueprint_component") return;

        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (cursorMode === "blueprint_component") {
            if (isInsideSystemBlueprintParentBox(position)) return;

            resetFiltersForCanvasCreation();
            const componentId = Math.floor(Date.now() + Math.random() * 1000);
            dispatch(addNode({
                id: crypto.randomUUID(),
                position,
                type: "blueprintComponent",
                data: {
                    label: "blueprint_component",
                    type: "technical",
                    title: "Blueprint component",
                    codebaseFilePaths: [],
                    manualCreated: true,
                    description: "",
                    blueprintComponent: {
                        id: componentId,
                        name: "Blueprint component",
                        feedsInto: [],
                        description: "",
                        referenceCitation: "",
                        highBlockName: "Manual",
                        intermediateBlockName: "Manual",
                    },
                    blueprintPaperTitle: "Manual component",
                    blueprintFileName: "",
                    createdAt: resolveActionTimestamp(),
                },
            }));
            return;
        }

        // Clicking inside an activity's drop ring creates an object card wired to that activity;
        // clicking empty canvas still creates a root activity card. Resolve the target before
        // resetting filters, so we can un-hide the label of whichever card we are about to create.
        const activityTarget = findActivityDropTarget(getActivityDropTargets(displayedNodes), position);
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
            setPendingFocusNodeId(nodeId);
            return;
        }

        const activityNodeId = crypto.randomUUID();
        setPendingFocusNodeId(activityNodeId);
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
    }, [canvasIsEditable, cursorMode, displayedNodes, dispatch, interactionLocked, isInsideSystemBlueprintParentBox, resolveActionTimestamp, resetFiltersForCanvasCreation, screenToFlowPosition]);

    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        if (interactionLocked) return;
        const dragTypes = Array.from(e.dataTransfer?.types ?? []);
        const hasFiles = dragTypes.includes("Files");
        const hasBlueprint = dragTypes.includes(BLUEPRINT_DRAG_MIME);
        const hasGitHubFile = dragTypes.includes("application/x-vitral-github-file");
        if (!hasFiles && !hasBlueprint && !hasGitHubFile) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }, [interactionLocked]);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        if (interactionLocked) return;
        if (!canvasIsEditable) return;
        const blueprintRaw = e.dataTransfer?.getData(BLUEPRINT_DRAG_MIME);
        if (blueprintRaw) {
            e.preventDefault();

            const payload = parseBlueprintDragPayload(blueprintRaw);
            if (!payload) return;

            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const graph = buildBlueprintComponentGraph(payload, position, resolveActionTimestamp());
            if (graph.nodes.length > 0) {
                dispatch(addNodes(graph.nodes));
            }
            if (graph.edges.length > 0) {
                dispatch(connectEdges(graph.edges));
            }
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
        // Dropping inside an activity's ring connects every dropped file's card to that activity;
        // the placement of each card is then resolved next to the activity, not at the cursor.
        const activityTarget = findActivityDropTarget(getActivityDropTargets(displayedNodes), basePosition);

        void (async () => {
            for (let index = 0; index < droppedFiles.length; index++) {
                const dropPosition = activityTarget
                    ? basePosition
                    : {
                        x: basePosition.x - (CARD_WIDTH_PX / 2) + (index * (CARD_WIDTH_PX + 100)),
                        y: basePosition.y - (CARD_HEIGHT_PX / 2),
                    };
                const createdNodeId = await onAttachFileForCanvas(droppedFiles[index], dropPosition, activityTarget?.nodeId ?? null);

                // Only the first card pulls the camera; panning once per file in a multi-file drop
                // would yank the canvas around while the uploads finish.
                if (index === 0 && createdNodeId) setPendingFocusNodeId(createdNodeId);

                // Un-hide the card's label only once the card exists. Clearing a filter re-runs the
                // explore-mode fitView, and doing that up front — before the upload resolves — would
                // frame the graph *without* the new card, so a card dropped outside those bounds
                // ended up off-screen with only an unexplained camera move to show for it.
                if (index === 0) resetFiltersForCanvasCreation("object");
            }
        })();
    }, [canvasIsEditable, displayedNodes, dispatch, interactionLocked, onAttachFileForCanvas, resetFiltersForCanvasCreation, resolveActionTimestamp, screenToFlowPosition]);

    const onFreeInputSubmit = useCallback(async (x: number, y: number, userText: string) => {
        if (interactionLocked) return;
        setCursorMode("");
        setLoading(true);

        try {
            const response: { cards: llmCardData[]; connections: llmConnectionData[] } =
                await requestCardsLLMTextInput(userText, llmModel);

            if (response?.cards) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(
                    response.cards,
                    screenToFlowPosition({ x, y }),
                    { createdAt: resolveActionTimestamp() },
                );
                const generatedEdges = llmConnectionsToEdges(
                    response.connections,
                    idMap,
                    response.cards
                ).map((edge) => ({
                    ...edge,
                    data: {
                        ...(edge.data as Record<string, unknown> | undefined),
                        createdAt: resolveActionTimestamp(),
                    },
                }));

                dispatch(addNodes(generatedNodes));
                dispatch(connectEdges(generatedEdges));
            }
        } catch (error) {
            console.error("Card extraction failed for the free-text input.", error);
            setFileProcessingError(error instanceof Error ? error.message : "Card extraction failed.");
        } finally {
            setLoading(false);
        }
    }, [dispatch, interactionLocked, llmModel, resolveActionTimestamp, screenToFlowPosition]);

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
        const blueprintEventByComponentNodeId = new Map<string, typeof blueprintEvents[number]>();
        const existingBlueprintEventIds = new Set<string>();
        for (const eventData of blueprintEvents) {
            existingBlueprintEventIds.add(eventData.id);
            if (typeof eventData.componentNodeId === "string" && eventData.componentNodeId.trim() !== "") {
                blueprintEventIdByComponentNodeId.set(eventData.componentNodeId, eventData.id);
                blueprintEventByComponentNodeId.set(eventData.componentNodeId, eventData);
            }
        }

        const missingBlueprintEvents: Array<{
            id: string;
            name: string;
            occurredAt: string;
            componentNodeId: string;
            paperDescription?: string;
            referenceCitation?: string;
            paperTitle?: string;
            blueprintFileName?: string;
        }> = [];
        const updatedBlueprintEvents: typeof blueprintEvents = [];
        const requiredAutoLinks: Array<{ blueprintEventId: string; codebaseSubtrackId: string }> = [];
        const requiredAutoLinkKeys = new Set<string>();

        for (const node of nodes) {
            const nodeLabel = String(node.data?.label ?? "").toLowerCase();
            if (nodeLabel !== "blueprint_component") continue;

            const componentData = node.data as Record<string, unknown>;
            const blueprintComponent = (
                componentData.blueprintComponent &&
                typeof componentData.blueprintComponent === "object"
            )
                ? (componentData.blueprintComponent as Record<string, unknown>)
                : null;
            const nextEventName = typeof componentData.title === "string" && componentData.title.trim() !== ""
                ? componentData.title
                : "Blueprint component";
            const nextPaperDescription = blueprintComponent && typeof blueprintComponent.description === "string"
                ? blueprintComponent.description
                : "";
            const nextReferenceCitation = blueprintComponent && typeof blueprintComponent.referenceCitation === "string"
                ? blueprintComponent.referenceCitation
                : "";
            const nextPaperTitle = typeof componentData.blueprintPaperTitle === "string"
                ? componentData.blueprintPaperTitle
                : undefined;
            const nextBlueprintFileName = typeof componentData.blueprintFileName === "string"
                ? componentData.blueprintFileName
                : undefined;

            const existingBlueprintEvent = blueprintEventByComponentNodeId.get(node.id);
            if (existingBlueprintEvent) {
                const shouldUpdate =
                    existingBlueprintEvent.name !== nextEventName ||
                    (existingBlueprintEvent.paperDescription ?? "") !== nextPaperDescription ||
                    (existingBlueprintEvent.referenceCitation ?? "") !== nextReferenceCitation ||
                    (existingBlueprintEvent.paperTitle ?? "") !== (nextPaperTitle ?? "") ||
                    (existingBlueprintEvent.blueprintFileName ?? "") !== (nextBlueprintFileName ?? "");

                if (shouldUpdate) {
                    updatedBlueprintEvents.push({
                        ...existingBlueprintEvent,
                        name: nextEventName,
                        paperDescription: nextPaperDescription,
                        referenceCitation: nextReferenceCitation,
                        paperTitle: nextPaperTitle,
                        blueprintFileName: nextBlueprintFileName,
                    });
                }
            }

            const attachedPaths = Array.isArray(componentData.codebaseFilePaths)
                ? componentData.codebaseFilePaths
                    .filter((path): path is string => typeof path === "string")
                    .map((path) => normalizePath(path))
                    .filter((path) => path !== "")
                : [];
            if (attachedPaths.length === 0) continue;

            let blueprintEventId = blueprintEventIdByComponentNodeId.get(node.id);
            if (!blueprintEventId) {
                blueprintEventId = `blueprint-component:${node.id}`;
                blueprintEventIdByComponentNodeId.set(node.id, blueprintEventId);

                if (!existingBlueprintEventIds.has(blueprintEventId)) {
                    missingBlueprintEvents.push({
                        id: blueprintEventId,
                        name: nextEventName,
                        occurredAt: resolveActionTimestamp(),
                        componentNodeId: node.id,
                        paperDescription: nextPaperDescription,
                        referenceCitation: nextReferenceCitation,
                        paperTitle: nextPaperTitle,
                        blueprintFileName: nextBlueprintFileName,
                    });
                    existingBlueprintEventIds.add(blueprintEventId);
                }
            }

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

        for (const eventData of missingBlueprintEvents) {
            dispatch(addBlueprintEvent(eventData));
        }
        for (const eventData of updatedBlueprintEvents) {
            dispatch(updateBlueprintEvent(eventData));
        }

        dispatch(reconcileBlueprintCodebaseAutoLinks(requiredAutoLinks));
    }, [codebaseSubtracks, dispatch, interactionLocked, nodes, blueprintEvents, resolveActionTimestamp]);

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
            case "blueprint_component":
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

    useEffect(() => {
        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [blueprintComponentsVisible, selectedLabels, queryMatchedNodeIds, fitView]);

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
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [canvasLevel, canvasFocus, levelFollowsZoom, fitView]);

    useEffect(() => {
        return () => {
            if (nodeChangeRafRef.current !== null) {
                window.cancelAnimationFrame(nodeChangeRafRef.current);
            }
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

    const handleSendChatMessage = useCallback(() => {
        const trimmed = chatInput.trim();
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
        setChatInput("");
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
    }, [chatInput, chatLoading, chatMessages, labelFilteredNodes, playbackAt, projectId]);

    const handleSystemPapersRefresh = useCallback(() => {
        const cards = nodes
            .map((node) => node.data)
            .filter((data) => SYSTEM_PAPER_CARD_LABELS.has(normalizeNodeLabel(String(data?.label ?? "")) as cardLabel))
            .map((data) => ({
                label: normalizeNodeLabel(String(data?.label ?? "")),
                title: String(data?.title ?? ""),
                description: String(data?.description ?? ""),
            }));

        if (cards.length === 0) {
            setSystemPaperResults([]);
            setSystemPapersError("Add at least one requirement card before refreshing.");
            return;
        }

        setSystemPapersLoading(true);
        setSystemPapersError(null);

        void (async () => {
            try {
                const response = await querySystemPapers({
                    cards,
                    limit: 5,
                });
                setSystemPaperResults(response.results);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to refresh system papers.";
                setSystemPapersError(message);
                setSystemPaperResults([]);
            } finally {
                setSystemPapersLoading(false);
            }
        })();
    }, [nodes]);

    const handleExportMarkdown = useCallback(() => {
        if (exportingMarkdown) return;
        setExportingMarkdown(true);

        void (async () => {
            try {
                const projectTitle = title?.trim() || "Untitled";
                const allCards = getCardSnapshots(nodes);
                const cardById = new Map(allCards.map((card) => [card.id, card]));
                const cardsByLabel = (label: string) => allCards.filter((card) => card.label === label);
                const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
                    const seen = new Set<string>();
                    const result: T[] = [];
                    for (const item of items) {
                        if (seen.has(item.id)) continue;
                        seen.add(item.id);
                        result.push(item);
                    }
                    return result;
                };
                const toIsoDate = (value: unknown): string => {
                    if (typeof value === "string") {
                        const parsed = new Date(value);
                        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
                        return value;
                    }
                    if (value instanceof Date && !Number.isNaN(value.getTime())) {
                        return value.toISOString();
                    }
                    return "";
                };

                const authors = Array.from(new Set(
                    cardsByLabel("person")
                        .map((card) => card.title.trim())
                        .filter(Boolean)
                ));

                const blueprintComponentsWithParents = getBlueprintComponentSnapshots(nodes);
                const latestScreenshotDataUrl = mostRecentSystemScreenshotMarker?.imageDataUrl?.trim() || "";

                const settingsInfo = {
                    llmModel,
                    projectTitle,
                    projectGoal: projectGoal?.trim() || "",
                    participants: participants.map((participant) => ({
                        name: String(participant.name ?? "").trim() || "Participant",
                        role: String(participant.role ?? "").trim() || "Researcher",
                    })),
                    timeline: {
                        start: toIsoDate(timelineStartEnd.start),
                        end: toIsoDate(timelineStartEnd.end),
                        stages: timelineStages.map((stage) => ({
                            name: stage.name,
                            start: toIsoDate(stage.start),
                            end: toIsoDate(stage.end),
                        })),
                        defaultStages: [...defaultStages],
                    },
                };

                const assetsMetadata = allFiles.map((file) => ({
                    id: file.id,
                    name: file.name,
                    ext: file.ext,
                    mimeType: file.mimeType,
                    sizeBytes: file.sizeBytes,
                    createdAt: file.createdAt,
                }));

                const matchedLiteratureCardIds = new Set<string>();
                const queryResults = await Promise.allSettled([
                    queryDocumentNodes(projectId, { query: "literature review", limit: 40, minScore: 0.2 }),
                    queryDocumentNodes(projectId, { query: "paper", limit: 40, minScore: 0.2 }),
                ]);
                for (const result of queryResults) {
                    if (result.status !== "fulfilled") continue;
                    for (const nodeId of result.value.matchedNodeIds) {
                        matchedLiteratureCardIds.add(nodeId);
                    }
                }

                const activityIds = new Set<string>();
                for (const nodeId of matchedLiteratureCardIds) {
                    const card = cardById.get(nodeId);
                    if (card?.label === "activity") {
                        activityIds.add(nodeId);
                    }
                }

                const activityConnectedCardIds = new Set<string>();
                for (const edge of edges) {
                    if (activityIds.has(edge.source) && cardById.has(edge.target)) {
                        activityConnectedCardIds.add(edge.target);
                    }
                    if (activityIds.has(edge.target) && cardById.has(edge.source)) {
                        activityConnectedCardIds.add(edge.source);
                    }
                }

                const literatureCards = dedupeById([
                    ...Array.from(matchedLiteratureCardIds).map((id) => cardById.get(id)).filter((card): card is ReportCardSnapshot => Boolean(card)),
                    ...Array.from(activityConnectedCardIds).map((id) => cardById.get(id)).filter((card): card is ReportCardSnapshot => Boolean(card)),
                ]);

                const abstract = await requestMarkdownReportSectionLLM("MarkdownReportAbstract", {
                    projectTitle,
                    settings: settingsInfo,
                    cards: {
                        insights: cardsByLabel("insight"),
                        concepts: cardsByLabel("concept"),
                        requirements: cardsByLabel("requirement"),
                    },
                    blueprintComponents: blueprintComponentsWithParents,
                    assets: assetsMetadata,
                }, llmModel);

                const abstractFallback = abstract || "This project explores the problem space, design constraints, and implementation strategy using the available artifacts and timeline context.";

                const [introduction, literatureReview, designGoals, timelineNarrative, methods, conclusion] = await Promise.all([
                    requestMarkdownReportSectionLLM("MarkdownReportIntroduction", {
                        projectTitle,
                        settings: settingsInfo,
                        abstract: abstractFallback,
                    }, llmModel),
                    requestMarkdownReportSectionLLM("MarkdownReportLiteratureReview", {
                        projectTitle,
                        abstract: abstractFallback,
                        literatureCards,
                        blueprintComponentsWithParents,
                    }, llmModel),
                    requestMarkdownReportSectionLLM("MarkdownReportDesignGoals", {
                        projectTitle,
                        abstract: abstractFallback,
                        requirementCards: cardsByLabel("requirement"),
                    }, llmModel),
                    requestMarkdownReportSectionLLM("MarkdownReportTimeline", {
                        projectTitle,
                        abstract: abstractFallback,
                        settings: settingsInfo,
                        timelineEvents: {
                            designStudy: designStudyEvents.map((eventData) => ({
                                name: eventData.name,
                                occurredAt: toIsoDate(eventData.occurredAt),
                                generatedBy: eventData.generatedBy === "llm" ? "llm" : "manual",
                            })),
                            knowledgeBase: [],
                            blueprint: blueprintEvents.map((eventData) => ({
                                name: eventData.name,
                                occurredAt: toIsoDate(eventData.occurredAt),
                                componentNodeId: eventData.componentNodeId ?? "",
                                paperTitle: eventData.paperTitle ?? "",
                            })),
                        },
                        codebaseSubtracks: codebaseSubtracks.map((subtrack) => ({
                            title: subtrack.name,
                            attachedFiles: Array.isArray(subtrack.filePaths) ? subtrack.filePaths : [],
                        })),
                    }, llmModel),
                    requestMarkdownReportSectionLLM("MarkdownReportMethods", {
                        projectTitle,
                        abstract: abstractFallback,
                        blueprintComponents: blueprintComponentsWithParents,
                        cards: {
                            objects: cardsByLabel("object"),
                            concepts: cardsByLabel("concept"),
                            insights: cardsByLabel("insight"),
                            requirements: cardsByLabel("requirement"),
                        },
                    }, llmModel),
                    requestMarkdownReportSectionLLM("MarkdownReportConclusion", {
                        projectTitle,
                        abstract: abstractFallback,
                        insightCards: cardsByLabel("insight"),
                    }, llmModel),
                ]);

                const markdownParts: string[] = [];
                markdownParts.push(`# ${projectTitle}`);
                markdownParts.push("");
                markdownParts.push("## Suggested authors");
                if (authors.length > 0) {
                    for (const author of authors) {
                        markdownParts.push(`- ${author}`);
                    }
                } else {
                    markdownParts.push("- _No person cards available_");
                }
                markdownParts.push("");
                markdownParts.push("## Teaser");
                if (latestScreenshotDataUrl) {
                    markdownParts.push(`![Teaser system screenshot](${latestScreenshotDataUrl})`);
                } else {
                    markdownParts.push("_No system screenshot uploaded._");
                }
                markdownParts.push("");
                markdownParts.push("## Abstract");
                markdownParts.push(abstractFallback);
                markdownParts.push("");
                markdownParts.push("## Introduction");
                markdownParts.push(introduction || "_No introduction generated._");
                markdownParts.push("");
                markdownParts.push("## Literature review");
                markdownParts.push(literatureReview || "_No literature review generated._");
                markdownParts.push("");
                markdownParts.push("## Design goals");
                markdownParts.push(designGoals || "_No design goals generated._");
                markdownParts.push("");
                markdownParts.push("## Timeline");
                markdownParts.push(timelineNarrative || "_No timeline narrative generated._");
                markdownParts.push("");
                markdownParts.push("## Methods");
                markdownParts.push(methods || "_No methods generated._");
                markdownParts.push("");
                markdownParts.push("## Conclusion");
                markdownParts.push(conclusion || "_No conclusion generated._");
                markdownParts.push("");

                const markdown = markdownParts.join("\n");
                const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const safeName = projectTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "") || "project-report";
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${safeName}.md`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
            } catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : "Failed to export markdown report.";
                window.alert(message);
            } finally {
                setExportingMarkdown(false);
            }
        })();
    }, [
        allFiles,
        blueprintEvents,
        codebaseSubtracks,
        defaultStages,
        designStudyEvents,
        edges,
        exportingMarkdown,
        mostRecentSystemScreenshotMarker?.imageDataUrl,
        nodes,
        participants,
        projectGoal,
        projectId,
        llmModel,
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

    const focusNodeById = useCallback((targetNodeId: string) => {
        const focusNode = () => {
            void fitView({
                nodes: [{ id: targetNodeId }],
                padding: 0.28,
                duration: 360,
            });
        };

        focusNode();
    }, [fitView]);

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

    const handleBlueprintEventNavigate = useCallback((eventData: BlueprintEvent) => {
        const componentNodeId = typeof eventData.componentNodeId === "string"
            ? eventData.componentNodeId.trim()
            : "";
        if (!componentNodeId) return;

        const existingNodeIds = new Set(nodes.map((node) => String(node.id ?? "")));
        if (!existingNodeIds.has(componentNodeId)) return;

        focusNodeById(componentNodeId);
    }, [focusNodeById, nodes]);

    const handleFreeInputClicked = useCallback(() => {
        if (interactionLocked) return;
        setCursorMode("text");
    }, [interactionLocked]);

    const handleNodeInputClicked = useCallback(() => {
        if (interactionLocked) return;
        setCursorMode("node");
    }, [interactionLocked]);

    const handleBlueprintComponentInputClicked = useCallback(() => {
        if (interactionLocked) return;
        setCursorMode("blueprint_component");
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
            if (hoveredAssetFileId === file.id) {
                setHoveredAssetFileId(null);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete asset.";
            window.alert(message);
        } finally {
            setDeletingAssetId((current) => (current === file.id ? null : current));
        }
    }, [dispatch, hoveredAssetFileId, interactionLocked, projectId]);

    const clearKnowledgeEditsAroundPlayback = useCallback((
        direction: "before" | "after",
        cutoffOverrideIso?: string
    ) => {
        if (reviewOnly) return;
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
    }, [dispatch, edges, nodes, resolveActionTimestamp, reviewOnly, timelineRangeEndMs, timelineRangeStartMs]);

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

    if (status === "loading") return <div>Loading...</div>;
    if (status === "error") return <div>Error: {error}</div>;

    const canvasSidebarBottomOffset = timelineOpen
        ? TIMELINE_DOCK_HEIGHT + TIMELINE_DOCK_TOGGLE_HEIGHT
        : 0;

    return (
        <>
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
                onClick={onCanvasClick}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                activityDropTargets={activityDropTargets}
                activityDropReason={activityDropReason ?? "drag"}
                onResetNodePositions={hasManualNodePositions ? handleResetNodePositions : null}
                miniMapBottomOffsetPx={canvasSidebarBottomOffset + (canvasFocusLabel
                    ? MINIMAP_LEVEL_PANEL_FOCUSED_CLEARANCE_PX
                    : MINIMAP_LEVEL_PANEL_CLEARANCE_PX)}
                miniMapRightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX}
                onMove={handleViewportMove}
                levelControlRightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX}
                levelControl={(
                    <CanvasLevelControl
                        level={canvasLevel}
                        followZoom={levelFollowsZoom}
                        onLevelChange={handleCanvasLevelChange}
                        onFollowZoomChange={handleLevelFollowsZoomChange}
                        focusLabel={canvasFocusLabel}
                        onClearFocus={handleClearCanvasFocus}
                        shifted={timelineOpen}
                        chatOpen={chatOpen}
                        onOpenChat={handleOpenChat}
                    />
                )}
            />

            <EdgeConnectMenu
                x={pendingConnectionMenu?.x ?? 0}
                y={pendingConnectionMenu?.y ?? 0}
                defaultLabel={pendingConnectionMenu?.defaultLabel ?? "related to"}
                open={!interactionLocked && pendingConnectionMenu !== null}
                onClose={() => setPendingConnectionMenu(null)}
                onSelect={handleConnectSelection}
            />

            <CanvasSidebar
                title={title}
                onSetTitle={handleSetTitle}
                onGoHome={handleGoHome}
                onOpenSettings={reviewOnly ? undefined : handleOpenSettings}
                onExportProject={handleExportProject}
                exportingProject={exportingProject}
                onExportMarkdown={handleExportMarkdown}
                exportingMarkdown={exportingMarkdown}
                bottomOffsetPx={canvasSidebarBottomOffset}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                blueprintComponentsVisible={blueprintComponentsVisible}
                onToggleBlueprintComponents={handleToggleBlueprintComponents}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabelWithQueryRefresh}
                systemPaperResults={systemPaperResults}
                systemPapersLoading={systemPapersLoading}
                systemPapersError={systemPapersError}
                onSystemPapersRefresh={handleSystemPapersRefresh}
            />

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

            {reviewOnly ? (
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
                    You are in review mode. No editting allowed.
                </div>
            ) : null}

            {/* <div style={{ position: "fixed", right: "350px", top: "30px", opacity: 0.5 }}>
                <img src="/vitral/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div> */}

            {!interactionLocked ? (
                <Toolbar
                    onFreeInputClicked={handleFreeInputClicked}
                    onNodeInputClicked={handleNodeInputClicked}
                    onBlueprintComponentClicked={handleBlueprintComponentInputClicked}
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
                bottomOffsetPx={canvasSidebarBottomOffset}
                onAssetHover={setHoveredAssetFileId}
                deletingAssetId={deletingAssetId}
                onDeleteAsset={interactionLocked ? undefined : handleDeleteAsset}
            />

            <CanvasChatOverlay
                open={chatOpen}
                loading={chatLoading}
                error={chatError}
                inputValue={chatInput}
                filterActive={activeQuery.trim().length > 0}
                messages={chatMessages}
                onInputValueChange={setChatInput}
                onSend={handleSendChatMessage}
                onClose={() => setChatOpen(false)}
                onClearFilter={clearCanvasFilter}
            />

            {cursorMode === "text" && !interactionLocked ? (
                <FreeInputZone onInputSubmit={onFreeInputSubmit} />
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
                allowKnowledgeTrackClearMenu={!reviewOnly}
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
                blueprintEvents={blueprintEvents}
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
