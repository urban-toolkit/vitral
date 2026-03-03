import { useMemo } from "react";
import * as d3 from "d3";
import type {
    BlueprintEvent,
    DesignStudyEvent,
    GitHubEvent,
    Stage,
    SubStage,
} from "@/config/types";
import type { KnowledgeBaseEvent, ParsedTimelineData } from "./timelineTypes";
import { toDate } from "./timelineUtils";

type UseParsedTimelineDataParams = {
    startMarker: Date | string;
    endMarker: Date | string;
    stages: Stage[];
    subStages: SubStage[];
    codebaseEvents: GitHubEvent[];
    knowledgeBaseEvents: KnowledgeBaseEvent[];
    designStudyEvents: DesignStudyEvent[];
    blueprintEvents: BlueprintEvent[];
};

export function useParsedTimelineData({
    startMarker,
    endMarker,
    stages,
    subStages,
    codebaseEvents,
    knowledgeBaseEvents,
    designStudyEvents,
    blueprintEvents,
}: UseParsedTimelineDataParams): ParsedTimelineData {
    return useMemo(() => {
        const parseEvents = <T extends { occurredAt: Date | string }>(events: T[]) =>
            events
                .map((event) => ({ ...event, date: toDate(event.occurredAt) }))
                .filter((event) => !Number.isNaN(event.date.getTime()));

        const cb = parseEvents(codebaseEvents).filter(
            (event) => event.type === "commit"
        );

        const kb = parseEvents(knowledgeBaseEvents);
        const ds = parseEvents(designStudyEvents);
        const bp = parseEvents(blueprintEvents);

        const parsedStages = stages
            .map((stage) => ({ ...stage, start: toDate(stage.start), end: toDate(stage.end) }))
            .filter(
                (stage) =>
                    !Number.isNaN(stage.start.getTime()) && !Number.isNaN(stage.end.getTime())
            );

        const parsedSubStages = subStages
            .map((subStage) => ({
                ...subStage,
                start: toDate(subStage.start),
                end: toDate(subStage.end),
            }))
            .filter(
                (subStage) =>
                    !Number.isNaN(subStage.start.getTime()) &&
                    !Number.isNaN(subStage.end.getTime())
            );

        const dates = [
            toDate(startMarker),
            toDate(endMarker),
            ...parsedStages.flatMap((stage) => [stage.start, stage.end]),
            ...cb.map((event) => event.date),
            ...kb.map((event) => event.date),
            ...ds.map((event) => event.date),
            ...bp.map((event) => event.date),
        ].filter((date) => !Number.isNaN(date.getTime()));

        const minDate = d3.min(dates) ?? new Date();
        const maxDate = d3.max(dates) ?? new Date();

        const padding = Math.max(
            24 * 3600 * 1000,
            (maxDate.getTime() - minDate.getTime()) * 0.06
        );

        return {
            cb,
            kb,
            ds,
            bp,
            stages: parsedStages,
            subStages: parsedSubStages,
            start: toDate(startMarker),
            end: toDate(endMarker),
            domain: [
                new Date(minDate.getTime() - padding),
                new Date(maxDate.getTime() + padding),
            ] as [Date, Date],
        };
    }, [
        startMarker,
        endMarker,
        stages,
        subStages,
        codebaseEvents,
        knowledgeBaseEvents,
        designStudyEvents,
        blueprintEvents,
    ]);
}
