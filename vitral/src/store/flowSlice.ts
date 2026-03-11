import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { nodeType, edgeType, fileRecord } from '@/config/types';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { RootState } from "@/store/rootReducer";

const EMPTY_IDS: string[] = [];
const EMPTY_BY_ID: Record<string, fileRecord> = {};

const initialState: { nodes: nodeType[], edges: edgeType[], title: string } = {
    nodes: [],
    edges: [],
    title: "Untitled"
};

function ensureAttachmentArray(node: nodeType): string[] {
    if (!Array.isArray(node.data.attachmentIds)) node.data.attachmentIds = [];
    return node.data.attachmentIds;
}

function ensureCodebaseFilePathArray(node: nodeType): string[] {
    const data = node.data as Record<string, unknown>;
    if (!Array.isArray(data.codebaseFilePaths)) data.codebaseFilePaths = [];
    return data.codebaseFilePaths as string[];
}

function normalizeCodebasePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function asNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function nodeLabel(node: nodeType): string {
    return String((node.data as Record<string, unknown>)?.label ?? "").toLowerCase();
}

function nodeSize(node: nodeType): { width: number; height: number } {
    const style = node.style as Record<string, unknown> | undefined;
    const fallback = nodeLabel(node) === "blueprint_component" ? 112 : 120;
    return {
        width: asNumber(style?.width, fallback),
        height: asNumber(style?.height, fallback),
    };
}

function blueprintGroupConfig(level: unknown): {
    minWidth: number;
    minHeight: number;
    paddingRight: number;
    paddingBottom: number;
} {
    if (level === "high") {
        return { minWidth: 180, minHeight: 100, paddingRight: 22, paddingBottom: 22 };
    }
    if (level === "intermediate") {
        return { minWidth: 140, minHeight: 90, paddingRight: 18, paddingBottom: 18 };
    }
    return { minWidth: 220, minHeight: 120, paddingRight: 28, paddingBottom: 24 };
}

function getComponentColumns(count: number): number {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
}

function getIntermediateColumns(count: number): number {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
}

function sortNodesByPosition(nodes: nodeType[]): nodeType[] {
    return [...nodes].sort((a, b) => {
        if (a.position.y !== b.position.y) return a.position.y - b.position.y;
        if (a.position.x !== b.position.x) return a.position.x - b.position.x;
        return a.id.localeCompare(b.id);
    });
}

function compactBlueprintChildren(group: nodeType, children: nodeType[]): void {
    const data = group.data as Record<string, unknown>;
    const level = data.blueprintGroupLevel;

    if (level === "intermediate") {
        const components = sortNodesByPosition(
            children.filter((child) => nodeLabel(child) === "blueprint_component")
        );
        if (components.length === 0) return;

        const columns = getComponentColumns(components.length);
        const contentTop = 42;
        const paddingX = 18;
        const componentSize = 112;
        const gapX = 24;
        const gapY = 24;

        components.forEach((component, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            component.position = {
                x: paddingX + col * (componentSize + gapX),
                y: contentTop + row * (componentSize + gapY),
            };
        });
        return;
    }

    if (level === "high") {
        const intermediateGroups = sortNodesByPosition(
            children.filter((child) => {
                if (nodeLabel(child) !== "blueprint_group") return false;
                const childData = child.data as Record<string, unknown>;
                return childData.blueprintGroupLevel === "intermediate";
            }),
        );
        if (intermediateGroups.length === 0) return;

        const columns = getIntermediateColumns(intermediateGroups.length);
        const rows = Math.max(1, Math.ceil(intermediateGroups.length / columns));
        const columnWidths = new Array<number>(columns).fill(0);
        const rowHeights = new Array<number>(rows).fill(0);

        for (let index = 0; index < intermediateGroups.length; index++) {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const size = nodeSize(intermediateGroups[index]);
            columnWidths[col] = Math.max(columnWidths[col], size.width);
            rowHeights[row] = Math.max(rowHeights[row], size.height);
        }

        const columnOffsets = new Array<number>(columns).fill(0);
        const rowOffsets = new Array<number>(rows).fill(0);
        const gapX = 28;
        const gapY = 28;
        for (let index = 1; index < columns; index++) {
            columnOffsets[index] = columnOffsets[index - 1] + columnWidths[index - 1] + gapX;
        }
        for (let index = 1; index < rows; index++) {
            rowOffsets[index] = rowOffsets[index - 1] + rowHeights[index - 1] + gapY;
        }

        const contentTop = 46;
        const paddingX = 22;

        intermediateGroups.forEach((intermediateGroup, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            intermediateGroup.position = {
                x: paddingX + columnOffsets[col],
                y: contentTop + rowOffsets[row],
            };
        });
        return;
    }

    if (level === "paper") {
        const highGroups = sortNodesByPosition(
            children.filter((child) => {
                if (nodeLabel(child) !== "blueprint_group") return false;
                const childData = child.data as Record<string, unknown>;
                return childData.blueprintGroupLevel === "high";
            }),
        );
        if (highGroups.length === 0) return;

        const contentTop = 54;
        const paddingX = 28;
        const gapX = 120;
        let cursorX = paddingX;

        highGroups.forEach((highGroup) => {
            highGroup.position = { x: cursorX, y: contentTop };
            cursorX += nodeSize(highGroup).width + gapX;
        });
    }
}

