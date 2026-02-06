import { createSlice, type PayloadAction, createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store/rootReducer";
import type { GitHubEvent } from "@/config/types";

type GitHubEventsState = {
    byId: Record<string, GitHubEvent>;
    allIds: string[];
};

const initialState: GitHubEventsState = {
    byId: {},
    allIds: [],
};

function setAll(state: GitHubEventsState, events: GitHubEvent[]) {
    state.byId = {};
    state.allIds = [];

    for (const ev of events) {
        if (!state.byId[ev.id]) state.allIds.push(ev.id);
        state.byId[ev.id] = ev;
    }
}

export const githubEventsSlice = createSlice({
    name: "githubEvents",
    initialState,
    reducers: {
        setGithubEvents: (state, action: PayloadAction<GitHubEvent[]>) => {
            setAll(state, action.payload);
        },
        clearGithubEvents: (state) => {
            state.byId = {};
            state.allIds = [];
        },
    },
});

export const { setGithubEvents, clearGithubEvents } = githubEventsSlice.actions;

export default githubEventsSlice.reducer;

// selectors
export const selectGitHubEventsState = (state: RootState) => state.gitEvents;

export const selectGitHubEventById = (eventId: string) =>
    createSelector(selectGitHubEventsState, (s) => s.byId[eventId]);

export const selectAllGitHubEvents = createSelector(selectGitHubEventsState, (s) =>
    s.allIds.map((id: string) => s.byId[id]).filter(Boolean)
);
