import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { fileExtension, fileRecord } from '@/config/types';
import type { RootState } from "@/store/rootReducer";

type FilesState = {
    byId: Record<string, fileRecord>;
    allIds: string[];
    activeFileId: string | null;
};

const initialState: FilesState = {
    byId: {},
    allIds: [],
    activeFileId: null,
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
    if (state.activeFileId === fileId) state.activeFileId = null;
}

export const filesSlice = createSlice({
    name: "files",
    initialState,
    reducers: {
        setFiles: (state, action: PayloadAction<fileRecord[]>) => {
            state.byId = {};
            state.allIds = [];
            state.activeFileId = null;

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
        updateFileContent: (
            state,
            action: PayloadAction<{
                fileId: string;
                content: string;
                mimeType?: string;
                sizeBytes?: number;
                sha256?: string;
            }>
        ) => {
            const { fileId, content, mimeType, sizeBytes, sha256 } = action.payload;
            const f = state.byId[fileId];
            if (!f) return;

            f.content = content;
            if (mimeType !== undefined) f.mimeType = mimeType;
            if (sizeBytes !== undefined) f.sizeBytes = sizeBytes;
            if (sha256 !== undefined) f.sha256 = sha256;
        },
        setActiveFile: (state, action: PayloadAction<string | null>) => {
            state.activeFileId = action.payload;
        },
        clearAllFiles: (state) => {
            state.byId = {};
            state.allIds = [];
            state.activeFileId = null;
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
    updateFileContent,
    setActiveFile,
    clearAllFiles,
} = filesSlice.actions;

export default filesSlice.reducer;

export const selectFilesState = (state: RootState) => state.files;

export const selectFileById = (fileId: string) =>
    createSelector(selectFilesState, (s) => s.byId[fileId]);

export const selectAllFiles = createSelector(selectFilesState, (s) =>
    s.allIds.map((id) => s.byId[id]).filter(Boolean)
);

export const selectActiveFile = createSelector(selectFilesState, (s) =>
    s.activeFileId ? s.byId[s.activeFileId] : null
);