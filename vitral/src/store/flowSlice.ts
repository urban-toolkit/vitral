import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { nodeType, edgeType, fileData } from '@/config/types';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { RootState } from "@/store/rootReducer";

const initialState: { nodes: nodeType[], edges: edgeType[], title: string } = {
    nodes: [],
    edges: [],
    title: "Untitled"
};

function ensureAttachmentArray(node: nodeType): string[] {
    if (!Array.isArray(node.data.attachmentIds)) node.data.attachmentIds = [];
    return node.data.attachmentIds;
}

const flowSlice = createSlice({
    name: 'flow',
    initialState,
    reducers: {
        setNodes: (state, action) => {
            state.nodes = action.payload;
        },
        setEdges: (state, action) => {
            state.edges = action.payload;
        },
        addNode: (state, action) => {
            state.nodes.push(action.payload);
        },
        addNodes: (state, action) => {
            state.nodes = state.nodes.concat(action.payload);
        },
        updateNode: (state, action) => {
            const index = state.nodes.findIndex(n => n.id === action.payload.id);
            if (index !== -1) state.nodes[index] = { ...state.nodes[index], ...action.payload };
        },
        removeNode: (state, action) => {
            state.nodes = state.nodes.filter(n => n.id !== action.payload);
            state.edges = state.edges.filter(e => e.source !== action.payload && e.target !== action.payload);
        },
        connectEdge: (state, action) => {
            state.edges.push(action.payload);
        },
        connectEdges: (state, action) => {
            state.edges = state.edges.concat(action.payload);
        },
        removeEdge: (state, action) => {
            state.edges = state.edges.filter(e => e.id !== action.payload);
        },
        onNodesChange: (state, action) => {
            const a = applyNodeChanges(action.payload, state.nodes);
            state.nodes = a;
        },
        onEdgesChange: (state, action) => {
            const a = applyEdgeChanges(action.payload, state.edges);
            state.edges = a;
        },
        setTitle: (state, action) => {
            state.title = action.payload;
        },
        attachFileIdToNode: (state, action: PayloadAction<{ nodeId: string; fileId: string }>) => {
            const { nodeId, fileId } = action.payload;
            const node = state.nodes.find((n) => n.id === nodeId);
            if (!node) return;

            const ids = ensureAttachmentArray(node);
            if (!ids.includes(fileId)) ids.push(fileId);
        },
        detachFileIdFromNode: (state, action: PayloadAction<{ nodeId: string; fileId: string }>) => {
            const { nodeId, fileId } = action.payload;
            const node = state.nodes.find((n) => n.id === nodeId);
            if (!node) return;

            const ids = ensureAttachmentArray(node);
            node.data!.attachmentIds = ids.filter((id) => id !== fileId);
        },
    }
});

export const {
    setNodes,
    setEdges,
    addNode,
    updateNode,
    removeNode,
    connectEdge,
    removeEdge,
    onNodesChange,
    onEdgesChange,
    addNodes,
    connectEdges,
    setTitle,
    attachFileIdToNode,
    detachFileIdFromNode
} = flowSlice.actions;

export default flowSlice.reducer;

export const selectFlow = (state: RootState) => state.flow;
export const selectNodes = createSelector(selectFlow, (flow) => flow.nodes);
export const selectFilesById = (state: RootState) => state.files.byId as Record<string, fileData>;

export const selectFilesForNode = (nodeId: string) =>
    createSelector([selectNodes, selectFilesById], (nodes, filesById) => {
        const node = nodes.find((n) => n.id === nodeId);
        const ids = node?.data?.attachmentIds ?? [];
        return ids.map((id) => filesById[id]).filter(Boolean);
    });