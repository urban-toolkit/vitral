import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type { BlueprintEvent, DesignStudyEvent, GitHubEvent, Stage } from "@/config/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faPlus, faWandSparkles } from "@fortawesome/free-solid-svg-icons";
import { StagePicker } from "@/components/timeline/StagePicker";
import { useDispatch, useSelector } from "react-redux";
import {
  addCodebaseSubtrack,
  selectHoveredBlueprintComponentNodeId,
  addDesignStudyEvent,
  attachFileToCodebaseSubtrack,
  deleteCodebaseSubtrack,
  deleteDesignStudyEvent,
  renameCodebaseSubtrack,
  selectCodebaseSubtracks,
  selectHoveredCodebaseFilePath,
  selectAllSubStages,
  toggleCodebaseSubtrackInactive,
  toggleCodebaseSubtrackCollapsed,
  updateDesignStudyEvent,
  updateSubStage,
} from "@/store/timelineSlice";
import { MilestoneMenu } from "./MilestoneMenu";
import { requestMilestonesLLM } from "@/func/LLMRequest";
import { CodebaseTooltip } from "./CodebaseTooltip";
import { BlueprintTooltip } from "./BlueprintTooltip";
import type {
  SelectedTimelineEvent,
  TimelineProps,
} from "./timelineTypes";
import { fromDate } from "./timelineUtils";
import { useParsedTimelineData } from "./useParsedTimelineData";
import { useTimelineChart } from "./useTimelineChart";

export type {
  BlueprintEvent,
  KnowledgeBaseEvent,
  TimelineEventBase,
  TimelineProps,
} from "./timelineTypes";

