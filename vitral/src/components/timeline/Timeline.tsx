import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type { GitHubEvent, GitHubEventType } from "@/config/types";

type ISODate = string;

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
    <span className={`${classes.ghPill} ${classes[`ghPill_${type}`]}`} title={GIT_LABELS[type]}>
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

export type Stage = {
    name: string;
    start: Date | ISODate;
    end: Date | ISODate;
};

export type TimelineEventBase = {
    id: string;
    occurredAt: Date | ISODate;
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
    startMarker: Date | ISODate;
    endMarker: Date | ISODate;
    stages?: Stage[];
    codebaseEvents?: GitHubEvent[];
    knowledgeBaseEvents?: KnowledgeBaseEvent[];
    designStudyEvents?: DesignStudyEvent[];
    margin?: { top: number; right: number; bottom: number; left: number };
};

const toDate = (d: Date | ISODate) => (d instanceof Date ? d : new Date(d));

export const Timeline: React.FC<TimelineProps> = ({
    startMarker,
    endMarker,
    stages = [],
    codebaseEvents = [],
    knowledgeBaseEvents = [],
    designStudyEvents = [],
    margin = { top: 22, right: 16, bottom: 34, left: 16 },
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);

    const [selectedEvent, setSelectedEvent] = useState<{kind: "codeBase" | "knowledge" | "designStudy", event: AnyEvent} | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
    const [showTooltip, setShowTooltip] = useState<boolean>(false);

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
                .map(e => ({ ...e, date: toDate(e.occurredAt) }))
                .filter(e => !isNaN(e.date.getTime()));

        const cb = parseEvents(codebaseEvents);
        const kb = parseEvents(knowledgeBaseEvents);
        const ds = parseEvents(designStudyEvents);

        const stgs = stages
            .map(s => ({ ...s, start: toDate(s.start), end: toDate(s.end) }))
            .filter(s => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));

        const dates = [
            toDate(startMarker),
            toDate(endMarker),
            ...stgs.flatMap(s => [s.start, s.end]),
            ...cb.map(e => e.date),
            ...kb.map(e => e.date),
            ...ds.map(e => e.date),
        ].filter(d => !isNaN(d.getTime()));

        const min = d3.min(dates) ?? new Date();
        const max = d3.max(dates) ?? new Date();

        const pad = Math.max(24 * 3600 * 1000, (max.getTime() - min.getTime()) * 0.06);

        return {
            cb,
            kb,
            ds,
            stages: stgs,
            start: toDate(startMarker),
            end: toDate(endMarker),
            domain: [new Date(min.getTime() - pad), new Date(max.getTime() + pad)] as [Date, Date],
        };
    }, [
        startMarker,
        endMarker,
        stages,
        codebaseEvents,
        knowledgeBaseEvents,
        designStudyEvents,
    ]);

    useEffect(() => {
        if (!svgRef.current || width === 0 || height === 0) return;

        const svgWidth = width;
        const svgHeight = height;

        const svg = d3
            .select(svgRef.current)
            .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);

        svg.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const lanesTop = margin.top;
        const laneH = 28;
        const laneGap = 12;

        const laneY = {
            designStudy: lanesTop + laneH / 2, 
            knowledge: lanesTop + laneH + laneGap + laneH / 2,
            codebase: lanesTop + 2 * (laneH + laneGap) + laneH / 2,
        };

        const x0 = d3
            .scaleTime()
            .domain(parsed.domain)
            .range([margin.left, margin.left + innerW]);

        const axisG = svg
            .append("g")
            .attr("class", classes.axis)
            .attr("transform", `translate(0, ${svgHeight - margin.bottom - margin.top})`);

        const stageG = svg.append("g").attr("class", "stage-layer");
        const markerG = svg.append("g").attr("class", "marker-layer");
        const lanesG = svg.append("g").attr("class", "lanes-layer");
        const eventsG = svg.append("g").attr("class", "events-layer");

        const lanes = [
            { key: "designStudy", label: "Design study" },
            { key: "knowledge", label: "Knowledge base" },
            { key: "codebase", label: "Codebase" },
        ] as const;

        lanes.forEach((l) => {
            const y = laneY[l.key];

            lanesG
                .append("line")
                .attr("class", classes.laneLine)
                .attr("x1", margin.left)
                .attr("x2", margin.left + innerW)
                .attr("y1", y)
                .attr("y2", y);

            lanesG
                .append("text")
                .attr("class", classes.laneLabel)
                .attr("x", margin.left + 8)
                .attr("y", y - 8)
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

            stageG.selectAll("*").remove();

            stageG
                .selectAll("line")
                .data(parsed.stages)
                .enter()
                .append("line")
                .attr("class", classes.markerLine)
                .attr("x1", (d) => x(d.start))
                .attr("x2", (d) => x(d.start))
                .attr("y1", margin.top)
                .attr("y2", svgHeight - margin.bottom - margin.top);

            stageG
                .selectAll("text")
                .data(parsed.stages)
                .enter()
                .append("text")
                .attr("class", classes.stageLabel)
                .attr("x", (d) => (x(d.start) + x(d.end)) / 2)
                .attr("y", margin.top)
                .text((d) => d.name);

            // start/end markers
            markerG.selectAll("*").remove();

            const drawMarker = (date: Date, label: string) => {
                const px = x(date);

                markerG
                    .append("line")
                    .attr("class", classes.markerLine)
                    .attr("x1", px)
                    .attr("x2", px)
                    .attr("y1", margin.top)
                    .attr("y2", svgHeight - margin.bottom - margin.top);

                markerG
                    .append("text")
                    .attr("class", classes.markerLabel)
                    .attr("x", px)
                    .attr("y", margin.top - 6)
                    .text(label);
            };

            drawMarker(parsed.start, "Start");
            drawMarker(parsed.end, "End");

            // events
            eventsG.selectAll("*").remove();

            const plot = (
                events: AnyEvent[],
                kind: "codeBase" | "knowledge" | "designStudy",
                y: number,
                icon: (g: d3.Selection<SVGGElement, unknown, null, undefined>) => void
            ) => {
                const g = eventsG.append("g");

                g.selectAll("g")
                    .data(events)
                    .enter()
                    .append("g")
                    .attr("class", classes.event)
                    .attr("transform", (d) => `translate(${x(toDate((d as any).date))}, ${y})`)
                    .each(function () {
                        icon(d3.select(this));
                    })
                    .selectAll("rect, circle, path")
                    .attr("class", classes.eventShape)
                    .on("click", (e, d) => {
                        const heightOffset = containerRef ? containerRef.current.getBoundingClientRect().top : 0;
                        let clampedX = Math.min(Math.max(e.clientX, 0), window.innerWidth - 300);
                        let clampedY = Math.min(Math.max(e.clientY, 0), window.innerHeight - 150) - heightOffset;
                        console.log(d);
                        setSelectedEvent({kind, event: d});
                        setTooltipPosition({x: clampedX, y: clampedY});
                        setShowTooltip(true);
                    });
            };

            plot(parsed.ds, "designStudy", laneY.designStudy, drawDiamond);
            plot(parsed.kb, "knowledge", laneY.knowledge, drawCircle);
            plot(parsed.cb, "codeBase", laneY.codebase, drawSquare);
        };

        // initial draw
        draw(x0);

        const zoom = d3
            .zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 3000]) // zoom out/in limits
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
        if(selectedEvent?.kind == "codeBase"){
            const event = selectedEvent?.event as GitHubEvent

            return <div className={classes.codeBaseTooltip}>
                <div className={classes.tooltipHeader}>
                    <p style={{fontWeight: "bold", fontSize: "var(--font-size-md)"}}>{event.title}</p>
                    <GitHubEventPill type={event.type} />
                </div>
                <p style={{fontSize: "var(--font-size-xs)", color: "var(--subtitle-color)"}}>{formatDate(event.occurredAt)}</p>
                <p style={{fontSize: "var(--font-size-sm)", color: "var(--subtitle-color)"}}>Author: {event.actor}</p>
                <p><a style={{backgroundColor: "rgba(237, 237, 237, 0.251)"}} href={event.url ?? '#'} target="_blank">{event.key.slice(0,8)}</a></p>
            </div>
        }

        return null;
    }, [selectedEvent])

    return (
        <>
            <div 
                ref={containerRef} 
                className={classes.container} 
                onClick={() => {setShowTooltip(false)}}
            >
                <svg ref={svgRef} className={classes.svg} />
            </div>
            <div 
                className={classes.tooltip} 
                style={{
                    left: tooltipPosition.x, 
                    top: tooltipPosition.y,
                    ...(showTooltip
                        ?
                        {display: "block"}
                        :
                        {display: "none"}
                    )
                }}>
                {TooltipInner}
            </div>
        </>

    );
};
