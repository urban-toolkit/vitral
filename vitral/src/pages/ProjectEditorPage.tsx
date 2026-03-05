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
import { requestCardsLLMTextInput, llmCardsToNodes, llmConnectionsToEdges } from "@/func/LLMRequest";
import { queryDocumentNodes, querySystemPapers, updateDocumentMeta, type QuerySystemPapersResult } from "@/api/stateApi";
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
    detachFileIdFromNode,
    onEdgesChange,
    onNodesChange,
    removeNode,
    updateNode,
} from "@/store/flowSlice";
import { selectAllFiles } from "@/store/filesSlice";
import { selectAllGitHubEvents, setGithubEvents } from "@/store/gitEventsSlice";
import {
    addBlueprintEvent,
    addDefaultStage,
    addStage,
    changeStageBoundary,
    deleteStage,
    selectAllBlueprintEvents,
    selectCodebaseSubtracks,
    selectAllDesignStudyEvents,
    selectAllStages,
    selectDefaultStages,
    selectParticipants,
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
import {
    TimelineDock,
    TIMELINE_DOCK_HEIGHT,
    TIMELINE_DOCK_TOGGLE_HEIGHT,
} from "@/pages/projectEditor/TimelineDock";
import { useFileAttachmentProcessing } from "@/pages/projectEditor/useFileAttachmentProcessing";

const SYSTEM_PAPER_CARD_LABELS = new Set<cardLabel>(["task", "requirement"]);

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
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
    const { status, error } = useDocumentSync(projectId);

    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { screenToFlowPosition, fitView } = useReactFlow();

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<CursorMode>("");
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [viewMode, setViewMode] = useState<CanvasViewMode>("explore");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [selectedLabels, setSelectedLabels] = useState<cardLabel[]>([...CARD_LABELS]);
    const [queryInput, setQueryInput] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [queryMatchedNodeIds, setQueryMatchedNodeIds] = useState<string[] | null>(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [systemPaperResults, setSystemPaperResults] = useState<QuerySystemPapersResult[]>([]);
    const [systemPapersLoading, setSystemPapersLoading] = useState(false);
    const [systemPapersError, setSystemPapersError] = useState<string | null>(null);
    const [gitConnectionStatus, setGitConnectionStatus] = useState<GitConnectionStatus>({ connected: false });
    const [hoveredAssetFileId, setHoveredAssetFileId] = useState<string | null>(null);
    const queuedPositionChangesRef = useRef<NodeChange<nodeType>[]>([]);
    const nodeChangeRafRef = useRef<number | null>(null);
    const queryRequestIdRef = useRef(0);

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
  const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
  const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);

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
        allFiles,
        setLoading,
    });

    const flushQueuedPositionChanges = useCallback(() => {
        nodeChangeRafRef.current = null;
        if (viewMode === "evolution") {
            queuedPositionChangesRef.current = [];
            return;
        }

        if (queuedPositionChangesRef.current.length === 0) return;
        const queuedChanges = queuedPositionChangesRef.current;
        queuedPositionChangesRef.current = [];
        dispatch(onNodesChange(queuedChanges));
    }, [dispatch, viewMode]);

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        if (viewMode === "evolution") return;

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
    }, [dispatch, viewMode, flushQueuedPositionChanges]);

    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => {
        dispatch(onEdgesChange(changes));
    }, [dispatch]);

    const handleConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;

        const sourceNode = nodes.find((node) => node.id === connection.source);
        const targetNode = nodes.find((node) => node.id === connection.target);
        const sourceLabel = String(sourceNode?.data?.label ?? "").toLowerCase();
        const targetLabel = String(targetNode?.data?.label ?? "").toLowerCase();

        if (!isAllowedConnection(sourceLabel, targetLabel)) return;

        const alreadyConnected = edges.some(
            (edge) => edge.source === connection.source && edge.target === connection.target,
        );
        if (alreadyConnected) return;

        const label = relationLabelFor(sourceLabel, targetLabel);
        if (!label) return;
        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: connection.source,
            target: connection.target,
            type: "relation",
            label,
            data: { label, from: sourceLabel, to: targetLabel },
        }]));

        const sourceIsTaskOrRequirement = sourceLabel === "task" || sourceLabel === "requirement";
        const targetIsTaskOrRequirement = targetLabel === "task" || targetLabel === "requirement";
        const sourceIsBlueprintComponent = sourceLabel === "blueprint_component";
        const targetIsBlueprintComponent = targetLabel === "blueprint_component";

        if (
            (sourceIsTaskOrRequirement && targetIsBlueprintComponent) ||
            (targetIsTaskOrRequirement && sourceIsBlueprintComponent)
        ) {
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
        }
    }, [dispatch, nodes, edges, blueprintEvents]);

    const onDataPropertyChange = useCallback((nodeProps: nodeType, value: unknown, propertyName: string) => {
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
    }, [dispatch]);

    const onDeleteNode = useCallback((nodeId: string) => {
        dispatch(removeNode(nodeId));
    }, [dispatch]);

    const onDetachFile = useCallback((nodeId: string, fileId: string) => {
        dispatch(detachFileIdFromNode({ nodeId, fileId }));
    }, [dispatch]);

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
                onAttachFile,
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
    }), [onAttachFile, onDetachFile, onDataPropertyChange, onDeleteNode, participantNames]);

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
            const rawLabel = String(node.data?.label ?? "").toLowerCase();
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

            const sourceLabel = String(sourceNode.data?.label ?? "").toLowerCase();
            const targetLabel = String(targetNode.data?.label ?? "").toLowerCase();
            const sourceIsComponent = sourceLabel === "blueprint_component";
            const targetIsComponent = targetLabel === "blueprint_component";
            const sourceIsTaskOrRequirement = sourceLabel === "task" || sourceLabel === "requirement";
            const targetIsTaskOrRequirement = targetLabel === "task" || targetLabel === "requirement";

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
            const nodeLabel = String(node.data?.label ?? "").toLowerCase();
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
                        opacity: isEmphasized ? 1 : 0.35,
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

    const filteredEdges = useMemo(() => {
        const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
        return edges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [edges, filteredNodes]);

    const evolutionBaseNodes = useMemo(() => {
        if (viewMode !== "evolution") return filteredNodes;
        return filteredNodes.filter((node) => {
            const label = String(node.data?.label ?? "").toLowerCase();
            return label !== "blueprint_component" && label !== "blueprint_group";
        });
    }, [viewMode, filteredNodes]);

    const displayedNodes = useMemo(() => {
        if (viewMode === "evolution") {
            return buildEvolutionLayoutNodes(evolutionBaseNodes, filteredEdges);
        }
        return evolutionBaseNodes;
    }, [viewMode, evolutionBaseNodes, filteredEdges]);

    const displayedEdges = useMemo(() => {
        const visibleNodeIds = new Set(displayedNodes.map((node) => node.id));
        return filteredEdges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [filteredEdges, displayedNodes]);

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
        if (viewMode === "evolution") return;
        if (cursorMode !== "node" && cursorMode !== "blueprint_component") return;

        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (cursorMode === "blueprint_component") {
            if (isInsideSystemBlueprintParentBox(position)) return;

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
    }, [dispatch, viewMode, cursorMode, screenToFlowPosition, isInsideSystemBlueprintParentBox]);

    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        const dragTypes = Array.from(e.dataTransfer?.types ?? []);
        const hasFiles = dragTypes.includes("Files");
        const hasBlueprint = dragTypes.includes(BLUEPRINT_DRAG_MIME);
        const hasGitHubFile = dragTypes.includes("application/x-vitral-github-file");
        if (!hasFiles && !hasBlueprint && !hasGitHubFile) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = viewMode === "evolution" ? "none" : "copy";

        if (viewMode === "evolution") return;
    }, [viewMode]);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        const blueprintRaw = e.dataTransfer?.getData(BLUEPRINT_DRAG_MIME);
        if (blueprintRaw) {
            e.preventDefault();
            if (viewMode === "evolution") return;

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
        if (viewMode === "evolution") return;

        const basePosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        void (async () => {
            for (let index = 0; index < droppedFiles.length; index++) {
                await onAttachFileToCanvas(droppedFiles[index], {
                    x: basePosition.x + (index * 300),
                    y: basePosition.y,
                });
            }
        })();
    }, [dispatch, onAttachFileToCanvas, screenToFlowPosition, viewMode]);

    const onFreeInputSubmit = useCallback(async (x: number, y: number, userText: string) => {
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
    }, [dispatch, screenToFlowPosition]);

    const fetchGithubEvents = useCallback(async (connected: boolean) => {
        if (!connected) return;

        const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
        if (!info.github_repo) return;

        const events = await getGitHubEvents(projectId, { limit: 5000 });

        dispatch(setGithubEvents(events));
    }, [dispatch, projectId]);

    const checkGitStatus = useCallback(async () => {
        const status = await githubStatus();
        setGitConnectionStatus(status);
        await fetchGithubEvents(status.connected);
    }, [fetchGithubEvents]);

    useEffect(() => {
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
    }, [dispatch, nodes, blueprintEvents, codebaseSubtracks]);

    useEffect(() => {
        dispatch(setGithubEvents([]));
        void checkGitStatus();
    }, [dispatch, checkGitStatus]);

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
        if (viewMode !== "explore") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, selectedLabels, queryMatchedNodeIds, fitView]);

    useEffect(() => {
        if (viewMode !== "evolution") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, displayedNodes, fitView]);

    useEffect(() => {
        if (viewMode !== "evolution") return;
        queuedPositionChangesRef.current = [];
        if (nodeChangeRafRef.current !== null) {
            window.cancelAnimationFrame(nodeChangeRafRef.current);
            nodeChangeRafRef.current = null;
        }
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
                const rawLabel = String(node.data?.label ?? "").toLowerCase();
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
            setQueryError(null);
            return;
        }

        const requestId = ++queryRequestIdRef.current;
        setQueryLoading(true);
        setQueryError(null);

        try {
            const response = await queryDocumentNodes(projectId, {
                query: trimmed,
                scopeNodeIds,
                limit: Math.max(1, Math.min(200, scopeNodeIds.length || 60)),
            });
            if (requestId !== queryRequestIdRef.current) return;
            setActiveQuery(trimmed);
            setQueryMatchedNodeIds(response.matchedNodeIds);
        } catch (error) {
            if (requestId !== queryRequestIdRef.current) return;
            const message = error instanceof Error ? error.message : "Failed to run natural language query.";
            setQueryError(message);
        } finally {
            if (requestId === queryRequestIdRef.current) {
                setQueryLoading(false);
            }
        }
    }, [projectId]);

    const handleQuerySubmit = useCallback(() => {
        const scopeNodeIds = labelFilteredNodes.map((node) => node.id);
        void runNaturalLanguageQuery(queryInput, scopeNodeIds);
    }, [labelFilteredNodes, queryInput, runNaturalLanguageQuery]);

    const handleQueryClear = useCallback(() => {
        setQueryInput("");
        setActiveQuery("");
        setQueryMatchedNodeIds(null);
        setQueryError(null);
    }, []);

    const handleSystemPapersRefresh = useCallback(() => {
        const cards = nodes
            .map((node) => node.data)
            .filter((data) => SYSTEM_PAPER_CARD_LABELS.has(String(data?.label ?? "").toLowerCase() as cardLabel))
            .map((data) => ({
                label: String(data?.label ?? "").toLowerCase(),
                title: String(data?.title ?? ""),
                description: String(data?.description ?? ""),
            }));

        if (cards.length === 0) {
            setSystemPaperResults([]);
            setSystemPapersError("Add at least one task or requirement card before refreshing.");
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
        void updateDocumentMeta(projectId, { title: newTitle });
    }, [projectId]);

    const handleOpenSettings = useCallback(() => {
        navigate(`/project/${projectId}/setup`);
    }, [navigate, projectId]);

    const handleGoHome = useCallback(() => {
        navigate("/projects");
    }, [navigate]);

    const handleFreeInputClicked = useCallback(() => {
        setCursorMode("text");
    }, []);

    const handleNodeInputClicked = useCallback(() => {
        setCursorMode("node");
    }, []);

    const handleBlueprintComponentInputClicked = useCallback(() => {
        setCursorMode("blueprint_component");
    }, []);

    const handlePointerClicked = useCallback(() => {
        setCursorMode("");
    }, []);

    const handleStageUpdate = useCallback((stage: Stage) => {
        dispatch(updateStage({
            ...stage,
            start: fromDate(stage.start),
            end: fromDate(stage.end),
        }));
    }, [dispatch]);

    const handleStageCreation = useCallback((name: string) => {
        dispatch(addDefaultStage(name));
    }, [dispatch]);

    const handleStageLaneCreation = useCallback((name: string) => {
        dispatch(addStage(name));
    }, [dispatch]);

    const handleStageLaneDeletion = useCallback((id: string) => {
        dispatch(deleteStage(id));
    }, [dispatch]);

    const handleStageBoundaryChange = useCallback((prevId: string, nextId: string, date: Date) => {
        dispatch(changeStageBoundary({
            prevId,
            nextId,
            date: fromDate(date),
        }));
    }, [dispatch]);

    const handleSyncCodebaseEvents = useCallback(async () => {
        await checkGitStatus();
    }, [checkGitStatus]);

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
                nodesDraggable={viewMode === "explore"}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onClick={onCanvasClick}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
            />

            <CanvasSidebar
                title={title}
                onSetTitle={handleSetTitle}
                onGoHome={handleGoHome}
                onOpenSettings={handleOpenSettings}
                bottomOffsetPx={canvasSidebarBottomOffset}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabelWithQueryRefresh}
                queryValue={queryInput}
                onQueryValueChange={setQueryInput}
                onQuerySubmit={handleQuerySubmit}
                onQueryClear={handleQueryClear}
                queryLoading={queryLoading}
                queryError={queryError}
                queryResultCount={activeQuery ? filteredNodes.length : null}
                systemPaperResults={systemPaperResults}
                systemPapersLoading={systemPapersLoading}
                systemPapersError={systemPapersError}
                onSystemPapersRefresh={handleSystemPapersRefresh}
            />

            {/* <div style={{ position: "fixed", right: "350px", top: "30px", opacity: 0.5 }}>
                <img src="/vitral/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div> */}

            <Toolbar
                onFreeInputClicked={handleFreeInputClicked}
                onNodeInputClicked={handleNodeInputClicked}
                onBlueprintComponentClicked={handleBlueprintComponentInputClicked}
                onPointerClicked={handlePointerClicked}
                shifted={timelineOpen}
            />

            <RightSidebar
                projectId={projectId}
                connectionStatus={gitConnectionStatus}
                assetsRecords={allFiles}
                bottomOffsetPx={canvasSidebarBottomOffset}
                onAssetHover={setHoveredAssetFileId}
            />

            {cursorMode === "text" ? (
                <FreeInputZone onInputSubmit={onFreeInputSubmit} />
            ) : null}

            <LoadSpinner loading={loading} />

            <PendingFileModal
                pendingDrop={pendingDrop}
                generatedAtInput={generatedAtInput}
                onGeneratedAtInputChange={setGeneratedAtInput}
                onCancel={cancelPendingDrop}
                onProcess={processPendingDrop}
            />

            <TimelineDock
                open={timelineOpen}
                onToggleOpen={handleToggleTimeline}
                startMarker={timelineStartEnd.start}
                endMarker={timelineStartEnd.end}
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
