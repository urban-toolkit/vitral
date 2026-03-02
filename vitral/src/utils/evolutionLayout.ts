import type { edgeType, nodeType } from "@/config/types";

type TimestampInfo = {
    value: number | null;
    key: string;
};

function parseNodeTimestamp(node: nodeType): TimestampInfo {
    const raw = node.data?.createdAt;
    if (!raw) return { value: null, key: "missing" };

    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return { value: null, key: "missing" };

    return { value: parsed, key: `ts:${parsed}` };
}

function buildComponents(nodes: nodeType[], edges: edgeType[]): string[][] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();

    for (const node of nodes) {
        adjacency.set(node.id, new Set());
    }

    for (const edge of edges) {
        if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
        adjacency.get(edge.source)?.add(edge.target);
        adjacency.get(edge.target)?.add(edge.source);
    }

    const visited = new Set<string>();
    const components: string[][] = [];

    for (const node of nodes) {
        if (visited.has(node.id)) continue;

        const stack = [node.id];
        const current: string[] = [];
        visited.add(node.id);

        while (stack.length > 0) {
            const id = stack.pop()!;
            current.push(id);

            for (const next of adjacency.get(id) ?? []) {
                if (visited.has(next)) continue;
                visited.add(next);
                stack.push(next);
            }
        }

        components.push(current);
    }

    return components;
}

function buildDirectedGraph(componentIds: string[], edges: edgeType[]) {
    const idSet = new Set(componentIds);
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();

    for (const id of componentIds) {
        outgoing.set(id, new Set());
        incoming.set(id, new Set());
    }

    for (const edge of edges) {
        if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
        outgoing.get(edge.source)?.add(edge.target);
        incoming.get(edge.target)?.add(edge.source);
    }

    return { outgoing, incoming };
}

function computeTreeDepths(
    componentIds: string[],
    nodeById: Map<string, nodeType>,
    edges: edgeType[]
): Map<string, number> {
    const { outgoing, incoming } = buildDirectedGraph(componentIds, edges);
    const depths = new Map<string, number>();

    const activityRoots = componentIds
        .filter((id) => String(nodeById.get(id)?.data?.label ?? "").toLowerCase() === "activity")
        .sort((a, b) => a.localeCompare(b));

    let roots = activityRoots;
    if (roots.length === 0) {
        roots = componentIds.filter((id) => (incoming.get(id)?.size ?? 0) === 0);
    }
    if (roots.length === 0 && componentIds.length > 0) {
        roots = [componentIds[0]];
    }

    const queue: string[] = [];
    for (const root of roots) {
        if (depths.has(root)) continue;
        depths.set(root, 0);
        queue.push(root);
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        const currentDepth = depths.get(current) ?? 0;

        for (const next of outgoing.get(current) ?? []) {
            const candidate = currentDepth + 1;
            const previous = depths.get(next);
            if (previous == null || candidate < previous) {
                depths.set(next, candidate);
                queue.push(next);
            }
        }
    }

    let maxDepth = Math.max(0, ...Array.from(depths.values()));
    const unresolved = componentIds
        .filter((id) => !depths.has(id))
        .sort((a, b) => {
            const ax = nodeById.get(a)?.position.x ?? 0;
            const bx = nodeById.get(b)?.position.x ?? 0;
            if (ax !== bx) return ax - bx;
            return a.localeCompare(b);
        });

    for (const id of unresolved) {
        let candidate = Number.POSITIVE_INFINITY;

        for (const parent of incoming.get(id) ?? []) {
            const parentDepth = depths.get(parent);
            if (parentDepth != null) {
                candidate = Math.min(candidate, parentDepth + 1);
            }
        }
        for (const child of outgoing.get(id) ?? []) {
            const childDepth = depths.get(child);
            if (childDepth != null) {
                candidate = Math.min(candidate, Math.max(0, childDepth - 1));
            }
        }

        if (!Number.isFinite(candidate)) {
            candidate = maxDepth + 1;
        }

        depths.set(id, candidate);
        maxDepth = Math.max(maxDepth, candidate);
    }

    return depths;
}

