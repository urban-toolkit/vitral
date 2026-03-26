import { memo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons";

import {
    Timeline,
    type BlueprintEvent,
    type BlueprintEventConnection,
    type KnowledgeBaseEvent,
    type KnowledgeBlueprintLink,
    type KnowledgeCrossTreeConnection,
    type KnowledgeTreePill,
} from "@/components/timeline/Timeline";
import type { DesignStudyEvent, GitHubEvent, Stage } from "@/config/types";

export const TIMELINE_DOCK_HEIGHT = 380;
export const TIMELINE_DOCK_TOGGLE_HEIGHT = 15;

type TimelineDockProps = {
    projectId: string;
    open: boolean;
    onToggleOpen: () => void;
    closedBottomOffsetPx?: number;
    readOnly?: boolean;
    allowKnowledgeTrackClearMenu?: boolean;
    startMarker: Date | string;
    endMarker: Date | string;
    projectName?: string;
    projectGoal?: string;
    codebaseEvents: GitHubEvent[];
    knowledgeBaseEvents?: KnowledgeBaseEvent[];
    knowledgeTreePills?: KnowledgeTreePill[];
    knowledgeCrossTreeConnections?: KnowledgeCrossTreeConnection[];
    knowledgeBlueprintLinks?: KnowledgeBlueprintLink[];
    playbackAt?: Date | string | null;
    onPlaybackAtChange?: (value: string | null) => void;
    onKnowledgeEventNavigate?: (event: KnowledgeBaseEvent) => void;
    onBlueprintEventNavigate?: (event: BlueprintEvent) => void;
    onClearKnowledgePreviousEdits?: (cutoffIso?: string) => void;
    onClearKnowledgeNextEdits?: (cutoffIso?: string) => void;
    designStudyEvents: DesignStudyEvent[];
    blueprintEvents?: BlueprintEvent[];
    blueprintEventConnections?: BlueprintEventConnection[];
    connectedBlueprintComponentNodeIds?: string[];
    stages: Stage[];
    defaultStages: string[];
    onStageUpdate: (stage: Stage) => void;
    onStageCreation: (name: string) => void;
    onStageLaneCreation: (name: string) => void;
    onStageLaneDeletion: (id: string) => void;
    onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
    onSyncCodebaseEvents?: () => Promise<void> | void;
};

export const TimelineDock = memo(function TimelineDock({
    projectId,
    open,
    onToggleOpen,
    closedBottomOffsetPx = 65,
    readOnly = false,
    allowKnowledgeTrackClearMenu = false,
    startMarker,
    endMarker,
    projectName,
    projectGoal,
    codebaseEvents,
    knowledgeBaseEvents = [],
    knowledgeTreePills = [],
    knowledgeCrossTreeConnections = [],
    knowledgeBlueprintLinks = [],
    playbackAt = null,
    onPlaybackAtChange,
    onKnowledgeEventNavigate,
    onBlueprintEventNavigate,
    onClearKnowledgePreviousEdits,
    onClearKnowledgeNextEdits,
    designStudyEvents,
    blueprintEvents = [],
    blueprintEventConnections = [],
    connectedBlueprintComponentNodeIds = [],
    stages,
    defaultStages,
    onStageUpdate,
    onStageCreation,
    onStageLaneCreation,
    onStageLaneDeletion,
    onStageBoundaryChange,
    onSyncCodebaseEvents,
}: TimelineDockProps) {
    const toggleBottomPx = open
        ? TIMELINE_DOCK_HEIGHT + closedBottomOffsetPx
        : closedBottomOffsetPx;

    return (
        <>
            <div
                style={{
                    bottom: `${toggleBottomPx}px`,
                    left: "50%",
                    transform: "translate(-50%, 0)",
                    cursor: "pointer",
                    height: `${TIMELINE_DOCK_TOGGLE_HEIGHT - 10}px`,
                    padding: "5px",
                    position: "fixed",
                    zIndex: 2,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                }}
                onClick={onToggleOpen}
            >
                {/* <p style={{ margin: 0 }}>Events</p> */}
                <FontAwesomeIcon
                    icon={faChevronUp}
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
                    projectId={projectId}
                    readOnly={readOnly}
                    allowKnowledgeTrackClearMenu={allowKnowledgeTrackClearMenu}
                    startMarker={startMarker}
                    endMarker={endMarker}
                    projectName={projectName}
                    projectGoal={projectGoal}
                    codebaseEvents={codebaseEvents}
                    knowledgeBaseEvents={knowledgeBaseEvents}
                    designStudyEvents={designStudyEvents}
                    blueprintEvents={blueprintEvents}
                    blueprintEventConnections={blueprintEventConnections}
                    knowledgeTreePills={knowledgeTreePills}
                    knowledgeCrossTreeConnections={knowledgeCrossTreeConnections}
                    knowledgeBlueprintLinks={knowledgeBlueprintLinks}
                    playbackAt={playbackAt}
                    onPlaybackAtChange={onPlaybackAtChange}
                    onKnowledgeEventNavigate={onKnowledgeEventNavigate}
                    onBlueprintEventNavigate={onBlueprintEventNavigate}
                    onClearKnowledgePreviousEdits={onClearKnowledgePreviousEdits}
                    onClearKnowledgeNextEdits={onClearKnowledgeNextEdits}
                    connectedBlueprintComponentNodeIds={connectedBlueprintComponentNodeIds}
                    stages={stages}
                    defaultStages={defaultStages}
                    onStageUpdate={onStageUpdate}
                    onStageCreation={onStageCreation}
                    onStageLaneCreation={onStageLaneCreation}
                    onStageLaneDeletion={onStageLaneDeletion}
                    onStageBoundaryChange={onStageBoundaryChange}
                    onSyncCodebaseEvents={onSyncCodebaseEvents}
                />
            </div>
        </>
    );
});
