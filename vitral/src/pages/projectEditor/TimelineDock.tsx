import { memo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesUp } from "@fortawesome/free-solid-svg-icons";

import { Timeline, type BlueprintEvent, type KnowledgeBaseEvent } from "@/components/timeline/Timeline";
import type { DesignStudyEvent, GitHubEvent, Stage } from "@/config/types";

export const TIMELINE_DOCK_HEIGHT = 380;
export const TIMELINE_DOCK_TOGGLE_HEIGHT = 35;

const KNOWLEDGE_BASE_EVENTS: KnowledgeBaseEvent[] = [];

type TimelineDockProps = {
    open: boolean;
    onToggleOpen: () => void;
    startMarker: Date | string;
    endMarker: Date | string;
    codebaseEvents: GitHubEvent[];
    designStudyEvents: DesignStudyEvent[];
    blueprintEvents?: BlueprintEvent[];
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
    blueprintEvents = [],
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
                    ...(open ? { bottom: `${TIMELINE_DOCK_HEIGHT}px` } : { bottom: 0 }),
                    cursor: "pointer",
                    height: `${TIMELINE_DOCK_TOGGLE_HEIGHT - 10}px`,
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
                    ...(open ? { bottom: 0 } : { bottom: `-${TIMELINE_DOCK_HEIGHT}px` }),
                    position: "fixed",
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    height: `${TIMELINE_DOCK_HEIGHT}px`,
                    overflowY: "auto",
                    overflowX: "hidden",
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
                    blueprintEvents={blueprintEvents}
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
