import { useEffect } from "react";
import * as d3 from "d3";
import { faCheck, faCircle, faWandSparkles } from "@fortawesome/free-solid-svg-icons";
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
    CodebaseSubtrack,
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

type NameEditState = {
    id: string;
    x: number;
    y: number;
    key: "designStudyEvent" | "subStage" | "codebaseSubtrack";
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
    newCodebaseSubtrackButtonRef: RefObject<HTMLSpanElement | null>;
    syncCodebaseButtonRef: RefObject<HTMLSpanElement | null>;
    llmButtonRef: RefObject<HTMLSpanElement | null>;
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
    defaultStages: string[];
    parsed: ParsedTimelineData;
    codebaseSubtracks: CodebaseSubtrack[];
    blueprintCodebaseLinks: BlueprintCodebaseLink[];
    systemScreenshotMarkers: SystemScreenshotMarker[];
    pendingBlueprintLinkEventId: string | null;
    hoveredCodebaseFilePath: string | null;
    highlightedCodebaseFilePaths: string[];
    hoveredBlueprintComponentNodeId: string | null;
    connectedBlueprintComponentNodeIds: string[];
    readOnly: boolean;
    dispatch: (action: any) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
    onStageLaneDeletion: (id: string) => void;
    onAttachFileToCodebaseSubtrack: (subtrackId: string, filePath: string) => void;
    onToggleCodebaseSubtrackCollapsed: (subtrackId: string) => void;
    onToggleCodebaseSubtrackInactive: (subtrackId: string) => void;
    onDeleteCodebaseSubtrack: (subtrackId: string) => void;
    onCreateBlueprintCodebaseLink: (blueprintEventId: string, codebaseSubtrackId: string) => void;
    onDeleteSystemScreenshotMarker: (markerId: string) => void;
    onSuggestCodebaseSubtrackFiles: (subtrackId: string) => void;
    suggestingCodebaseSubtrackIds: string[];
    setSystemScreenshotTooltip: Dispatch<SetStateAction<SystemScreenshotTooltipState>>;
    setMilestoneMenu: Dispatch<SetStateAction<MilestoneMenuState>>;
    setSelectedMilestone: Dispatch<SetStateAction<DesignStudyEvent | null>>;
    setBlueprintLinkMenu: Dispatch<SetStateAction<BlueprintLinkMenuState>>;
    setBlueprintCodebaseLinkMenu: Dispatch<SetStateAction<BlueprintCodebaseLinkMenuState>>;
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
    newCodebaseSubtrackButtonRef,
    syncCodebaseButtonRef,
    llmButtonRef,
    width,
    height,
    margin,
    defaultStages,
    parsed,
    codebaseSubtracks,
    blueprintCodebaseLinks,
    systemScreenshotMarkers,
    pendingBlueprintLinkEventId,
    hoveredCodebaseFilePath,
    highlightedCodebaseFilePaths,
    hoveredBlueprintComponentNodeId,
    connectedBlueprintComponentNodeIds,
    readOnly,
    dispatch,
    onStageBoundaryChange,
    onStageLaneDeletion,
    onAttachFileToCodebaseSubtrack,
    onToggleCodebaseSubtrackCollapsed,
    onToggleCodebaseSubtrackInactive,
    onDeleteCodebaseSubtrack,
    onCreateBlueprintCodebaseLink,
    onDeleteSystemScreenshotMarker,
    onSuggestCodebaseSubtrackFiles,
    suggestingCodebaseSubtrackIds,
    setSystemScreenshotTooltip,
    setMilestoneMenu,
    setSelectedMilestone,
    setBlueprintLinkMenu,
    setBlueprintCodebaseLinkMenu,
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

        const laneY = {
            designStudy: lanesTop + laneH / 2,
            knowledge: lanesTop + laneH + laneGap + laneH / 2,
            blueprint: lanesTop + 2 * (laneH + laneGap) + laneH / 2,
            codebase: lanesTop + 3 * (laneH + laneGap) + laneH / 2,
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
        const highlightedSubtrackIdsFromBlueprintHover = new Set<string>();
        const highlightedBlueprintEventIdsFromFileHover = new Set<string>();
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

        if (highlightedCodebasePathSet.size > 0) {
            const highlightedSubtrackIdsFromFileHover = new Set(
                codebaseSubtracks
                    .filter((subtrack) =>
                        subtrack.filePaths.some((path) => highlightedCodebasePathSet.has(normalizePath(path)))
                    )
                    .map((subtrack) => subtrack.id)
            );

            for (const link of blueprintCodebaseLinks) {
                if (highlightedSubtrackIdsFromFileHover.has(link.codebaseSubtrackId)) {
                    highlightedBlueprintEventIdsFromFileHover.add(link.blueprintEventId);
                }
            }
        }

        if (hoveredBlueprintComponentNodeId) {
            const hoveredBlueprintEventIds = new Set(
                parsed.bp
                    .filter((eventData) => eventData.componentNodeId === hoveredBlueprintComponentNodeId)
                    .map((eventData) => eventData.id)
            );

            for (const link of blueprintCodebaseLinks) {
                if (hoveredBlueprintEventIds.has(link.blueprintEventId)) {
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
                    subtrack.filePaths.some((path) => highlightedCodebasePathSet.has(normalizePath(path))) ||
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
            .attr("fill", "rgba(45, 125, 210, 0.8)");

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
        const blueprintCodebaseLinksG = svg.append("g");
        const eventsG = svg.append("g");

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
            ...codebaseSubtrackRows.map((row) => ({
                lane: "codebaseSubtrack" as const,
                top: row.top,
                height: row.height,
            })),
        ];

        lanes.forEach((lane) => {
            const y = laneY[lane.key];

            laneBackgroundG
                .append("rect")
                .attr("class", classes.laneLine)
                .attr("x", margin.left)
                .attr("y", y)
                .attr("width", totalTrackWidth)
                .attr("height", 65);

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
            .attr("y", (row) => row.top)
            .attr("width", totalTrackWidth)
            .attr("height", (row) => row.height)
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

        codebaseSubtrackGroups
            .append("rect")
            .attr("class", classes.codebaseSubtrackLinkTarget)
            .attr("x", timelineLeft)
            .attr("y", (row) => row.top)
            .attr("width", innerW)
            .attr("height", (row) => row.height)
            .attr("data-timeline-interactive", pendingBlueprintLinkEventId ? "true" : null)
            .style("fill", pendingBlueprintLinkEventId ? "rgba(45, 125, 210, 0.10)" : "transparent")
            .style("stroke", pendingBlueprintLinkEventId ? "rgba(45, 125, 210, 0.45)" : "none")
            .style("stroke-dasharray", pendingBlueprintLinkEventId ? "4 3" : null)
            .style("pointer-events", readOnly ? "none" : (pendingBlueprintLinkEventId ? "all" : "none"))
            .style("cursor", readOnly ? "default" : (pendingBlueprintLinkEventId ? "crosshair" : "default"))
            .on("click", (event: any, row: any) => {
                if (readOnly) return;
                if (!pendingBlueprintLinkEventId) return;
                event.preventDefault();
                event.stopPropagation();
                onCreateBlueprintCodebaseLink(pendingBlueprintLinkEventId, row.id);
            });

        codebaseSubtrackGroups
            .append("rect")
            .attr("x", margin.left)
            .attr("y", (row) => row.top)
            .attr("width", laneHeaderWidth)
            .attr("height", (row) => row.height)
            .attr("class", classes.codebaseDropZone)
            .style("fill", (row: any) => (row.isHighlighted ? "rgba(0, 199, 255, 0.14)" : "transparent"))
            .style("stroke", (row: any) => (row.isHighlighted ? "#00A8DB" : "none"))
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
            .text((row: any) => (row.collapsed ? "❯" : "V"))
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
            .attr("display", (row) => (row.collapsed ? "none" : "block"));

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

            lines.forEach((line, index) => {
                subtrackFilesTooltipText
                    .append("tspan")
                    .attr("dy", index === 0 ? 0 : 14)
                    .text(line);
            });

            const tspans = subtrackFilesTooltipText.selectAll<SVGTSpanElement, unknown>("tspan").nodes();
            const maxLineWidth = tspans.reduce((maxWidth, node) => {
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
                setShowTooltip(false);
            };

            g.append("path")
                .attr("d", "M 0 -12 L 12 0 L 0 12 L -12 0 Z")
                .on("contextmenu", openMilestoneMenu)
                .on("click", openMilestoneMenu);

            g.append("text")
                .attr("class", classes.diamondText)
                .attr("x", 0)
                .attr("y", -15)
                .text(eventData.name)
                .on("contextmenu", openMilestoneMenu)
                .on("click", (event: any) => {
                    if (readOnly) return;
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setNameEdit({
                        id: eventData.id,
                        x: sx,
                        y: sy,
                        value: eventData.name,
                        key: "designStudyEvent",
                    });
                });
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
                .each(function stageRow(stageData: any) {
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
                        .attr("y", (fillRow) => Math.round(fillRow.top))
                        .attr("width", x(stageData.end) - x(stageData.start))
                        .attr("height", (fillRow) => fillRow.height)
                        .attr("fill", stageColor(stageData.name))
                        .attr("opacity", 0.5)
                        .on("contextmenu", function (event: any, fillRow: { lane: LaneType | "codebaseSubtrack" }) {
                            if (readOnly) return;
                            if (fillRow.lane !== "designStudy") return;

                            event.preventDefault();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
                            setSelectedMilestone(null);
                            setMilestoneMenu({ x: sx, y: sy, date: fromDate(x.invert(sx)) });
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
                newCodebaseSubtrackButtonRef.current,
                margin.left + 8,
                laneY.codebase + 40
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
                .each(function attachBrush(laneDef: any) {
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

            const screenshotMarkerTopY = margin.top + 18;
            const screenshotLineBottomY = codebaseSubtracksBottom;
            const clampTimelineX = (value: number) =>
                Math.max(timelineLeft, Math.min(timelineLeft + innerW, value));

            const screenshotMarkerGroups = markerG
                .selectAll("g.systemScreenshotMarker")
                .data(parsedSystemScreenshotMarkers, (markerData: any) => markerData.id)
                .join((enter) =>
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
                    (entry: any) => entry.link.blueprintEventId === pendingBlueprintLinkEventId
                )
                .style("pointer-events", "stroke")
                .style("cursor", "context-menu")
                .attr("d", (entry: any) => {
                    const sourceX = x(entry.blueprintEvent.date);
                    const sourceY = laneY.blueprint + laneH / 2;
                    const targetY = entry.subtrackRow.center;

                    return `M ${sourceX} ${sourceY} L ${sourceX} ${targetY}`;
                })
                .attr("marker-end", "url(#blueprint-link-arrow-head)")
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
                    setShowTooltip(false);
                });

            const plot = (
                events: any[],
                kind: LaneType,
                centerY: number,
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
                        const isHoveredBlueprintComponentEvent =
                            kind === "blueprint" &&
                            hoveredBlueprintComponentNodeId &&
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId;
                        const isHighlightedByFileHover =
                            kind === "blueprint" &&
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id);
                        const isHighlightedBlueprintEvent = isHoveredBlueprintComponentEvent || isHighlightedByFileHover;
                        const scale = isHighlightedBlueprintEvent ? 1.35 : 1;
                        return `translate(${x(toDate(eventData.date))}, ${centerY}) scale(${scale})`;
                    })
                    .each(function drawIcon(eventData: any) {
                        icon(d3.select(this), eventData);
                    })
                    .selectAll("rect, circle, path")
                    .attr("class", classes.eventShape)
                    .style("fill", (eventData: any) => {
                        if (kind === "designStudy") {
                            return eventData.generatedBy === "llm" ? "rgb(110, 176, 238)" : "rgb(238, 168, 110)";
                        }
                        const isHoveredBlueprintComponentEvent =
                            kind === "blueprint" &&
                            hoveredBlueprintComponentNodeId &&
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId;
                        const isHighlightedByFileHover =
                            kind === "blueprint" &&
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id);
                        const isHighlightedBlueprintEvent = isHoveredBlueprintComponentEvent || isHighlightedByFileHover;
                        return isHighlightedBlueprintEvent ? "#00A8DB" : null;
                    })
                    .style("stroke", (eventData: any) => {
                        if (kind === "designStudy") {
                            return eventData.generatedBy === "llm" ? "rgb(67, 132, 192)" : "rgb(188, 115, 56)";
                        }
                        const isHoveredBlueprintComponentEvent =
                            kind === "blueprint" &&
                            hoveredBlueprintComponentNodeId &&
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId;
                        const isHighlightedByFileHover =
                            kind === "blueprint" &&
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id);
                        const isHighlightedBlueprintEvent = isHoveredBlueprintComponentEvent || isHighlightedByFileHover;
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isDisconnectedBlueprintEvent) return "#4D4D4D";
                        return isHighlightedBlueprintEvent ? "#005E79" : null;
                    })
                    .style("stroke-width", (eventData: any) => {
                        if (kind === "designStudy") return 1.4;
                        const isHoveredBlueprintComponentEvent =
                            kind === "blueprint" &&
                            hoveredBlueprintComponentNodeId &&
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId;
                        const isHighlightedByFileHover =
                            kind === "blueprint" &&
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id);
                        const isHighlightedBlueprintEvent = isHoveredBlueprintComponentEvent || isHighlightedByFileHover;
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isDisconnectedBlueprintEvent) return 1.8;
                        return isHighlightedBlueprintEvent ? 2.2 : null;
                    })
                    .style("opacity", (eventData: any) => {
                        const isHoveredBlueprintComponentEvent =
                            kind === "blueprint" &&
                            hoveredBlueprintComponentNodeId &&
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId;
                        const isHighlightedByFileHover =
                            kind === "blueprint" &&
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id);
                        const isHighlightedBlueprintEvent = isHoveredBlueprintComponentEvent || isHighlightedByFileHover;
                        const isDisconnectedBlueprintEvent =
                            kind === "blueprint" &&
                            typeof eventData.componentNodeId === "string" &&
                            eventData.componentNodeId.trim() !== "" &&
                            !connectedBlueprintComponentNodeIdSet.has(eventData.componentNodeId);
                        if (isHighlightedBlueprintEvent) return 1;
                        return isDisconnectedBlueprintEvent ? 0.45 : 1;
                    })
                    .style("stroke-dasharray", (eventData: any) => {
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
                        if (kind !== "codebase" && kind !== "blueprint") return;

                        const heightOffset = containerRef.current
                            ? containerRef.current.getBoundingClientRect().top
                            : 0;

                        const clampedX = Math.min(Math.max(event.clientX, 0), window.innerWidth - 300);
                        const clampedY =
                            Math.min(Math.max(event.clientY, 0), window.innerHeight - 150) -
                            heightOffset;

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
                        setShowTooltip(false);
                    });

                if (kind === "blueprint" && (hoveredBlueprintComponentNodeId || highlightedBlueprintEventIdsFromFileHover.size > 0)) {
                    eventMarks
                        .filter((eventData: any) =>
                            eventData.componentNodeId === hoveredBlueprintComponentNodeId ||
                            highlightedBlueprintEventIdsFromFileHover.has(eventData.id)
                        )
                        .raise();
                }
            };

            plot(parsed.ds, "designStudy", laneY.designStudy + laneH / 2, drawDiamond);
            plot(parsed.kb, "knowledge", laneY.knowledge + laneH / 2, drawCircle);
            plot(parsed.bp, "blueprint", laneY.blueprint + laneH / 2, drawTriangle);
            plot(parsed.cb, "codebase", laneY.codebase + laneH / 2, drawSquare);

            for (const row of codebaseSubtrackRows) {
                if (row.collapsed) continue;

                const rowEvents = eventsByCodebaseSubtrack.get(row.id) ?? [];
                plot(rowEvents, "codebase", row.center, drawSquare, row.inactive ? 0.35 : 1);
            }
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
        newCodebaseSubtrackButtonRef,
        syncCodebaseButtonRef,
        llmButtonRef,
        codebaseSubtracks,
        blueprintCodebaseLinks,
        systemScreenshotMarkers,
        pendingBlueprintLinkEventId,
        hoveredCodebaseFilePath,
        highlightedCodebaseFilePaths,
        hoveredBlueprintComponentNodeId,
        connectedBlueprintComponentNodeIds,
        readOnly,
        dispatch,
        onStageBoundaryChange,
        onStageLaneDeletion,
        onAttachFileToCodebaseSubtrack,
        onToggleCodebaseSubtrackCollapsed,
        onToggleCodebaseSubtrackInactive,
        onDeleteCodebaseSubtrack,
        onCreateBlueprintCodebaseLink,
        onDeleteSystemScreenshotMarker,
        onSuggestCodebaseSubtrackFiles,
        suggestingCodebaseSubtrackIds,
        setSystemScreenshotTooltip,
        setMilestoneMenu,
        setSelectedMilestone,
        setBlueprintLinkMenu,
        setBlueprintCodebaseLinkMenu,
        setTagPicker,
        setStageMenu,
        setNameEdit,
        setSelectedEvent,
        setTooltipPosition,
        setShowTooltip,
    ]);
}
