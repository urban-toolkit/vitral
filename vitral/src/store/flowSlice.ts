import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { nodeType, edgeType, fileRecord } from '@/config/types';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { RootState } from "@/store/rootReducer";

const EMPTY_IDS: string[] = [];
const EMPTY_BY_ID: Record<string, fileRecord> = {};
const NODE_HISTORY_KEY = "__history";
const NODE_EDIT_AT_KEY = "__editAt";
const DEFAULT_HISTORY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

type NodeHistoryEntry = {
    at: string;
    kind: "data" | "position";
    data?: Record<string, unknown>;
    position?: { x: number; y: number };
};

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

function edgeDataRecord(edge: edgeType): Record<string, unknown> {
    return edge.data && typeof edge.data === "object"
        ? edge.data as Record<string, unknown>
        : {};
}

function edgeString(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function edgeLabel(edge: edgeType): string {
    const data = edgeDataRecord(edge);
    return edgeString(edge.label) || edgeString(data.label);
}

function edgeDedupKey(edge: edgeType): string {
    const data = edgeDataRecord(edge);
    const source = edgeString(edge.source);
    const target = edgeString(edge.target);
    const label = edgeLabel(edge);
    const kind = edgeString(data.kind);
    const from = edgeString(data.from);
    const to = edgeString(data.to);
    const deleted = typeof data.deletedAt === "string" && data.deletedAt.trim() !== ""
        ? "deleted"
        : "active";
    return `${source}|${target}|${label}|${kind}|${from}|${to}|${deleted}`;
}

function dedupeEdges(edges: edgeType[]): edgeType[] {
    const seen = new Set<string>();
    const result: edgeType[] = [];
    for (const edge of edges) {
        const key = edgeDedupKey(edge);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(edge);
    }
    return result;
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toISOString();
}

function nodeDataRecord(node: nodeType): Record<string, unknown> {
    return isObjectRecord(node.data) ? { ...node.data } : {};
}

function stripNodeMeta(data: Record<string, unknown>): Record<string, unknown> {
    const cloned = { ...data };
    delete cloned[NODE_HISTORY_KEY];
    delete cloned[NODE_EDIT_AT_KEY];
    return cloned;
}

function readNodeHistory(data: Record<string, unknown>): NodeHistoryEntry[] {
    const raw = data[NODE_HISTORY_KEY];
    if (!Array.isArray(raw)) return [];

    return raw
        .map((item) => {
            if (!isObjectRecord(item)) return null;
            const kind = item.kind === "position" ? "position" : item.kind === "data" ? "data" : null;
            if (!kind) return null;
            const at = normalizeIsoTimestamp(item.at, "");
            if (!at) return null;

            const entry: NodeHistoryEntry = { at, kind };
            if (kind === "data" && isObjectRecord(item.data)) {
                entry.data = { ...item.data };
            }
            if (kind === "position" && isObjectRecord(item.position)) {
                const x = Number(item.position.x);
                const y = Number(item.position.y);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    entry.position = { x, y };
                }
            }
            return entry;
        })
        .filter((entry): entry is NodeHistoryEntry => entry !== null);
}

function writeNodeHistory(data: Record<string, unknown>, history: NodeHistoryEntry[]): Record<string, unknown> {
    return {
        ...data,
        [NODE_HISTORY_KEY]: history,
    };
}

function appendNodeDataSnapshot(
    history: NodeHistoryEntry[],
    at: string,
    snapshot: Record<string, unknown>,
): NodeHistoryEntry[] {
    return [
        ...history,
        {
            at,
            kind: "data",
            data: { ...snapshot },
        },
    ];
}

function appendNodePositionSnapshot(
    history: NodeHistoryEntry[],
    at: string,
    position: { x: number; y: number },
): NodeHistoryEntry[] {
    return [
        ...history,
        {
            at,
            kind: "position",
            position: { x: position.x, y: position.y },
        },
    ];
}

function ensureNodeHistory(node: nodeType): nodeType {
    const data = nodeDataRecord(node);
    const createdAt = normalizeIsoTimestamp(data.createdAt, DEFAULT_HISTORY_TIMESTAMP);
    const snapshotData = stripNodeMeta(data);
    const history = readNodeHistory(data);

    if (history.length > 0) {
        const nextData = writeNodeHistory({
            ...snapshotData,
            createdAt,
        }, history);

        return {
            ...node,
            data: nextData as nodeType["data"],
        };
    }

    const initialized = appendNodePositionSnapshot(
        appendNodeDataSnapshot([], createdAt, { ...snapshotData, createdAt }),
        createdAt,
        node.position,
    );

    const nextData = writeNodeHistory({
        ...snapshotData,
        createdAt,
    }, initialized);

    return {
        ...node,
        data: nextData as nodeType["data"],
    };
}

function ensureEdgeTimestamps(edge: edgeType): edgeType {
    const data = edgeDataRecord(edge);
    const createdAt = normalizeIsoTimestamp(data.createdAt, DEFAULT_HISTORY_TIMESTAMP);
    const deletedAtRaw = data.deletedAt;
    const deletedAt = typeof deletedAtRaw === "string" && deletedAtRaw.trim() !== ""
        ? normalizeIsoTimestamp(deletedAtRaw, "")
        : "";

    return {
        ...edge,
        data: {
            ...data,
            createdAt,
            ...(deletedAt ? { deletedAt } : {}),
        },
    };
}

