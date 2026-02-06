import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type { GitHubEvent } from "@/config/types";

type ISODate = string;

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
    onEventClick?: (event: AnyEvent) => void;
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
    onEventClick,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);

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
        if (!svgRef.current || width === 0) return;

        const svgWidth = width;
        const svgHeight = height;

        const svg = d3.select(svgRef.current)
                    .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
        svg.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const stageBandH = innerH - 20;
        const lanesTop = margin.top;
        const laneH = 28;
        const laneGap = 12;

        const laneY = {
            codebase: lanesTop + laneH / 2,
            knowledge: lanesTop + laneH + laneGap + laneH / 2,
            designStudy: lanesTop + 2 * (laneH + laneGap) + laneH / 2,
        };

        const x = d3
            .scaleTime()
            .domain(parsed.domain)
            .range([margin.left, margin.left + innerW]);

        const axis = d3.axisBottom<Date>(x).ticks(Math.max(3, Math.floor(innerW / 120)));

        svg
            .append("g")
            .attr("class", classes.axis)
            .attr("transform", `translate(0, ${svgHeight - margin.bottom - margin.top})`)
            .call(axis);

        // svg
        //     .append("rect")
        //     .attr("class", classes.stageBand)
        //     .attr("x", margin.left)
        //     .attr("y", margin.top)
        //     .attr("width", innerW)
        //     .attr("height", stageBandH);

        const stageG = svg.append("g");

        // stageG
        //     .selectAll("rect")
        //     .data(parsed.stages)
        //     .enter()
        //     .append("rect")
        //     .attr("class", classes.stage)
        //     .attr("x", d => x(d.start))
        //     .attr("y", margin.top)
        //     .attr("width", d => Math.max(1, x(d.end) - x(d.start)))
        //     .attr("height", stageBandH);

        stageG
            .selectAll("line")
            .data(parsed.stages)
            .enter()
            .append("line")
            .attr("class", classes.markerLine)
            .attr("x1", d => x(d.start))
            .attr("x2", d => x(d.start))
            .attr("y1", margin.top)
            .attr("y2", svgHeight - margin.bottom - margin.top);

        stageG
            .selectAll("text")
            .data(parsed.stages)
            .enter()
            .append("text")
            .attr("class", classes.stageLabel)
            .attr("x", (d) => {
                let startPosition = x(d.start);
                let endPosition = x(d.end);

                return (endPosition + startPosition) / 2;
            })
            .attr("y", margin.top)
            .text(d => d.name);

        const markerG = svg.append("g");

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

        const lanes = [
            { key: "codebase", label: "Codebase" },
            { key: "knowledge", label: "Knowledge base" },
            { key: "designStudy", label: "Design study" },
        ] as const;

        lanes.forEach(l => {
            const y = laneY[l.key];
            svg
                .append("line")
                .attr("class", classes.laneLine)
                .attr("x1", margin.left)
                .attr("x2", margin.left + innerW)
                .attr("y1", y)
                .attr("y2", y);

            svg
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

        const plot = (
            events: AnyEvent[],
            y: number,
            icon: (g: d3.Selection<SVGGElement, unknown, null, undefined>) => void
        ) => {
            const g = svg.append("g");

            g.selectAll("g")
                .data(events)
                .enter()
                .append("g")
                .attr("class", classes.event)
                .attr("transform", d => `translate(${x(toDate(d.date))}, ${y})`)
                .each(function () {
                    icon(d3.select(this));
                })
                .selectAll("rect, circle, path")
                .attr("class", classes.eventShape)
                .on("click", (_, d) => onEventClick?.(d));
        };

        plot(parsed.cb, laneY.codebase, drawSquare);
        plot(parsed.kb, laneY.knowledge, drawCircle);
        plot(parsed.ds, laneY.designStudy, drawDiamond);
    }, [parsed, width, margin, onEventClick]);

    return (
        <div ref={containerRef} className={classes.container} >
            <svg ref={svgRef} className={classes.svg} />
        </div>
    );
};
