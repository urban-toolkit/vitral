import { useEffect } from "react";
import * as d3 from "d3";
import { faCheck, faCircle, faImages, faWandSparkles } from "@fortawesome/free-solid-svg-icons";
import type {
    Dispatch,
    MutableRefObject,
    RefObject,
    SetStateAction,
} from "react";
import type {
    BlueprintCodebaseLink,
    DesignStudyEvent,
    LaneType,
    Stage,
    SystemScreenshotMarker,
} from "@/config/types";
import {
    addSubStage,
    deleteSubStage,
    setHoveredBlueprintComponentNodeId,
} from "@/store/timelineSlice";
import classes from "./Timeline.module.css";
import type {
    BlueprintEventConnection,
    CodebaseSubtrack,
    KnowledgeBlueprintLink,
    KnowledgeCrossTreeConnection,
    KnowledgeTreePill,
    ParsedTimelineData,
    SelectedTimelineEvent,
} from "./timelineTypes";
import { formatDate, fromDate, setRefPos, toDate } from "./timelineUtils";

type MilestoneMenuState = { x: number; y: number; date: string } | null;

type TagPickerState = (Stage & { x: number; y: number }) | null;

type StageMenuState = {
    subStageId: string;
    x: number;
    y: number;
} | null;

type BlueprintLinkMenuState = {
    x: number;
    y: number;
    blueprintEventId: string;
} | null;

type BlueprintCodebaseLinkMenuState = {
    x: number;
    y: number;
    linkId: string;
} | null;

type KnowledgeTrackMenuState = {
    x: number;
    y: number;
} | null;

type NameEditState = {
    id: string;
    x: number;
    y: number;
    key: "designStudyEvent" | "subStage" | "codebaseSubtrack" | "knowledgeSubtrack";
    value: string;
} | null;

type TooltipPosition = {
    x: number;
    y: number;
};

type SystemScreenshotTooltipState = {
    markerId: string;
    x: number;
    y: number;
} | null;

const normalizePath = (path: string) =>
    path.replace(/\\/g, "/").replace(/^\/+/, "");

const faCirclePath = Array.isArray(faCircle.icon[4]) ? faCircle.icon[4][0] : faCircle.icon[4];
const faCheckPath = Array.isArray(faCheck.icon[4]) ? faCheck.icon[4][0] : faCheck.icon[4];
const faWandSparklesPath = Array.isArray(faWandSparkles.icon[4])
    ? faWandSparkles.icon[4][0]
    : faWandSparkles.icon[4];
const faWandSparklesWidth = faWandSparkles.icon[0];
const faWandSparklesHeight = faWandSparkles.icon[1];
const faImagesPath = Array.isArray(faImages.icon[4]) ? faImages.icon[4][0] : faImages.icon[4];
const faImagesWidth = faImages.icon[0];
const faImagesHeight = faImages.icon[1];
const BLUEPRINT_HIGHLIGHT_FILL = "#00A8DB";
const BLUEPRINT_HIGHLIGHT_STROKE = "#005E79";

function getDroppedGitHubFilePath(event: DragEvent): string | null {
    const payload = event.dataTransfer?.getData("application/x-vitral-github-file");
    if (payload) {
        try {
            const parsedPayload = JSON.parse(payload) as { path?: string };
            if (typeof parsedPayload.path === "string" && parsedPayload.path.trim() !== "") {
                return normalizePath(parsedPayload.path);
            }
        } catch {
            // Fallback to text/plain below.
        }
    }

    const plain = event.dataTransfer?.getData("text/plain");
    if (typeof plain === "string" && plain.trim() !== "") {
        return normalizePath(plain.trim());
    }

    return null;
}

type UseTimelineChartParams = {
    containerRef: RefObject<HTMLDivElement | null>;
    svgRef: RefObject<SVGSVGElement | null>;
    zoomTransformRef: MutableRefObject<d3.ZoomTransform>;
    startCaretRef: RefObject<HTMLSpanElement | null>;
    endCaretRef: RefObject<HTMLSpanElement | null>;
    todayCaretRef: RefObject<HTMLSpanElement | null>;
    newStageButtonRef: RefObject<HTMLSpanElement | null>;
    newKnowledgeSubtrackButtonRef: RefObject<HTMLSpanElement | null>;
    newCodebaseSubtrackButtonRef: RefObject<HTMLSpanElement | null>;
    codebaseVisualButtonRef: RefObject<HTMLSpanElement | null>;
    syncCodebaseButtonRef: RefObject<HTMLSpanElement | null>;
    llmButtonRef: RefObject<HTMLSpanElement | null>;
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
    defaultStages: string[];
    parsed: ParsedTimelineData;
    codebaseSubtracks: CodebaseSubtrack[];
    knowledgeSubtracks: CodebaseSubtrack[];
    knowledgePillTrackAssignments: Record<string, string | null>;
    knowledgeTreePills: KnowledgeTreePill[];
    knowledgeCrossTreeConnections: KnowledgeCrossTreeConnection[];
    knowledgeBlueprintLinks: KnowledgeBlueprintLink[];
    blueprintEventConnections: BlueprintEventConnection[];
    hoveredKnowledgeTreeId: string | null;
    onHoveredKnowledgeTreeIdChange: (treeId: string | null) => void;
    blueprintCodebaseLinks: BlueprintCodebaseLink[];
    systemScreenshotMarkers: SystemScreenshotMarker[];
    playbackAt: Date | string | null;
    onPlaybackAtChange?: (value: string | null) => void;
    pendingBlueprintLinkEventId: string | null;
    hoveredCodebaseFilePath: string | null;
    highlightedCodebaseFilePaths: string[];
    hoveredBlueprintComponentNodeId: string | null;
    connectedBlueprintComponentNodeIds: string[];
    readOnly: boolean;
    allowKnowledgeTrackClearMenu: boolean;
    dispatch: (action: any) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
    onStageLaneDeletion: (id: string) => void;
    onAttachFileToCodebaseSubtrack: (subtrackId: string, filePath: string) => void;
    onToggleCodebaseSubtrackCollapsed: (subtrackId: string) => void;
    onToggleCodebaseSubtrackInactive: (subtrackId: string) => void;
    onToggleKnowledgeSubtrackCollapsed: (subtrackId: string) => void;
    onToggleKnowledgeSubtrackInactive: (subtrackId: string) => void;
    onDeleteCodebaseSubtrack: (subtrackId: string) => void;
    onDeleteKnowledgeSubtrack: (subtrackId: string) => void;
    onAssignKnowledgePillToSubtrack: (treeId: string, subtrackId: string | null) => void;
    onCreateBlueprintCodebaseLink: (blueprintEventId: string, codebaseSubtrackId: string) => void;
    onDeleteSystemScreenshotMarker: (markerId: string) => void;
    onSuggestCodebaseSubtrackFiles: (subtrackId: string) => void;
    onToggleCodebaseSubtrackVisualEvolution: (subtrackId: string) => void;
    suggestingCodebaseSubtrackIds: string[];
    setSystemScreenshotTooltip: Dispatch<SetStateAction<SystemScreenshotTooltipState>>;
    setMilestoneMenu: Dispatch<SetStateAction<MilestoneMenuState>>;
    setSelectedMilestone: Dispatch<SetStateAction<DesignStudyEvent | null>>;
    setBlueprintLinkMenu: Dispatch<SetStateAction<BlueprintLinkMenuState>>;
    setBlueprintCodebaseLinkMenu: Dispatch<SetStateAction<BlueprintCodebaseLinkMenuState>>;
    setKnowledgeTrackMenu: Dispatch<SetStateAction<KnowledgeTrackMenuState>>;
    setTagPicker: Dispatch<SetStateAction<TagPickerState>>;
    setStageMenu: Dispatch<SetStateAction<StageMenuState>>;
    setNameEdit: Dispatch<SetStateAction<NameEditState>>;
    setSelectedEvent: Dispatch<SetStateAction<SelectedTimelineEvent | null>>;
    setTooltipPosition: Dispatch<SetStateAction<TooltipPosition>>;
    setShowTooltip: Dispatch<SetStateAction<boolean>>;
};

