import { useEffect } from "react";
import * as d3 from "d3";
import type {
    Dispatch,
    MutableRefObject,
    RefObject,
    SetStateAction,
} from "react";
import type { DesignStudyEvent, LaneType, Stage } from "@/config/types";
import { addSubStage, deleteSubStage } from "@/store/timelineSlice";
import classes from "./Timeline.module.css";
import type {
    CodebaseSubtrack,
    ParsedTimelineData,
    SelectedTimelineEvent,
} from "./timelineTypes";
import { fromDate, setRefPos, toDate } from "./timelineUtils";

type MilestoneMenuState = { x: number; y: number; date: string } | null;

type TagPickerState = (Stage & { x: number; y: number }) | null;

type StageMenuState = {
    subStageId: string;
    x: number;
    y: number;
} | null;

type NameEditState = {
    id: string;
    x: number;
    y: number;
    key: "designStudyEvent" | "subStage";
    value: string;
} | null;

type TooltipPosition = {
    x: number;
    y: number;
};

const normalizePath = (path: string) =>
    path.replace(/\\/g, "/").replace(/^\/+/, "");

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
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
    defaultStages: string[];
    parsed: ParsedTimelineData;
    codebaseSubtracks: CodebaseSubtrack[];
    dispatch: (action: unknown) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
    onStageLaneDeletion: (id: string) => void;
    onAttachFileToCodebaseSubtrack: (subtrackId: string, filePath: string) => void;
    onToggleCodebaseSubtrackCollapsed: (subtrackId: string) => void;
    onRenameCodebaseSubtrack: (subtrackId: string, name: string) => void;
    onDeleteCodebaseSubtrack: (subtrackId: string) => void;
    setMilestoneMenu: Dispatch<SetStateAction<MilestoneMenuState>>;
    setSelectedMilestone: Dispatch<SetStateAction<DesignStudyEvent | null>>;
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
    width,
    height,
    margin,
    defaultStages,
    parsed,
    codebaseSubtracks,
    dispatch,
    onStageBoundaryChange,
    onStageLaneDeletion,
    onAttachFileToCodebaseSubtrack,
    onToggleCodebaseSubtrackCollapsed,
    onRenameCodebaseSubtrack,
    onDeleteCodebaseSubtrack,
    setMilestoneMenu,
    setSelectedMilestone,
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

        const innerW = width - margin.left - margin.right;

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
            };
        });

        const codebaseSubtracksBottom =
            codebaseSubtrackRows.length > 0
                ? codebaseSubtrackRows[codebaseSubtrackRows.length - 1].top +
                codebaseSubtrackRows[codebaseSubtrackRows.length - 1].height
                : laneY.codebase + laneH;

        const findCodebaseSubtrackAtY = (py: number) =>
            codebaseSubtrackRows.find(
                (row) => py >= row.top && py <= row.top + row.height
            ) ?? null;

        const svgHeight = Math.max(viewportHeight, Math.ceil(codebaseSubtracksBottom + margin.bottom + 8));

        const svg = d3.select(currentSvg)
            .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
            .attr("height", svgHeight)
            .style("height", `${svgHeight}px`);

        svg.selectAll("*").remove();

        const pointerOnSvg = (event: DragEvent): [number, number] => {
            const [px, py] = d3.pointer(event, currentSvg);
            if (Number.isFinite(px) && Number.isFinite(py)) {
                return [px, py];
            }

            const bounds = currentSvg.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return [0, 0];

            const normalizedX = (event.clientX - bounds.left) / bounds.width;
            const normalizedY = (event.clientY - bounds.top) / bounds.height;

            return [normalizedX * svgWidth, normalizedY * svgHeight];
        };

        const x0 = d3
            .scaleTime()
            .domain(parsed.domain)
            .range([margin.left, margin.left + innerW]);

        const stageColor = d3
            .scaleOrdinal<string, string>()
            .domain(defaultStages)
            .range(d3.schemePastel2)
            .unknown("#ccc");

        const axisG = svg
            .append("g")
            .attr("class", classes.axis)
            .attr("transform", `translate(0, ${margin.top + 14})`);

        const stageG = svg.append("g");
        const markerG = svg.append("g");
        const lanesG = svg.append("g");
        const brushG = svg.append("g").style("display", "none");
        const subStagesG = svg.append("g");
        const eventsG = svg.append("g");

        const handleSvgDragEnter = (event: DragEvent) => {
            const [, py] = pointerOnSvg(event);
            const hoveredSubtrack = findCodebaseSubtrackAtY(py);
            if (!hoveredSubtrack) return;

            event.preventDefault();
            event.stopPropagation();
        };

        const handleSvgDragOver = (event: DragEvent) => {
            const [, py] = pointerOnSvg(event);
            const hoveredSubtrack = findCodebaseSubtrackAtY(py);
            if (!hoveredSubtrack) return;

            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "copy";
            }
        };

        const handleSvgDrop = (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();

            const droppedPath = getDroppedGitHubFilePath(event);
            if (!droppedPath) return;

            const [, py] = pointerOnSvg(event);
            const hoveredSubtrack = findCodebaseSubtrackAtY(py);
            if (!hoveredSubtrack) return;

            onAttachFileToCodebaseSubtrack(hoveredSubtrack.id, droppedPath);
        };

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

        currentSvg.addEventListener("dragenter", handleSvgDragEnter);
        currentSvg.addEventListener("dragover", handleSvgDragOver);
        currentSvg.addEventListener("drop", handleSvgDrop);

        lanes.forEach((lane) => {
            const y = laneY[lane.key];

            lanesG
                .append("rect")
                .attr("class", classes.laneLine)
                .attr("x", margin.left)
                .attr("y", y)
                .attr("width", innerW)
                .attr("height", 65);

            lanesG
                .append("text")
                .attr("class", classes.laneLabel)
                .attr("x", margin.left + 8)
                .attr("y", y + 18)
                .text(lane.label);
        });

        const codebaseSubtrackGroups = lanesG
            .selectAll("g.codebase-subtrack")
            .data(codebaseSubtrackRows)
            .enter()
            .append("g")
            .attr("class", "codebase-subtrack");

        codebaseSubtrackGroups
            .append("rect")
            .attr("class", classes.laneLine)
            .attr("x", margin.left)
            .attr("y", (row) => row.top)
            .attr("width", innerW)
            .attr("height", (row) => row.height)
            .attr("fill", "transparent")
            .attr("stroke", "#c6c6c6");

        codebaseSubtrackGroups
            .append("rect")
            .attr("x", margin.left)
            .attr("y", (row) => row.top)
            .attr("width", innerW)
            .attr("height", (row) => row.height)
            .attr("fill", "transparent")
            .attr("data-timeline-interactive", "true")
            .style("pointer-events", "all")
            .style("cursor", "copy")
            .on("dragenter", (event: any) => {
                event.preventDefault();
                event.stopPropagation();
            })
            .on("dragover", (event: any) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "copy";
                }
            })
            .on("drop", (event: any, row: any) => {
                event.preventDefault();
                event.stopPropagation();

                const droppedPath = getDroppedGitHubFilePath(event as DragEvent);
                if (!droppedPath) return;
                onAttachFileToCodebaseSubtrack(row.id, droppedPath);
            });

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.laneLabel)
            .attr("x", margin.left + 8)
            .attr("y", (row) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", "pointer")
            .text((row) => {
                const caret = row.collapsed ? ">" : "v";
                return `${caret} ${row.name} (${row.filePaths.length} files)`;
            })
            .on("click", (event: any, row: any) => {
                event.stopPropagation();
                onToggleCodebaseSubtrackCollapsed(row.id);
            });

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.subStageText)
            .attr("x", margin.left + innerW - 74)
            .attr("y", (row) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", "pointer")
            .text("Rename")
            .on("click", (event: any, row: any) => {
                event.stopPropagation();
                const proposedName = window.prompt("Rename codebase subtrack", row.name);
                if (!proposedName) return;

                const nextName = proposedName.trim();
                if (!nextName) return;
                onRenameCodebaseSubtrack(row.id, nextName);
            });

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.subStageDelete)
            .attr("x", margin.left + innerW - 14)
            .attr("y", (row) => row.top + 16)
            .attr("data-timeline-interactive", "true")
            .style("cursor", "pointer")
            .text("X")
            .on("click", (event: any, row: any) => {
                event.stopPropagation();
                const shouldDelete = window.confirm(
                    `Delete "${row.name}" subtrack?`
                );
                if (!shouldDelete) return;
                onDeleteCodebaseSubtrack(row.id);
            });

        codebaseSubtrackGroups
            .append("text")
            .attr("class", classes.subStageText)
            .attr("x", margin.left + 8)
            .attr("y", (row) => row.top + Math.min(row.height - 6, 34))
            .text((row) => {
                if (row.filePaths.length === 0) return "Drop GitHub files here";
                const preview = row.filePaths.slice(0, 2).join(", ");
                const moreCount = row.filePaths.length - 2;
                return moreCount > 0 ? `${preview} +${moreCount}` : preview;
            })
            .attr("display", (row) => (row.collapsed ? "none" : "block"));

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
            g.append("path")
                .attr("d", "M 0 -12 L 12 0 L 0 12 L -12 0 Z")
                .style("fill", "#ff4545")
                .style("stroke", "black")
                .on("contextmenu", (event: any) => {
                    event.preventDefault();

                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setMilestoneMenu({ x: sx, y: sy, date: "" });
                    setSelectedMilestone(eventData);
                });

            g.append("text")
                .attr("class", classes.diamondText)
                .attr("x", 0)
                .attr("y", -15)
                .text(eventData.name)
                .on("click", (event: any) => {
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

            axisG
                .selectAll("rect")
                .data(["placeholder"])
                .enter()
                .append("rect")
                .attr("class", classes.laneLine)
                .attr("x", margin.left)
                .attr("y", 0)
                .attr("width", innerW)
                .attr("height", 30);

            const dividerDrag = d3
                .drag<SVGLineElement, any>()
                .on("drag", (event: any, divider: any) => {
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
                        .text((d: any) => `${d.name} v`);

                    group
                        .append("text")
                        .attr("class", classes.subStageDelete)
                        .attr("x", x(stageData.end) - 20)
                        .attr("y", margin.top + 58)
                        .text("X")
                        .style("cursor", "pointer")
                        .on("click", (event: any, stage: any) => {
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
                            if (fillRow.lane !== "designStudy") return;

                            event.preventDefault();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
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
                .attr("cursor", "ew-resize")
                .call(dividerDrag as any);

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
                laneY.codebase + laneH + 8
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
                .style("cursor", "pointer")
                .on("click", (event: any, subStageData: any) => {
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
                .style("cursor", "pointer")
                .on("click", (event: any, subStageData: any) => {
                    event.stopPropagation();
                    dispatch(deleteSubStage(subStageData.id));
                });

            subStage
                .append("text")
                .attr("class", classes.subStageText)
                .attr("x", (d: any) => x(d.start) + 5)
                .attr("y", (d: any) => laneY[d.lane as LaneType] + 20)
                .text((d: any) => d.name)
                .style("cursor", "text")
                .on("click", (event: any, subStageData: any) => {
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
                        [margin.left, top],
                        [margin.left + innerW, top + laneH],
                    ])
                    .filter((event: any) => !isOverArea(event, x, lane))
                    .on("end", (event: any) => {
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

            const plot = (
                events: any[],
                kind: LaneType,
                centerY: number,
                icon: (
                    g: d3.Selection<SVGGElement, unknown, null, undefined>,
                    eventData: any
                ) => void
            ) => {
                const group = eventsG.append("g");

                group
                    .selectAll("g")
                    .data(events)
                    .enter()
                    .append("g")
                    .attr(
                        "class",
                        classes.event
                    )
                    .attr(
                        "transform",
                        (eventData: any) => `translate(${x(toDate(eventData.date))}, ${centerY})`
                    )
                    .each(function drawIcon(eventData: any) {
                        icon(d3.select(this), eventData);
                    })
                    .selectAll("rect, circle, path")
                    .attr("class", classes.eventShape)
                    .on("click", (event: any, eventData: any) => {
                        if (kind !== "codebase") return;

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
                    });
            };

            plot(parsed.ds, "designStudy", laneY.designStudy + laneH / 2, drawDiamond);
            plot(parsed.kb, "knowledge", laneY.knowledge + laneH / 2, drawCircle);
            plot(parsed.bp, "blueprint", laneY.blueprint + laneH / 2, drawTriangle);
            plot(parsed.cb, "codebase", laneY.codebase + laneH / 2, drawSquare);

            for (const row of codebaseSubtrackRows) {
                if (row.collapsed) continue;

                const rowEvents = eventsByCodebaseSubtrack.get(row.id) ?? [];
                plot(rowEvents, "codebase", row.center, drawSquare);
            }
        };

        draw(zoomTransformRef.current.rescaleX(x0));

        const zoom = d3
            .zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 3000])
            .filter((event: any) => {
                if (isTimelineInteractiveTarget(event)) return false;
                if (typeof event.type === "string" && event.type.startsWith("drag")) {
                    return false;
                }
                if (event.shiftKey) return false;
                return !event.ctrlKey || event.type === "wheel";
            })
            .translateExtent([
                [margin.left, 0],
                [margin.left + innerW, svgHeight],
            ])
            .extent([
                [margin.left, 0],
                [margin.left + innerW, svgHeight],
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
            currentSvg.removeEventListener("dragenter", handleSvgDragEnter);
            currentSvg.removeEventListener("dragover", handleSvgDragOver);
            currentSvg.removeEventListener("drop", handleSvgDrop);
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
        codebaseSubtracks,
        dispatch,
        onStageBoundaryChange,
        onStageLaneDeletion,
        onAttachFileToCodebaseSubtrack,
        onToggleCodebaseSubtrackCollapsed,
        onRenameCodebaseSubtrack,
        onDeleteCodebaseSubtrack,
        setMilestoneMenu,
        setSelectedMilestone,
        setTagPicker,
        setStageMenu,
        setNameEdit,
        setSelectedEvent,
        setTooltipPosition,
        setShowTooltip,
    ]);
}
