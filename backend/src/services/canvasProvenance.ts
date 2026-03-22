type RecordValue = Record<string, unknown>;

export type ProvenanceConnectionKind = "regular" | "referenced_by" | "iteration_of";
export type ProvenanceCardLabel =
    | "person"
    | "activity"
    | "requirement"
    | "concept"
    | "insight"
    | "object";

export type ProvenanceCard = {
    nodeId: string;
    label: ProvenanceCardLabel;
    title: string;
    description: string;
    relevant: boolean;
    createdAt: string;
};

export type ProvenanceComponent = {
    nodeId: string;
    title: string;
};

export type ProvenanceConnection = {
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourceLabel: string;
    targetLabel: string;
    sourceTitle: string;
    targetTitle: string;
    label: string;
    kind: ProvenanceConnectionKind;
};

export type ProvenanceSnapshot = {
    cards: Map<string, ProvenanceCard>;
    components: Map<string, ProvenanceComponent>;
    connections: Map<string, ProvenanceConnection>;
    treeByCardId: Map<string, string | null>;
    treeTitleByActivityId: Map<string, string>;
};

export type ProvenanceDiff = {
    cardCreated: ProvenanceCard[];
    cardUpdated: Array<{ previous: ProvenanceCard; current: ProvenanceCard }>;
    cardDeleted: ProvenanceCard[];
    cardTreeChanged: Array<{
        card: ProvenanceCard;
        previousTreeId: string | null;
        nextTreeId: string | null;
    }>;
    connectionCreated: ProvenanceConnection[];
    connectionUpdated: Array<{ previous: ProvenanceConnection; current: ProvenanceConnection }>;
    connectionDeleted: ProvenanceConnection[];
};

const CARD_LABELS = new Set<ProvenanceCardLabel>([
    "person",
    "activity",
    "requirement",
    "concept",
    "insight",
    "object",
]);

function isRecord(value: unknown): value is RecordValue {
    return typeof value === "object" && value !== null;
}

function normalizeLabel(raw: unknown): string {
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (value === "task") return "requirement";
    return value;
}

function toCardLabel(raw: unknown): ProvenanceCardLabel | null {
    const normalized = normalizeLabel(raw);
    if (!CARD_LABELS.has(normalized as ProvenanceCardLabel)) return null;
    return normalized as ProvenanceCardLabel;
}

function stringValue(raw: unknown): string {
    return typeof raw === "string" ? raw : "";
}

function normalizeIsoTimestamp(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim() === "") return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString();
}

function isSoftDeleted(data: RecordValue): boolean {
    const deletedAt = data.deletedAt;
    if (typeof deletedAt !== "string") return false;
    return deletedAt.trim() !== "";
}

function connectionKindFrom(label: string, kind: string): ProvenanceConnectionKind {
    const normalizedKind = kind.trim().toLowerCase();
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedKind === "referenced_by" || normalizedLabel === "referenced by") return "referenced_by";
    if (normalizedKind === "iteration_of" || normalizedLabel === "iteration of") return "iteration_of";
    return "regular";
}

function cardComparablePayload(card: ProvenanceCard): string {
    return JSON.stringify({
        label: card.label,
        title: card.title,
        description: card.description,
        relevant: card.relevant,
    });
}

function connectionComparablePayload(connection: ProvenanceConnection): string {
    return JSON.stringify({
        sourceNodeId: connection.sourceNodeId,
        targetNodeId: connection.targetNodeId,
        label: connection.label,
        kind: connection.kind,
        sourceLabel: connection.sourceLabel,
        targetLabel: connection.targetLabel,
    });
}

function resolveTreeMap(
    cards: Map<string, ProvenanceCard>,
    connections: Map<string, ProvenanceConnection>,
): {
    treeByCardId: Map<string, string | null>;
    treeTitleByActivityId: Map<string, string>;
} {
    const treeByCardId = new Map<string, string | null>();
    const treeTitleByActivityId = new Map<string, string>();
    const nonActivityToActivities = new Map<string, string[]>();

    for (const card of cards.values()) {
        if (card.label === "activity") {
            treeByCardId.set(card.nodeId, card.nodeId);
            treeTitleByActivityId.set(card.nodeId, card.title || "Activity");
        } else {
            treeByCardId.set(card.nodeId, null);
        }
    }

    const pushActivityNeighbor = (cardId: string, activityId: string) => {
        const entries = nonActivityToActivities.get(cardId) ?? [];
        if (!entries.includes(activityId)) entries.push(activityId);
        nonActivityToActivities.set(cardId, entries);
    };

    for (const connection of connections.values()) {
        if (connection.kind !== "regular") continue;
        const sourceCard = cards.get(connection.sourceNodeId);
        const targetCard = cards.get(connection.targetNodeId);
        if (!sourceCard || !targetCard) continue;

        if (sourceCard.label === "activity" && targetCard.label !== "activity") {
            pushActivityNeighbor(targetCard.nodeId, sourceCard.nodeId);
            continue;
        }
        if (targetCard.label === "activity" && sourceCard.label !== "activity") {
            pushActivityNeighbor(sourceCard.nodeId, targetCard.nodeId);
        }
    }

    for (const [cardId, activityIds] of nonActivityToActivities.entries()) {
        const sorted = [...activityIds].sort((a, b) => a.localeCompare(b));
        treeByCardId.set(cardId, sorted[0] ?? null);
    }

    return { treeByCardId, treeTitleByActivityId };
}

