import { memo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesUp } from "@fortawesome/free-solid-svg-icons";

import { Timeline, type KnowledgeBaseEvent } from "@/components/timeline/Timeline";
import type { DesignStudyEvent, GitHubEvent, Stage } from "@/config/types";

const KNOWLEDGE_BASE_EVENTS: KnowledgeBaseEvent[] = [
    { id: "kb-activity-created", occurredAt: new Date("July 04, 2023 12:24:00"), kind: "knowledge", subtype: "activity_created" },
    { id: "kb-requirement-created", occurredAt: new Date("July 13, 2023 12:24:00"), kind: "knowledge", subtype: "requirement_created" },
];

type TimelineDockProps = {
    open: boolean;
    onToggleOpen: () => void;
    startMarker: Date | string;
    endMarker: Date | string;
    codebaseEvents: GitHubEvent[];
    designStudyEvents: DesignStudyEvent[];
    stages: Stage[];
    defaultStages: string[];
    onStageUpdate: (stage: Stage) => void;
    onStageCreation: (name: string) => void;
    onStageLaneCreation: (name: string) => void;
    onStageLaneDeletion: (id: string) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
};

export const TimelineDock = memo(function TimelineDock({
    open,
    onToggleOpen,
    startMarker,
    endMarker,
    codebaseEvents,
    designStudyEvents,
    stages,
    defaultStages,
    onStageUpdate,
    onStageCreation,
    onStageLaneCreation,
    onStageLaneDeletion,
    onStageBoundaryChange,
}: TimelineDockProps) {
    return (
        <>
            <div
                style={{
                    ...(open ? { bottom: "300px" } : { bottom: 0 }),
                    cursor: "pointer",
                    height: "25px",
                    padding: "5px",
                    position: "fixed",
                    backgroundColor: "white",
                    zIndex: 2,
                    border: "1px solid rgba(174, 172, 172, 0.39)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                }}
                onClick={onToggleOpen}
            >
                <p style={{ margin: 0 }}>Events</p>
                <FontAwesomeIcon
                    icon={faAnglesUp}
                    style={open ? { transform: "rotateX(180deg)" } : {}}
                />
            </div>

            <div
                style={{
                    ...(open ? { bottom: 0 } : { bottom: "-300px" }),
                    position: "fixed",
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    height: "300px",
                    width: "100vw",
                    boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.39)",
                    backdropFilter: "blur(4px)",
                }}
            >
                <Timeline
                    startMarker={startMarker}
                    endMarker={endMarker}
                    codebaseEvents={codebaseEvents}
                    knowledgeBaseEvents={KNOWLEDGE_BASE_EVENTS}
                    designStudyEvents={designStudyEvents}
                    stages={stages}
                    defaultStages={defaultStages}
                    onStageUpdate={onStageUpdate}
                    onStageCreation={onStageCreation}
                    onStageLaneCreation={onStageLaneCreation}
                    onStageLaneDeletion={onStageLaneDeletion}
                    onStageBoundaryChange={onStageBoundaryChange}
                />
            </div>
        </>
    );
});
