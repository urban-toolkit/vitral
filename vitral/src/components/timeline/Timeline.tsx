import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type { GitHubEvent, GitHubEventType, LaneType, Stage } from "@/config/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faPlus } from "@fortawesome/free-solid-svg-icons";
import { StagePicker } from "@/components/timeline/StagePicker";
import { useDispatch, useSelector } from "react-redux";
import { addSubStage, deleteSubStage, selectAllSubStages, updateSubStage } from "@/store/timelineSlice";

const GIT_LABELS: Record<GitHubEventType, string> = {
    commit: "Commit",
    issue_opened: "Issue opened",
    issue_closed: "Issue closed",
    pr_opened: "PR opened",
    pr_closed: "PR closed",
    pr_merged: "PR merged",
};

function GitHubEventPill({ type }: { type: GitHubEventType }) {
    return (
        <span
            className={`${classes.ghPill} ${classes[`ghPill_${type}`]}`}
            title={GIT_LABELS[type]}
        >
            {GIT_LABELS[type]}
        </span>
    );
}

function formatDate(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export type TimelineEventBase = {
    id: string;
    occurredAt: Date | string;
    label?: string;
    description?: string;
};

export type KnowledgeBaseEvent = TimelineEventBase & {
    kind: "knowledge";
    subtype?: string;
};

export type DesignStudyEvent = TimelineEventBase & {
    kind: "designStudy";
    subtype?: string;
};

type AnyEvent = GitHubEvent | KnowledgeBaseEvent | DesignStudyEvent;

export type TimelineProps = {
    startMarker: Date | string;
    endMarker: Date | string;
    defaultStages: string[];
    onStageUpdate: (stage: Stage) => void; 
    onStageCreation: (name: string) => void;
    onStageLaneCreation: (name: string) => void;
    onStageLaneDeletion: (id: string) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
    stages?: Stage[];
    codebaseEvents?: GitHubEvent[];
    knowledgeBaseEvents?: KnowledgeBaseEvent[];
    designStudyEvents?: DesignStudyEvent[];
    margin?: { top: number; right: number; bottom: number; left: number };
};

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const fromDate = (d: Date | string) => (d instanceof Date ? d.toString() : d);

export const Timeline: React.FC<TimelineProps> = ({
    startMarker,
    endMarker,
    stages = [],
    codebaseEvents = [],
    knowledgeBaseEvents = [],
    designStudyEvents = [],
    defaultStages = [],
    onStageUpdate,
    onStageCreation,
    onStageLaneCreation,
    onStageLaneDeletion,
    onStageBoundaryChange,
    margin = { top: 22, right: 16, bottom: 34, left: 16 },
}) => {

    const dispatch = useDispatch();

    const containerRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);

    const [selectedEvent, setSelectedEvent] = useState<{
        kind: LaneType;
        event: AnyEvent;
    } | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({
        x: 0,
        y: 0,
    });
    const [showTooltip, setShowTooltip] = useState<boolean>(false);

    const [tagPicker, setTagPicker] = useState<null | Stage & { x: number; y: number }>(null);

    const subStages = useSelector(selectAllSubStages);

    const [stageMenu, setStageMenu] = useState<null | {
        subStageId: string;
        x: number;
        y: number;
    }>(null);

    const [nameEdit, setNameEdit] = useState<null | {
        subStageId: string;
        x: number; 
        y: number;
        value: string;
    }>(null);

    const startCaretRef = useRef<HTMLSpanElement | null>(null);
    const endCaretRef = useRef<HTMLSpanElement | null>(null);
    const todayCaretRef = useRef<HTMLSpanElement | null>(null);
    
    const newStageButtonRef = useRef<HTMLSpanElement | null>(null);

    const setRefPos = (el: HTMLSpanElement | null, x: number, y: number) => {
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    };

    useEffect(() => {
        if (!containerRef.current) return;

        const ro = new ResizeObserver(([entry]) => {
            setWidth(Math.floor(entry.contentRect.width));
            setHeight(Math.floor(entry.contentRect.height));
        });

        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const parsed = useMemo(() => {
        const parseEvents = (arr: any[]) =>
            arr
                .map((e) => ({ ...e, date: toDate(e.occurredAt) }))
                .filter((e) => !isNaN(e.date.getTime()));

        const cb = parseEvents(codebaseEvents);
        const kb = parseEvents(knowledgeBaseEvents);
        const ds = parseEvents(designStudyEvents);

        const stgs = stages
            .map((s) => ({ ...s, start: toDate(s.start), end: toDate(s.end) }))
            .filter((s) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));

        const sbtgs = subStages
            .map((s) => ({ ...s, start: toDate(s.start), end: toDate(s.end) }))
            .filter((s) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));

        const dates = [
            toDate(startMarker),
            toDate(endMarker),
            ...stgs.flatMap((s) => [s.start, s.end]),
            ...cb.map((e) => e.date),
            ...kb.map((e) => e.date),
            ...ds.map((e) => e.date),
        ].filter((d) => !isNaN(d.getTime()));

        const min = d3.min(dates) ?? new Date();
        const max = d3.max(dates) ?? new Date();

        const pad = Math.max(24 * 3600 * 1000, (max.getTime() - min.getTime()) * 0.06);

        return {
            cb,
            kb,
            ds,
            stages: stgs,
            subStages: sbtgs,
            start: toDate(startMarker),
            end: toDate(endMarker),
            domain: [new Date(min.getTime() - pad), new Date(max.getTime() + pad)] as [Date, Date],
        };
    }, [startMarker, endMarker, stages, subStages, codebaseEvents, knowledgeBaseEvents, designStudyEvents]);

    useEffect(() => {
        if (!svgRef.current || width === 0 || height === 0) return;

        const svgWidth = width;
        const svgHeight = height;

        const svg = d3.select(svgRef.current).attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
        svg.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;

        const lanesTop = margin.top + 32;
        const laneH = 65;
        const laneGap = 6;

        const laneY = {
            designStudy: lanesTop + laneH / 2,
            knowledge: lanesTop + laneH + laneGap + laneH / 2,
            codebase: lanesTop + 2 * (laneH + laneGap) + laneH / 2,
        };

        const laneTop = (lane: LaneType) => (laneY[lane]);

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
        const brushG = svg.append("g")
            .style("pointer-events", "all");
        const subStagesG = svg.append("g");
        const eventsG = svg.append("g");

        const lanes = [
            { key: "designStudy", label: "Design study" },
            { key: "knowledge", label: "Knowledge base" },
            { key: "codebase", label: "Codebase" },
        ] as const;

        const laneDefs: Array<{ lane: LaneType; top: number; }> = [
            { lane: "designStudy", top: laneY["designStudy"] },
            { lane: "knowledge", top: laneY["knowledge"] },
            { lane: "codebase", top: laneY["codebase"] },
        ];

        lanes.forEach((l) => {
            const y = laneY[l.key];

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
                .text(l.label);
        });

        const drawSquare = (g: d3.Selection<SVGGElement, unknown, null, undefined>) =>
            g.append("rect").attr("x", -7).attr("y", -7).attr("width", 15).attr("height", 15).attr("rx", 4);

        const drawCircle = (g: d3.Selection<SVGGElement, unknown, null, undefined>) =>
            g.append("circle").attr("r", 10);

        const drawDiamond = (g: d3.Selection<SVGGElement, unknown, null, undefined>) =>
            g.append("path").attr("d", "M 0 -12 L 12 0 L 0 12 L -12 0 Z");

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

            const dividerDrag = d3.drag<SVGLineElement, any>()
                .on("drag", function (event: any, d: any) {
                    const px = event.x;
                    const newDate = x.invert(px);

                    const prev = parsed.stages[d.index];
                    const next = (d.index + 1) <= parsed.stages.length ? parsed.stages[d.index + 1] : null;

                    // Prevent collapsing
                    if (+newDate <= +prev.start) return;
                    if (next && +newDate >= +next.end) return;

                    onStageBoundaryChange(prev.id, next ? next.id : '-1', newDate);
                });

            stageG.selectAll("*").remove();

            stageG
                .selectAll("g.stage")
                .data(parsed.stages)
                .enter()
                .append("g")
                .attr("class", "stage")
                .each(function (d: any) {
                    const g = d3.select(this);

                    // Main rect
                    g.append("rect")
                        .attr("class", classes.stageLine)
                        .attr("fill", stageColor(d.name))
                        .attr("x", x(d.start))
                        .attr("y", margin.top + 44)
                        .attr("width", x(d.end) - x(d.start))
                        .attr("height", 20)
                        .on("click", (event: any, d: any) => {
                            event.stopPropagation();
                            const [sx, sy] = d3.pointer(event, containerRef.current);
                            setTagPicker({ ...d, x: sx, y: sy });
                        });

                    g.selectAll("text")
                        .data(parsed.stages)
                        .enter()
                        .append("text")
                        .attr("class", classes.stageLabel)
                        .attr("x", (x(d.start) + x(d.end)) / 2)
                        .attr("y", margin.top + 58)
                        .text(d.name + "▾");

                    g.append("text")
                        .attr("class", classes.subStageDelete)
                        .attr("x", x(d.end) - 20)
                        .attr("y", margin.top + 58)
                        .text("X")
                        .style("cursor", "pointer")
                        .on("click", (event: any, d: any) => {
                            event.stopPropagation();
                            onStageLaneDeletion(d.id);
                        });

                    g.append("rect")
                        .attr("x", x(d.start))
                        .attr("y", margin.top + 65)
                        .attr("width", x(d.end) - x(d.start))
                        .attr("height", 65)
                        .attr("fill", d => stageColor(d.name))
                        .attr("opacity", 0.5);

                    g.append("rect")
                        .attr("x", x(d.start))
                        .attr("y", margin.top + 135)
                        .attr("width", x(d.end) - x(d.start))
                        .attr("height", 65)
                        .attr("fill", d => stageColor(d.name))
                        .attr("opacity", 0.5);

                    g.append("rect")
                        .attr("x", x(d.start))
                        .attr("y", margin.top + 207)
                        .attr("width", x(d.end) - x(d.start))
                        .attr("height", 65)
                        .attr("fill", d => stageColor(d.name))
                        .attr("opacity", 0.5);

                });

            stageG.selectAll("line.divider")
                .data(parsed.stages.map((s, i) => ({ ...s, index: i })))
                .enter()
                .append("line")
                .attr("class", "divider")
                .attr("x1", (d: any) => x(parsed.stages[d.index].end))
                .attr("x2", (d: any) => x(parsed.stages[d.index].end))
                .attr("y1", margin.top + 44)
                .attr("y2", margin.top + 272)
                .attr("stroke", "transparent")
                .attr("stroke-width", 10)
                .attr("cursor", "ew-resize")
                .call(dividerDrag as any);

            let augmentedStages = [...parsed.stages];

            if (parsed.stages.length > 0) {
                const lastStage = parsed.stages[parsed.stages.length - 1];
                augmentedStages.push({
                    id: "-1",
                    name: "lastStage",
                    start: lastStage.end,
                    end: lastStage.end
                });

                setRefPos(newStageButtonRef.current, x(lastStage.end) + 3, margin.top + 45);
            }else{
                setRefPos(newStageButtonRef.current, x(parsed.start) + 3, margin.top + 45);
            }

            stageG
                .selectAll("line.markerLine")
                .data(augmentedStages)
                .enter()
                .append("line")
                .attr("class", classes.markerLine)
                .attr("x1", (d) => x(d.start))
                .attr("x2", (d) => x(d.start))
                .attr("y1", margin.top + 65)
                .attr("y2", svgHeight);

            subStagesG.selectAll("*").remove();

            const subStage = subStagesG
                .selectAll("g.subStage")
                .data(parsed.subStages, (d: any) => d.id)
                .enter()
                .append("g");

            subStage
                .append("rect")
                .attr("class", classes.subStage)
                .attr("x", d => x(d.start))
                .attr("y", d => laneY[d.lane as LaneType] + 5)
                .attr("width", d => x(d.end) - x(d.start))
                .attr("height", laneH - 10)
                .attr("fill", (d) => {
                    if (defaultStages.includes(d.stage))
                        return stageColor(d.stage);
                    else
                        return "none";
                })
                .attr("rx", 6);

            subStage
                .append("text")
                .attr("class", classes.subStageText)
                .attr("x", d => x(d.start) + 5)
                .attr("y", d => laneY[d.lane as LaneType] + 20)
                .text((d) => d.name);

            subStage.append("text")
                .attr("class", classes.subStageCaret)
                .attr("x", d => x(d.end) - 35)
                .attr("y", d => laneY[d.lane as LaneType] + 20)
                .text("▾")
                .style("cursor", "pointer")
                .on("click", (event, d: any) => {
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setStageMenu({ subStageId: d.id, x: sx, y: sy });
                });

            subStage.append("text")
                .attr("class", classes.subStageDelete)
                .attr("x", d => x(d.end) - 16)
                .attr("y", d => laneY[d.lane as LaneType] + 18)
                .text("X")
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                    event.stopPropagation();
                    dispatch(deleteSubStage(d.id));
                });

            subStage
                .append("text")
                .attr("class", classes.subStageText)
                .attr("x", d => x(d.start) + 5)
                .attr("y", d => laneY[d.lane as LaneType] + 20)
                .text(d => d.name)
                .style("cursor", "text")
                .on("click", (event, d: any) => {
                    event.stopPropagation();
                    const [sx, sy] = d3.pointer(event, containerRef.current);
                    setNameEdit({ subStageId: d.id, x: sx, y: sy, value: d.name });
                });

            brushG.selectAll("*").remove();

            const isOverArea = (event: any, x: d3.ScaleTime<number, number>, lane: LaneType) => {
                const [px, py] = d3.pointer(event, svgRef.current); // svg coords

                const top = laneTop(lane);
                if (py < top || py > top + laneH) return false;

                return parsed.subStages.some(a =>
                    a.lane === lane &&
                    px >= x(a.start) &&
                    px <= x(a.end)
                );
            };

            const brush = (lane: LaneType, top: number) =>
                d3.brushX()
                    .extent([[margin.left, top], [margin.left + innerW, top + laneH]])
                    .filter((event) => {
                        if (!event.shiftKey) return false;

                        return !isOverArea(event, x, lane)
                    })
                    .on("end", (event) => {
                        if (!event.selection) return;

                        const [px0, px1] = event.selection as [number, number];
                        const start = fromDate(x.invert(px0));
                        const end = fromDate(x.invert(px1));

                        const name = "Untitled";
                        const stage = "Unstaged";

                        dispatch(addSubStage({ id: crypto.randomUUID(), lane, start, end, name, stage }));

                        d3.select(event.sourceEvent?.currentTarget ?? null);
                    });

            brushG
                .selectAll("g.lane-brush")
                .data(laneDefs)
                .enter()
                .append("g")
                .each(function (d) {
                    d3.select(this).call(brush(d.lane, d.top) as any);
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
            } else {
                if (todayCaretRef.current) todayCaretRef.current.style.display = "none";
            }

            // events
            eventsG.selectAll("*").remove();

            const plot = (
                events: AnyEvent[],
                kind: LaneType,
                y: number,
                icon: (g: d3.Selection<SVGGElement, unknown, null, undefined>) => void
            ) => {
                const g = eventsG.append("g");

                g.selectAll("g")
                    .data(events)
                    .enter()
                    .append("g")
                    .attr("class", classes.event)
                    .attr("transform", (d) => `translate(${x(toDate((d as any).date))}, ${y + 32})`)
                    .each(function () {
                        icon(d3.select(this));
                    })
                    .selectAll("rect, circle, path")
                    .attr("class", classes.eventShape)
                    .on("click", (e, d) => {
                        const heightOffset = containerRef.current
                            ? containerRef.current.getBoundingClientRect().top
                            : 0;

                        const clampedX = Math.min(Math.max(e.clientX, 0), window.innerWidth - 300);
                        const clampedY =
                            Math.min(Math.max(e.clientY, 0), window.innerHeight - 150) - heightOffset;

                        setSelectedEvent({ kind, event: d });
                        setTooltipPosition({ x: clampedX, y: clampedY });
                        setShowTooltip(true);
                    });
            };

            plot(parsed.ds, "designStudy", laneY.designStudy, drawDiamond);
            plot(parsed.kb, "knowledge", laneY.knowledge, drawCircle);
            plot(parsed.cb, "codebase", laneY.codebase, drawSquare);
        };

        draw(zoomTransformRef.current.rescaleX(x0));

        const zoom = d3
            .zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 3000])
            .filter((event) => {
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
            .on("zoom", (event) => {
                zoomTransformRef.current = event.transform;
                const x = event.transform.rescaleX(x0);
                draw(x);
            });

        svg.call(zoom as any);
        svg.call(zoom.transform as any, zoomTransformRef.current);
    }, [parsed, width, height, margin]);

    const TooltipInner = useMemo(() => {
        if (selectedEvent?.kind == "codebase") {
            const event = selectedEvent?.event as GitHubEvent;

            return (
                <div className={classes.codeBaseTooltip}>
                    <div className={classes.tooltipHeader}>
                        <p style={{ fontWeight: "bold", fontSize: "var(--font-size-md)" }}>{event.title}</p>
                        <GitHubEventPill type={event.type} />
                    </div>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--subtitle-color)" }}>
                        {formatDate(event.occurredAt)}
                    </p>
                    <p style={{ fontSize: "var(--font-size-sm)", color: "var(--subtitle-color)" }}>
                        Author: {event.actor}
                    </p>
                    <p>
                        <a
                            style={{ backgroundColor: "rgba(237, 237, 237, 0.251)" }}
                            href={event.url ?? "#"}
                            target="_blank"
                        >
                            {event.key.slice(0, 8)}
                        </a>
                    </p>
                </div>
            );
        }

        return null;
    }, [selectedEvent]);

    return (
        <>
            <div
                id={"timelineContainer"}
                ref={containerRef}
                className={classes.container}
                onClick={() => {
                    setShowTooltip(false);
                }}
            >
                <svg ref={svgRef} className={classes.svg} />

                <span ref={startCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
                    <FontAwesomeIcon icon={faCaretDown} />
                </span>

                <span ref={endCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
                    <FontAwesomeIcon icon={faCaretDown} />
                </span>

                <span ref={todayCaretRef} className={classes.marker} style={{ left: 0, top: margin.top, display: "none" }}>
                    <FontAwesomeIcon icon={faCaretDown} />
                </span>

                <span 
                    ref={newStageButtonRef} 
                    className={classes.newStage}
                    onClick={(e) => {
                        onStageLaneCreation("Untitled");
                    }}
                >
                    <FontAwesomeIcon icon={faPlus} />
                </span>

            </div>

            <div
                className={classes.tooltip}
                style={{
                    left: tooltipPosition.x,
                    top: tooltipPosition.y,
                    ...(showTooltip ? { display: "block" } : { display: "none" }),
                }}
            >
                {TooltipInner}
            </div>

            {stageMenu && (
                <div
                    className={classes.stageDropdown}
                    style={{ left: stageMenu.x, top: stageMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <select
                        value={parsed.subStages.find(s => s.id === stageMenu.subStageId)?.stage ?? ""}
                        onChange={(e) => {
                            const newStage = e.target.value;

                            const subStage = parsed.subStages.filter(s => s.id == stageMenu.subStageId);
                            
                            if(subStage.length <= 0) return;

                            let newSubStage = {
                                ...subStage[0],
                                start: fromDate(subStage[0].start),
                                end: fromDate(subStage[0].end),
                                stage: newStage
                            };

                            dispatch(updateSubStage(newSubStage))
                            setStageMenu(null);
                        }}
                        onBlur={() => setStageMenu(null)}
                        autoFocus
                    >
                        <option value="">(none)</option>
                        {defaultStages.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
            )}

            {nameEdit && (
                <input
                    className={classes.nameEditor}
                    style={{ left: nameEdit.x, top: nameEdit.y }}
                    value={nameEdit.value}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNameEdit(prev => prev ? { ...prev, value: e.target.value } : prev)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            const nextName = nameEdit.value.trim();

                            const subStage = parsed.subStages.filter(s => s.id == nameEdit.subStageId);
                            
                            if(subStage.length <= 0) return;

                            let newSubStage = {
                                ...subStage[0],
                                start: fromDate(subStage[0].start),
                                end: fromDate(subStage[0].end),
                                name: nextName
                            };

                            dispatch(updateSubStage(newSubStage))

                            setNameEdit(null);
                        }
                        if (e.key === "Escape") setNameEdit(null);
                    }}
                    onBlur={() => {
                        const nextName = nameEdit.value.trim();

                        const subStage = parsed.subStages.filter(s => s.id == nameEdit.subStageId);
                        
                        if(subStage.length <= 0) return;

                        let newSubStage = {
                            ...subStage[0],
                            start: fromDate(subStage[0].start),
                            end: fromDate(subStage[0].end),
                            name: nextName
                        };

                        dispatch(updateSubStage(newSubStage))
                        setNameEdit(null);
                    }}
                />
            )}

            <StagePicker
                isOpen={!!tagPicker}
                x={tagPicker?.x ?? 0}
                y={tagPicker?.y ?? 0}
                currentValue={
                    tagPicker ? (parsed.subStages.find(s => s.id === tagPicker.id)?.stage ?? "") : ""
                }
                options={defaultStages}
                onClose={() => setTagPicker(null)}
                onCreate={(value) => {
                    onStageCreation(value);
                }}
                onSelect={(value) => {
                    if (!tagPicker) return;
                    onStageUpdate({
                        id: tagPicker.id,
                        end: tagPicker.end,
                        start: tagPicker.start,
                        name: value});
                    setTagPicker(null);
                }}
            />

        </>
    );
};
