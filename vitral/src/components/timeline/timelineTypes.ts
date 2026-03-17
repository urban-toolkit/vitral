import type {
  BlueprintEvent,
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
  SystemScreenshotMarker,
} from "@/config/types";

export type TimelineEventBase = {
  id: string;
  occurredAt: Date | string;
  label?: string;
  description?: string;
};

export type KnowledgeTreeCardEvent = {
  id: string;
  occurredAt: Date | string;
  eventType: "created";
  isDeleted?: boolean;
  nodeId: string;
  cardLabel: string;
  cardTitle: string;
  cardDescription: string;
  metadata?: unknown;
};

export type KnowledgeTreePill = {
  treeId: string;
  treeTitle: string;
  occurredAt: Date | string;
  events: KnowledgeTreeCardEvent[];
};

export type KnowledgeCrossTreeConnection = {
  id: string;
  occurredAt: Date | string;
  label: string;
  kind: "regular" | "referenced_by" | "iteration_of";
  sourceNodeId: string;
  targetNodeId: string;
  sourceCardTitle: string;
  sourceCardLabel: string;
  targetCardTitle: string;
  targetCardLabel: string;
  sourceTreeId: string;
  targetTreeId: string;
};

export type KnowledgeBlueprintLink = {
  id: string;
  kind: "regular" | "referenced_by" | "iteration_of";
  label: string;
  cardNodeId: string;
  cardLabel: string;
  cardTitle: string;
  cardCreatedAt: Date | string;
  blueprintEventId: string;
  blueprintEventName: string;
  blueprintOccurredAt: Date | string;
  componentNodeId: string;
};

export type BlueprintEventConnection = {
  id: string;
  kind: "regular" | "referenced_by" | "iteration_of";
  label: string;
  sourceBlueprintEventId: string;
  sourceBlueprintEventName: string;
  sourceComponentNodeId: string;
  targetBlueprintEventId: string;
  targetBlueprintEventName: string;
  targetComponentNodeId: string;
};

export type KnowledgeBaseEvent = TimelineEventBase & {
  kind: "knowledge";
  subtype?: string;
  isDeleted?: boolean;
  treeId?: string;
  treeTitle?: string;
  events?: KnowledgeTreeCardEvent[];
};

export type AnyEvent =
  | GitHubEvent
  | KnowledgeBaseEvent
  | DesignStudyEvent
  | BlueprintEvent;

export type TimelineProps = {
  projectId: string;
  readOnly?: boolean;
  startMarker: Date | string;
  endMarker: Date | string;
  projectName?: string;
  projectGoal?: string;
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
  blueprintEventConnections?: BlueprintEventConnection[];
  knowledgeTreePills?: KnowledgeTreePill[];
  knowledgeCrossTreeConnections?: KnowledgeCrossTreeConnection[];
  knowledgeBlueprintLinks?: KnowledgeBlueprintLink[];
  playbackAt?: Date | string | null;
  onPlaybackAtChange?: (value: string | null) => void;
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
