import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange, type NodeProps } from "@xyflow/react";

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
import { deleteFile, exportProjectVi, loadDocument, queryCanvasChat, queryDocumentNodes, querySystemPapers, updateDocumentMeta, type QuerySystemPapersResult } from "@/api/stateApi";
import { getGithubDocumentLink, githubStatus, type GitHubDocumentResponse } from "@/api/githubApi";
import { getGitHubEvents } from "@/api/eventsApi";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { FreeInputZone } from "@/components/toolbar/FreeInputZone";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { Card, type CardProps } from "@/components/cards/Card";
import { CARD_LABELS } from "@/components/cards/cardVisuals";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { CanvasSidebar, type CanvasViewMode } from "@/components/sidebar/CanvasSidebar";
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
    removeNode,
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
    selectParticipants,
    selectSystemScreenshotMarkers,
    selectHoveredCodebaseFilePath,
    reconcileBlueprintCodebaseAutoLinks,
    selectTimelineStartEnd,
    updateBlueprintEvent,
    updateStage,
} from "@/store/timelineSlice";

import { isAllowedConnection, relationLabelFor } from "@/utils/relationships";
import { buildEvolutionLayoutNodes } from "@/utils/evolutionLayout";
import { fromDate } from "@/pages/projectEditor/dateUtils";
import type { CursorMode, GitConnectionStatus } from "@/pages/projectEditor/types";
import { FlowCanvas } from "@/pages/projectEditor/FlowCanvas";
import { PendingFileModal } from "@/pages/projectEditor/PendingFileModal";
import { CanvasChatOverlay, type CanvasChatEntry } from "@/pages/projectEditor/CanvasChatOverlay";
import { EdgeConnectMenu, type EdgeConnectOption } from "@/pages/projectEditor/EdgeConnectMenu";
import {
    TimelineDock,
    TIMELINE_DOCK_HEIGHT,
    TIMELINE_DOCK_TOGGLE_HEIGHT,
} from "@/pages/projectEditor/TimelineDock";
import { useFileAttachmentProcessing } from "@/pages/projectEditor/useFileAttachmentProcessing";
import { SystemScreenshotPanel } from "@/pages/projectEditor/SystemScreenshotPanel";

const SYSTEM_PAPER_CARD_LABELS = new Set<cardLabel>(["requirement"]);
const REFERENCED_BY_EDGE_LABEL = "referenced by";
const ITERATION_OF_EDGE_LABEL = "iteration of";
const RIGHT_SIDEBAR_WIDTH_PX = 250;

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

function normalizeNodeLabel(label: string): string {
    const normalized = label.trim().toLowerCase();
    if (normalized === "task") return "requirement";
    return normalized;
}

