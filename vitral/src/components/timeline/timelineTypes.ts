import type {
  BlueprintCodebaseLink,
  BlueprintEvent,
  CodebaseSubtrack,
  DesignStudyEvent,
  GitHubEvent,
  LaneType,
  Stage,
  SubStage,
} from "@/config/types";

export type {
  BlueprintCodebaseLink,
  BlueprintEvent,
  CodebaseSubtrack,
  DesignStudyEvent,
  GitHubEvent,
  LaneType,
  Stage,
  SubStage,
} from "@/config/types";

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

export type AnyEvent =
  | GitHubEvent
  | KnowledgeBaseEvent
  | DesignStudyEvent
  | BlueprintEvent;

export type TimelineProps = {
  startMarker: Date | string;
  endMarker: Date | string;
  defaultStages: string[];
  onStageUpdate: (stage: Stage) => void;
  onStageCreation: (name: string) => void;
  onStageLaneCreation: (name: string) => void;
  onStageLaneDeletion: (id: string) => void;
  onStageBoundaryChange: (prevId: string, nextId: string, date: Date) => void;
  onSyncCodebaseEvents?: () => Promise<void> | void;
  stages?: Stage[];
  codebaseEvents?: GitHubEvent[];
  knowledgeBaseEvents?: KnowledgeBaseEvent[];
  designStudyEvents?: DesignStudyEvent[];
  blueprintEvents?: BlueprintEvent[];
  connectedBlueprintComponentNodeIds?: string[];
  margin?: { top: number; right: number; bottom: number; left: number };
};

export type ParsedGitHubEvent = GitHubEvent & {
  date: Date;
};

export type ParsedKnowledgeBaseEvent = KnowledgeBaseEvent & {
  date: Date;
};

export type ParsedDesignStudyEvent = DesignStudyEvent & {
  date: Date;
};

export type ParsedBlueprintEvent = BlueprintEvent & {
  date: Date;
};

export type ParsedStage = Omit<Stage, "start" | "end"> & {
  start: Date;
  end: Date;
};

export type ParsedSubStage = Omit<SubStage, "start" | "end"> & {
  start: Date;
  end: Date;
};

export type ParsedTimelineData = {
  cb: ParsedGitHubEvent[];
  kb: ParsedKnowledgeBaseEvent[];
  ds: ParsedDesignStudyEvent[];
  bp: ParsedBlueprintEvent[];
  stages: ParsedStage[];
  subStages: ParsedSubStage[];
  start: Date;
  end: Date;
  domain: [Date, Date];
};

export type SelectedTimelineEvent = {
  kind: LaneType;
  event: AnyEvent;
};
