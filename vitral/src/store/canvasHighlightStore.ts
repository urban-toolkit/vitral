/**
 * Presentational highlight for canvas nodes, kept out of React state and out of the node objects on
 * purpose.
 *
 * Highlight is a property of *how a card is drawn*, not of the graph, so it must not travel through
 * `flow.nodes`. It used to: `filteredNodes` cloned nodes to inject `node.style`, which invalidated
 * every memo below it — salience, clustering, abstraction, the orbit layout — and, because React
 * Flow keeps a node's internals only while `userNode` is identical, also rebuilt those internals and
 * re-rendered every edge touching the node. All of that for a mouse entering and leaving a timeline
 * pill.
 *
 * Consumers subscribe with `useSyncExternalStore` and select a *boolean*, so a hover re-renders
 * exactly the nodes whose boolean flipped rather than all forty. Every setter compares before it
 * commits, which is what makes the second `setHighlightedKnowledgeNodeIds([])` of a hover-out a
 * genuine no-op — something the Redux reducer cannot be, since it allocates a fresh array each time.
 */
type HighlightState = {
    knowledgeNodeIds: ReadonlySet<string>;
    hoveredAssetFileId: string | null;
    emphasizedBlueprintComponentIds: ReadonlySet<string>;
};

const EMPTY: ReadonlySet<string> = new Set<string>();

let state: HighlightState = {
    knowledgeNodeIds: EMPTY,
    hoveredAssetFileId: null,
    emphasizedBlueprintComponentIds: EMPTY,
};

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function commit(next: HighlightState) {
    state = next;
    for (const listener of listeners) listener();
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const value of a) {
        if (!b.has(value)) return false;
    }
    return true;
}

export function setHighlightedKnowledgeNodeIds(ids: readonly string[]) {
    const next = new Set(ids);
    if (sameMembers(next, state.knowledgeNodeIds)) return;
    commit({ ...state, knowledgeNodeIds: next });
}

export function setHoveredAssetFileId(fileId: string | null) {
    if (fileId === state.hoveredAssetFileId) return;
    commit({ ...state, hoveredAssetFileId: fileId });
}

/**
 * Which blueprint components are wired to a requirement. Structural rather than hover-driven, but it
 * reaches the nodes the same way — as a class, not as an injected `opacity` — because writing it into
 * `node.style` would put it back in the layout's path: `nodeSizeOf` reads `node.style` too.
 */
export function setEmphasizedBlueprintComponentIds(ids: ReadonlySet<string>) {
    if (sameMembers(ids, state.emphasizedBlueprintComponentIds)) return;
    commit({ ...state, emphasizedBlueprintComponentIds: ids });
}

export function isKnowledgeHighlighted(nodeId: string | undefined): boolean {
    if (!nodeId) return false;
    return state.knowledgeNodeIds.has(nodeId);
}

export function isAssetHighlighted(attachmentIds: readonly unknown[] | undefined): boolean {
    const hovered = state.hoveredAssetFileId;
    if (!hovered || !Array.isArray(attachmentIds)) return false;
    return attachmentIds.includes(hovered);
}

export function isBlueprintComponentEmphasized(nodeId: string | undefined): boolean {
    if (!nodeId) return false;
    return state.emphasizedBlueprintComponentIds.has(nodeId);
}

/** For imperative reads outside a render — deleting the asset that happens to be hovered. */
export function getHoveredAssetFileId(): string | null {
    return state.hoveredAssetFileId;
}
