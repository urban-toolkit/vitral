import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store/rootReducer";
import type {
    BlueprintCodebaseLink,
    BlueprintEvent,
    CodebaseSubtrack,
    DesignStudyEvent,
    ProjectParticipant,
    Stage,
    SubStage,
    SystemScreenshotMarker,
    SystemScreenshotZone,
    TimelineState,
} from "@/config/types";

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const fromDate = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);
const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "").trim();

function normalizeScreenshotZone(zone: unknown, index: number): SystemScreenshotZone | null {
    if (!zone || typeof zone !== "object") return null;
    const candidate = zone as Record<string, unknown>;
    const id = typeof candidate.id === "string" && candidate.id.trim() !== ""
        ? candidate.id
        : `zone-${index + 1}`;
    const name = typeof candidate.name === "string" && candidate.name.trim() !== ""
        ? candidate.name
        : `Zone ${index + 1}`;
    const x = typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 0;
    const y = typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 0;
    const width = typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : 0;
    const height = typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : 0;
    const filePaths = Array.isArray(candidate.filePaths)
        ? Array.from(new Set(
            candidate.filePaths
                .filter((path): path is string => typeof path === "string")
                .map(normalizePath)
                .filter(Boolean)
        ))
        : [];
    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim() !== ""
        ? candidate.rationale
        : undefined;
    return {
        id,
        name,
        x,
        y,
        width,
        height,
        filePaths,
        rationale,
    };
}

function normalizeScreenshotZones(zones: unknown): SystemScreenshotZone[] {
    if (!Array.isArray(zones)) return [];
    const normalized: SystemScreenshotZone[] = [];
    for (let index = 0; index < zones.length; index++) {
        const zone = normalizeScreenshotZone(zones[index], index);
        if (!zone) continue;
        normalized.push(zone);
    }
    return normalized;
}

const initialState: TimelineState = {
    llmModel: "gpt-5-nano",
    stages: {
        byId: {},
        allIds: [],
    },
    subStages: {
        byId: {},
        allIds: [],
    },
    designStudyEvents: {
        byId: {},
        allIds: []
    },
    blueprintEvents: {
        byId: {},
        allIds: []
    },
    codebaseSubtracks: [],
    knowledgeSubtracks: [],
    knowledgePillTrackAssignments: {},
    blueprintCodebaseLinks: [],
    systemScreenshotMarkers: [],
    participants: [],
    hoveredCodebaseFilePath: null,
    highlightedCodebaseFilePaths: [],
    highlightedKnowledgeNodeIds: [],
    hoveredBlueprintComponentNodeId: null,
    defaultStages: [],
    timelineStartEnd: {
        start: "June 15, 2023 03:24:00",
        end: "December 04, 2023 00:24:00",
    },
};

function setAllStages(state: TimelineState, stages: Stage[]) {
    state.stages.byId = {};
    state.stages.allIds = [];

    for (const s of stages) {
        state.stages.byId[s.id] = s;
        state.stages.allIds.push(s.id);
    }
}

function setAllSubStages(state: TimelineState, subStages: SubStage[]) {
    state.subStages.byId = {};
    state.subStages.allIds = [];

    for (const s of subStages) {
        state.subStages.byId[s.id] = s;
        state.subStages.allIds.push(s.id);
    }
}

function setAllDesignStudyEvents(state: TimelineState, designStudyEvents: DesignStudyEvent[]) {
    state.designStudyEvents.byId = {};
    state.designStudyEvents.allIds = [];

    for (const s of designStudyEvents) {
        state.designStudyEvents.byId[s.id] = s;
        state.designStudyEvents.allIds.push(s.id);
    }
}

function setAllBlueprintEvents(state: TimelineState, blueprintEvents: BlueprintEvent[]) {
    state.blueprintEvents.byId = {};
    state.blueprintEvents.allIds = [];

    for (const event of blueprintEvents) {
        state.blueprintEvents.byId[event.id] = event;
        state.blueprintEvents.allIds.push(event.id);
    }
}