export function extractProvenanceSnapshot(state: unknown): ProvenanceSnapshot {
    const cards = new Map<string, ProvenanceCard>();
    const components = new Map<string, ProvenanceComponent>();
    const connections = new Map<string, ProvenanceConnection>();

    if (!isRecord(state)) {
        return {
            cards,
            components,
            connections,
            treeByCardId: new Map<string, string | null>(),
            treeTitleByActivityId: new Map<string, string>(),
        };
    }

    const flow = isRecord(state.flow) ? state.flow : null;
    const rawNodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const rawEdges = Array.isArray(flow?.edges) ? flow.edges : [];

    const nodeIndex = new Map<string, { label: string; title: string }>();

    for (const rawNode of rawNodes) {
        if (!isRecord(rawNode)) continue;
        const nodeId = stringValue(rawNode.id).trim();
        if (!nodeId) continue;
        const data = isRecord(rawNode.data) ? rawNode.data : {};
        if (isSoftDeleted(data)) continue;
        const label = normalizeLabel(data.label);
        const title = stringValue(data.title).trim();
        nodeIndex.set(nodeId, { label, title });

        const cardLabel = toCardLabel(label);
        if (cardLabel) {
            cards.set(nodeId, {
                nodeId,
                label: cardLabel,
                title,
                description: stringValue(data.description).trim(),
                relevant: data.relevant !== false,
                createdAt: normalizeIsoTimestamp(data.createdAt),
            });
            continue;
        }

        if (label === "blueprint_component") {
            components.set(nodeId, {
                nodeId,
                title: title || "Blueprint component",
            });
        }
    }

    for (const rawEdge of rawEdges) {
        if (!isRecord(rawEdge)) continue;
        const edgeId = stringValue(rawEdge.id).trim();
        const sourceNodeId = stringValue(rawEdge.source).trim();
        const targetNodeId = stringValue(rawEdge.target).trim();
        if (!edgeId || !sourceNodeId || !targetNodeId) continue;

        const data = isRecord(rawEdge.data) ? rawEdge.data : {};
        if (isSoftDeleted(data)) continue;
        const rawLabel = stringValue(rawEdge.label).trim() || stringValue(data.label).trim();
        const rawKind = stringValue(data.kind);
        const sourceInfo = nodeIndex.get(sourceNodeId);
        const targetInfo = nodeIndex.get(targetNodeId);
        if (!sourceInfo || !targetInfo) continue;

        const sourceIsKnown = cards.has(sourceNodeId) || components.has(sourceNodeId);
        const targetIsKnown = cards.has(targetNodeId) || components.has(targetNodeId);
        if (!sourceIsKnown || !targetIsKnown) continue;

        connections.set(edgeId, {
            edgeId,
            sourceNodeId,
            targetNodeId,
            sourceLabel: sourceInfo.label,
            targetLabel: targetInfo.label,
            sourceTitle: sourceInfo.title,
            targetTitle: targetInfo.title,
            label: rawLabel,
            kind: connectionKindFrom(rawLabel, rawKind),
        });
    }

    const { treeByCardId, treeTitleByActivityId } = resolveTreeMap(cards, connections);

    return {
        cards,
        components,
        connections,
        treeByCardId,
        treeTitleByActivityId,
    };
}

export function diffProvenanceSnapshots(
    previous: ProvenanceSnapshot,
    current: ProvenanceSnapshot,
): ProvenanceDiff {
    const cardCreated: ProvenanceCard[] = [];
    const cardUpdated: Array<{ previous: ProvenanceCard; current: ProvenanceCard }> = [];
    const cardDeleted: ProvenanceCard[] = [];
    const cardTreeChanged: Array<{
        card: ProvenanceCard;
        previousTreeId: string | null;
        nextTreeId: string | null;
    }> = [];
    const connectionCreated: ProvenanceConnection[] = [];
    const connectionUpdated: Array<{ previous: ProvenanceConnection; current: ProvenanceConnection }> = [];
    const connectionDeleted: ProvenanceConnection[] = [];

    for (const [nodeId, currentCard] of current.cards.entries()) {
        const previousCard = previous.cards.get(nodeId);
        if (!previousCard) {
            cardCreated.push(currentCard);
            continue;
        }

        if (cardComparablePayload(previousCard) !== cardComparablePayload(currentCard)) {
            cardUpdated.push({ previous: previousCard, current: currentCard });
        }

        const previousTreeId = previous.treeByCardId.get(nodeId) ?? null;
        const nextTreeId = current.treeByCardId.get(nodeId) ?? null;
        if (previousTreeId !== nextTreeId) {
            cardTreeChanged.push({ card: currentCard, previousTreeId, nextTreeId });
        }
    }

    for (const [nodeId, previousCard] of previous.cards.entries()) {
        if (!current.cards.has(nodeId)) {
            cardDeleted.push(previousCard);
        }
    }

    for (const [edgeId, currentConnection] of current.connections.entries()) {
        const previousConnection = previous.connections.get(edgeId);
        if (!previousConnection) {
            connectionCreated.push(currentConnection);
            continue;
        }
        if (connectionComparablePayload(previousConnection) !== connectionComparablePayload(currentConnection)) {
            connectionUpdated.push({ previous: previousConnection, current: currentConnection });
        }
    }

    for (const [edgeId, previousConnection] of previous.connections.entries()) {
        if (!current.connections.has(edgeId)) {
            connectionDeleted.push(previousConnection);
        }
    }

    return {
        cardCreated,
        cardUpdated,
        cardDeleted,
        cardTreeChanged,
        connectionCreated,
        connectionUpdated,
        connectionDeleted,
    };
}

export function resolveTreeForCard(
    snapshot: ProvenanceSnapshot,
    cardId: string,
): { treeId: string | null; treeTitle: string | null } {
    const treeId = snapshot.treeByCardId.get(cardId) ?? null;
    if (!treeId) return { treeId: null, treeTitle: null };
    return {
        treeId,
        treeTitle: snapshot.treeTitleByActivityId.get(treeId) ?? null,
    };
}