export function useTimelineChart({
    containerRef,
    svgRef,
    zoomTransformRef,
    startCaretRef,
    endCaretRef,
    todayCaretRef,
    newStageButtonRef,
    newKnowledgeSubtrackButtonRef,
    newCodebaseSubtrackButtonRef,
    codebaseVisualButtonRef,
    syncCodebaseButtonRef,
    llmButtonRef,
    width,
    height,
    margin,
    defaultStages,
    parsed,
    codebaseSubtracks,
    knowledgeSubtracks,
    knowledgePillTrackAssignments,
    knowledgeTreePills,
    knowledgeCrossTreeConnections,
    knowledgeBlueprintLinks,
    blueprintEventConnections,
    hoveredKnowledgeTreeId,
    onHoveredKnowledgeTreeIdChange,
    blueprintCodebaseLinks,
    systemScreenshotMarkers,
    playbackAt,
    onPlaybackAtChange,
    pendingBlueprintLinkEventId,
    hoveredCodebaseFilePath,
    highlightedCodebaseFilePaths,
    hoveredBlueprintComponentNodeId,
    connectedBlueprintComponentNodeIds,
    readOnly,
    allowKnowledgeTrackClearMenu,
    dispatch,
    onStageBoundaryChange,
    onStageLaneDeletion,
    onAttachFileToCodebaseSubtrack,
    onToggleCodebaseSubtrackCollapsed,
    onToggleCodebaseSubtrackInactive,
    onToggleKnowledgeSubtrackCollapsed,
    onToggleKnowledgeSubtrackInactive,
    onDeleteCodebaseSubtrack,
    onDeleteKnowledgeSubtrack,
    onAssignKnowledgePillToSubtrack,
    onCreateBlueprintCodebaseLink,
    onDeleteSystemScreenshotMarker,
    onSuggestCodebaseSubtrackFiles,
    onToggleCodebaseSubtrackVisualEvolution,
    suggestingCodebaseSubtrackIds,
    setSystemScreenshotTooltip,
    setMilestoneMenu,
    setSelectedMilestone,
    setBlueprintLinkMenu,
    setBlueprintCodebaseLinkMenu,
    setKnowledgeTrackMenu,
    setTagPicker,
    setStageMenu,
    setNameEdit,
    setSelectedEvent,
    setTooltipPosition,
    setShowTooltip,
}: UseTimelineChartParams) {
    useEffect(() => {
        if (!svgRef.current || width === 0 || height === 0) return;
        const currentSvg = svgRef.current;

        const isTimelineInteractiveTarget = (event: Event): boolean => {
            const target = event.target;
            if (!(target instanceof Element)) return false;
            return !!target.closest("[data-timeline-interactive='true']");
        };

        const svgWidth = width;
        const viewportHeight = containerRef.current?.parentElement?.clientHeight ?? height;

        const subtrackContentX = margin.left + 26;
        const codebaseDropZoneWidth = 180;
        const laneHeaderWidth = subtrackContentX - margin.left + codebaseDropZoneWidth;
        const timelineLeft = margin.left + laneHeaderWidth;
        const innerW = Math.max(120, width - timelineLeft - margin.right);
        const totalTrackWidth = laneHeaderWidth + innerW;

        const lanesTop = margin.top + 32;
        const laneH = 65;
        const laneGap = 6;

        const designStudyLaneTop = lanesTop + laneH / 2;
        const knowledgeLaneTop = designStudyLaneTop + laneH + laneGap;
        const knowledgeSubtrackCollapsedHeight = 24;
        const knowledgeSubtrackExpandedHeight = laneH;
        const knowledgeSubtrackRows = knowledgeSubtracks.map((subtrack, index) => {
            let top = knowledgeLaneTop + laneH + laneGap;

            for (let i = 0; i < index; i++) {
                const previous = knowledgeSubtracks[i];
                top += (previous.collapsed ? knowledgeSubtrackCollapsedHeight : knowledgeSubtrackExpandedHeight) + laneGap;
            }

            const heightForRow = subtrack.collapsed
                ? knowledgeSubtrackCollapsedHeight
                : knowledgeSubtrackExpandedHeight;

            return {
                ...subtrack,
                top,
                height: heightForRow,
                center: top + heightForRow / 2,
            };
        });
        const knowledgeSubtracksBottom =
            knowledgeSubtrackRows.length > 0
                ? knowledgeSubtrackRows[knowledgeSubtrackRows.length - 1].top +
                knowledgeSubtrackRows[knowledgeSubtrackRows.length - 1].height
                : knowledgeLaneTop + laneH;
        const blueprintLaneTop = knowledgeSubtracksBottom + laneGap;
        const codebaseLaneTop = blueprintLaneTop + laneH + laneGap;

        const laneY = {
            designStudy: designStudyLaneTop,
            knowledge: knowledgeLaneTop,
            blueprint: blueprintLaneTop,
            codebase: codebaseLaneTop,
        };

        const laneTop = (lane: LaneType) => laneY[lane];
        const codebaseSubtrackCollapsedHeight = 24;
        const codebaseSubtrackExpandedHeight = laneH;
        const normalizedHoveredPath = hoveredCodebaseFilePath
            ? normalizePath(hoveredCodebaseFilePath)
            : null;
        const highlightedCodebasePathSet = new Set(
            highlightedCodebaseFilePaths
                .map((path) => normalizePath(path))
                .filter(Boolean)
        );
        if (normalizedHoveredPath) {
            highlightedCodebasePathSet.add(normalizedHoveredPath);
        }
        const highlightedSubtrackIdsFromFileHover = new Set<string>();
        const highlightedSubtrackIdsFromBlueprintHover = new Set<string>();
        const highlightedBlueprintEventIds = new Set<string>();
        const highlightedKnowledgeBlueprintLinkIds = new Set<string>();
        const connectedBlueprintComponentNodeIdSet = new Set(connectedBlueprintComponentNodeIds);
        const suggestingSubtrackIdSet = new Set(suggestingCodebaseSubtrackIds);
        const parsedSystemScreenshotMarkers = systemScreenshotMarkers
            .map((marker) => {
                const parsedDate = toDate(marker.occurredAt);
                if (Number.isNaN(parsedDate.getTime())) return null;
                return {
                    ...marker,
                    date: parsedDate,
                };
            })
            .filter((marker): marker is SystemScreenshotMarker & { date: Date } => marker !== null)
            .sort((a, b) => +a.date - +b.date);
        const parsedKnowledgeTreePills = knowledgeTreePills
            .map((pill) => {
                const parsedDate = toDate(pill.occurredAt);
                if (Number.isNaN(parsedDate.getTime())) return null;
                const parsedEvents = Array.isArray(pill.events)
                    ? pill.events
                        .map((eventData) => {
                            const eventDate = toDate(eventData.occurredAt);
                            if (Number.isNaN(eventDate.getTime())) return null;
                            return {
                                ...eventData,
                                date: eventDate,
                            };
                        })
                        .filter((eventData): eventData is (typeof pill.events[number] & { date: Date }) => eventData !== null)
                    : [];
                const events = [...parsedEvents].sort((a, b) => +a.date - +b.date);
                const startDate = events[0]?.date ?? parsedDate;
                const endDate = events[events.length - 1]?.date ?? parsedDate;
                return {
                    ...pill,
                    date: parsedDate,
                    startDate,
                    endDate,
                    events,
                };
            })
            .filter((pill): pill is (KnowledgeTreePill & {
                date: Date;
                startDate: Date;
                endDate: Date;
                events: Array<KnowledgeTreePill["events"][number] & { date: Date }>;
            }) => pill !== null)
            .sort((a, b) => +a.startDate - +b.startDate);
        const knowledgeTreeNodeIdsByTreeId = new Map<string, Set<string>>();
        for (const pill of parsedKnowledgeTreePills) {
            const nodeIds = new Set(
                pill.events
                    .map((eventData) => eventData.nodeId)
                    .filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.trim() !== "")
            );
            knowledgeTreeNodeIdsByTreeId.set(pill.treeId, nodeIds);
        }

        if (highlightedCodebasePathSet.size > 0) {
            for (const subtrack of codebaseSubtracks) {
                if (subtrack.filePaths.some((path) => highlightedCodebasePathSet.has(normalizePath(path)))) {
                    highlightedSubtrackIdsFromFileHover.add(subtrack.id);
                }
            }

            for (const link of blueprintCodebaseLinks) {
                if (highlightedSubtrackIdsFromFileHover.has(link.codebaseSubtrackId)) {
                    highlightedBlueprintEventIds.add(link.blueprintEventId);
                }
            }
        }

        if (hoveredBlueprintComponentNodeId) {
            for (const eventData of parsed.bp) {
                if (eventData.componentNodeId === hoveredBlueprintComponentNodeId) {
                    highlightedBlueprintEventIds.add(eventData.id);
                }
            }
        }

        if (hoveredKnowledgeTreeId) {
            const hoveredTreeNodeIds = knowledgeTreeNodeIdsByTreeId.get(hoveredKnowledgeTreeId);
            if (hoveredTreeNodeIds && hoveredTreeNodeIds.size > 0) {
                for (const link of knowledgeBlueprintLinks) {
                    if (hoveredTreeNodeIds.has(link.cardNodeId)) {
                        highlightedKnowledgeBlueprintLinkIds.add(link.id);
                        highlightedBlueprintEventIds.add(link.blueprintEventId);
                    }
                }
            }
        }

        if (highlightedBlueprintEventIds.size > 0) {
            for (const link of blueprintCodebaseLinks) {
                if (highlightedBlueprintEventIds.has(link.blueprintEventId)) {
                    highlightedSubtrackIdsFromBlueprintHover.add(link.codebaseSubtrackId);
                }
            }
        }

        const codebaseSubtrackRows = codebaseSubtracks.map((subtrack, index) => {
            let top = laneY.codebase + laneH + laneGap;

            for (let i = 0; i < index; i++) {
                const previous = codebaseSubtracks[i];
                top += (previous.collapsed ? codebaseSubtrackCollapsedHeight : codebaseSubtrackExpandedHeight) + laneGap;
            }

            const heightForRow = subtrack.collapsed
                ? codebaseSubtrackCollapsedHeight
                : codebaseSubtrackExpandedHeight;

            return {
                ...subtrack,
                top,
                height: heightForRow,
                center: top + heightForRow / 2,
                isHighlighted:
                    highlightedSubtrackIdsFromFileHover.has(subtrack.id) ||
                    highlightedSubtrackIdsFromBlueprintHover.has(subtrack.id),
            };
        });

        const codebaseSubtracksBottom =
            codebaseSubtrackRows.length > 0
                ? codebaseSubtrackRows[codebaseSubtrackRows.length - 1].top +
                codebaseSubtrackRows[codebaseSubtrackRows.length - 1].height
                : laneY.codebase + laneH;

        const svgHeight = Math.max(viewportHeight, Math.ceil(codebaseSubtracksBottom + margin.bottom + 8));

        const svg = d3.select(currentSvg)
            .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
            .attr("height", svgHeight)
            .style("height", `${svgHeight}px`);

        svg.selectAll("*").remove();
        const defs = svg.append("defs");
        defs.append("marker")
            .attr("id", "blueprint-link-arrow-head")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 5)
            .attr("refY", 5)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", "rgb(204, 204, 204)");

        defs.append("marker")
            .attr("id", "blueprint-link-arrow-head-active")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 5)
            .attr("refY", 5)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", BLUEPRINT_HIGHLIGHT_STROKE);

        defs.append("marker")
            .attr("id", "knowledge-blueprint-arrow-head")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 5)
            .attr("refY", 5)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", "rgba(204, 80, 80, 0.9)");

        const x0 = d3
            .scaleTime()
            .domain(parsed.domain)
            .range([timelineLeft, timelineLeft + innerW]);

        const stageColor = d3
            .scaleOrdinal<string, string>()
            .domain(defaultStages)
            .range(d3.schemePastel2)
            .unknown("#ccc");

        const axisG = svg
            .append("g")
            .attr("class", classes.axis)
            .attr("transform", `translate(0, ${margin.top + 14})`);

        const laneBackgroundG = svg.append("g");
        const stageG = svg.append("g");
        const markerG = svg.append("g");
        const lanesG = svg.append("g");
        const brushG = svg.append("g").style("display", "none");
        const subStagesG = svg.append("g");
        const knowledgeConnectionsG = svg.append("g");
        const knowledgeEventsG = svg.append("g");
        const knowledgeBlueprintLinksG = svg.append("g");
        const blueprintEventConnectionsG = svg.append("g");
        const blueprintCodebaseLinksG = svg.append("g");
        const eventsG = svg.append("g");
        const screenshotOverlayG = svg.append("g");

        const lanes = [
            { key: "designStudy", label: "Design study" },
            { key: "knowledge", label: "Knowledge base" },
            { key: "blueprint", label: "Blueprint" },
            { key: "codebase", label: "Codebase" },
        ] as const;

        const laneDefs: Array<{ lane: LaneType; top: number }> = [
            { lane: "designStudy", top: laneY.designStudy },
            { lane: "knowledge", top: laneY.knowledge },
            { lane: "blueprint", top: laneY.blueprint },
            { lane: "codebase", top: laneY.codebase },
        ];

        const stageFillRows = [
            ...laneDefs.map((laneDef) => ({
                lane: laneDef.lane,
                top: laneDef.top,
                height: laneH,
            })),
            ...knowledgeSubtrackRows.map((row) => ({
                lane: "knowledgeSubtrack" as const,
                top: row.top,
                height: row.height,
            })),
            ...codebaseSubtrackRows.map((row) => ({
                lane: "codebaseSubtrack" as const,
                top: row.top,
                height: row.height,
            })),
        ];

        const openKnowledgeTrackMenu = (event: any) => {
            if (!allowKnowledgeTrackClearMenu) return;
            event.preventDefault();
            event.stopPropagation();
            const [sx, sy] = d3.pointer(event, containerRef.current);
            setSelectedMilestone(null);
            setMilestoneMenu(null);
            setBlueprintLinkMenu(null);
            setBlueprintCodebaseLinkMenu(null);
            setKnowledgeTrackMenu({
                x: sx,
                y: sy,
            });
            setShowTooltip(false);
        };

        lanes.forEach((lane) => {
            const y = laneY[lane.key];

            const laneBackground = laneBackgroundG
                .append("rect")
                .attr("class", classes.laneLine)
                .attr("x", margin.left)
                .attr("y", y)
                .attr("width", totalTrackWidth)
                .attr("height", 65);
            if (lane.key === "knowledge") {
                laneBackground
                    .attr("data-timeline-interactive", allowKnowledgeTrackClearMenu ? "true" : null)
                    .on("contextmenu", openKnowledgeTrackMenu);
                if (allowKnowledgeTrackClearMenu) {
                    laneBackground.style("cursor", "context-menu");
                }
            }

            lanesG
                .append("rect")
                .attr("class", classes.codebaseDropZone)
                .attr("x", margin.left)
                .attr("y", y)
                .attr("width", laneHeaderWidth)
                .attr("height", 65)
                .style("pointer-events", "none");

            lanesG
                .append("line")
                .attr("class", classes.headerZoneDivider)
                .attr("x1", timelineLeft)
                .attr("x2", timelineLeft)
                .attr("y1", y)
                .attr("y2", y + 65)
                .style("pointer-events", "none");

            lanesG
                .append("text")
                .attr("class", classes.laneLabel)
                .attr("x", margin.left + 8)
                .attr("y", y + 18)
                .text(lane.label);
        });

        const hierarchyTrunkX = margin.left + 14;

        if (knowledgeSubtrackRows.length > 0) {
            lanesG
                .append("line")
                .attr("class", classes.codebaseHierarchyLine)
                .attr("x1", hierarchyTrunkX)
                .attr("x2", hierarchyTrunkX)
                .attr("y1", laneY.knowledge + laneH)
                .attr("y2", knowledgeSubtracksBottom)
                .style("pointer-events", "none");
        }

        const knowledgeSubtrackGroups = lanesG
            .selectAll("g.knowledge-subtrack")
            .data(knowledgeSubtrackRows)
            .enter()
            .append("g")
            .attr("class", "knowledge-subtrack");

        laneBackgroundG
            .selectAll("rect.knowledge-subtrack-lane-line")
            .data(knowledgeSubtrackRows)
            .enter()
            .append("rect")
            .attr("class", `${classes.laneLine} knowledge-subtrack-lane-line`)
            .attr("x", margin.left)
            .attr("y", (row: any) => row.top)
            .attr("width", totalTrackWidth)
            .attr("height", (row: any) => row.height)
            .style("pointer-events", "none");

        knowledgeSubtrackGroups
            .append("line")
            .attr("class", classes.codebaseHierarchyLine)
            .attr("x1", hierarchyTrunkX)
            .attr("x2", subtrackContentX - 4)
            .attr("y1", (row: any) => row.top + 12)
            .attr("y2", (row: any) => row.top + 12)
            .style("pointer-events", "none");

        knowledgeSubtrackGroups
            .append("rect")
            .attr("x", margin.left)
            .attr("y", (row: any) => row.top)
            .attr("width", laneHeaderWidth)
            .attr("height", (row: any) => row.height)
            .attr("class", classes.codebaseDropZone)
            .style("fill", "transparent")
            .style("pointer-events", "none");

        knowledgeSubtrackGroups
            .append("line")
            .attr("class", classes.headerZoneDivider)
            .attr("x1", timelineLeft)
            .attr("x2", timelineLeft)
            .attr("y1", (row: any) => row.top)
            .attr("y2", (row: any) => row.top + row.height)
            .style("pointer-events", "none");

        const knowledgeSubtrackStatusIcon = knowledgeSubtrackGroups
            .append("g")
            .attr("data-timeline-interactive", "true")
            .attr("transform", (row: any) => `translate(${timelineLeft - 12}, ${row.top + 12})`)
            .style("cursor", readOnly ? "default" : "pointer")
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onToggleKnowledgeSubtrackInactive(row.id);
            });

        knowledgeSubtrackStatusIcon
            .append("circle")
            .attr("r", 12)
            .attr("fill", "transparent");

        knowledgeSubtrackStatusIcon
            .append("path")
            .attr("d", (row: any) => (row.inactive ? faCheckPath : faCirclePath))
            .attr("transform", "scale(0.022) translate(-256 -256)")
            .attr("fill", (row: any) => (row.inactive ? "#9b9b9b" : "black"));

        knowledgeSubtrackStatusIcon
            .append("title")
            .text((row: any) => (row.inactive ? "Mark as active" : "Mark as no longer being worked on"));

        knowledgeSubtrackGroups
            .append("text")
            .attr("class", classes.laneLabel)
            .attr("x", subtrackContentX + 2)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", readOnly ? "default" : "pointer")
            .text((row: any) => (row.collapsed ? ">" : "V"))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onToggleKnowledgeSubtrackCollapsed(row.id);
            });

        knowledgeSubtrackGroups
            .append("text")
            .attr("class", classes.laneLabel)
            .attr("x", subtrackContentX + 16)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", readOnly ? "default" : "text")
            .text((row: any) => row.name)
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                const [sx, sy] = d3.pointer(event, containerRef.current);
                setNameEdit({
                    id: row.id,
                    x: sx,
                    y: sy,
                    value: row.name,
                    key: "knowledgeSubtrack",
                });
            });

        knowledgeSubtrackGroups
            .append("text")
            .attr("class", classes.subStageDelete)
            .attr("x", timelineLeft + innerW - 14)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", readOnly ? "default" : "pointer")
            .text("X")
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onDeleteKnowledgeSubtrack(row.id);
            });

        knowledgeSubtrackGroups
            .style("opacity", (row: any) => (row.inactive ? 0.45 : 1));

        if (codebaseSubtrackRows.length > 0) {
            lanesG
                .append("line")
                .attr("class", classes.codebaseHierarchyLine)
                .attr("x1", hierarchyTrunkX)
                .attr("x2", hierarchyTrunkX)
                .attr("y1", laneY.codebase + laneH)
                .attr("y2", codebaseSubtracksBottom)
                .style("pointer-events", "none");
        }

        const codebaseSubtrackGroups = lanesG
            .selectAll("g.codebase-subtrack")
            .data(codebaseSubtrackRows)
            .enter()
            .append("g")
            .attr("class", "codebase-subtrack");

        laneBackgroundG
            .selectAll("rect.codebase-subtrack-lane-line")
            .data(codebaseSubtrackRows)
            .enter()
            .append("rect")
            .attr("class", `${classes.laneLine} codebase-subtrack-lane-line`)
            .attr("x", margin.left)
            .attr("y", (row: any) => row.top)
            .attr("width", totalTrackWidth)
            .attr("height", (row: any) => row.height)
            .style("fill", (row: any) => (row.isHighlighted ? "rgba(0, 199, 255, 0.14)" : "transparent"))
            .style("stroke", (row: any) => (row.isHighlighted ? "#00A8DB" : "#E3E3E3"))
            .style("stroke-width", (row: any) => (row.isHighlighted ? 3 : 1))
            .style("pointer-events", "none");

        codebaseSubtrackGroups
            .append("line")
            .attr("class", classes.codebaseHierarchyLine)
            .attr("x1", hierarchyTrunkX)
            .attr("x2", subtrackContentX - 4)
            .attr("y1", (row: any) => row.top + 12)
            .attr("y2", (row: any) => row.top + 12)
            .style("stroke", (row: any) => (row.isHighlighted ? "#00A8DB" : null))
            .style("stroke-width", (row: any) => (row.isHighlighted ? 3 : null))
            .style("pointer-events", "none");

        const codebaseSubtrackLinkTargets = codebaseSubtrackGroups
            .append("rect")
            .attr("class", classes.codebaseSubtrackLinkTarget)
            .attr("x", timelineLeft)
            .attr("y", (row: any) => row.top)
            .attr("width", innerW)
            .attr("height", (row: any) => row.height)
            .attr("data-timeline-interactive", pendingBlueprintLinkEventId ? "true" : null)
            .style("fill", pendingBlueprintLinkEventId ? "rgba(45, 125, 210, 0.10)" : "transparent")
            .style("stroke", pendingBlueprintLinkEventId ? "rgba(45, 125, 210, 0.45)" : "none")
            .style("pointer-events", readOnly ? "none" : (pendingBlueprintLinkEventId ? "all" : "none"))
            .style("cursor", readOnly ? "default" : (pendingBlueprintLinkEventId ? "crosshair" : "default"))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                if (!pendingBlueprintLinkEventId) return;
                event.preventDefault();
                event.stopPropagation();
                onCreateBlueprintCodebaseLink(pendingBlueprintLinkEventId, row.id);
            });

        if (pendingBlueprintLinkEventId) {
            codebaseSubtrackLinkTargets.style("stroke-dasharray", "4 3");
        } else {
            codebaseSubtrackLinkTargets.style("stroke-dasharray", null);
        }

        codebaseSubtrackGroups
            .append("rect")
            .attr("x", margin.left)
            .attr("y", (row: any) => row.top)
            .attr("width", laneHeaderWidth)
            .attr("height", (row: any) => row.height)
            .attr("class", classes.codebaseDropZone)
            .style("fill", (row: any) => (row.isHighlighted ? "rgba(0, 199, 255, 0.14)" : "transparent"))
            .style("stroke", (row: any) => (row.isHighlighted ? "#15738d" : "none"))
            .style("stroke-width", (row: any) => (row.isHighlighted ? 2 : 0))
            .attr("data-timeline-interactive", "true")
            .style("pointer-events", readOnly ? "none" : "all")
            .style("cursor", readOnly ? "default" : (pendingBlueprintLinkEventId ? "crosshair" : "copy"))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                if (!pendingBlueprintLinkEventId) return;
                event.preventDefault();
                event.stopPropagation();
                onCreateBlueprintCodebaseLink(pendingBlueprintLinkEventId, row.id);
            })
            .on("dragenter", (event: any) => {
                if (readOnly) return;
                event.preventDefault();
                event.stopPropagation();
            })
            .on("dragover", (event: any) => {
                if (readOnly) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "copy";
                }
            })
            .on("drop", (event: any, row: any) => {
                if (readOnly) return;
                event.preventDefault();
                event.stopPropagation();

                const droppedPath = getDroppedGitHubFilePath(event as DragEvent);
                if (!droppedPath) return;
                onAttachFileToCodebaseSubtrack(row.id, droppedPath);
            });

        codebaseSubtrackGroups
            .append("line")
            .attr("class", classes.headerZoneDivider)
            .attr("x1", timelineLeft)
            .attr("x2", timelineLeft)
            .attr("y1", (row: any) => row.top)
            .attr("y2", (row: any) => row.top + row.height)
            .style("stroke", (row: any) => (row.isHighlighted ? "#00A8DB" : null))
            .style("stroke-width", (row: any) => (row.isHighlighted ? 2 : null))
            .style("pointer-events", "none");

        const codebaseSubtrackStatusIcon = codebaseSubtrackGroups
            .append("g")
            .attr("data-timeline-interactive", "true")
            .attr("transform", (row: any) => `translate(${timelineLeft - 12}, ${row.top + 12})`)
            .style("cursor", readOnly ? "default" : "pointer")
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onToggleCodebaseSubtrackInactive(row.id);
            });

        codebaseSubtrackStatusIcon
            .append("circle")
            .attr("r", 12)
            .attr("fill", "transparent");

        codebaseSubtrackStatusIcon
            .append("path")
            .attr("d", (row: any) => (row.inactive ? faCheckPath : faCirclePath))
            .attr("transform", "scale(0.022) translate(-256 -256)")
            .attr("fill", (row: any) => (row.inactive ? "#9b9b9b" : "black"));

        codebaseSubtrackStatusIcon
            .append("title")
            .text((row: any) => (row.inactive ? "Mark as active" : "Mark as no longer being worked on"));

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.laneLabel)
            .attr("x", subtrackContentX + 2)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .attr("fill", (row: any) => (row.isHighlighted ? "#00A8DB" : null))
            .style("cursor", readOnly ? "default" : "pointer")
            .text((row: any) => (row.collapsed ? ">" : "V"))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onToggleCodebaseSubtrackCollapsed(row.id);
            });

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.laneLabel)
            .attr("x", subtrackContentX + 16)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .attr("fill", (row: any) => (row.isHighlighted ? "#00A8DB" : null))
            .style("cursor", readOnly ? "default" : "text")
            .text((row: any) => {
                return row.name;
            })
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                const [sx, sy] = d3.pointer(event, containerRef.current);
                setNameEdit({
                    id: row.id,
                    x: sx,
                    y: sy,
                    value: row.name,
                    key: "codebaseSubtrack",
                });
            });

        const codebaseSubtrackSuggestionIcon = codebaseSubtrackGroups
            .append("g")
            .attr("data-timeline-interactive", "true")
            .attr("transform", (row: any) => `translate(${timelineLeft - 30}, ${row.top + 12})`)
            .style("cursor", (row: any) => {
                if (readOnly) return "default";
                return suggestingSubtrackIdSet.has(row.id) ? "wait" : "pointer";
            })
            .style("opacity", (row: any) => (suggestingSubtrackIdSet.has(row.id) ? 0.5 : 1))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                if (suggestingSubtrackIdSet.has(row.id)) return;
                onSuggestCodebaseSubtrackFiles(row.id);
            });

        codebaseSubtrackSuggestionIcon
            .append("circle")
            .attr("r", 8)
            .attr("fill", "transparent");

        codebaseSubtrackSuggestionIcon
            .append("path")
            .attr("d", faWandSparklesPath)
            .attr("fill", (row: any) => (suggestingSubtrackIdSet.has(row.id) ? "#9b9b9b" : "black"))
            .attr("transform", `scale(0.023) translate(${-faWandSparklesWidth / 2} ${-faWandSparklesHeight / 2})`);

        codebaseSubtrackSuggestionIcon
            .append("title")
            .text((row: any) =>
                suggestingSubtrackIdSet.has(row.id) ? "Suggesting files..." : "Suggest files with LLM"
            );

        const codebaseSubtrackVisualEvolutionIcon = codebaseSubtrackGroups
            .append("g")
            .attr("data-timeline-interactive", "true")
            .attr("transform", (row: any) => `translate(${timelineLeft - 48}, ${row.top + 12})`)
            .style("cursor", "pointer")
            .on("click", (event: MouseEvent, row: any) => {
                event.stopPropagation();
                onToggleCodebaseSubtrackVisualEvolution(row.id);
            });

        codebaseSubtrackVisualEvolutionIcon
            .append("circle")
            .attr("r", 8)
            .attr("fill", "transparent");

        codebaseSubtrackVisualEvolutionIcon
            .append("path")
            .attr("d", faImagesPath)
            .attr("fill", "black")
            .attr("transform", `scale(0.018) translate(${-faImagesWidth / 2} ${-faImagesHeight / 2})`);

        codebaseSubtrackVisualEvolutionIcon
            .append("title")
            .text("Show visual evolution");

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.subStageDelete)
            .attr("x", timelineLeft + innerW - 14)
            .attr("y", (row: any) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", readOnly ? "default" : "pointer")
            .text("X")
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                event.stopPropagation();
                onDeleteCodebaseSubtrack(row.id);
            });

        const codebaseFilesText = codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.subStageText)
            .attr("x", subtrackContentX + 16)
            .attr("y", (row: any) => row.top + Math.min(row.height - 6, 34))
            .attr("data-timeline-interactive", "true")
            .attr("fill", (row: any) => (row.isHighlighted ? "#00A8DB" : null))
            .text((row: any) => {
                if (row.filePaths.length === 0) return "Drop GitHub files here";
                const preview = row.filePaths
                    .slice(0, 2)
                    .join(", ");
                return preview.length > 20 ? `${preview.slice(0, 20)}...` : preview;
            })
            .attr("display", (row: any) => (row.collapsed ? "none" : "block"));

        const subtrackFilesTooltip = svg
            .append("g")
            .attr("class", classes.subtrackFilesTooltip)
            .style("display", "none")
            .style("pointer-events", "none");

        const subtrackFilesTooltipBg = subtrackFilesTooltip
            .append("rect")
            .attr("class", classes.subtrackFilesTooltipBg)
            .attr("rx", 4)
            .attr("ry", 4);

        const subtrackFilesTooltipText = subtrackFilesTooltip
            .append("text")
            .attr("class", classes.subtrackFilesTooltipText);

        const hideSubtrackFilesTooltip = () => {
            subtrackFilesTooltip.style("display", "none");
        };

        const showSubtrackFilesTooltip = (event: MouseEvent, row: any) => {
            if (!Array.isArray(row.filePaths) || row.filePaths.length === 0) {
                hideSubtrackFilesTooltip();
                return;
            }

            const maxLines = 8;
            const visibleFiles = row.filePaths.slice(0, maxLines);
            const remaining = row.filePaths.length - visibleFiles.length;
            const lines = remaining > 0
                ? [...visibleFiles, `+${remaining} more`]
                : visibleFiles;

            subtrackFilesTooltipText.selectAll("*").remove();
            subtrackFilesTooltip.style("display", "block");

            lines.forEach((line: string, index: number) => {
                subtrackFilesTooltipText
                    .append("tspan")
                    .attr("dy", index === 0 ? 0 : 14)
                    .text(line);
            });

            const tspans = subtrackFilesTooltipText.selectAll<SVGTSpanElement, unknown>("tspan").nodes();
            const maxLineWidth = tspans.reduce((maxWidth: number, node: SVGTSpanElement) => {
                return Math.max(maxWidth, node.getComputedTextLength());
            }, 0);

            const lineHeight = 14;
            const paddingX = 8;
            const paddingY = 8;
            const tooltipWidth = Math.ceil(maxLineWidth + paddingX * 2);
            const tooltipHeight = Math.ceil(lines.length * lineHeight + paddingY * 2);
            const [px, py] = d3.pointer(event, currentSvg);

            const tooltipX = Math.max(8, Math.min(px + 12, svgWidth - tooltipWidth - 8));
            const tooltipY = Math.max(8, Math.min(py + 12, svgHeight - tooltipHeight - 8));

            subtrackFilesTooltipBg
                .attr("x", tooltipX)
                .attr("y", tooltipY)
                .attr("width", tooltipWidth)
                .attr("height", tooltipHeight);

            subtrackFilesTooltipText
                .attr("x", tooltipX + paddingX)
                .attr("y", tooltipY + paddingY + 10);
            subtrackFilesTooltipText
                .selectAll<SVGTSpanElement, unknown>("tspan")
                .attr("x", tooltipX + paddingX);
            subtrackFilesTooltip.raise();
        };

        codebaseFilesText
            .on("mouseenter", (event: MouseEvent, row: any) => {
                showSubtrackFilesTooltip(event, row);
            })
            .on("mousemove", (event: MouseEvent, row: any) => {
                showSubtrackFilesTooltip(event, row);
            })
            .on("mouseleave", () => {
                hideSubtrackFilesTooltip();
            });

        codebaseSubtrackGroups
            .style("opacity", (row: any) => (row.inactive ? 0.45 : 1));

        const drawSquare = (
            g: d3.Selection<SVGGElement, unknown, null, undefined>
        ) => {
            g.append("rect").attr("x", -7).attr("y", -7).attr("width", 15).attr("height", 15).attr("rx", 4);
        };

        const drawCircle = (
            g: d3.Selection<SVGGElement, unknown, null, undefined>
        ) => {
            g.append("circle").attr("r", 10);
        };

        const drawTriangle = (
            g: d3.Selection<SVGGElement, unknown, null, undefined>
        ) => {
            g.append("path")
                .attr("d", "M 0 -11 L 10 8 L -10 8 Z")
                .style("fill", "#2d7dd2")
                .style("stroke", "black");
        };

        const drawDiamond = (
            g: d3.Selection<SVGGElement, unknown, null, undefined>,
            eventData: any
        ) => {
            const openMilestoneMenu = (event: any) => {
                event.preventDefault();
                event.stopPropagation();
                const [sx, sy] = d3.pointer(event, containerRef.current);
                setMilestoneMenu({ x: sx, y: sy, date: "" });
                setSelectedMilestone(eventData);
                setBlueprintLinkMenu(null);
                setBlueprintCodebaseLinkMenu(null);
                setKnowledgeTrackMenu(null);
                setShowTooltip(false);
            };

            g.append("path")
                .attr("d", "M 0 -12 L 12 0 L 0 12 L -12 0 Z")
                .on("contextmenu", openMilestoneMenu);
        };

        let activeKnowledgePillTreeId: string | null = null;
        const hideKnowledgePillTooltip = () => {
            if (activeKnowledgePillTreeId === null) return;
            activeKnowledgePillTreeId = null;
            onHoveredKnowledgeTreeIdChange(null);
            setShowTooltip(false);
        };

        const draw = (x: d3.ScaleTime<number, number>) => {
            const axis = d3.axisBottom<Date>(x).ticks(Math.max(3, Math.floor(innerW / 120)));
            axisG.call(axis);

            const axisBackground = axisG
                .selectAll<SVGRectElement, string>("rect.axis-lane-background")
                .data(["placeholder"])
                .join("rect")
                .attr("class", `${classes.laneLine} axis-lane-background`)
                .attr("x", timelineLeft)
                .attr("y", 0)
                .attr("width", innerW)
                .attr("height", 30);
            axisBackground.lower();
            axisG.raise();
            markerG.raise();

            const dividerDrag = d3
                .drag<SVGLineElement, any>()
                .on("drag", (event: any, divider: any) => {
                    if (readOnly) return;
                    const px = event.x;
                    const newDate = x.invert(px);

                    const prev = parsed.stages[divider.index];
                    const next =
                        divider.index + 1 <= parsed.stages.length
                            ? parsed.stages[divider.index + 1]
                            : null;

                    if (+newDate <= +prev.start) return;
                    if (next && +newDate >= +next.end) return;

                    onStageBoundaryChange(prev.id, next ? next.id : "-1", newDate);
                });

            stageG.selectAll("*").remove();

            stageG
                .selectAll("g.stage")
                .data(parsed.stages)
                .enter()
                .append("g")
                .attr("class", "stage")
                .each(function stageRow(this: SVGGElement, stageData: any) {
                    const group = d3.select(this);

                    group
                        .append("rect")
                        .attr("class", classes.stageLine)
                        .attr("fill", stageColor(stageData.name))
                        .attr("x", x(stageData.start))
                        .attr("y", margin.top + 44)
                        .attr("width", x(stageData.end) - x(stageData.start))
                        .attr("height", 20)
                        .on("click", (event: any, stage: any) => {
                            if (readOnly) return;
                            event.stopPropagation();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
                            setTagPicker({ ...stage, x: sx, y: sy });
                        });

                    group
                        .selectAll("text")
                        .data(parsed.stages)
                        .enter()
                        .append("text")
                        .attr("class", classes.stageLabel)
                        .attr("x", (d: any) => (x(d.start) + x(d.end)) / 2)
                        .attr("y", margin.top + 58)
                        .text((d: any) => `${d.name} V`);

                    group
                        .append("text")
                        .attr("class", classes.subStageDelete)
                        .attr("x", x(stageData.end) - 20)
                        .attr("y", margin.top + 58)
                        .text("X")
                        .style("cursor", readOnly ? "default" : "pointer")
                        .on("click", (event: any, stage: any) => {
                            if (readOnly) return;
                            event.stopPropagation();
                            onStageLaneDeletion(stage.id);
                        });

                    group
                        .selectAll("rect.stageFill")
                        .data(stageFillRows)
                        .enter()
                        .append("rect")
                        .attr("class", "stageFill")
                        .attr("x", x(stageData.start))
                        .attr("y", (fillRow: any) => Math.round(fillRow.top))
                        .attr("width", x(stageData.end) - x(stageData.start))
                        .attr("height", (fillRow: any) => fillRow.height)
                        .attr("fill", stageColor(stageData.name))
                        .attr("opacity", 0.5)
                        .on("contextmenu", function (event: any, fillRow: { lane: LaneType | "codebaseSubtrack" | "knowledgeSubtrack" }) {
                            const isKnowledgeLane = fillRow.lane === "knowledge" || fillRow.lane === "knowledgeSubtrack";
                            if (isKnowledgeLane) {
                                openKnowledgeTrackMenu(event);
                                return;
                            }
                            if (readOnly) return;
                            if (fillRow.lane !== "designStudy") return;

                            event.preventDefault();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
                            setSelectedMilestone(null);
                            setMilestoneMenu({ x: sx, y: sy, date: fromDate(x.invert(sx)) });
                            setKnowledgeTrackMenu(null);
                        });
                });

            const lanesBottom = Math.ceil(codebaseSubtracksBottom);

            stageG
                .selectAll("line.divider")
                .data(parsed.stages.map((stage, index) => ({ ...stage, index })))
                .enter()
                .append("line")
                .attr("class", "divider")
                .attr("x1", (d: any) => x(parsed.stages[d.index].end))
                .attr("x2", (d: any) => x(parsed.stages[d.index].end))
                .attr("y1", margin.top + 44)
                .attr("y2", lanesBottom)
                .attr("stroke", "transparent")
                .attr("stroke-width", 10)
                .attr("cursor", readOnly ? "default" : "ew-resize")
                .call(readOnly ? (() => undefined) as any : dividerDrag as any);

            const augmentedStages = [...parsed.stages];

            if (parsed.stages.length > 0) {
                const lastStage = parsed.stages[parsed.stages.length - 1];
                augmentedStages.push({
                    id: "-1",
                    name: "lastStage",
                    start: lastStage.end,
                    end: lastStage.end,
                });

                setRefPos(newStageButtonRef.current, x(lastStage.end) + 3, margin.top + 45);
            } else {
                setRefPos(newStageButtonRef.current, x(parsed.start) + 3, margin.top + 45);
            }

            setRefPos(
                newKnowledgeSubtrackButtonRef.current,
                margin.left + 8,
                laneY.knowledge + 40
            );
            setRefPos(
                newCodebaseSubtrackButtonRef.current,
                margin.left + 8,
                laneY.codebase + 40
            );
            setRefPos(
                codebaseVisualButtonRef.current,
                timelineLeft - 38,
                laneY.codebase + 5
            );
            setRefPos(
                syncCodebaseButtonRef.current,
                timelineLeft - 20,
                laneY.codebase + 5
            );
            setRefPos(
                llmButtonRef.current,
                timelineLeft - 20,
                laneY.designStudy + 5
            );

            stageG
                .selectAll("line.markerLine")
                .data(augmentedStages)
                .enter()
                .append("line")
                .attr("class", classes.markerLine)
                .attr("x1", (d: any) => x(d.start))
                .attr("x2", (d: any) => x(d.start))
                .attr("y1", margin.top + 65)
                .attr("y2", svgHeight);

            subStagesG.selectAll("*").remove();

            const subStage = subStagesG
                .selectAll("g.subStage")
                .data(parsed.subStages, (subStageData: any) => subStageData.id)
                .enter()
                .append("g");

            subStage
                .append("rect")
                .attr("class", classes.subStage)
                .attr("x", (d: any) => x(d.start))
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 5)
                .attr("width", (d: any) => x(d.end) - x(d.start))
                .attr("height", laneH - 10)
                .attr("fill", (d: any) => {
                    if (defaultStages.includes(d.stage)) return stageColor(d.stage);
                    return "none";
                })
                .attr("rx", 6);

            subStage
                .append("text")
                .attr("class", classes.subStageText)
                .attr("x", (d: any) => x(d.start) + 5)
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 20)
                .text((d: any) => d.name);

            subStage
                .append("text")
                .attr("class", classes.subStageCaret)
                .attr("x", (d: any) => x(d.end) - 35)
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 20)
                .text("v")
                .style("cursor", readOnly ? "default" : "pointer")
                .on("click", (event: any, subStageData: any) => {
                    if (readOnly) return;
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setStageMenu({ subStageId: subStageData.id, x: sx, y: sy });
                });

            subStage
                .append("text")
                .attr("class", classes.subStageDelete)
                .attr("x", (d: any) => x(d.end) - 16)
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 18)
                .text("X")
                .style("cursor", readOnly ? "default" : "pointer")
                .on("click", (event: any, subStageData: any) => {
                    if (readOnly) return;
                    event.stopPropagation();
                    dispatch(deleteSubStage(subStageData.id));
                });

            subStage
                .append("text")
                .attr("class", classes.subStageText)
                .attr("x", (d: any) => x(d.start) + 5)
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 20)
                .text((d: any) => d.name)
                .style("cursor", readOnly ? "default" : "text")
                .on("click", (event: any, subStageData: any) => {
                    if (readOnly) return;
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setNameEdit({
                        id: subStageData.id,
                        x: sx,
                        y: sy,
                        value: subStageData.name,
                        key: "subStage",
                    });
                });

            brushG.selectAll("*").remove();

            const isOverArea = (
                event: any,
                timelineScale: d3.ScaleTime<number, number>,
                lane: LaneType
            ) => {
                const [px, py] = d3.pointer(event, svgRef.current);

                const top = laneTop(lane);
                if (py < top || py > top + laneH) return false;

                return parsed.subStages.some(
                    (area) =>
                        area.lane === lane &&
                        px >= timelineScale(area.start) &&
                        px <= timelineScale(area.end)
                );
            };

            const brush = (lane: LaneType, top: number) =>
                d3
                    .brushX()
                    .extent([
                        [timelineLeft, top],
                        [timelineLeft + innerW, top + laneH],
                    ])
                    .filter((event: any) => !isOverArea(event, x, lane))
                    .on("end", (event: any) => {
                        if (readOnly) return;
                        if (!event.selection) return;

                        const [px0, px1] = event.selection as [number, number];
                        const start = fromDate(x.invert(px0));
                        const end = fromDate(x.invert(px1));

                        dispatch(
                            addSubStage({
                                id: crypto.randomUUID(),
                                lane,
                                start,
                                end,
                                name: "Untitled",
                                stage: "Unstaged",
                            })
                        );

                        d3.select(event.sourceEvent?.currentTarget ?? null);
                    });

            brushG
                .selectAll("g.lane-brush")
                .data(laneDefs)
                .enter()
                .append("g")
                .each(function attachBrush(this: SVGGElement, laneDef: any) {
                    if (readOnly) return;
                    d3.select(this).call(brush(laneDef.lane, laneDef.top) as any);
                });

            markerG.selectAll("*").remove();

            const drawMarker = (date: Date, label: "Start" | "End" | "Today") => {
                const px = x(date);

                markerG
                    .append("text")
                    .attr("class", classes.markerLabel)
                    .attr("x", px)
                    .attr("y", margin.top - 6)
                    .text(label);

                if (label === "Start") setRefPos(startCaretRef.current, px, margin.top);
                if (label === "End") setRefPos(endCaretRef.current, px, margin.top);
                if (label === "Today") setRefPos(todayCaretRef.current, px, margin.top);
            };

            drawMarker(parsed.start, "Start");
            drawMarker(parsed.end, "End");

            const today = new Date();
            const [d0, d1] = parsed.domain;
            const showToday = today >= d0 && today <= d1;

            if (showToday) {
                drawMarker(today, "Today");
                if (todayCaretRef.current) todayCaretRef.current.style.display = "block";
            } else if (todayCaretRef.current) {
                todayCaretRef.current.style.display = "none";
            }

            const connectionColorForKind = (kind: string) => {
                if (kind === "referenced_by") return "#90b1e9";
                if (kind === "iteration_of") return "#dda788";
                return "#cccccc";
            };

            const timelineDomainStart = parsed.domain[0];
            const timelineDomainEnd = parsed.domain[1];
            const defaultPlaybackDate = today < timelineDomainStart
                ? timelineDomainStart
                : (today > timelineDomainEnd ? timelineDomainStart : today);
            const playbackCandidate = playbackAt ? toDate(playbackAt) : defaultPlaybackDate;
            const clampedPlaybackDate = new Date(
                Math.min(timelineDomainEnd.getTime(), Math.max(timelineDomainStart.getTime(), playbackCandidate.getTime())),
            );
            const maxPlayableX = x(timelineDomainEnd);
            const minPlayableX = timelineLeft;
            const playheadX = Math.max(minPlayableX, Math.min(maxPlayableX, x(clampedPlaybackDate)));
            const todayX = x(today);
            const todaySnapPx = 14;

            markerG
                .append("line")
                .attr("x1", playheadX)
                .attr("x2", playheadX)
                .attr("y1", margin.top + 14)
                .attr("y2", svgHeight)
                .attr("stroke", "#d63b3b")
                .attr("stroke-width", 2.2)
                .attr("stroke-dasharray", "5 4")
                .attr("opacity", 0.95);

            const handlePlaybackMove = (event: any) => {
                if (!onPlaybackAtChange) return;
                const [pointerX] = d3.pointer(event, currentSvg);
                const clampedX = Math.max(minPlayableX, Math.min(maxPlayableX, pointerX));
                if (showToday && Math.abs(clampedX - todayX) <= todaySnapPx) {
                    onPlaybackAtChange(null);
                    return;
                }
                const nextDate = x.invert(clampedX);
                onPlaybackAtChange(nextDate.toISOString());
            };

            const playheadHandle = markerG
                .append("g")
                .attr("data-timeline-interactive", "true")
                .attr("transform", `translate(${playheadX}, ${margin.top + 14})`)
                .style("cursor", onPlaybackAtChange ? "ew-resize" : "default");

            playheadHandle
                .append("circle")
                .attr("r", 6)
                .attr("fill", "#d63b3b")
                .attr("stroke", "#ffffff")
                .attr("stroke-width", 1.5);

            playheadHandle
                .append("title")
                .text("Playback time (drag to inspect past and future canvas states)");

            if (onPlaybackAtChange) {
                playheadHandle.call(
                    d3.drag<SVGGElement, unknown>()
                        .on("start", handlePlaybackMove)
                        .on("drag", handlePlaybackMove)
                        .on("end", handlePlaybackMove) as any,
                );
            }

            knowledgeConnectionsG.selectAll("*").remove();
            knowledgeEventsG.selectAll("*").remove();
            knowledgeBlueprintLinksG.selectAll("*").remove();
            blueprintEventConnectionsG.selectAll("*").remove();

            const pillPositionByTreeId = new Map<string, { x: number; y: number }>();
            const cardCreatedPositionByNodeId = new Map<string, { x: number; y: number }>();
            const knowledgePillHeight = 36;
            const knowledgeEventRadius = 10;
            const knowledgePillHorizontalPadding = 12;
            const minimumPillWidth = (knowledgePillHorizontalPadding * 2) + (knowledgeEventRadius * 2);
            const knowledgeEventColor = "#2d7dd2";
            const knowledgeMainTrackRow = {
                id: null as string | null,
                top: laneY.knowledge,
                height: laneH,
                center: laneY.knowledge + laneH / 2,
            };
            const knowledgeTrackRows = [knowledgeMainTrackRow, ...knowledgeSubtrackRows];
            const knowledgeSubtrackRowById = new Map(knowledgeSubtrackRows.map((row) => [row.id, row]));
            const resolveKnowledgeSubtrackIdForTree = (treeId: string): string | null => {
                const assigned = knowledgePillTrackAssignments?.[treeId];
                if (typeof assigned !== "string") return null;
                return knowledgeSubtrackRowById.has(assigned) ? assigned : null;
            };
            const knowledgeTrackRowForTree = (treeId: string) => {
                const assignedSubtrackId = resolveKnowledgeSubtrackIdForTree(treeId);
                if (!assignedSubtrackId) return knowledgeMainTrackRow;
                return knowledgeSubtrackRowById.get(assignedSubtrackId) ?? knowledgeMainTrackRow;
            };
            const knowledgePillLayoutFor = (pillData: any) => {
                const startXTime = x(pillData.startDate ?? pillData.date);
                const endXTime = x(pillData.endDate ?? pillData.date);
                const naturalSpan = Math.max(0, endXTime - startXTime);
                const baseWidth = naturalSpan + (knowledgePillHorizontalPadding * 2);
                const width = Math.max(minimumPillWidth, baseWidth);
                const extraWidth = width - baseWidth;
                const startX = startXTime - knowledgePillHorizontalPadding - (extraWidth / 2);
                const centerX = startX + (width / 2);
                const trackRow = knowledgeTrackRowForTree(pillData.treeId);
                const startY = trackRow.center - (knowledgePillHeight / 2);
                return { startX, width, centerX, trackRow, startY };
            };
            const showKnowledgePillTooltip = (event: MouseEvent, pillData: any) => {
                activeKnowledgePillTreeId = pillData.treeId;
                onHoveredKnowledgeTreeIdChange(pillData.treeId);
                const heightOffset = containerRef.current
                    ? containerRef.current.getBoundingClientRect().top
                    : 0;
                const clampedX = Math.min(Math.max(event.clientX + 14, 0), window.innerWidth - 300);
                const clampedY = Math.min(Math.max(event.clientY + 14, 0), window.innerHeight - 180) - heightOffset;
                const events = Array.isArray(pillData.events) ? pillData.events : [];
                const lines = events.map((eventData: any) =>
                    `${eventData.eventType}: ${eventData.cardTitle || "Untitled"} (${eventData.cardLabel})`
                );
                setSelectedEvent({
                    kind: "knowledge",
                    event: {
                        id: `knowledge-pill:${pillData.treeId}`,
                        occurredAt: pillData.occurredAt,
                        kind: "knowledge",
                        subtype: "tree",
                        label: pillData.treeTitle || "Knowledge tree",
                        description: lines.join("\n"),
                    },
                });
                setTooltipPosition({ x: clampedX, y: clampedY });
                setShowTooltip(true);
            };

            const pillGroups = knowledgeEventsG
                .selectAll("g.knowledge-tree-pill")
                .data(parsedKnowledgeTreePills, (pillData: any) => pillData.treeId)
                .join("g")
                .attr("class", "knowledge-tree-pill")
                .attr("data-timeline-interactive", "true")
                .attr("transform", (pillData: any) => {
                    const layout = knowledgePillLayoutFor(pillData);
                    pillPositionByTreeId.set(pillData.treeId, {
                        x: layout.centerX,
                        y: layout.trackRow.center,
                    });
                    return `translate(${layout.startX}, ${layout.startY})`;
                })
                .on("mouseenter", (_event: any, pillData: any) => {
                    if (activeKnowledgePillTreeId !== null) return;
                    onHoveredKnowledgeTreeIdChange(pillData.treeId);
                })
                .on("mouseleave", (_event: any, pillData: any) => {
                    if (activeKnowledgePillTreeId !== null && activeKnowledgePillTreeId === pillData.treeId) return;
                    onHoveredKnowledgeTreeIdChange(null);
                });

            const pillRects = pillGroups
                .append("rect")
                .attr("width", (pillData: any) => knowledgePillLayoutFor(pillData).width)
                .attr("height", knowledgePillHeight)
                .attr("rx", 16)
                .attr("ry", 16)
                .attr("fill", "rgba(238, 168, 110, 0.26)")
                .attr("stroke", "rgb(188, 115, 56)")
                .attr("stroke-width", 1.2)
                .attr("data-timeline-interactive", "true")
                .style("cursor", readOnly ? "pointer" : "ns-resize")
                .on("click", (event: any, pillData: any) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (activeKnowledgePillTreeId === pillData.treeId) {
                        hideKnowledgePillTooltip();
                        return;
                    }
                    showKnowledgePillTooltip(event, pillData);
                });

            pillRects.append("title")
                .text((pillData: any) => {
                    const lines = pillData.events.map((eventData: any) =>
                        `${eventData.eventType}: ${eventData.cardTitle || "Untitled"} (${eventData.cardLabel})`
                    );
                    return `${pillData.treeTitle}\n${lines.join("\n")}`;
                });

            const clampPillY = (value: number) => {
                const minY = knowledgeMainTrackRow.top;
                const maxY = knowledgeSubtracksBottom - knowledgePillHeight;
                return Math.max(minY, Math.min(maxY, value));
            };
            const resolveKnowledgeTrackRowByPointerY = (pointerY: number) => {
                const containingRow = knowledgeTrackRows.find(
                    (row) => pointerY >= row.top && pointerY <= (row.top + row.height)
                );
                if (containingRow) return containingRow;
                let closestRow = knowledgeTrackRows[0];
                let closestDistance = Math.abs(pointerY - knowledgeTrackRows[0].center);
                for (let i = 1; i < knowledgeTrackRows.length; i++) {
                    const row = knowledgeTrackRows[i];
                    const distance = Math.abs(pointerY - row.center);
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestRow = row;
                    }
                }
                return closestRow;
            };
            if (!readOnly) {
                pillGroups.call(
                    d3.drag<SVGGElement, any>()
                        .on("start", () => {
                            hideKnowledgePillTooltip();
                        })
                        .on("drag", function onPillDrag(this: SVGGElement, event: any, pillData: any) {
                            const layout = knowledgePillLayoutFor(pillData);
                            const [, pointerY] = d3.pointer(event, currentSvg);
                            const nextY = clampPillY(pointerY - (knowledgePillHeight / 2));
                            d3.select(this).attr("transform", `translate(${layout.startX}, ${nextY})`);
                        })
                        .on("end", function onPillDragEnd(this: SVGGElement, event: any, pillData: any) {
                            const [, pointerY] = d3.pointer(event, currentSvg);
                            const targetRow = resolveKnowledgeTrackRowByPointerY(pointerY);
                            const nextSubtrackId = targetRow.id;
                            const previousSubtrackId = resolveKnowledgeSubtrackIdForTree(pillData.treeId);
                            const layout = knowledgePillLayoutFor(pillData);
                            const snappedY = targetRow.center - (knowledgePillHeight / 2);
                            d3.select(this).attr("transform", `translate(${layout.startX}, ${snappedY})`);
                            if (nextSubtrackId !== previousSubtrackId) {
                                onAssignKnowledgePillToSubtrack(pillData.treeId, nextSubtrackId);
                            }
                        }) as any,
                );
            }

            pillGroups.each(function eachPill(this: d3.BaseType, pillData: any) {
                const group = d3.select(this as SVGGElement);
                const events = Array.isArray(pillData.events) ? pillData.events : [];
                if (events.length === 0) return;
                const layout = knowledgePillLayoutFor(pillData);
                const centerY = knowledgePillHeight / 2;
                const dots = group
                    .selectAll("circle.knowledge-pill-event")
                    .data(events)
                    .join("circle")
                    .attr("class", "knowledge-pill-event")
                    .attr("cx", (eventData: any) => x(eventData.date) - layout.startX)
                    .attr("cy", centerY)
                    .attr("r", knowledgeEventRadius)
                    .attr("fill", knowledgeEventColor)
                    .attr("stroke", "#ffffff")
                    .attr("stroke-width", 1.3)
                    .attr("stroke-dasharray", (eventData: any) => (eventData.isDeleted ? "2 1.4" : null))
                    .style("opacity", (eventData: any) => (eventData.isDeleted ? 0.45 : 1))
                    .attr("data-timeline-interactive", "true")
                    .style("cursor", "pointer")
                    .on("click", (event: any, eventData: any) => {
                        hideKnowledgePillTooltip();
                        const heightOffset = containerRef.current
                            ? containerRef.current.getBoundingClientRect().top
                            : 0;
                        const clampedX = Math.min(Math.max(event.clientX, 0), window.innerWidth - 300);
                        const clampedY =
                            Math.min(Math.max(event.clientY, 0), window.innerHeight - 160) - heightOffset;
                        setSelectedEvent({
                            kind: "knowledge",
                            event: {
                                id: eventData.id,
                            occurredAt: eventData.occurredAt,
                            kind: "knowledge",
                            subtype: eventData.eventType,
                            label: `${eventData.eventType.toUpperCase()} - ${eventData.cardTitle || "Untitled"}`,
                            description: `Card label: ${eventData.cardLabel}\nCard title: ${eventData.cardTitle || "Untitled"}\n${eventData.cardDescription || ""}`.trim(),
                        },
                    });
                        setTooltipPosition({ x: clampedX, y: clampedY });
                        setShowTooltip(true);
                    });

                dots.append("title").text((eventData: any) =>
                    `${eventData.eventType}: ${eventData.cardTitle || "Untitled"} (${eventData.cardLabel})`
                );

                for (const eventData of events) {
                    if (eventData.eventType === "created" && typeof eventData.nodeId === "string") {
                        cardCreatedPositionByNodeId.set(eventData.nodeId, {
                            x: x(eventData.date),
                            y: layout.trackRow.center,
                        });
                    }
                }
            });

            const arcIndexByPair = new Map<string, number>();
            const crossTreeConnectionPaths = knowledgeConnectionsG
                .selectAll("path.knowledge-cross-tree-connection")
                .data(knowledgeCrossTreeConnections)
                .join("path")
                .attr("class", "knowledge-cross-tree-connection")
                .attr("data-timeline-interactive", "true")
                .attr("fill", "none")
                .attr("stroke", (connectionData: any) => connectionColorForKind(connectionData.kind))
                .attr("stroke-width", 3)
                .attr("opacity", 0.9)
                .style("cursor", "pointer")
                .attr("d", (connectionData: any) => {
                    const source = pillPositionByTreeId.get(connectionData.sourceTreeId);
                    const target = pillPositionByTreeId.get(connectionData.targetTreeId);
                    if (!source || !target) return "";
                    const fromX = source.x;
                    const fromY = source.y;
                    const toX = target.x;
                    const toY = target.y;
                    const minX = Math.min(fromX, toX);
                    const maxX = Math.max(fromX, toX);
                    const pairKey = `${connectionData.sourceTreeId}::${connectionData.targetTreeId}::${minX}:${maxX}`;
                    const arcIndex = arcIndexByPair.get(pairKey) ?? 0;
                    arcIndexByPair.set(pairKey, arcIndex + 1);
                    const midX = (fromX + toX) / 2;
                    const arcHeight = 26 + arcIndex * 18;
                    const controlY = Math.min(fromY, toY) - arcHeight;
                    return `M ${fromX} ${fromY} Q ${midX} ${controlY} ${toX} ${toY}`;
                })
                .on("click", (event: any, connectionData: any) => {
                    const heightOffset = containerRef.current
                        ? containerRef.current.getBoundingClientRect().top
                        : 0;
                    const clampedX = Math.min(Math.max(event.clientX, 0), window.innerWidth - 300);
                    const clampedY =
                        Math.min(Math.max(event.clientY, 0), window.innerHeight - 160) - heightOffset;
                    setSelectedEvent({
                        kind: "knowledge",
                        event: {
                            id: connectionData.id,
                            occurredAt: connectionData.occurredAt,
                            kind: "knowledge",
                            subtype: connectionData.kind,
                            label: `Connection: ${connectionData.label || connectionData.kind}`,
                            description:
                                `${connectionData.sourceCardTitle} (${connectionData.sourceCardLabel})\n` +
                                `${connectionData.targetCardTitle} (${connectionData.targetCardLabel})`,
                        },
                    });
                    setTooltipPosition({ x: clampedX, y: clampedY });
                    setShowTooltip(true);
                });

            crossTreeConnectionPaths
                .append("title")
                .text((connectionData: any) =>
                    `${connectionData.sourceCardTitle} (${connectionData.sourceCardLabel})\n` +
                    `${connectionData.targetCardTitle} (${connectionData.targetCardLabel})\n` +
                    `Label: ${connectionData.label || connectionData.kind}`
                );

            const knowledgeBlueprintPaths = knowledgeBlueprintLinksG
                .selectAll("path.knowledge-blueprint-link")
                .data(knowledgeBlueprintLinks)
                .join("path")
                .attr("class", "knowledge-blueprint-link")
                .attr("data-timeline-interactive", "true")
                .attr("fill", "none")
                .attr("stroke", (linkData: any) =>
                    highlightedKnowledgeBlueprintLinkIds.has(linkData.id)
                        ? BLUEPRINT_HIGHLIGHT_STROKE
                        : connectionColorForKind(linkData.kind)
                )
                .attr("stroke-width", (linkData: any) =>
                    highlightedKnowledgeBlueprintLinkIds.has(linkData.id) ? 4 : 3
                )
                .attr("opacity", (linkData: any) =>
                    highlightedKnowledgeBlueprintLinkIds.has(linkData.id) ? 1 : 0.85
                )
                .style("cursor", "pointer")
                .attr("d", (linkData: any) => {
                    const createdPosition = cardCreatedPositionByNodeId.get(linkData.cardNodeId);
                    const startX = createdPosition?.x ?? x(toDate(linkData.cardCreatedAt));
                    const endX = x(toDate(linkData.blueprintOccurredAt));
                    const startY = createdPosition?.y ?? (laneY.knowledge + laneH / 2);
                    const endY = laneY.blueprint + laneH / 2;
                    const midY = (startY + endY) / 2;
                    return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
                });
            knowledgeBlueprintPaths
                .append("title")
                .text((linkData: any) =>
                    `${linkData.cardTitle} (${linkData.cardLabel}) -> ${linkData.blueprintEventName}\n` +
                    `Label: ${linkData.label || linkData.kind}`
                );

            const screenshotMarkerTopY = margin.top + 18;
            const screenshotLineBottomY = codebaseSubtracksBottom;
            const clampTimelineX = (value: number) =>
                Math.max(timelineLeft, Math.min(timelineLeft + innerW, value));

            screenshotOverlayG.selectAll("*").remove();

            const screenshotMarkerGroups = screenshotOverlayG
                .selectAll("g.systemScreenshotMarker")
                .data(parsedSystemScreenshotMarkers, (markerData: any) => markerData.id)
                .join((enter: any) =>
                    enter
                        .append("g")
                        .attr("class", "systemScreenshotMarker")
                );

            screenshotMarkerGroups
                .selectAll("line")
                .data((markerData: any) => [markerData])
                .join("line")
                .attr("data-timeline-interactive", "true")
                .attr("x1", (markerData: any) => clampTimelineX(x(markerData.date)))
                .attr("x2", (markerData: any) => clampTimelineX(x(markerData.date)))
                .attr("y1", screenshotMarkerTopY)
                .attr("y2", screenshotLineBottomY)
                .attr("stroke", "#E5962D")
                .attr("stroke-width", 2)
                .attr("stroke-dasharray", "4 3")
                .style("cursor", "context-menu")
                .on("contextmenu", (event: any, markerData: any) => {
                    if (readOnly) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSystemScreenshotTooltip(null);
                    onDeleteSystemScreenshotMarker(markerData.id);
                });

            screenshotMarkerGroups
                .selectAll("circle")
                .data((markerData: any) => [markerData])
                .join("circle")
                .attr("data-timeline-interactive", "true")
                .attr("cx", (markerData: any) => clampTimelineX(x(markerData.date)))
                .attr("cy", screenshotMarkerTopY)
                .attr("r", 6)
                .attr("fill", "#E5962D")
                .attr("stroke", "rgba(255,255,255,0.95)")
                .attr("stroke-width", 1.5)
                .style("cursor", "pointer")
                .on("click", (event: MouseEvent, markerData: any) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const markerX = clampTimelineX(x(markerData.date));
                    const svgRect = currentSvg.getBoundingClientRect();
                    const tooltipHalfWidth = 160;
                    const anchorX = Math.max(
                        tooltipHalfWidth + 8,
                        Math.min(window.innerWidth - tooltipHalfWidth - 8, svgRect.left + markerX)
                    );
                    const anchorY = svgRect.top + screenshotMarkerTopY;
                    setSystemScreenshotTooltip((previous) => {
                        if (previous?.markerId === markerData.id) {
                            return null;
                        }
                        return {
                            markerId: markerData.id,
                            x: anchorX,
                            y: anchorY,
                        };
                    });
                })
                .on("contextmenu", (event: any, markerData: any) => {
                    if (readOnly) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSystemScreenshotTooltip(null);
                    onDeleteSystemScreenshotMarker(markerData.id);
                });

            screenshotMarkerGroups
                .selectAll("text.systemScreenshotTimestamp")
                .data((markerData: any) => [markerData])
                .join("text")
                .attr("class", "systemScreenshotTimestamp")
                .attr("x", (markerData: any) => clampTimelineX(x(markerData.date)))
                .attr("y", screenshotMarkerTopY - 10)
                .attr("text-anchor", "middle")
                .attr("fill", "#C87710")
                .attr("font-size", 10)
                .style("pointer-events", "none")
                .text((markerData: any) => formatDate(markerData.occurredAt));

            // Keep screenshot marker line/circle above the top axis background band.
            screenshotOverlayG.raise();

            blueprintCodebaseLinksG.selectAll("*").remove();
            eventsG.selectAll("*").remove();

            const eventsByCodebaseSubtrack = new Map<string, any[]>();

            for (const subtrack of codebaseSubtracks) {
                const trackedFiles = new Set(subtrack.filePaths.map((path) => normalizePath(path)));

                if (trackedFiles.size === 0) {
                    eventsByCodebaseSubtrack.set(subtrack.id, []);
                    continue;
                }

                const matchingCommits = parsed.cb.filter((event) =>
                    (Array.isArray(event.filesAffected) ? event.filesAffected : [])
                        .some((filePath) => trackedFiles.has(normalizePath(filePath)))
                );

                eventsByCodebaseSubtrack.set(subtrack.id, matchingCommits);
            }

            const blueprintEventsById = new Map(parsed.bp.map((eventData) => [eventData.id, eventData]));
            const codebaseSubtrackRowsById = new Map(codebaseSubtrackRows.map((row) => [row.id, row]));
            const blueprintEventLaneCenterY = laneY.blueprint + laneH / 2;

            const resolvedBlueprintEventConnections = blueprintEventConnections
                .map((connection) => ({
                    connection,
                    sourceEvent: blueprintEventsById.get(connection.sourceBlueprintEventId),
                    targetEvent: blueprintEventsById.get(connection.targetBlueprintEventId),
                }))
                .filter((entry) => entry.sourceEvent && entry.targetEvent);

            const blueprintArcIndexByPair = new Map<string, number>();

            const blueprintEventConnectionPaths = blueprintEventConnectionsG
                .selectAll("path.blueprint-event-connection")
                .data(resolvedBlueprintEventConnections, (entry: any) => entry.connection.id)
                .join("path")
                .attr("class", "blueprint-event-connection")
                .attr("data-timeline-interactive", "true")
                .attr("fill", "none")
                .attr("stroke", (entry: any) => {
                    const isHighlighted =
                        highlightedBlueprintEventIds.has(entry.connection.sourceBlueprintEventId) ||
                        highlightedBlueprintEventIds.has(entry.connection.targetBlueprintEventId);
                    return isHighlighted
                        ? BLUEPRINT_HIGHLIGHT_STROKE
                        : connectionColorForKind(entry.connection.kind);
                })
                .attr("stroke-width", (entry: any) => {
                    const isHighlighted =
                        highlightedBlueprintEventIds.has(entry.connection.sourceBlueprintEventId) ||
                        highlightedBlueprintEventIds.has(entry.connection.targetBlueprintEventId);
                    return isHighlighted ? 3.6 : 3;
                })
                .attr("opacity", (entry: any) => {
                    const isHighlighted =
                        highlightedBlueprintEventIds.has(entry.connection.sourceBlueprintEventId) ||
                        highlightedBlueprintEventIds.has(entry.connection.targetBlueprintEventId);
                    return isHighlighted ? 1 : 0.88;
                })
                .style("cursor", "pointer")
                .attr("d", (entry: any) => {
                    const sourceX = x(entry.sourceEvent.date);
                    const targetX = x(entry.targetEvent.date);
                    if (!Number.isFinite(sourceX) || !Number.isFinite(targetX)) {
                        return "";
                    }

                    const minX = Math.min(sourceX, targetX);
                    const maxX = Math.max(sourceX, targetX);
                    const sortedPair = [entry.connection.sourceBlueprintEventId, entry.connection.targetBlueprintEventId]
                        .sort()
                        .join("::");
                    const pairKey = `${sortedPair}::${minX}:${maxX}`;
                    const arcIndex = blueprintArcIndexByPair.get(pairKey) ?? 0;
                    blueprintArcIndexByPair.set(pairKey, arcIndex + 1);

                    const midX = (sourceX + targetX) / 2;
                    const arcHeight = 12 + arcIndex * 8;
                    const controlY = blueprintEventLaneCenterY - arcHeight;
                    return `M ${sourceX} ${blueprintEventLaneCenterY} Q ${midX} ${controlY} ${targetX} ${blueprintEventLaneCenterY}`;
                });

            blueprintEventConnectionPaths
                .append("title")
                .text((entry: any) =>
                    `${entry.connection.sourceBlueprintEventName} -> ${entry.connection.targetBlueprintEventName}\n` +
                    `Label: ${entry.connection.label || entry.connection.kind}`
                );

            const resolvedBlueprintCodebaseLinks = blueprintCodebaseLinks
                .map((link) => ({
                    link,
                    blueprintEvent: blueprintEventsById.get(link.blueprintEventId),
                    subtrackRow: codebaseSubtrackRowsById.get(link.codebaseSubtrackId),
                }))
                .filter((entry) => entry.blueprintEvent && entry.subtrackRow);

            blueprintCodebaseLinksG
                .selectAll("path")
                .data(resolvedBlueprintCodebaseLinks)
                .enter()
                .append("path")
                .attr("class", classes.blueprintCodebaseLink)
                .classed(
                    classes.blueprintCodebaseLinkActive,
                    (entry: any) =>
                        entry.link.blueprintEventId === pendingBlueprintLinkEventId ||
                        highlightedBlueprintEventIds.has(entry.link.blueprintEventId)
                )
                .style("stroke", (entry: any) => {
                    if (highlightedBlueprintEventIds.has(entry.link.blueprintEventId)) {
                        return BLUEPRINT_HIGHLIGHT_STROKE;
                    }
                    if (entry.link.blueprintEventId === pendingBlueprintLinkEventId) {
                        return "#2d7dd2";
                    }
                    return null;
                })
                .style("stroke-width", (entry: any) =>
                    highlightedBlueprintEventIds.has(entry.link.blueprintEventId) ? 3.2 : null
                )
                .style("pointer-events", "stroke")
                .style("cursor", "context-menu")
                .attr("d", (entry: any) => {
                    const sourceX = x(entry.blueprintEvent.date);
                    const sourceY = laneY.blueprint + laneH / 2;
                    const targetY = entry.subtrackRow.center;

                    return `M ${sourceX} ${sourceY} L ${sourceX} ${targetY}`;
                })
                .attr("marker-end", (entry: any) =>
                    highlightedBlueprintEventIds.has(entry.link.blueprintEventId) ||
                    entry.link.blueprintEventId === pendingBlueprintLinkEventId
                        ? "url(#blueprint-link-arrow-head-active)"
                        : "url(#blueprint-link-arrow-head)"
                )
                .on("contextmenu", (event: any, entry: any) => {
                    if (readOnly) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setMilestoneMenu(null);
                    setBlueprintLinkMenu(null);
                    setBlueprintCodebaseLinkMenu({
                        x: sx,
                        y: sy,
                        linkId: entry.link.id,
                    });
                    setKnowledgeTrackMenu(null);
                    setShowTooltip(false);
                });

            const plot = (
                events: any[],
                kind: LaneType,
                centerY: number | ((eventData: any) => number),
                icon: (
                    g: d3.Selection<SVGGElement, unknown, null, undefined>,
                    eventData: any
                ) => void,
                opacity = 1
            ) => {
                const group = eventsG.append("g");

                const eventMarks = group
                    .selectAll("g")
                    .data(events)
                    .enter()
                    .append("g")
                    .attr(
                        "class",
                        classes.event
                    )
                    .style("opacity", opacity)
                    .attr("transform", (eventData: any) => {
                        const resolvedCenterY = typeof centerY === "function"
                            ? centerY(eventData)
                            : centerY;
                        const isHighlightedBlueprintEvent =
                            kind === "blueprint" && highlightedBlueprintEventIds.has(eventData.id);
                        const scale = isHighlightedBlueprintEvent ? 1.35 : 1;
                        return `translate(${x(toDate(eventData.date))}, ${resolvedCenterY}) scale(${scale})`;
                    })
                    .each(function drawIcon(this: SVGGElement, eventData: any) {
                        icon(d3.select(this), eventData);
                    })
                    .selectAll("rect, circle, path")
                    .attr("class", classes.eventShape)
                    .style("fill", (eventData: any) => {
                        if (kind === "designStudy") {
                            return eventData.generatedBy === "llm" ? "rgb(110, 176, 238)" : "rgb(238, 168, 110)";
                        }
                        const isHighlightedBlueprintEvent =
                            kind === "blueprint" && highlightedBlueprintEventIds.has(eventData.id);
                        return isHighlightedBlueprintEvent ? BLUEPRINT_HIGHLIGHT_FILL : null;
                    })
                    .style("stroke", (eventData: any) => {
                        if (kind === "designStudy") {
                            return eventData.generatedBy === "llm" ? "rgb(67, 132, 192)" : "rgb(188, 115, 56)";
                        }
                        const isHighlightedBlueprintEvent =
                            kind === "blueprint" && highlightedBlueprintEventIds.has(eventData.id);
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isDisconnectedBlueprintEvent) return "#4D4D4D";
                        return isHighlightedBlueprintEvent ? BLUEPRINT_HIGHLIGHT_STROKE : null;
                    })
                    .style("stroke-width", (eventData: any) => {
                        if (kind === "designStudy") return 1.4;
                        if (kind === "knowledge") return 1.5;
                        const isHighlightedBlueprintEvent =
                            kind === "blueprint" && highlightedBlueprintEventIds.has(eventData.id);
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isDisconnectedBlueprintEvent) return 1.8;
                        return isHighlightedBlueprintEvent ? 2.2 : null;
                    })
                    .style("opacity", (eventData: any) => {
                        if (kind === "knowledge") {
                            return eventData.isDeleted ? 0.45 : 1;
                        }
                        const isHighlightedBlueprintEvent =
                            kind === "blueprint" && highlightedBlueprintEventIds.has(eventData.id);
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isHighlightedBlueprintEvent) return 1;
                        return isDisconnectedBlueprintEvent ? 0.45 : 1;
                    })
                    .style("stroke-dasharray", (eventData: any) => {
                        if (kind === "knowledge") {
                            return eventData.isDeleted ? "4 3" : null;
                        }
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        return isDisconnectedBlueprintEvent ? "4 3" : null;
                    })
                    .on("mouseenter", (_event: any, eventData: any) => {
                        if (kind !== "blueprint") return;
                        if (typeof eventData.componentNodeId !== "string" || eventData.componentNodeId.trim() === "") {
                            return;
                        }
                        if (hoveredBlueprintComponentNodeId === eventData.componentNodeId) return;
                        dispatch(setHoveredBlueprintComponentNodeId(eventData.componentNodeId));
                    })
                    .on("mouseleave", () => {
                        if (kind !== "blueprint") return;
                        if (!hoveredBlueprintComponentNodeId) return;
                        dispatch(setHoveredBlueprintComponentNodeId(null));
                    })
                    .on("click", (event: any, eventData: any) => {
                        if (kind !== "codebase" && kind !== "blueprint" && kind !== "designStudy") return;
                        hideKnowledgePillTooltip();

                        const heightOffset = containerRef.current
                            ? containerRef.current.getBoundingClientRect().top
                            : 0;

                        const clampedX = Math.min(Math.max(event.clientX, 0), window.innerWidth - 300);
                        const clampedY =
                            Math.min(Math.max(event.clientY, 0), window.innerHeight - 150) -
                            heightOffset;

                        if (kind === "designStudy") {
                            setMilestoneMenu(null);
                            setSelectedMilestone(null);
                            setBlueprintCodebaseLinkMenu(null);
                            setBlueprintLinkMenu(null);
                        }

                        setSelectedEvent({ kind, event: eventData });
                        setTooltipPosition({ x: clampedX, y: clampedY });
                        setShowTooltip(true);
                    })
                    .on("contextmenu", (event: any, eventData: any) => {
                        if (kind === "designStudy") {
                            if (readOnly) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
                            setMilestoneMenu({ x: sx, y: sy, date: "" });
                            setSelectedMilestone(eventData);
                            setBlueprintCodebaseLinkMenu(null);
                            setBlueprintLinkMenu(null);
                            setKnowledgeTrackMenu(null);
                            setShowTooltip(false);
                            return;
                        }

                        if (kind !== "blueprint") return;
                        if (readOnly) return;

                        event.preventDefault();
                        event.stopPropagation();
                        const [sx, sy] = d3.pointer(event, containerRef.current);
                        setMilestoneMenu(null);
                        setBlueprintCodebaseLinkMenu(null);
                        setBlueprintLinkMenu({
                            x: sx,
                            y: sy,
                            blueprintEventId: eventData.id,
                        });
                        setKnowledgeTrackMenu(null);
                        setShowTooltip(false);
                    });

                if (kind === "blueprint" && highlightedBlueprintEventIds.size > 0) {
                    eventMarks
                        .filter((eventData: any) =>
                            highlightedBlueprintEventIds.has(eventData.id)
                        )
                        .raise();
                }
            };

            plot(parsed.ds, "designStudy", laneY.designStudy + laneH / 2, drawDiamond);
            plot(
                parsed.kb,
                "knowledge",
                (eventData: any) => {
                    if (!eventData?.treeId) return knowledgeMainTrackRow.center;
                    return knowledgeTrackRowForTree(eventData.treeId).center;
                },
                drawCircle
            );
            plot(parsed.bp, "blueprint", laneY.blueprint + laneH / 2, drawTriangle);
            plot(parsed.cb, "codebase", laneY.codebase + laneH / 2, drawSquare);

            for (const row of codebaseSubtrackRows) {
                if (row.collapsed) continue;

                const rowEvents = eventsByCodebaseSubtrack.get(row.id) ?? [];
                plot(rowEvents, "codebase", row.center, drawSquare, row.inactive ? 0.35 : 1);
            }

            svg.on("mousedown.knowledge-pill-hover-guard", (event: MouseEvent) => {
                if (activeKnowledgePillTreeId === null) return;
                const target = event.target;
                if (!(target instanceof Element) || !target.closest("g.knowledge-tree-pill")) {
                    hideKnowledgePillTooltip();
                }
            });
            svg.on("wheel.knowledge-pill-hover-guard", () => {
                hideKnowledgePillTooltip();
            });
        };

        draw(zoomTransformRef.current.rescaleX(x0));
        lanesG.raise();
        subtrackFilesTooltip.raise();

        const zoom = d3
            .zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 3000])
            .filter((event: any) => {
                if (isTimelineInteractiveTarget(event)) return false;
                const [px, py] = d3.pointer(event, currentSvg);
                const isInsideTrackArea =
                    px >= timelineLeft &&
                    px <= timelineLeft + innerW &&
                    py >= laneY.designStudy &&
                    py <= codebaseSubtracksBottom;
                if (!isInsideTrackArea) return false;
                if (typeof event.type === "string" && event.type.startsWith("drag")) {
                    return false;
                }
                if (event.shiftKey) return false;
                return !event.ctrlKey || event.type === "wheel";
            })
            .translateExtent([
                [timelineLeft, 0],
                [timelineLeft + innerW, svgHeight],
            ])
            .extent([
                [timelineLeft, 0],
                [timelineLeft + innerW, svgHeight],
            ])
            .on("zoom", (event: any) => {
                zoomTransformRef.current = event.transform;
                const x = event.transform.rescaleX(x0);
                draw(x);
            });

        svg.call(zoom as any);
        svg.call(zoom.transform as any, zoomTransformRef.current);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Shift") brushG.style("display", "block");
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Shift") brushG.style("display", "none");
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            svg.selectAll(`.${classes.subtrackFilesTooltip}`).remove();
        };
    }, [
        parsed,
        width,
        height,
        margin,
        defaultStages,
        containerRef,
        svgRef,
        zoomTransformRef,
        startCaretRef,
        endCaretRef,
        todayCaretRef,
        newStageButtonRef,
        newKnowledgeSubtrackButtonRef,
        newCodebaseSubtrackButtonRef,
        codebaseVisualButtonRef,
        syncCodebaseButtonRef,
        llmButtonRef,
        codebaseSubtracks,
        knowledgeSubtracks,
        knowledgePillTrackAssignments,
        knowledgeTreePills,
        knowledgeCrossTreeConnections,
        knowledgeBlueprintLinks,
        blueprintEventConnections,
        hoveredKnowledgeTreeId,
        onHoveredKnowledgeTreeIdChange,
        blueprintCodebaseLinks,
        systemScreenshotMarkers,
        playbackAt,
        onPlaybackAtChange,
        pendingBlueprintLinkEventId,
        hoveredCodebaseFilePath,
        highlightedCodebaseFilePaths,
        hoveredBlueprintComponentNodeId,
        connectedBlueprintComponentNodeIds,
        readOnly,
        allowKnowledgeTrackClearMenu,
        dispatch,
        onStageBoundaryChange,
        onStageLaneDeletion,
        onAttachFileToCodebaseSubtrack,
        onToggleCodebaseSubtrackCollapsed,
        onToggleCodebaseSubtrackInactive,
        onToggleKnowledgeSubtrackCollapsed,
        onToggleKnowledgeSubtrackInactive,
        onDeleteCodebaseSubtrack,
        onDeleteKnowledgeSubtrack,
        onAssignKnowledgePillToSubtrack,
        onCreateBlueprintCodebaseLink,
        onDeleteSystemScreenshotMarker,
        onSuggestCodebaseSubtrackFiles,
        onToggleCodebaseSubtrackVisualEvolution,
        suggestingCodebaseSubtrackIds,
        setSystemScreenshotTooltip,
        setMilestoneMenu,
        setSelectedMilestone,
        setBlueprintLinkMenu,
        setBlueprintCodebaseLinkMenu,
        setKnowledgeTrackMenu,
        setTagPicker,
        setStageMenu,
        setNameEdit,
        setSelectedEvent,
        setTooltipPosition,
        setShowTooltip,
    ]);
}
