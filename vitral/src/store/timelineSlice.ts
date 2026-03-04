import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/store/rootReducer";
import type {
    BlueprintCodebaseLink,
    BlueprintEvent,
    CodebaseSubtrack,
    DesignStudyEvent,
    Stage,
    SubStage,
    TimelineState,
} from "@/config/types";

const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const fromDate = (d: Date | string) => (d instanceof Date ? d.toString() : d);

const initialState: TimelineState = {
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
    blueprintCodebaseLinks: [],
    hoveredCodebaseFilePath: null,
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

export const timelineSlice = createSlice({
    name: "timeline",
    initialState,
    reducers: {

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
            let designStudyEvents = action.payload.map((designStudyEvent) => {
                return {
                    ...designStudyEvent,
                    occurredAt: fromDate(designStudyEvent.occurredAt)
                }
            });

            setAllDesignStudyEvents(state, designStudyEvents);
        },

        addDesignStudyEvent: (state, action: PayloadAction<DesignStudyEvent>) => {
            const s = action.payload;
            state.designStudyEvents.byId[s.id] = {
                ...s,
                occurredAt: fromDate(s.occurredAt)
            };
            state.designStudyEvents.allIds.push(s.id);
        },

        updateDesignStudyEvent: (state, action: PayloadAction<DesignStudyEvent>) => {
            const s = action.payload;
            if (state.designStudyEvents.byId[s.id]) {
                state.designStudyEvents.byId[s.id] = {
                    ...s,
                    occurredAt: fromDate(s.occurredAt)
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
            state.codebaseSubtracks = action.payload.map((subtrack, index) => ({
                id: subtrack.id || crypto.randomUUID(),
                name: subtrack.name || `Codebase subtrack ${index + 1}`,
                filePaths: Array.isArray(subtrack.filePaths)
                    ? subtrack.filePaths.filter((path) => typeof path === "string")
                    : [],
                collapsed: Boolean(subtrack.collapsed),
                inactive: Boolean(subtrack.inactive),
            }));
        },

        addCodebaseSubtrack: (state, action: PayloadAction<CodebaseSubtrack>) => {
            const subtrack = action.payload;
            if (state.codebaseSubtracks.some((existing) => existing.id === subtrack.id)) return;

            state.codebaseSubtracks.push({
                id: subtrack.id,
                name: subtrack.name,
                filePaths: Array.isArray(subtrack.filePaths) ? subtrack.filePaths : [],
                collapsed: Boolean(subtrack.collapsed),
                inactive: Boolean(subtrack.inactive),
            });
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

        setHoveredCodebaseFilePath: (state, action: PayloadAction<string | null>) => {
            state.hoveredCodebaseFilePath = action.payload;
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
                }));
        },

        addBlueprintCodebaseLink: (
            state,
            action: PayloadAction<{
                id?: string;
                blueprintEventId: string;
                codebaseSubtrackId: string;
            }>
        ) => {
            const { id, blueprintEventId, codebaseSubtrackId } = action.payload;
            if (!blueprintEventId || !codebaseSubtrackId) return;

            const duplicate = state.blueprintCodebaseLinks.some(
                (link) =>
                    link.blueprintEventId === blueprintEventId &&
                    link.codebaseSubtrackId === codebaseSubtrackId
            );
            if (duplicate) return;

            state.blueprintCodebaseLinks.push({
                id: id || crypto.randomUUID(),
                blueprintEventId,
                codebaseSubtrackId,
            });
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
    setHoveredCodebaseFilePath,
    setHoveredBlueprintComponentNodeId,
    setBlueprintCodebaseLinks,
    addBlueprintCodebaseLink,
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

export const selectBlueprintCodebaseLinks = createSelector(
    selectTimelineState,
    s => s.blueprintCodebaseLinks
);

export const selectHoveredCodebaseFilePath = createSelector(
    selectTimelineState,
    s => s.hoveredCodebaseFilePath
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
