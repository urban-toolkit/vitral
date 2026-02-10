import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { fileExtension, fileRecord } from '@/config/types';
import type { RootState } from "@/store/rootReducer";

type FilesState = {
    byId: Record<string, fileRecord>;
    allIds: string[];
};

const initialState: FilesState = {
    byId: {},
    allIds: [],
};

function upsertOne(state: FilesState, file: fileRecord) {
    const exists = !!state.byId[file.id];
    state.byId[file.id] = file;
    if (!exists) state.allIds.push(file.id);
}

function removeOne(state: FilesState, fileId: string) {
    if (!state.byId[fileId]) return;
    delete state.byId[fileId];
    state.allIds = state.allIds.filter((id) => id !== fileId);
}

export const filesSlice = createSlice({
    name: "files",
    initialState,
    reducers: {
        setFiles: (state, action: PayloadAction<fileRecord[]>) => {
            state.byId = {};
            state.allIds = [];

            for (const f of action.payload) upsertOne(state, f);
        },
        upsertFile: (state, action: PayloadAction<fileRecord>) => {
            upsertOne(state, action.payload);
        },
        upsertMany: (state, action: PayloadAction<fileRecord[]>) => {
            for (const f of action.payload) upsertOne(state, f);
        },
        removeFile: (state, action: PayloadAction<string>) => {
            removeOne(state, action.payload);
        },
        removeMany: (state, action: PayloadAction<string[]>) => {
            for (const id of action.payload) removeOne(state, id);
        },
        renameFile: (state, action: PayloadAction<{ fileId: string; name: string }>) => {
            const { fileId, name } = action.payload;
            const f = state.byId[fileId];
            if (!f) return;
            f.name = name;
            f.ext = name.split(".").pop()?.toLowerCase() as fileExtension;
        },
        clearAllFiles: (state) => {
            state.byId = {};
            state.allIds = [];
        },
    },
});

export const {
    setFiles,
    upsertFile,
    upsertMany,
    removeFile,
    removeMany,
    renameFile,
    clearAllFiles,
} = filesSlice.actions;

export default filesSlice.reducer;

export const selectFilesState = (state: RootState) => state.files;

export const selectFileById = (fileId: string) =>
    createSelector(selectFilesState, (s) => s.byId[fileId]);

export const selectAllFiles = createSelector(selectFilesState, (s) =>
    s.allIds.map((id) => s.byId[id]).filter(Boolean)
);