function sanitizeSubtrack(subtrack: CodebaseSubtrack, fallbackName: string): CodebaseSubtrack {
    return {
        id: subtrack.id || crypto.randomUUID(),
        name: subtrack.name || fallbackName,
        filePaths: Array.isArray(subtrack.filePaths)
            ? subtrack.filePaths.filter((path) => typeof path === "string")
            : [],
        collapsed: Boolean(subtrack.collapsed),
        inactive: Boolean(subtrack.inactive),
    };
}

export const timelineSlice = createSlice({
    name: "timeline",
    initialState,
    reducers: {
        setLlmModel: (state, action: PayloadAction<string>) => {
            const value = String(action.payload ?? "").trim();
            state.llmModel = value || "gpt-5-nano";
        },

        // Stages
        setStages: (state, action: PayloadAction<Stage[]>) => {

            let stages = action.payload.map((stage) => {
                return {
                    ...stage,
                    start: fromDate(stage.start),
                    end: fromDate(stage.end)
                }
            });

            setAllStages(state, stages);
        },

        addStage: (state, action: PayloadAction<string>) => {
            const name = action.payload;

            const addTwoWeeks = (date: Date) => {
                const result = new Date(date);
                result.setDate(result.getDate() + 14);
                return result;
            };

            let dateOffset = toDate(state.timelineStartEnd.start);

            if (state.stages.allIds.length > 0) {
                const lastStageId = state.stages.allIds[state.stages.allIds.length - 1];
                const lastStage = state.stages.byId[lastStageId];
                dateOffset = new Date(lastStage.end);
            }

            const newId = crypto.randomUUID();

            state.stages.allIds.push(newId);
            state.stages.byId[newId] = {
                id: newId,
                name,
                start: fromDate(dateOffset),
                end: fromDate(addTwoWeeks(dateOffset)),
            }
        },

        updateStage: (state, action: PayloadAction<Stage>) => {
            const stage = action.payload;
            if (state.stages.byId[stage.id]) {
                state.stages.byId[stage.id] = {
                    ...stage,
                    start: fromDate(stage.start),
                    end: fromDate(stage.end)
                };
            }
        },

        deleteStage: (state, action: PayloadAction<string>) => {
            const id = action.payload;

            const index = state.stages.allIds.findIndex(s => s === id);
            if (!state.stages.byId[id]) return;

            const stageToDelete = state.stages.byId[id];

            const duration =
                +new Date(stageToDelete.end) -
                +new Date(stageToDelete.start);

            const remaining = state.stages.allIds.filter(s => s !== id);

            for (let i = 0; i < remaining.length; i++) {
                if (i < index) continue;

                const s = state.stages.byId[remaining[i]];

                state.stages.byId[remaining[i]] = {
                    ...s,
                    start: fromDate(new Date(+new Date(s.start) - duration)),
                    end: fromDate(new Date(+new Date(s.end) - duration)),
                }
            }

            state.stages.allIds = remaining;
            const { [id]: _, ...newObj } = state.stages.byId;
            state.stages.byId = newObj;
        },

        changeStageBoundary: (
            state,
            action: PayloadAction<{
                prevId: string;
                nextId: string;
                date: string;
            }>
        ) => {
            const { prevId, nextId, date } = action.payload;

            for (let i = 0; i < state.stages.allIds.length; i++) {
                if (state.stages.allIds[i] == prevId)
                    state.stages.byId[prevId] = { ...state.stages.byId[prevId], start: fromDate(state.stages.byId[prevId].start), end: fromDate(date) };

                if (state.stages.allIds[i] == nextId)
                    state.stages.byId[nextId] = { ...state.stages.byId[nextId], start: fromDate(date), end: fromDate(state.stages.byId[nextId].end) };

            }
        },

        // Substages
        setSubStages: (state, action: PayloadAction<SubStage[]>) => {
            let subStages = action.payload.map((subStage) => {
                return {
                    ...subStage,
                    start: fromDate(subStage.start),
                    end: fromDate(subStage.end)
                }
            });

            setAllSubStages(state, subStages);
        },

        addSubStage: (state, action: PayloadAction<SubStage>) => {
            const s = action.payload;
            state.subStages.byId[s.id] = {
                ...s,
                start: fromDate(s.start),
                end: fromDate(s.end)
            };
            state.subStages.allIds.push(s.id);
        },

        updateSubStage: (state, action: PayloadAction<SubStage>) => {
            const s = action.payload;
            if (state.subStages.byId[s.id]) {
                state.subStages.byId[s.id] = {
                    ...s,
                    start: fromDate(s.start),
                    end: fromDate(s.end)
                };
            }
        },

        deleteSubStage: (state, action: PayloadAction<string>) => {
            const id = action.payload;
            delete state.subStages.byId[id];
            state.subStages.allIds =
                state.subStages.allIds.filter(sid => sid !== id);
        },

        // Design Study Events
        setDesignStudyEvents: (state, action: PayloadAction<DesignStudyEvent[]>) => {
            const designStudyEvents: DesignStudyEvent[] = action.payload.map((designStudyEvent): DesignStudyEvent => {
                return {
                    ...designStudyEvent,
                    occurredAt: fromDate(designStudyEvent.occurredAt),
                    generatedBy: designStudyEvent.generatedBy === "llm" ? "llm" : "manual",
                }
            });

            setAllDesignStudyEvents(state, designStudyEvents);
        },

        addDesignStudyEvent: (state, action: PayloadAction<DesignStudyEvent>) => {
            const s = action.payload;
            state.designStudyEvents.byId[s.id] = {
                ...s,
                occurredAt: fromDate(s.occurredAt),
                generatedBy: s.generatedBy === "llm" ? "llm" : "manual",
            };
            state.designStudyEvents.allIds.push(s.id);
        },

        updateDesignStudyEvent: (state, action: PayloadAction<DesignStudyEvent>) => {
            const s = action.payload;
            if (state.designStudyEvents.byId[s.id]) {
                state.designStudyEvents.byId[s.id] = {
                    ...s,
                    occurredAt: fromDate(s.occurredAt),
                    generatedBy: s.generatedBy === "llm" ? "llm" : "manual",
                };
            }
        },

        deleteDesignStudyEvent: (state, action: PayloadAction<string>) => {
            const id = action.payload;
            delete state.designStudyEvents.byId[id];
            state.designStudyEvents.allIds =
                state.designStudyEvents.allIds.filter(sid => sid !== id);
        },

        // Blueprint events
        setBlueprintEvents: (state, action: PayloadAction<BlueprintEvent[]>) => {
            const blueprintEvents = action.payload.map((event) => ({
                ...event,
                occurredAt: fromDate(event.occurredAt),
            }));

            setAllBlueprintEvents(state, blueprintEvents);
        },

        addBlueprintEvent: (state, action: PayloadAction<BlueprintEvent>) => {
            const event = action.payload;
            if (state.blueprintEvents.byId[event.id]) return;

            state.blueprintEvents.byId[event.id] = {
                ...event,
                occurredAt: fromDate(event.occurredAt),
            };
            state.blueprintEvents.allIds.push(event.id);
        },

        updateBlueprintEvent: (state, action: PayloadAction<BlueprintEvent>) => {
            const event = action.payload;
            if (!state.blueprintEvents.byId[event.id]) return;

            state.blueprintEvents.byId[event.id] = {
                ...event,
                occurredAt: fromDate(event.occurredAt),
            };
        },

        deleteBlueprintEvent: (state, action: PayloadAction<string>) => {
            const id = action.payload;
            delete state.blueprintEvents.byId[id];
            state.blueprintEvents.allIds =
                state.blueprintEvents.allIds.filter((eventId) => eventId !== id);
            state.blueprintCodebaseLinks = state.blueprintCodebaseLinks.filter(
                (link) => link.blueprintEventId !== id
            );
        },

        // Codebase subtracks
        setCodebaseSubtracks: (state, action: PayloadAction<CodebaseSubtrack[]>) => {
            state.codebaseSubtracks = action.payload.map((subtrack, index) =>
                sanitizeSubtrack(subtrack, `Codebase subtrack ${index + 1}`)
            );
        },

        addCodebaseSubtrack: (state, action: PayloadAction<CodebaseSubtrack>) => {
            const subtrack = action.payload;
            if (state.codebaseSubtracks.some((existing) => existing.id === subtrack.id)) return;
            state.codebaseSubtracks.push(sanitizeSubtrack(subtrack, "Codebase subtrack"));
        },

        attachFileToCodebaseSubtrack: (
            state,
            action: PayloadAction<{ subtrackId: string; filePath: string }>
        ) => {
            const { subtrackId, filePath } = action.payload;
            const subtrack = state.codebaseSubtracks.find((item) => item.id === subtrackId);
            if (!subtrack || !filePath) return;
            if (subtrack.filePaths.includes(filePath)) return;
            subtrack.filePaths.push(filePath);
        },

        toggleCodebaseSubtrackCollapsed: (state, action: PayloadAction<string>) => {
            const subtrack = state.codebaseSubtracks.find((item) => item.id === action.payload);
            if (!subtrack) return;
            subtrack.collapsed = !subtrack.collapsed;
        },

        renameCodebaseSubtrack: (
            state,
            action: PayloadAction<{ subtrackId: string; name: string }>
        ) => {
            const { subtrackId, name } = action.payload;
            const subtrack = state.codebaseSubtracks.find((item) => item.id === subtrackId);
            if (!subtrack) return;
            subtrack.name = name;
        },

        deleteCodebaseSubtrack: (state, action: PayloadAction<string>) => {
            state.codebaseSubtracks = state.codebaseSubtracks.filter(
                (subtrack) => subtrack.id !== action.payload
            );
            state.blueprintCodebaseLinks = state.blueprintCodebaseLinks.filter(
                (link) => link.codebaseSubtrackId !== action.payload
            );
        },

        toggleCodebaseSubtrackInactive: (state, action: PayloadAction<string>) => {
            const subtrack = state.codebaseSubtracks.find((item) => item.id === action.payload);
            if (!subtrack) return;
            subtrack.inactive = !subtrack.inactive;
        },

        // Knowledge subtracks
        setKnowledgeSubtracks: (state, action: PayloadAction<CodebaseSubtrack[]>) => {
            state.knowledgeSubtracks = action.payload.map((subtrack, index) =>
                sanitizeSubtrack(subtrack, `Knowledge subtrack ${index + 1}`)
            );
            const validSubtrackIds = new Set(state.knowledgeSubtracks.map((subtrack) => subtrack.id));
            for (const treeId of Object.keys(state.knowledgePillTrackAssignments)) {
                const assignedSubtrackId = state.knowledgePillTrackAssignments[treeId];
                if (assignedSubtrackId && !validSubtrackIds.has(assignedSubtrackId)) {
                    state.knowledgePillTrackAssignments[treeId] = null;
                }
            }
        },

        addKnowledgeSubtrack: (state, action: PayloadAction<CodebaseSubtrack>) => {
            const subtrack = action.payload;
            if (state.knowledgeSubtracks.some((existing) => existing.id === subtrack.id)) return;
            state.knowledgeSubtracks.push(sanitizeSubtrack(subtrack, "Knowledge subtrack"));
        },

        toggleKnowledgeSubtrackCollapsed: (state, action: PayloadAction<string>) => {
            const subtrack = state.knowledgeSubtracks.find((item) => item.id === action.payload);
            if (!subtrack) return;
            subtrack.collapsed = !subtrack.collapsed;
        },

        renameKnowledgeSubtrack: (
            state,
            action: PayloadAction<{ subtrackId: string; name: string }>
        ) => {
            const { subtrackId, name } = action.payload;
            const subtrack = state.knowledgeSubtracks.find((item) => item.id === subtrackId);
            if (!subtrack) return;
            subtrack.name = name;
        },

        deleteKnowledgeSubtrack: (state, action: PayloadAction<string>) => {
            const subtrackId = action.payload;
            state.knowledgeSubtracks = state.knowledgeSubtracks.filter(
                (subtrack) => subtrack.id !== subtrackId
            );
            for (const treeId of Object.keys(state.knowledgePillTrackAssignments)) {
                if (state.knowledgePillTrackAssignments[treeId] === subtrackId) {
                    state.knowledgePillTrackAssignments[treeId] = null;
                }
            }
        },

        toggleKnowledgeSubtrackInactive: (state, action: PayloadAction<string>) => {
            const subtrack = state.knowledgeSubtracks.find((item) => item.id === action.payload);
            if (!subtrack) return;
            subtrack.inactive = !subtrack.inactive;
        },

        setKnowledgePillTrackAssignments: (
            state,
            action: PayloadAction<Record<string, string | null>>
        ) => {
            const validSubtrackIds = new Set(state.knowledgeSubtracks.map((subtrack) => subtrack.id));
            const nextAssignments: Record<string, string | null> = {};
            for (const [treeId, subtrackId] of Object.entries(action.payload ?? {})) {
                if (typeof treeId !== "string" || treeId.trim() === "") continue;
                nextAssignments[treeId] =
                    typeof subtrackId === "string" && validSubtrackIds.has(subtrackId)
                        ? subtrackId
                        : null;
            }
            state.knowledgePillTrackAssignments = nextAssignments;
        },

        assignKnowledgePillToSubtrack: (
            state,
            action: PayloadAction<{ treeId: string; subtrackId: string | null }>
        ) => {
            const { treeId, subtrackId } = action.payload;
            if (!treeId || treeId.trim() === "") return;
            if (subtrackId && !state.knowledgeSubtracks.some((subtrack) => subtrack.id === subtrackId)) {
                state.knowledgePillTrackAssignments[treeId] = null;
                return;
            }
            state.knowledgePillTrackAssignments[treeId] = subtrackId ?? null;
        },

        setParticipants: (state, action: PayloadAction<ProjectParticipant[]>) => {
            state.participants = action.payload
                .filter((participant) =>
                    typeof participant?.id === "string" &&
                    participant.id.trim() !== "" &&
                    typeof participant?.name === "string" &&
                    participant.name.trim() !== ""
                )
                .map((participant, index) => ({
                    id: participant.id,
                    name: participant.name,
                    role: typeof participant.role === "string" && participant.role.trim() !== ""
                        ? participant.role
                        : `Role ${index + 1}`,
                }));
        },

        setHoveredCodebaseFilePath: (state, action: PayloadAction<string | null>) => {
            state.hoveredCodebaseFilePath = action.payload;
        },

        setHighlightedCodebaseFilePaths: (state, action: PayloadAction<string[]>) => {
            state.highlightedCodebaseFilePaths = Array.from(new Set(
                action.payload
                    .filter((path) => typeof path === "string")
                    .map(normalizePath)
                    .filter(Boolean)
            ));
        },

        setHighlightedKnowledgeNodeIds: (state, action: PayloadAction<string[]>) => {
            state.highlightedKnowledgeNodeIds = Array.from(new Set(
                action.payload
                    .filter((id) => typeof id === "string" && id.trim() !== "")
                    .map((id) => id.trim())
            ));
        },

        setHoveredBlueprintComponentNodeId: (state, action: PayloadAction<string | null>) => {
            state.hoveredBlueprintComponentNodeId = action.payload;
        },

        // Blueprint event <-> codebase subtrack links
        setBlueprintCodebaseLinks: (state, action: PayloadAction<BlueprintCodebaseLink[]>) => {
            state.blueprintCodebaseLinks = action.payload
                .filter(
                    (link) =>
                        typeof link.blueprintEventId === "string" &&
                        link.blueprintEventId.trim() !== "" &&
                        typeof link.codebaseSubtrackId === "string" &&
                        link.codebaseSubtrackId.trim() !== ""
                )
                .map((link) => ({
                    id: link.id || crypto.randomUUID(),
                    blueprintEventId: link.blueprintEventId,
                    codebaseSubtrackId: link.codebaseSubtrackId,
                    origin: link.origin === "auto" ? "auto" : "manual",
                }));
        },

        setSystemScreenshotMarkers: (
            state,
            action: PayloadAction<SystemScreenshotMarker[]>
        ) => {
            state.systemScreenshotMarkers = action.payload
                .filter((marker) =>
                    typeof marker?.id === "string" &&
                    marker.id.trim() !== "" &&
                    typeof marker?.occurredAt === "string" &&
                    marker.occurredAt.trim() !== "" &&
                    typeof marker?.imageDataUrl === "string"
                )
                .map((marker) => ({
                    id: marker.id,
                    occurredAt: fromDate(marker.occurredAt),
                    imageDataUrl: marker.imageDataUrl,
                    imageWidth: typeof marker.imageWidth === "number" && marker.imageWidth > 0
                        ? marker.imageWidth
                        : undefined,
                    imageHeight: typeof marker.imageHeight === "number" && marker.imageHeight > 0
                        ? marker.imageHeight
                        : undefined,
                    zones: normalizeScreenshotZones(marker.zones),
                }))
                .sort((a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt));
        },

        addSystemScreenshotMarker: (
            state,
            action: PayloadAction<SystemScreenshotMarker>
        ) => {
            const marker = action.payload;
            if (
                !marker ||
                typeof marker.id !== "string" ||
                marker.id.trim() === "" ||
                typeof marker.occurredAt !== "string" ||
                marker.occurredAt.trim() === "" ||
                typeof marker.imageDataUrl !== "string"
            ) {
                return;
            }

            if (state.systemScreenshotMarkers.some((item) => item.id === marker.id)) {
                return;
            }

            state.systemScreenshotMarkers.push({
                id: marker.id,
                occurredAt: fromDate(marker.occurredAt),
                imageDataUrl: marker.imageDataUrl,
                imageWidth: typeof marker.imageWidth === "number" && marker.imageWidth > 0
                    ? marker.imageWidth
                    : undefined,
                imageHeight: typeof marker.imageHeight === "number" && marker.imageHeight > 0
                    ? marker.imageHeight
                    : undefined,
                zones: normalizeScreenshotZones(marker.zones),
            });
            state.systemScreenshotMarkers.sort(
                (a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt)
            );
        },

        updateSystemScreenshotMarkerImage: (
            state,
            action: PayloadAction<{
                markerId: string;
                imageDataUrl?: string;
                imageWidth?: number;
                imageHeight?: number;
                zones?: SystemScreenshotZone[];
            }>
        ) => {
            const marker = state.systemScreenshotMarkers.find(
                (item) => item.id === action.payload.markerId
            );
            if (!marker) return;
            if (typeof action.payload.imageDataUrl === "string") {
                marker.imageDataUrl = action.payload.imageDataUrl;
            }
            if (typeof action.payload.imageWidth === "number" && action.payload.imageWidth > 0) {
                marker.imageWidth = action.payload.imageWidth;
            }
            if (typeof action.payload.imageHeight === "number" && action.payload.imageHeight > 0) {
                marker.imageHeight = action.payload.imageHeight;
            }
            if (Array.isArray(action.payload.zones)) {
                marker.zones = normalizeScreenshotZones(action.payload.zones);
            }
        },

        deleteSystemScreenshotMarker: (
            state,
            action: PayloadAction<string>
        ) => {
            state.systemScreenshotMarkers = state.systemScreenshotMarkers.filter(
                (marker) => marker.id !== action.payload
            );
        },

        addBlueprintCodebaseLink: (
            state,
            action: PayloadAction<{
                id?: string;
                blueprintEventId: string;
                codebaseSubtrackId: string;
                origin?: "manual" | "auto";
            }>
        ) => {
            const { id, blueprintEventId, codebaseSubtrackId, origin } = action.payload;
            if (!blueprintEventId || !codebaseSubtrackId) return;
            const resolvedOrigin = origin === "auto" ? "auto" : "manual";

            const duplicate = state.blueprintCodebaseLinks.find(
                (link) =>
                    link.blueprintEventId === blueprintEventId &&
                    link.codebaseSubtrackId === codebaseSubtrackId
            );
            if (duplicate) {
                if (resolvedOrigin === "manual") {
                    duplicate.origin = "manual";
                }
                return;
            }

            state.blueprintCodebaseLinks.push({
                id: id || crypto.randomUUID(),
                blueprintEventId,
                codebaseSubtrackId,
                origin: resolvedOrigin,
            });
        },

        reconcileBlueprintCodebaseAutoLinks: (
            state,
            action: PayloadAction<Array<{ blueprintEventId: string; codebaseSubtrackId: string }>>
        ) => {
            const requiredKeys = new Set<string>();
            const requiredPairs: Array<{ blueprintEventId: string; codebaseSubtrackId: string }> = [];

            for (const pair of action.payload) {
                if (!pair.blueprintEventId || !pair.codebaseSubtrackId) continue;
                const key = `${pair.blueprintEventId}::${pair.codebaseSubtrackId}`;
                if (requiredKeys.has(key)) continue;
                requiredKeys.add(key);
                requiredPairs.push(pair);
            }

            const nextLinks: BlueprintCodebaseLink[] = [];
            const existingKeys = new Set<string>();
            let changed = false;

            for (const link of state.blueprintCodebaseLinks) {
                const key = `${link.blueprintEventId}::${link.codebaseSubtrackId}`;
                const keep = link.origin === "manual" || requiredKeys.has(key);
                if (!keep) {
                    changed = true;
                    continue;
                }
                nextLinks.push(link);
                existingKeys.add(key);
            }

            for (const pair of requiredPairs) {
                const key = `${pair.blueprintEventId}::${pair.codebaseSubtrackId}`;
                if (existingKeys.has(key)) continue;
                nextLinks.push({
                    id: crypto.randomUUID(),
                    blueprintEventId: pair.blueprintEventId,
                    codebaseSubtrackId: pair.codebaseSubtrackId,
                    origin: "auto",
                });
                existingKeys.add(key);
                changed = true;
            }

            if (changed) {
                state.blueprintCodebaseLinks = nextLinks;
            }
        },

        deleteBlueprintCodebaseLink: (state, action: PayloadAction<string>) => {
            state.blueprintCodebaseLinks = state.blueprintCodebaseLinks.filter(
                (link) => link.id !== action.payload
            );
        },

        // Default stages
        setDefaultStages: (state, action: PayloadAction<string[]>) => {
            state.defaultStages = action.payload;
        },

        addDefaultStage: (state, action: PayloadAction<string>) => {
            if (!state.defaultStages.includes(action.payload)) {
                state.defaultStages.push(action.payload);
            }
        },

        // Project range
        setTimelineStartEnd: (
            state,
            action: PayloadAction<{ start: Date | string; end: Date | string }>
        ) => {
            state.timelineStartEnd = {
                start: fromDate(action.payload.start),
                end: fromDate(action.payload.end)
            };
        },

        clearTimeline: () => initialState,
    },
});