export const Timeline = ({
  startMarker,
  endMarker,
  stages = [],
  codebaseEvents = [],
  knowledgeBaseEvents = [],
  designStudyEvents = [],
  blueprintEvents = [],
  defaultStages = [],
  onStageUpdate,
  onStageCreation,
  onStageLaneCreation,
  onStageLaneDeletion,
  onStageBoundaryChange,
  margin = { top: 22, right: 16, bottom: 34, left: 16 },
}: TimelineProps) => {
  const dispatch = useDispatch();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  const [selectedEvent, setSelectedEvent] = useState<SelectedTimelineEvent | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [showTooltip, setShowTooltip] = useState(false);

  const [milestoneMenu, setMilestoneMenu] = useState<{
    x: number;
    y: number;
    date: string;
  } | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<DesignStudyEvent | null>(null);

  const [tagPicker, setTagPicker] = useState<(Stage & { x: number; y: number }) | null>(null);

  const subStages = useSelector(selectAllSubStages);

  const [stageMenu, setStageMenu] = useState<{
    subStageId: string;
    x: number;
    y: number;
  } | null>(null);

  const [nameEdit, setNameEdit] = useState<{
    id: string;
    x: number;
    y: number;
    key: "designStudyEvent" | "subStage" | "codebaseSubtrack";
    value: string;
  } | null>(null);

  const startCaretRef = useRef<HTMLSpanElement | null>(null);
  const endCaretRef = useRef<HTMLSpanElement | null>(null);
  const todayCaretRef = useRef<HTMLSpanElement | null>(null);
  const newStageButtonRef = useRef<HTMLSpanElement | null>(null);
  const newCodebaseSubtrackButtonRef = useRef<HTMLSpanElement | null>(null);
  const llmButtonRef = useRef<HTMLSpanElement | null>(null);

  const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
  const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);
  const hoveredBlueprintComponentNodeId = useSelector(selectHoveredBlueprintComponentNodeId);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeTarget = containerRef.current.parentElement ?? containerRef.current;

    const resizeObserver = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
      setHeight(Math.floor(entry.contentRect.height));
    });

    resizeObserver.observe(resizeTarget);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const parsed = useParsedTimelineData({
    startMarker,
    endMarker,
    stages,
    subStages,
    codebaseEvents,
    knowledgeBaseEvents,
    designStudyEvents,
    blueprintEvents,
  });

  useTimelineChart({
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
    hoveredCodebaseFilePath,
    hoveredBlueprintComponentNodeId,
    dispatch,
    onStageBoundaryChange,
    onStageLaneDeletion,
    onAttachFileToCodebaseSubtrack: (subtrackId, filePath) => {
      dispatch(attachFileToCodebaseSubtrack({ subtrackId, filePath }));
    },
    onToggleCodebaseSubtrackCollapsed: (subtrackId) => {
      dispatch(toggleCodebaseSubtrackCollapsed(subtrackId));
    },
    onToggleCodebaseSubtrackInactive: (subtrackId) => {
      dispatch(toggleCodebaseSubtrackInactive(subtrackId));
    },
    onDeleteCodebaseSubtrack: (subtrackId) => {
      dispatch(deleteCodebaseSubtrack(subtrackId));
    },
    setMilestoneMenu,
    setSelectedMilestone,
    setTagPicker,
    setStageMenu,
    setNameEdit,
    setSelectedEvent,
    setTooltipPosition,
    setShowTooltip,
  });

  const updateSubStageStage = (subStageId: string, newStage: string) => {
    const matchingSubStages = parsed.subStages.filter((subStage) => subStage.id == subStageId);

    if (matchingSubStages.length <= 0) return;

    const subStageToUpdate = matchingSubStages[0];

    dispatch(
      updateSubStage({
        ...subStageToUpdate,
        start: fromDate(subStageToUpdate.start),
        end: fromDate(subStageToUpdate.end),
        stage: newStage,
      })
    );
  };

  const commitNameEdit = () => {
    if (!nameEdit) return;

    const nextName = nameEdit.value.trim();

    if (nameEdit.key === "subStage") {
      const matchingSubStages = parsed.subStages.filter((subStage) => subStage.id == nameEdit.id);

      if (matchingSubStages.length <= 0) return;

      const subStageToUpdate = matchingSubStages[0];

      dispatch(
        updateSubStage({
          ...subStageToUpdate,
          start: fromDate(subStageToUpdate.start),
          end: fromDate(subStageToUpdate.end),
          name: nextName,
        })
      );
    }

    if (nameEdit.key === "designStudyEvent") {
      const matchingDesignStudyEvents = parsed.ds.filter(
        (designStudyEvent) => designStudyEvent.id == nameEdit.id
      );

      if (matchingDesignStudyEvents.length <= 0) return;

      const eventToUpdate = matchingDesignStudyEvents[0];

      dispatch(
        updateDesignStudyEvent({
          ...eventToUpdate,
          date: fromDate(eventToUpdate.date),
          name: nextName,
        })
      );
    }

    if (nameEdit.key === "codebaseSubtrack") {
      dispatch(
        renameCodebaseSubtrack({
          subtrackId: nameEdit.id,
          name: nextName,
        })
      );
    }

    setNameEdit(null);
  };

  const handleGenerateMilestones = async () => {
    document.body.style.cursor = "wait";

    const milestones = await requestMilestonesLLM(
      parsed.ds.map((designStudyEvent) => ({
        id: designStudyEvent.id,
        name: designStudyEvent.name,
        occurredAt: fromDate(designStudyEvent.occurredAt),
      }))
    );

    document.body.style.cursor = "default";

    console.log("milestones", milestones);

    for (const milestone of milestones) {
      dispatch(addDesignStudyEvent(milestone));
    }
  };

  const tooltipInner = useMemo(() => {
    if (selectedEvent?.kind === "codebase") {
      return <CodebaseTooltip event={selectedEvent.event as GitHubEvent} />;
    }
    if (selectedEvent?.kind === "blueprint") {
      return <BlueprintTooltip event={selectedEvent.event as BlueprintEvent} />;
    }

    return null;
  }, [selectedEvent]);

  return (
    <>
      <div
        id="timelineContainer"
        ref={containerRef}
        className={classes.container}
        onClick={() => {
          setShowTooltip(false);
          setMilestoneMenu(null);
        }}
      >
        <svg ref={svgRef} className={classes.svg} />

        <span ref={startCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
          <FontAwesomeIcon icon={faCaretDown} />
        </span>

        <span ref={endCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
          <FontAwesomeIcon icon={faCaretDown} />
        </span>

        <span
          ref={todayCaretRef}
          className={classes.marker}
          style={{ left: 0, top: margin.top, display: "none" }}
        >
          <FontAwesomeIcon icon={faCaretDown} />
        </span>

        <span
          ref={newStageButtonRef}
          className={classes.newStage}
          onClick={() => {
            onStageLaneCreation("Untitled");
          }}
        >
          <FontAwesomeIcon icon={faPlus} />
        </span>

        <span
          ref={newCodebaseSubtrackButtonRef}
          className={classes.newStage}
          title="Add codebase subtrack"
          onClick={() => {
            dispatch(
              addCodebaseSubtrack({
                id: crypto.randomUUID(),
                name: `Codebase subtrack ${codebaseSubtracks.length + 1}`,
                filePaths: [],
                collapsed: false,
                inactive: false,
              })
            );
          }}
        >
          <FontAwesomeIcon icon={faPlus} />
        </span>

        <span
          ref={llmButtonRef}
          style={{ left: 125, top: margin.top + 67, position: "absolute", cursor: "pointer" }}
          onClick={handleGenerateMilestones}
        >
          <FontAwesomeIcon icon={faWandSparkles} />
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
        {tooltipInner}
      </div>

      {stageMenu && (
        <div
          className={classes.stageDropdown}
          style={{ left: stageMenu.x, top: stageMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <select
            value={parsed.subStages.find((subStage) => subStage.id === stageMenu.subStageId)?.stage ?? ""}
            onChange={(event) => {
              updateSubStageStage(stageMenu.subStageId, event.target.value);
              setStageMenu(null);
            }}
            onBlur={() => setStageMenu(null)}
            autoFocus
          >
            <option value="">(none)</option>
            {defaultStages.map((stageName) => (
              <option key={stageName} value={stageName}>
                {stageName}
              </option>
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
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            setNameEdit((previous) =>
              previous ? { ...previous, value: event.target.value } : previous
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitNameEdit();
            }

            if (event.key === "Escape") {
              setNameEdit(null);
            }
          }}
          onBlur={commitNameEdit}
        />
      )}

      <StagePicker
        isOpen={!!tagPicker}
        x={tagPicker?.x ?? 0}
        y={tagPicker?.y ?? 0}
        currentValue={
          tagPicker ? parsed.subStages.find((subStage) => subStage.id === tagPicker.id)?.stage ?? "" : ""
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
            name: value,
          });

          setTagPicker(null);
        }}
      />

      {milestoneMenu && (
        <MilestoneMenu
          x={milestoneMenu.x}
          y={milestoneMenu.y}
          onCreate={
            milestoneMenu.date !== ""
              ? () => {
                  dispatch(
                    addDesignStudyEvent({
                      id: crypto.randomUUID(),
                      name: "Untitled",
                      occurredAt: fromDate(milestoneMenu.date),
                    })
                  );
                }
              : undefined
          }
          onDelete={
            selectedMilestone
              ? () => {
                  dispatch(deleteDesignStudyEvent(selectedMilestone.id));
                }
              : undefined
          }
          onClose={() => {
            setMilestoneMenu(null);
            setSelectedMilestone(null);
          }}
        />
      )}
    </>
  );
};