const flowSlice = createSlice({
    name: 'flow',
    initialState,
    reducers: {
        setNodes: (state, action) => {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            state.nodes = incoming.map((node) => ensureNodeHistory(node));
        },
        setEdges: (state, action) => {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            state.edges = dedupeEdges(incoming.map((edge) => ensureEdgeTimestamps(edge)));
        },
        addNode: (state, action: PayloadAction<nodeType>) => {
            state.nodes.push(ensureNodeHistory(action.payload));
        },
        addNodes: (state, action) => {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            state.nodes = state.nodes.concat(incoming.map((node) => ensureNodeHistory(node)));
        },
        updateNode: (state, action: PayloadAction<nodeType>) => {
            const index = state.nodes.findIndex((n) => n.id === action.payload.id);
            if (index === -1) return;

            const existing = ensureNodeHistory(state.nodes[index]);
            const existingData = nodeDataRecord(existing);
            const incomingData = isObjectRecord(action.payload.data)
                ? action.payload.data as Record<string, unknown>
                : {};
            const mergedData = {
                ...existingData,
                ...incomingData,
            };
            const nowIso = new Date().toISOString();
            const editAt = normalizeIsoTimestamp(mergedData[NODE_EDIT_AT_KEY], nowIso);
            const previousSnapshot = stripNodeMeta(existingData);
            const nextSnapshot = stripNodeMeta(mergedData);
            const previousPosition = existing.position;
            const nextPosition = action.payload.position ?? existing.position;

            let history = readNodeHistory(mergedData);
            const dataChanged = JSON.stringify(previousSnapshot) !== JSON.stringify(nextSnapshot);
            const positionChanged = previousPosition.x !== nextPosition.x || previousPosition.y !== nextPosition.y;

            if (dataChanged) {
                history = appendNodeDataSnapshot(history, editAt, nextSnapshot);
            }
            if (positionChanged) {
                history = appendNodePositionSnapshot(history, editAt, nextPosition);
            }

            const nextData = writeNodeHistory({
                ...nextSnapshot,
                createdAt: normalizeIsoTimestamp(nextSnapshot.createdAt, DEFAULT_HISTORY_TIMESTAMP),
            }, history);

            state.nodes[index] = {
                ...existing,
                ...action.payload,
                position: nextPosition,
                data: nextData as nodeType["data"],
            };
        },
        removeNode: (state, action) => {
            state.nodes = state.nodes.filter(n => n.id !== action.payload);
            state.edges = state.edges.filter(e => e.source !== action.payload && e.target !== action.payload);
            resizeSystemBlueprintGroups(state.nodes);
        },
        connectEdge: (state, action) => {
            state.edges = dedupeEdges([...state.edges, ensureEdgeTimestamps(action.payload)]);
        },
        connectEdges: (state, action) => {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            state.edges = dedupeEdges(state.edges.concat(incoming.map((edge) => ensureEdgeTimestamps(edge))));
        },
        updateEdge: (state, action: PayloadAction<edgeType>) => {
            const index = state.edges.findIndex((edge) => edge.id === action.payload.id);
            if (index === -1) return;
            const existing = state.edges[index];
            const existingData = edgeDataRecord(existing);
            const incomingData = edgeDataRecord(action.payload);
            state.edges[index] = ensureEdgeTimestamps({
                ...existing,
                ...action.payload,
                data: {
                    ...existingData,
                    ...incomingData,
                },
            });
        },
        removeEdge: (state, action) => {
            state.edges = state.edges.filter(e => e.id !== action.payload);
        },
        onNodesChange: (state, action) => {
            const changes = Array.isArray(action.payload) ? action.payload : [];
            const positionTimestampsByNodeId = new Map<string, string>();
            const nowIso = new Date().toISOString();
            for (const change of changes) {
                if (!isObjectRecord(change)) continue;
                if (change.type !== "position") continue;
                const nodeId = typeof change.id === "string" ? change.id : "";
                if (!nodeId) continue;
                const editAt = normalizeIsoTimestamp(change[NODE_EDIT_AT_KEY], nowIso);
                positionTimestampsByNodeId.set(nodeId, editAt);
            }

            const a = applyNodeChanges(action.payload, state.nodes);
            state.nodes = a;

            if (positionTimestampsByNodeId.size > 0) {
                state.nodes = state.nodes.map((node) => {
                    const at = positionTimestampsByNodeId.get(node.id);
                    if (!at) return node;
                    const enriched = ensureNodeHistory(node);
                    const data = nodeDataRecord(enriched);
                    const history = appendNodePositionSnapshot(readNodeHistory(data), at, enriched.position);
                    const nextData = writeNodeHistory(stripNodeMeta(data), history);
                    return {
                        ...enriched,
                        data: nextData as nodeType["data"],
                    };
                });
            }

            const hasRemoval = Array.isArray(action.payload)
                ? action.payload.some((change: { type?: string }) => change.type === "remove")
                : false;
            if (hasRemoval) {
                resizeSystemBlueprintGroups(state.nodes);
            }
        },
        onEdgesChange: (state, action) => {
            const a = applyEdgeChanges(action.payload, state.edges);
            state.edges = dedupeEdges(a.map((edge) => ensureEdgeTimestamps(edge)));
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
    updateEdge,
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