export const {
    setLlmModel,
    setStages,
    addStage,
    updateStage,
    deleteStage,
    setSubStages,
    addSubStage,
    updateSubStage,
    deleteSubStage,
    setDefaultStages,
    addDefaultStage,
    setTimelineStartEnd,
    clearTimeline,
    changeStageBoundary,
    setDesignStudyEvents,
    addDesignStudyEvent,
    updateDesignStudyEvent,
    deleteDesignStudyEvent,
    setBlueprintEvents,
    addBlueprintEvent,
    updateBlueprintEvent,
    deleteBlueprintEvent,
    setCodebaseSubtracks,
    addCodebaseSubtrack,
    attachFileToCodebaseSubtrack,
    toggleCodebaseSubtrackCollapsed,
    renameCodebaseSubtrack,
    deleteCodebaseSubtrack,
    toggleCodebaseSubtrackInactive,
    setKnowledgeSubtracks,
    addKnowledgeSubtrack,
    toggleKnowledgeSubtrackCollapsed,
    renameKnowledgeSubtrack,
    deleteKnowledgeSubtrack,
    toggleKnowledgeSubtrackInactive,
    setKnowledgePillTrackAssignments,
    assignKnowledgePillToSubtrack,
    setParticipants,
    setHoveredCodebaseFilePath,
    setHighlightedCodebaseFilePaths,
    setHighlightedKnowledgeNodeIds,
    setHoveredBlueprintComponentNodeId,
    setBlueprintCodebaseLinks,
    setSystemScreenshotMarkers,
    addSystemScreenshotMarker,
    updateSystemScreenshotMarkerImage,
    deleteSystemScreenshotMarker,
    addBlueprintCodebaseLink,
    reconcileBlueprintCodebaseAutoLinks,
    deleteBlueprintCodebaseLink,
} = timelineSlice.actions;

