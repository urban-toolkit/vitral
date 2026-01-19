import { createSlice } from '@reduxjs/toolkit';
import type { nodeType, edgeType } from '@/config/types';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';

const initialState: { nodes: nodeType[], edges: edgeType[] } = {
    nodes: [],
    edges: []
};

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
        }
    }
});

export const { setNodes, setEdges, addNode, updateNode, removeNode, connectEdge, removeEdge, onNodesChange, onEdgesChange, addNodes, connectEdges } = flowSlice.actions;
export default flowSlice.reducer;