function resizeSystemBlueprintGroups(nodes: nodeType[]): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map<string, nodeType[]>();

    for (const node of nodes) {
        if (!node.parentId) continue;
        if (!childrenByParent.has(node.parentId)) {
            childrenByParent.set(node.parentId, []);
        }
        childrenByParent.get(node.parentId)?.push(node);
    }

    const depthCache = new Map<string, number>();
    const depthOf = (id: string): number => {
        const cached = depthCache.get(id);
        if (cached !== undefined) return cached;
        const node = byId.get(id);
        if (!node || !node.parentId) {
            depthCache.set(id, 0);
            return 0;
        }
        const depth = 1 + depthOf(node.parentId);
        depthCache.set(id, depth);
        return depth;
    };

    const groups = nodes
        .filter((node) => {
            if (nodeLabel(node) !== "blueprint_group") return false;
            const data = node.data as Record<string, unknown>;
            return typeof data.blueprintFileName === "string" && data.blueprintFileName.trim() !== "";
        })
        .sort((a, b) => depthOf(b.id) - depthOf(a.id));

    for (const group of groups) {
        const data = group.data as Record<string, unknown>;
        const config = blueprintGroupConfig(data.blueprintGroupLevel);
        const children = childrenByParent.get(group.id) ?? [];
        compactBlueprintChildren(group, children);

        let maxRight = 0;
        let maxBottom = 0;
        for (const child of children) {
            const childWidth = nodeSize(child).width;
            const childHeight = nodeSize(child).height;
            maxRight = Math.max(maxRight, child.position.x + childWidth);
            maxBottom = Math.max(maxBottom, child.position.y + childHeight);
        }

        const nextWidth = Math.max(config.minWidth, Math.ceil(maxRight + config.paddingRight));
        const nextHeight = Math.max(config.minHeight, Math.ceil(maxBottom + config.paddingBottom));
        const currentWidth = asNumber((group.style as Record<string, unknown> | undefined)?.width, config.minWidth);
        const currentHeight = asNumber((group.style as Record<string, unknown> | undefined)?.height, config.minHeight);

        if (currentWidth === nextWidth && currentHeight === nextHeight) continue;

        group.style = {
            ...(group.style ?? {}),
            width: nextWidth,
            height: nextHeight,
        };
    }
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
        addNode: (state, action: PayloadAction<nodeType>) => {
            state.nodes.push(action.payload);
        },
        addNodes: (state, action) => {
            state.nodes = state.nodes.concat(action.payload);
        },
        updateNode: (state, action: PayloadAction<nodeType>) => {
            const index = state.nodes.findIndex(n => n.id === action.payload.id);
            if (index !== -1) state.nodes[index] = { ...state.nodes[index], ...action.payload };
        },
        removeNode: (state, action) => {
            state.nodes = state.nodes.filter(n => n.id !== action.payload);
            state.edges = state.edges.filter(e => e.source !== action.payload && e.target !== action.payload);
            resizeSystemBlueprintGroups(state.nodes);
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
            const hasRemoval = Array.isArray(action.payload)
                ? action.payload.some((change: { type?: string }) => change.type === "remove")
                : false;
            if (hasRemoval) {
                resizeSystemBlueprintGroups(state.nodes);
            }
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
        detachFileIdFromAllNodes: (state, action: PayloadAction<string>) => {
            const fileId = action.payload;
            for (const node of state.nodes) {
                if (!Array.isArray(node.data?.attachmentIds)) continue;
                node.data.attachmentIds = node.data.attachmentIds.filter((id) => id !== fileId);
            }
        },
        attachCodebaseFilePathToNode: (
            state,
            action: PayloadAction<{ nodeId: string; filePath: string }>
        ) => {
            const { nodeId, filePath } = action.payload;
            const node = state.nodes.find((n) => n.id === nodeId);
            if (!node || !filePath) return;

            const normalizedPath = normalizeCodebasePath(filePath);
            if (!normalizedPath) return;

            const paths = ensureCodebaseFilePathArray(node);
            if (!paths.includes(normalizedPath)) {
                paths.push(normalizedPath);
            }
        },
        detachCodebaseFilePathFromNode: (
            state,
            action: PayloadAction<{ nodeId: string; filePath: string }>
        ) => {
            const { nodeId, filePath } = action.payload;
            const node = state.nodes.find((n) => n.id === nodeId);
            if (!node || !filePath) return;

            const normalizedPath = normalizeCodebasePath(filePath);
            if (!normalizedPath) return;

            const paths = ensureCodebaseFilePathArray(node);
            (node.data as Record<string, unknown>).codebaseFilePaths = paths.filter(
                (path) => normalizeCodebasePath(path) !== normalizedPath
            );
        },
        renameNodeTitle: (
            state,
            action: PayloadAction<{ nodeId: string; title: string }>
        ) => {
            const { nodeId, title } = action.payload;
            const node = state.nodes.find((n) => n.id === nodeId);
            if (!node) return;

            const nextTitle = title.trim() || "Blueprint component";
            (node.data as Record<string, unknown>).title = nextTitle;

            const blueprintComponent = (node.data as Record<string, unknown>).blueprintComponent;
            if (blueprintComponent && typeof blueprintComponent === "object") {
                (blueprintComponent as Record<string, unknown>).name = nextTitle;
            }
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
    detachFileIdFromNode,
    detachFileIdFromAllNodes,
    attachCodebaseFilePathToNode,
    detachCodebaseFilePathFromNode,
    renameNodeTitle,
} = flowSlice.actions;

export default flowSlice.reducer;

export const selectFlow = (state: RootState) => state.flow;
export const selectNodes = createSelector(selectFlow, (flow) => flow.nodes);
export const selectFilesById = (state: RootState) =>
  (state.files.byId ?? EMPTY_BY_ID) as Record<string, fileRecord>;

const selectAttachmentIdsForNode = (state: RootState, nodeId: string) => {
  const node = selectNodes(state).find(n => n.id === nodeId);
  return node?.data?.attachmentIds ?? EMPTY_IDS;
};

export const makeSelectFilesForNode = (nodeId: string) =>
  createSelector(
    [ (state) => selectAttachmentIdsForNode(state, nodeId), selectFilesById ],
    (ids, filesById) => ids.map(id => filesById[id]).filter(Boolean)
  );