export default timelineSlice.reducer;

// selectors

export const selectTimelineState = (state: RootState) => state.timeline;

// Stages
export const selectStageById = (id: string) =>
    createSelector(selectTimelineState, s => s.stages.byId[id]);

export const selectAllStages = createSelector(
    selectTimelineState,
    s => s.stages.allIds.map(id => s.stages.byId[id]).filter(Boolean)
);

// Substages
export const selectSubStageById = (id: string) =>
    createSelector(selectTimelineState, s => s.subStages.byId[id]);

export const selectAllSubStages = createSelector(
    selectTimelineState,
    s => s.subStages.allIds.map(id => s.subStages.byId[id]).filter(Boolean)
);

// Design study events 
export const selectDesignStudyEventById = (id: string) =>
    createSelector(selectTimelineState, s => s.designStudyEvents.byId[id]);

export const selectAllDesignStudyEvents = createSelector(
    selectTimelineState,
    s => s.designStudyEvents.allIds.map(id => s.designStudyEvents.byId[id]).filter(Boolean)
);

export const selectAllBlueprintEvents = createSelector(
    selectTimelineState,
    s => s.blueprintEvents.allIds.map(id => s.blueprintEvents.byId[id]).filter(Boolean)
);

export const selectCodebaseSubtracks = createSelector(
    selectTimelineState,
    s => s.codebaseSubtracks
);