function edgeLabelFrom(edge: edgeType): string {
    if (typeof edge.label === "string" && edge.label.trim() !== "") {
        return edge.label.trim().toLowerCase();
    }
    if (typeof edge.data?.label === "string" && edge.data.label.trim() !== "") {
        return edge.data.label.trim().toLowerCase();
    }
    return "";
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

function resolveAbsoluteNodePositions(allNodes: nodeType[]): Map<string, { x: number; y: number }> {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const absoluteById = new Map<string, { x: number; y: number }>();

    const resolve = (nodeId: string): { x: number; y: number } => {
        const cached = absoluteById.get(nodeId);
        if (cached) return cached;

        const current = byId.get(nodeId);
        if (!current) {
            const fallback = { x: 0, y: 0 };
            absoluteById.set(nodeId, fallback);
            return fallback;
        }

        if (!current.parentId) {
            const root = { x: current.position.x, y: current.position.y };
            absoluteById.set(nodeId, root);
            return root;
        }

        const parentAbsolute = resolve(current.parentId);
        const result = {
            x: parentAbsolute.x + current.position.x,
            y: parentAbsolute.y + current.position.y,
        };
        absoluteById.set(nodeId, result);
        return result;
    };

    for (const node of allNodes) {
        resolve(node.id);
    }

    return absoluteById;
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
    const { screenToFlowPosition, fitView } = useReactFlow();

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<CursorMode>("");
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [viewMode, setViewMode] = useState<CanvasViewMode>("explore");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [selectedLabels, setSelectedLabels] = useState<cardLabel[]>([...CARD_LABELS]);
    const [activeQuery, setActiveQuery] = useState("");
    const [queryMatchedNodeIds, setQueryMatchedNodeIds] = useState<string[] | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const [chatMessages, setChatMessages] = useState<CanvasChatEntry[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [systemPaperResults, setSystemPaperResults] = useState<QuerySystemPapersResult[]>([]);
    const [systemPapersLoading, setSystemPapersLoading] = useState(false);
    const [systemPapersError, setSystemPapersError] = useState<string | null>(null);
    const [exportingProject, setExportingProject] = useState(false);
    const [exportingMarkdown, setExportingMarkdown] = useState(false);
    const [gitConnectionStatus, setGitConnectionStatus] = useState<GitConnectionStatus>({ connected: false });
    const [hoveredAssetFileId, setHoveredAssetFileId] = useState<string | null>(null);
    const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
    const [projectGoal, setProjectGoal] = useState("");
    const [pendingConnectionMenu, setPendingConnectionMenu] = useState<PendingConnectionMenu | null>(null);
    const queuedPositionChangesRef = useRef<NodeChange<nodeType>[]>([]);
    const nodeChangeRafRef = useRef<number | null>(null);
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
    const timelineStartEnd = useSelector(selectTimelineStartEnd);
    const designStudyEvents = useSelector(selectAllDesignStudyEvents);
    const blueprintEvents = useSelector(selectAllBlueprintEvents);
    const systemScreenshotMarkers = useSelector(selectSystemScreenshotMarkers);
    const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
    const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);

    const llmProjectSettings = useMemo<LlmProjectSettingsContext>(() => {
        const participantRecords = participants.map((participant) => ({
            name: String(participant.name ?? "").trim() || "Participant",
            role: String(participant.role ?? "").trim() || "Researcher",
        }));
        const availableRoles = Array.from(new Set(participantRecords.map((participant) => participant.role)));

        return {
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
    }, [defaultStages, designStudyEvents, participants, projectGoal, timelineStages, timelineStartEnd.end, timelineStartEnd.start, title]);

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

    const {
        onAttachFile,
        onAttachFileToCanvas,
        pendingDrop,
        generatedAtInput,
        setGeneratedAtInput,
        processPendingDrop,
        cancelPendingDrop,
    } = useFileAttachmentProcessing({
        projectId,
        dispatch,
        nodes,
        edges,
        allFiles,
        projectSettings: llmProjectSettings,
        setLoading,
    });

    const onAttachFileForNode = useCallback((nodeId: string, file: File) => {
        if (reviewOnly) return;
        void onAttachFile(nodeId, file);
    }, [onAttachFile, reviewOnly]);

    const onAttachFileForCanvas = useCallback(async (file: File, dropPosition: { x: number; y: number }) => {
        if (reviewOnly) return;
        await onAttachFileToCanvas(file, dropPosition);
    }, [onAttachFileToCanvas, reviewOnly]);

    const flushQueuedPositionChanges = useCallback(() => {
        nodeChangeRafRef.current = null;
        if (reviewOnly) {
            queuedPositionChangesRef.current = [];
            return;
        }
        if (viewMode !== "explore") {
            queuedPositionChangesRef.current = [];
            return;
        }

        if (queuedPositionChangesRef.current.length === 0) return;
        const queuedChanges = queuedPositionChangesRef.current;
        queuedPositionChangesRef.current = [];
        dispatch(onNodesChange(queuedChanges));
    }, [dispatch, reviewOnly, viewMode]);

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        if (reviewOnly) return;
        if (viewMode !== "explore") return;

        const immediateChanges = changes.filter((change) => change.type !== "position");
        const positionChanges = changes.filter((change) => change.type === "position");

        if (immediateChanges.length > 0) {
            dispatch(onNodesChange(immediateChanges));
        }

        if (positionChanges.length > 0) {
            queuedPositionChangesRef.current.push(...positionChanges);
            if (nodeChangeRafRef.current === null) {
                nodeChangeRafRef.current = window.requestAnimationFrame(flushQueuedPositionChanges);
            }
        }
    }, [dispatch, reviewOnly, viewMode, flushQueuedPositionChanges]);

    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => {
        if (reviewOnly) return;
        dispatch(onEdgesChange(changes));
    }, [dispatch, reviewOnly]);

    const resetFiltersForCanvasCreation = useCallback(() => {
        setViewMode("explore");
        setActiveQuery("");
        setQueryMatchedNodeIds(null);
    }, []);

    const maybeCreateBlueprintEventFromConnection = useCallback((
        sourceNode: nodeType | undefined,
        targetNode: nodeType | undefined,
        sourceLabel: string,
        targetLabel: string,
    ) => {
        if (reviewOnly) return;
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
            occurredAt: new Date().toISOString(),
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
    }, [dispatch, blueprintEvents, reviewOnly]);

    const handleConnectSelection = useCallback((option: EdgeConnectOption) => {
        if (reviewOnly) return;
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
                edgeLabelFrom(edge) === label
            ));
            if (!alreadyConnected) {
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
    }, [dispatch, reviewOnly, edges, nodes, maybeCreateBlueprintEventFromConnection]);

    const handleConnect = useCallback((connection: Connection) => {
        if (reviewOnly) return;
        if (!connection.source || !connection.target) return;
        if (viewMode !== "explore") return;

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
    }, [nodes, reviewOnly, viewMode]);

    const onDataPropertyChange = useCallback((nodeProps: nodeType, value: unknown, propertyName: string) => {
        if (reviewOnly) return;
        const data = { ...nodeProps.data } as Record<string, unknown> & nodeType["data"];
        if (propertyName === "label" && typeof value === "string") {
            let resolvedType: cardType = "social";
            if (value === "requirement" || value === "insight") {
                resolvedType = "technical";
            }
            data.type = resolvedType;
        }

        data[propertyName] = value;

        dispatch(updateNode({
            ...nodeProps,
            data: data as nodeType["data"],
        }));
    }, [dispatch, reviewOnly]);

    const onDeleteNode = useCallback((nodeId: string) => {
        if (reviewOnly) return;
        dispatch(removeNode(nodeId));
    }, [dispatch, reviewOnly]);

    const onDetachFile = useCallback((nodeId: string, fileId: string) => {
        if (reviewOnly) return;
        dispatch(detachFileIdFromNode({ nodeId, fileId }));
    }, [dispatch, reviewOnly]);

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

    const nodeTypes = useMemo(() => ({
        card: (nodeProps: NodeProps) => {
            const cardProps = {
                ...(nodeProps as unknown as CardProps),
                onAttachFile: onAttachFileForNode,
                onDetachFile,
                onDataPropertyChange,
                onDeleteNode,
                participantOptions: participantNames,
            };

            return <Card {...cardProps} />;
        },
        blueprint: BlueprintNode,
        blueprintGroup: BlueprintGroupNode,
        blueprintComponent: BlueprintComponentNode,
    }), [onAttachFileForNode, onDetachFile, onDataPropertyChange, onDeleteNode, participantNames]);

    const edgeTypes = useMemo(() => ({
        relation: RelationEdge,
    }), []);

    const selectedLabelSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);
    const queryMatchedNodeSet = useMemo(
        () => (queryMatchedNodeIds ? new Set(queryMatchedNodeIds) : null),
        [queryMatchedNodeIds],
    );

    const labelFilteredNodes = useMemo(() => {
        return nodes.filter((node) => {
            const rawLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
            if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
            return selectedLabelSet.has(rawLabel as cardLabel);
        });
    }, [nodes, selectedLabelSet]);

    const emphasizedBlueprintComponentIds = useMemo(() => {
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const emphasized = new Set<string>();

        for (let index = 0; index < edges.length; index++) {
            const edge = edges[index];
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
    }, [nodes, edges]);
    const connectedBlueprintComponentNodeIds = useMemo(
        () => Array.from(emphasizedBlueprintComponentIds),
        [emphasizedBlueprintComponentIds]
    );

    const filteredNodes = useMemo(() => {
        const baseNodes = queryMatchedNodeSet
            ? labelFilteredNodes.filter((node) => queryMatchedNodeSet.has(node.id))
            : labelFilteredNodes;
        const normalizedHoveredCodebasePath = hoveredCodebaseFilePath
            ? normalizePath(hoveredCodebaseFilePath)
            : "";

        return baseNodes.map((node) => {
            const nodeLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
            const nodeData = node.data as Record<string, unknown>;
            if (nodeLabel === "blueprint_component") {
                const attachedCodebasePaths = Array.isArray(nodeData.codebaseFilePaths)
                    ? nodeData.codebaseFilePaths
                        .filter((path): path is string => typeof path === "string")
                        .map((path) => normalizePath(path))
                    : [];
                const isHoveredByFile = normalizedHoveredCodebasePath !== "" &&
                    attachedCodebasePaths.includes(normalizedHoveredCodebasePath);
                const isEmphasized = emphasizedBlueprintComponentIds.has(node.id) || isHoveredByFile;
                return {
                    ...node,
                    style: {
                        ...(node.style ?? {}),
                        opacity: isEmphasized ? 1 : 0.5,
                    },
                };
            }

            const isCardNode = CARD_LABELS.includes(nodeLabel as cardLabel);
            if (isCardNode && hoveredAssetFileId) {
                const attachmentIds = Array.isArray(nodeData.attachmentIds)
                    ? nodeData.attachmentIds.filter((id): id is string => typeof id === "string")
                    : [];
                if (attachmentIds.includes(hoveredAssetFileId)) {
                    return {
                        ...node,
                        style: {
                            ...(node.style ?? {}),
                            boxShadow: "0 0 0 3px rgba(0, 168, 219, 0.85)",
                            borderRadius: 18,
                        },
                    };
                }
            }

            return node;
        });
    }, [
        labelFilteredNodes,
        queryMatchedNodeSet,
        emphasizedBlueprintComponentIds,
        hoveredCodebaseFilePath,
        hoveredAssetFileId,
    ]);

    const compactBlueprintNodes = useMemo(() => {
        if (viewMode !== "blueprintComponents") return null;

        const absoluteById = resolveAbsoluteNodePositions(nodes);
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const visibleNodeIds = new Set<string>();

        const blueprintComponents = nodes.filter((node) => (
            String(node.data?.label ?? "").toLowerCase() === "blueprint_component"
        ));

        if (blueprintComponents.length === 0) return [];

        for (const componentNode of blueprintComponents) {
            visibleNodeIds.add(componentNode.id);
            let parentId = componentNode.parentId;
            while (parentId) {
                const parentNode = nodeById.get(parentId);
                if (!parentNode) break;
                const parentLabel = String(parentNode.data?.label ?? "").toLowerCase();
                if (parentLabel !== "blueprint_group") break;
                visibleNodeIds.add(parentNode.id);
                parentId = parentNode.parentId;
            }
        }

        const visibleBlueprintNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
        const visibleById = new Map(visibleBlueprintNodes.map((node) => [node.id, node]));

        const toDimension = (value: unknown, fallback: number) => {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
            const parsed = Number.parseFloat(String(value ?? ""));
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
            return fallback;
        };

        const roots = visibleBlueprintNodes
            .filter((node) => {
                if (node.parentId && visibleById.has(node.parentId)) return false;
                const label = String(node.data?.label ?? "").toLowerCase();
                return label === "blueprint_group" || label === "blueprint_component";
            })
            .map((node) => {
                const absolute = absoluteById.get(node.id) ?? { x: node.position.x, y: node.position.y };
                const label = String(node.data?.label ?? "").toLowerCase();
                const style = node.style as Record<string, unknown> | undefined;
                const width = label === "blueprint_group"
                    ? toDimension(style?.width, 360)
                    : 112;
                const height = label === "blueprint_group"
                    ? toDimension(style?.height, 220)
                    : 112;
                return {
                    id: node.id,
                    x: absolute.x,
                    y: absolute.y,
                    width,
                    height,
                };
            })
            .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

        const compactGap = 34;
        const startX = 120;
        const startY = 120;
        const columns = Math.max(1, Math.ceil(Math.sqrt(roots.length)));
        const newRootAbsolutePositions = new Map<string, { x: number; y: number }>();

        let cursorX = startX;
        let cursorY = startY;
        let rowMaxHeight = 0;

        for (let index = 0; index < roots.length; index++) {
            const root = roots[index];
            const col = index % columns;
            if (col === 0 && index > 0) {
                cursorY += rowMaxHeight + compactGap;
                cursorX = startX;
                rowMaxHeight = 0;
            }

            newRootAbsolutePositions.set(root.id, { x: cursorX, y: cursorY });
            cursorX += root.width + compactGap;
            rowMaxHeight = Math.max(rowMaxHeight, root.height);
        }

        return visibleBlueprintNodes.map((node) => {
            const newRootAbsolute = newRootAbsolutePositions.get(node.id);
            if (!newRootAbsolute) return node;

            if (node.parentId && visibleById.has(node.parentId)) return node;

            return {
                ...node,
                position: newRootAbsolute,
            };
        });
    }, [nodes, viewMode]);

    const filteredEdges = useMemo(() => {
        const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
        return edges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [edges, filteredNodes]);

    const featureViewNodes = useMemo(() => {
        if (viewMode !== "features") return null;

        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const adjacency = new Map<string, string[]>();

        const connect = (a: string, b: string) => {
            const listA = adjacency.get(a);
            if (listA) {
                listA.push(b);
            } else {
                adjacency.set(a, [b]);
            }
        };

        for (const edge of edges) {
            connect(edge.source, edge.target);
            connect(edge.target, edge.source);
        }

        const requirementOrBlueprintIds = new Set(
            nodes
                .filter((node) => {
                    const label = String(node.data?.label ?? "").toLowerCase();
                    if (label === "blueprint_component") return true;
                    return normalizeNodeLabel(label) === "requirement";
                })
                .map((node) => node.id)
        );

        const bfsDistances = (startIds: string[]): Map<string, number> => {
            const distances = new Map<string, number>();
            const queue: string[] = [];
            for (const startId of startIds) {
                distances.set(startId, 0);
                queue.push(startId);
            }

            let index = 0;
            while (index < queue.length) {
                const currentId = queue[index++];
                const currentDist = distances.get(currentId);
                if (currentDist === undefined) continue;
                const nextIds = adjacency.get(currentId) ?? [];
                for (const nextId of nextIds) {
                    if (distances.has(nextId)) continue;
                    distances.set(nextId, currentDist + 1);
                    queue.push(nextId);
                }
            }
            return distances;
        };

        const activityIds = nodes
            .filter((node) => normalizeNodeLabel(String(node.data?.label ?? "")) === "activity")
            .map((node) => node.id);

        const includedNodeIds = new Set<string>(requirementOrBlueprintIds);

        for (const anchorId of requirementOrBlueprintIds) {
            const neighbors = adjacency.get(anchorId) ?? [];
            for (const neighborId of neighbors) {
                includedNodeIds.add(neighborId);
            }
        }

        const distancesFromAnchors = bfsDistances(Array.from(requirementOrBlueprintIds));

        for (const activityId of activityIds) {
            const shortestToAnchor = distancesFromAnchors.get(activityId);
            if (shortestToAnchor === undefined) continue;

            const distancesFromActivity = bfsDistances([activityId]);
            for (const [nodeId, distFromAnchor] of distancesFromAnchors.entries()) {
                const distFromActivity = distancesFromActivity.get(nodeId);
                if (distFromActivity === undefined) continue;
                if (distFromAnchor + distFromActivity === shortestToAnchor) {
                    includedNodeIds.add(nodeId);
                }
            }
        }

        const includeBlueprintAncestors = (nodeId: string) => {
            let parentId = nodeById.get(nodeId)?.parentId;
            while (parentId) {
                const parentNode = nodeById.get(parentId);
                if (!parentNode) break;
                const label = String(parentNode.data?.label ?? "").toLowerCase();
                if (label !== "blueprint_group") break;
                includedNodeIds.add(parentNode.id);
                parentId = parentNode.parentId;
            }
        };

        for (const nodeId of Array.from(includedNodeIds)) {
            includeBlueprintAncestors(nodeId);
        }

        return nodes.filter((node) => includedNodeIds.has(node.id));
    }, [viewMode, nodes, edges]);

    const evolutionBaseNodes = useMemo(() => {
        if (viewMode === "blueprintComponents") {
            return compactBlueprintNodes ?? [];
        }
        if (viewMode === "features") {
            return featureViewNodes ?? [];
        }
        if (viewMode !== "evolution") return filteredNodes;
        return filteredNodes.filter((node) => {
            const label = String(node.data?.label ?? "").toLowerCase();
            return label !== "blueprint_component" && label !== "blueprint_group";
        });
    }, [viewMode, filteredNodes, compactBlueprintNodes, featureViewNodes]);

    const displayedNodes = useMemo(() => {
        if (viewMode === "evolution") {
            return buildEvolutionLayoutNodes(evolutionBaseNodes, filteredEdges);
        }
        return evolutionBaseNodes;
    }, [viewMode, evolutionBaseNodes, filteredEdges]);

    const displayedEdges = useMemo(() => {
        if (viewMode === "blueprintComponents" || viewMode === "features") {
            const visibleNodeIds = new Set(displayedNodes.map((node) => node.id));
            return edges.filter((edge) => (
                visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
            ));
        }
        const visibleNodeIds = new Set(displayedNodes.map((node) => node.id));
        return filteredEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [viewMode, edges, filteredEdges, displayedNodes]);

    const isInsideSystemBlueprintParentBox = useCallback((position: { x: number; y: number }) => {
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
    }, [nodes]);

    const onCanvasClick = useCallback((e: React.MouseEvent) => {
        if (reviewOnly) return;
        if (viewMode !== "explore") return;
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
                },
            }));
            return;
        }

        resetFiltersForCanvasCreation();
        dispatch(addNode({
            id: crypto.randomUUID(),
            position,
            type: "card",
            data: {
                label: "activity",
                type: "social",
                title: "Untitled",
                createdAt: new Date().toISOString(),
                relevant: true,
            },
        }));
    }, [dispatch, reviewOnly, viewMode, cursorMode, screenToFlowPosition, isInsideSystemBlueprintParentBox, resetFiltersForCanvasCreation]);

    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        if (reviewOnly) return;
        const dragTypes = Array.from(e.dataTransfer?.types ?? []);
        const hasFiles = dragTypes.includes("Files");
        const hasBlueprint = dragTypes.includes(BLUEPRINT_DRAG_MIME);
        const hasGitHubFile = dragTypes.includes("application/x-vitral-github-file");
        if (!hasFiles && !hasBlueprint && !hasGitHubFile) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = viewMode === "explore" ? "copy" : "none";

        if (viewMode !== "explore") return;
    }, [reviewOnly, viewMode]);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        if (reviewOnly) return;
        const blueprintRaw = e.dataTransfer?.getData(BLUEPRINT_DRAG_MIME);
        if (blueprintRaw) {
            e.preventDefault();
            if (viewMode !== "explore") return;

            const payload = parseBlueprintDragPayload(blueprintRaw);
            if (!payload) return;

            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const graph = buildBlueprintComponentGraph(payload, position);
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
        if (viewMode !== "explore") return;

        const basePosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        void (async () => {
            for (let index = 0; index < droppedFiles.length; index++) {
                await onAttachFileForCanvas(droppedFiles[index], {
                    x: basePosition.x + (index * 300),
                    y: basePosition.y,
                });
            }
        })();
    }, [dispatch, onAttachFileForCanvas, reviewOnly, screenToFlowPosition, viewMode]);

    const onFreeInputSubmit = useCallback(async (x: number, y: number, userText: string) => {
        if (reviewOnly) return;
        setCursorMode("");
        setLoading(true);

        try {
            const response: { cards: llmCardData[]; connections: llmConnectionData[] } =
                await requestCardsLLMTextInput(userText);

            if (response?.cards) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(
                    response.cards,
                    screenToFlowPosition({ x, y }),
                    { createdAt: new Date().toISOString() },
                );
                const generatedEdges = llmConnectionsToEdges(
                    response.connections,
                    idMap,
                    response.cards
                );

                dispatch(addNodes(generatedNodes));
                dispatch(connectEdges(generatedEdges));
            }
        } finally {
            setLoading(false);
        }
    }, [dispatch, reviewOnly, screenToFlowPosition]);

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
        if (reviewOnly) return;
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
                        occurredAt: new Date().toISOString(),
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
    }, [dispatch, reviewOnly, nodes, blueprintEvents, codebaseSubtracks]);

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
        if (!reviewOnly) return;
        if (cursorMode !== "") {
            setCursorMode("");
        }
    }, [cursorMode, reviewOnly]);

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
        if (viewMode !== "explore") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, selectedLabels, queryMatchedNodeIds, fitView]);

    useEffect(() => {
        if (viewMode === "explore") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, displayedNodes, fitView]);

    useEffect(() => {
        if (viewMode === "explore") return;
        queuedPositionChangesRef.current = [];
        if (nodeChangeRafRef.current !== null) {
            window.cancelAnimationFrame(nodeChangeRafRef.current);
            nodeChangeRafRef.current = null;
        }
        setPendingConnectionMenu(null);
    }, [viewMode]);

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
        return nodes
            .filter((node) => {
                const rawLabel = normalizeNodeLabel(String(node.data?.label ?? ""));
                if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
                return labelSet.has(rawLabel as cardLabel);
            })
            .map((node) => node.id);
    }, [nodes]);

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
                minScore: 0.3
            });
            if (requestId !== queryRequestIdRef.current) return;
            setActiveQuery(trimmed);
            setQueryMatchedNodeIds(response.matchedNodeIds);
        } catch (error) {
            if (requestId !== queryRequestIdRef.current) return;
            console.error("Failed to refresh filtered nodes for the current query.", error);
        }
    }, [projectId]);

    const clearCanvasFilter = useCallback(() => {
        setActiveQuery("");
        setQueryMatchedNodeIds(null);
        setViewMode("explore");
        setChatError(null);
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
                    limit: Math.max(1, Math.min(200, scopeNodeIds.length || 60)),
                    minScore: 0.3,
                });
                if (requestId !== chatRequestIdRef.current) return;

                const assistantEntry: CanvasChatEntry = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: response.reply,
                };
                setChatMessages((prev) => [...prev, assistantEntry].slice(-40));

                if (response.applyFilter) {
                    setViewMode("explore");
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
    }, [chatInput, chatLoading, chatMessages, labelFilteredNodes, projectId]);

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
                });

                const abstractFallback = abstract || "This project explores the problem space, design constraints, and implementation strategy using the available artifacts and timeline context.";

                const [introduction, literatureReview, designGoals, timelineNarrative, methods, conclusion] = await Promise.all([
                    requestMarkdownReportSectionLLM("MarkdownReportIntroduction", {
                        projectTitle,
                        settings: settingsInfo,
                        abstract: abstractFallback,
                    }),
                    requestMarkdownReportSectionLLM("MarkdownReportLiteratureReview", {
                        projectTitle,
                        abstract: abstractFallback,
                        literatureCards,
                        blueprintComponentsWithParents,
                    }),
                    requestMarkdownReportSectionLLM("MarkdownReportDesignGoals", {
                        projectTitle,
                        abstract: abstractFallback,
                        requirementCards: cardsByLabel("requirement"),
                    }),
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
                    }),
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
                    }),
                    requestMarkdownReportSectionLLM("MarkdownReportConclusion", {
                        projectTitle,
                        abstract: abstractFallback,
                        insightCards: cardsByLabel("insight"),
                    }),
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
        timelineStages,
        timelineStartEnd.end,
        timelineStartEnd.start,
        title,
    ]);

    const handleExportProject = useCallback(() => {
        if (exportingProject) return;
        setExportingProject(true);

        void (async () => {
            try {
                const blob = await exportProjectVi(projectId);
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

    const handleToggleTimeline = useCallback(() => {
        setTimelineOpen((prev) => !prev);
    }, []);

    const handleSetTitle = useCallback((newTitle: string) => {
        if (reviewOnly) return;
        void updateDocumentMeta(projectId, { title: newTitle });
    }, [projectId, reviewOnly]);

    const handleOpenSettings = useCallback(() => {
        navigate(`/project/${projectId}/setup`);
    }, [navigate, projectId]);

    const handleGoHome = useCallback(() => {
        navigate("/projects");
    }, [navigate]);

    const handleFreeInputClicked = useCallback(() => {
        if (reviewOnly) return;
        setCursorMode("text");
    }, [reviewOnly]);

    const handleNodeInputClicked = useCallback(() => {
        if (reviewOnly) return;
        setCursorMode("node");
    }, [reviewOnly]);

    const handleBlueprintComponentInputClicked = useCallback(() => {
        if (reviewOnly) return;
        setCursorMode("blueprint_component");
    }, [reviewOnly]);

    const handlePointerClicked = useCallback(() => {
        setCursorMode("");
    }, []);

    const handleStageUpdate = useCallback((stage: Stage) => {
        if (reviewOnly) return;
        dispatch(updateStage({
            ...stage,
            start: fromDate(stage.start),
            end: fromDate(stage.end),
        }));
    }, [dispatch, reviewOnly]);

    const handleStageCreation = useCallback((name: string) => {
        if (reviewOnly) return;
        dispatch(addDefaultStage(name));
    }, [dispatch, reviewOnly]);

    const handleStageLaneCreation = useCallback((name: string) => {
        if (reviewOnly) return;
        dispatch(addStage(name));
    }, [dispatch, reviewOnly]);

    const handleStageLaneDeletion = useCallback((id: string) => {
        if (reviewOnly) return;
        dispatch(deleteStage(id));
    }, [dispatch, reviewOnly]);

    const handleStageBoundaryChange = useCallback((prevId: string, nextId: string, date: Date) => {
        if (reviewOnly) return;
        dispatch(changeStageBoundary({
            prevId,
            nextId,
            date: fromDate(date),
        }));
    }, [dispatch, reviewOnly]);

    const handleSyncCodebaseEvents = useCallback(async () => {
        if (reviewOnly) return;
        await checkGitStatus();
    }, [checkGitStatus, reviewOnly]);

    const handleAddSystemScreenshotMarker = useCallback(() => {
        if (reviewOnly) return;
        dispatch(addSystemScreenshotMarker({
            id: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            imageDataUrl: "",
        }));
    }, [dispatch, reviewOnly]);

    const handleUploadSystemScreenshotForLatestMarker = useCallback(async (file: File) => {
        if (reviewOnly) return;
        try {
            const imageDataUrl = await readImageFileAsDataUrl(file);
            const { width: imageWidth, height: imageHeight } = await readImageDimensionsFromDataUrl(imageDataUrl);

            let markerId = mostRecentSystemScreenshotMarker?.id;
            if (!markerId) {
                markerId = crypto.randomUUID();
                dispatch(addSystemScreenshotMarker({
                    id: markerId,
                    occurredAt: new Date().toISOString(),
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
            });

            dispatch(updateSystemScreenshotMarkerImage({
                markerId,
                zones,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load screenshot.";
            window.alert(message);
        }
    }, [codebaseSubtracks, dispatch, mostRecentSystemScreenshotMarker?.id, projectGoal, projectId, reviewOnly, title]);

    const handleDeleteAsset = useCallback(async (file: { id: string; name: string }) => {
        if (reviewOnly) return;
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
    }, [dispatch, hoveredAssetFileId, projectId, reviewOnly]);

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
                nodesDraggable={viewMode === "explore" && !reviewOnly}
                cursorMode={cursorMode}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onClick={onCanvasClick}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
            />

            <EdgeConnectMenu
                x={pendingConnectionMenu?.x ?? 0}
                y={pendingConnectionMenu?.y ?? 0}
                defaultLabel={pendingConnectionMenu?.defaultLabel ?? "related to"}
                open={!reviewOnly && pendingConnectionMenu !== null}
                onClose={() => setPendingConnectionMenu(null)}
                onSelect={handleConnectSelection}
            />

            <CanvasSidebar
                title={title}
                onSetTitle={handleSetTitle}
                onGoHome={handleGoHome}
                onOpenSettings={handleOpenSettings}
                onExportProject={handleExportProject}
                exportingProject={exportingProject}
                onExportMarkdown={handleExportMarkdown}
                exportingMarkdown={exportingMarkdown}
                bottomOffsetPx={canvasSidebarBottomOffset}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabelWithQueryRefresh}
                systemPaperResults={systemPaperResults}
                systemPapersLoading={systemPapersLoading}
                systemPapersError={systemPapersError}
                onSystemPapersRefresh={handleSystemPapersRefresh}
            />

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

            {!reviewOnly ? (
                <Toolbar
                    onFreeInputClicked={handleFreeInputClicked}
                    onNodeInputClicked={handleNodeInputClicked}
                    onBlueprintComponentClicked={handleBlueprintComponentInputClicked}
                    onPointerClicked={handlePointerClicked}
                    activeMode={cursorMode}
                    shifted={timelineOpen}
                />
            ) : null}

            {!reviewOnly ? (
                <SystemScreenshotPanel
                    rightOffsetPx={RIGHT_SIDEBAR_WIDTH_PX + 12}
                    latestImageDataUrl={mostRecentSystemScreenshotMarker?.imageDataUrl ?? ""}
                    onAddMarker={handleAddSystemScreenshotMarker}
                    onUploadForLatestMarker={handleUploadSystemScreenshotForLatestMarker}
                />
            ) : null}

            <RightSidebar
                projectId={projectId}
                connectionStatus={gitConnectionStatus}
                assetsRecords={allFiles}
                reviewOnly={reviewOnly}
                bottomOffsetPx={canvasSidebarBottomOffset}
                onAssetHover={setHoveredAssetFileId}
                deletingAssetId={deletingAssetId}
                onDeleteAsset={reviewOnly ? undefined : handleDeleteAsset}
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

            {cursorMode === "text" && !reviewOnly ? (
                <FreeInputZone onInputSubmit={onFreeInputSubmit} />
            ) : null}

            <LoadSpinner loading={loading} />

            {!reviewOnly ? (
                <PendingFileModal
                    pendingDrop={pendingDrop}
                    generatedAtInput={generatedAtInput}
                    onGeneratedAtInputChange={setGeneratedAtInput}
                    onCancel={cancelPendingDrop}
                    onProcess={processPendingDrop}
                />
            ) : null}

            <TimelineDock
                projectId={projectId}
                open={timelineOpen}
                onToggleOpen={handleToggleTimeline}
                readOnly={reviewOnly}
                startMarker={timelineStartEnd.start}
                endMarker={timelineStartEnd.end}
                projectName={title}
                projectGoal={projectGoal}
                codebaseEvents={gitEvents}
                designStudyEvents={designStudyEvents}
                blueprintEvents={blueprintEvents}
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