export function buildEvolutionLayoutNodes(nodes: nodeType[], edges: edgeType[]): nodeType[] {
    if (nodes.length === 0) return nodes;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const components = buildComponents(nodes, edges);

    const timestampById = new Map<string, TimestampInfo>();
    for (const node of nodes) {
        timestampById.set(node.id, parseNodeTimestamp(node));
    }

    const allTimes = Array.from(new Set(
        nodes
            .map((node) => timestampById.get(node.id)?.value)
            .filter((v): v is number => typeof v === "number")
    )).sort((a, b) => a - b);

    const timeRank = new Map<number, number>();
    allTimes.forEach((time, index) => timeRank.set(time, index));

    const minOriginalX = Math.min(...nodes.map((n) => n.position.x));
    const maxOriginalX = Math.max(...nodes.map((n) => n.position.x));
    const originalXRange = Math.max(1, maxOriginalX - minOriginalX);

    const componentMeta = components.map((component) => {
        let earliest = Number.POSITIVE_INFINITY;
        for (const id of component) {
            const ts = timestampById.get(id)?.value;
            if (typeof ts === "number" && ts < earliest) earliest = ts;
        }
        return { ids: component, earliest };
    });

    componentMeta.sort((a, b) => {
        if (a.earliest !== b.earliest) return a.earliest - b.earliest;
        return a.ids[0].localeCompare(b.ids[0]);
    });

    const BASE_X = 260;
    const X_STEP = 700;
    const LANE_Y_START = 120;
    const LANE_HEIGHT = 260;
    const SAME_TIME_Y_STEP = 300;
    const DEPTH_X_STEP = 170;
    const ROOT_LEFT_MARGIN = 400;

    const positioned = new Map<string, { x: number; y: number }>();

    componentMeta.forEach((component, laneIndex) => {
        const laneCenterY = LANE_Y_START + laneIndex * LANE_HEIGHT;
        const depthById = computeTreeDepths(component.ids, nodeById, edges);
        const grouped = new Map<string, string[]>();

        const sortedIds = [...component.ids].sort((a, b) => {
            const ta = timestampById.get(a)?.value ?? Number.POSITIVE_INFINITY;
            const tb = timestampById.get(b)?.value ?? Number.POSITIVE_INFINITY;
            if (ta !== tb) return ta - tb;
            return a.localeCompare(b);
        });

        for (const id of sortedIds) {
            const key = timestampById.get(id)?.key ?? "missing";
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(id);
        }

        const localPositions = new Map<string, { x: number; y: number }>();

        for (const ids of grouped.values()) {
            ids.forEach((id, index) => {
                const node = nodeById.get(id)!;
                const ts = timestampById.get(id)?.value;
                const depth = depthById.get(id) ?? 0;
                const isActivity = String(node.data?.label ?? "").toLowerCase() === "activity";

                let x: number;
                if (typeof ts === "number") {
                    x = BASE_X + (timeRank.get(ts) ?? 0) * X_STEP + depth * DEPTH_X_STEP;
                } else {
                    const normalized = (node.position.x - minOriginalX) / originalXRange;
                    x = BASE_X + (allTimes.length + 1) * X_STEP + normalized * X_STEP * 2 + depth * DEPTH_X_STEP;
                }

                if (isActivity) {
                    x -= ROOT_LEFT_MARGIN;
                }

                const offset = (index - (ids.length - 1) / 2) * SAME_TIME_Y_STEP;
                const y = laneCenterY + offset;

                localPositions.set(id, { x, y });
            });
        }

        const activityIds = component.ids.filter((id) =>
            String(nodeById.get(id)?.data?.label ?? "").toLowerCase() === "activity"
        );
        if (activityIds.length > 0) {
            const minActivityX = Math.min(...activityIds.map((id) => localPositions.get(id)?.x ?? Number.POSITIVE_INFINITY));
            const minAnyX = Math.min(...component.ids.map((id) => localPositions.get(id)?.x ?? Number.POSITIVE_INFINITY));

            if (Number.isFinite(minActivityX) && Number.isFinite(minAnyX) && minAnyX < minActivityX) {
                const shiftRight = (minActivityX - minAnyX) + ROOT_LEFT_MARGIN;
                for (const id of component.ids) {
                    if (activityIds.includes(id)) continue;
                    const existing = localPositions.get(id);
                    if (!existing) continue;
                    localPositions.set(id, { ...existing, x: existing.x + shiftRight });
                }
            }
        }

        for (const [id, pos] of localPositions.entries()) {
            positioned.set(id, pos);
        }
    });

    return nodes.map((node) => {
        const next = positioned.get(node.id);
        if (!next) return node;

        return {
            ...node,
            position: next
        };
    });
}