export const selectKnowledgeSubtracks = createSelector(
    selectTimelineState,
    s => s.knowledgeSubtracks
);

export const selectKnowledgePillTrackAssignments = createSelector(
    selectTimelineState,
    s => s.knowledgePillTrackAssignments
);

export const selectBlueprintCodebaseLinks = createSelector(
    selectTimelineState,
    s => s.blueprintCodebaseLinks
);

export const selectHoveredCodebaseFilePath = createSelector(
    selectTimelineState,
    s => s.hoveredCodebaseFilePath
);

export const selectHighlightedCodebaseFilePaths = createSelector(
    selectTimelineState,
    s => s.highlightedCodebaseFilePaths
);

export const selectHighlightedKnowledgeNodeIds = createSelector(
    selectTimelineState,
    s => s.highlightedKnowledgeNodeIds
);

export const selectSystemScreenshotMarkers = createSelector(
    selectTimelineState,
    s => s.systemScreenshotMarkers
);

export const selectParticipants = createSelector(
    selectTimelineState,
    s => s.participants
);

export const selectHoveredBlueprintComponentNodeId = createSelector(
    selectTimelineState,
    s => s.hoveredBlueprintComponentNodeId
);

// Default and range
export const selectDefaultStages = createSelector(
    selectTimelineState,
    s => s.defaultStages
);

export const selectTimelineStartEnd = createSelector(
    selectTimelineState,
    s => s.timelineStartEnd
);

export const selectLlmModel = createSelector(
    selectTimelineState,
    s => s.llmModel
);
