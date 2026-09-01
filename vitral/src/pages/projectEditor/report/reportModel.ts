import type { edgeType, nodeType } from "@/config/types";
import {
    ACTIVITY_PROMOTED_MAX,
    PHASE_PROMOTED_PER_LABEL,
    collectParticipants,
    countLabels,
    isPerson,
    pickTop,
} from "@/pages/projectEditor/canvasAbstraction";
import type { ActivityCluster } from "@/pages/projectEditor/canvasClusters";
import { buildSalienceIndex, compareBySalience } from "@/pages/projectEditor/canvasSalience";
import { attachedComponentIds } from "@/pages/projectEditor/blueprintSurfaces";
import {
    connectionKindFromEdge,
    isEdgeActive,
    isNodeActive,
    nodeLabelOf,
    normalizeNodeLabel,
} from "@/pages/projectEditor/graphSemantics";
import { isModelDerivedEdgeData, isModelDerivedNodeData } from "@/utils/edgeProvenance";
import { relationLabelFor } from "@/utils/relationships";
import {
    DEFAULT_HISTORY_TIMESTAMP,
    countNodeDataRevisions,
    firstNodeHistoryAtMs,
    lastNodeHistoryAtMs,
} from "@/pages/projectEditor/nodeHistory";
import { locatorGraphScope, type LocatorIndex } from "@/pages/projectEditor/locators";
import type { ReportSnapshot } from "./reportTypes";

/**
 * The study, resolved into the shape a document wants.
 *
 * The governing rule, and the one thing to keep hold of when changing this file:
 * **abstraction decides emphasis and ordering; it never decides inclusion.** The canvas hides things
 * because it has one zoom and a fixed screen. A document has neither, so every live card appears
 * exactly once in a thread section or under "Unconnected cards", and again in the appendix. What the
 * Focus+Context levels contribute is *which* cards are named first — the same cards Overview and
 * Threads promote, taken from the same `pickTop` so the two cannot drift apart.
 *
 * ## The one thing that does decide inclusion
 *
 * **Relevance.** `data.relevant === false` is not the abstraction hiding something for want of room;
 * it is the researcher saying this material is not part of the study. So a set-aside card is kept out
 * of every content collection below — the threads, the unconnected band, the insight and concept
 * sweeps, the requirements and the components answering them — and out of any relation with an end
 * in one, which would otherwise cite a code the document has no entry for.
 *
 * It is not *erased*, and the distinction matters: `allCards` stays complete so `setAsideCards` can
 * name what was ruled out, because a judgement about the material is itself part of the record. That
 * one section, and the note in "Codes that no longer resolve" that points at it, are the whole of
 * what a set-aside card contributes to the document.
 *
 * `buildAbstractedGraph` is deliberately **not** called. It returns React Flow nodes carrying
 * synthetic `vz:` ids, positions and sizes that mean nothing here, and its `cardCount` /
 * `labelCounts` describe the *folded remainder* — they exclude the promoted cards on purpose, because
 * a glyph must not promise more than expanding it would reveal. A report that used them would
 * undercount every phase. It is used in the test instead, as the oracle this file is checked against.
 *
 * Inputs are the **whole live graph, unfiltered**: no label chips, no chat query, no
 * `blueprintComponentsVisible`. `buildSalienceIndex` normalises its degree terms against whatever set
 * it is handed, so passing the filtered canvas would silently rescale every card's emphasis to
 * whatever the researcher last clicked. The report says this about itself in its Provenance section.
 */

export type ReportAuthorship = "authored" | "model-proposed";

export type ReportCard = {
    nodeId: string;
    code: string | null;
    label: string;
    title: string;
    description: string;
    /** The verbatim source excerpt, when the card was extracted from a document. */
    quotation: string;
    /** The file id this card came from, when it came from one. */
    originFileId: string | null;
    attachmentIds: string[];
    createdAtIso: string | null;
    deletedAtIso: string | null;
    authorship: ReportAuthorship;
    /** False when the researcher marked the card not relevant. */
    relevant: boolean;
    salience: number;
    degree: number;
    crossTreeDegree: number;
    dataRevisions: number;
    firstSeenMs: number | null;
    lastEditedMs: number | null;
};

export type ReportRelationOrigin = "hand-drawn" | "model-derived" | "unknown";

export type ReportRelation = {
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourceCode: string | null;
    targetCode: string | null;
    sourceTitle: string;
    targetTitle: string;
    label: string;
    kind: string;
    origin: ReportRelationOrigin;
    /** Present on similarity-derived edges: the evidence that carried the decision. */
    similarity: number | null;
    similarityMargin: number | null;
    createdAtIso: string | null;
    deletedAtIso: string | null;
};

export type ReportThread = {
    activityNodeId: string;
    code: string | null;
    title: string;
    /**
     * False when the researcher marked the **activity itself** not relevant.
     *
     * The thread is still rendered, and this is the one place the relevance rule bends. An activity is
     * not content in the way a card is: it is the structure the document is organised by, and its
     * satellites are cards in their own right that were not set aside. Dropping the section would take
     * them with it, which is the one thing the report may not do. So the section stays, says so in a
     * line of its own, and the appendix does not claim the code is unanchored — see the note where
     * "Codes that no longer resolve" is emitted.
     */
    relevant: boolean;
    createdAtIso: string | null;
    participants: string[];
    /** The cards Threads promotes — what this activity is organised around. */
    headline: ReportCard[];
    /** Every card in the thread, most central first. Includes the headline. */
    cards: ReportCard[];
    /**
     * Relations with both ends inside this thread.
     *
     * Computed but no longer printed: the markdown dropped its "Relations inside this thread" line,
     * because every card in a thread is already in the table above it and the edges between them are
     * what put them there. Kept on the model because it is a true fact about a thread and the tray,
     * the tests and any future section can ask for it.
     */
    internalRelations: ReportRelation[];
    /** Relations reaching another thread, as one row per partner thread. */
    outboundRelations: ReportRelation[];
    setAside: ReportCard[];
};

export type ReportPhase = {
    clusterId: string;
    anchorActivityNodeId: string;
    code: string | null;
    anchorCode: string | null;
    label: string;
    labelSource: ActivityCluster["labelSource"];
    startIso: string | null;
    endIso: string | null;
    composition: Array<{ label: string; count: number }>;
    participants: string[];
    cardCount: number;
    /** The cards Overview promotes: two requirements and two concepts, by salience. */
    headline: ReportCard[];
    threads: ReportThread[];
};

export type ReportRequirementAnswer = {
    requirement: ReportCard;
    components: Array<{
        card: ReportCard;
        paperTitle: string | null;
        referenceCitation: string | null;
        attachedAtIso: string | null;
    }>;
};

export type ReportModel = {
    snapshot: ReportSnapshot;
    codes: LocatorIndex;
    phases: ReportPhase[];
    /** Threads belonging to no phase — only possible when clustering found nothing to cut. */
    looseThreads: ReportThread[];
    unassignedCards: ReportCard[];
    cardsById: Map<string, ReportCard>;
    allCards: ReportCard[];
    relations: ReportRelation[];
    crossPhaseRelations: ReportRelation[];
    requirementAnswers: ReportRequirementAnswer[];
    unansweredRequirements: ReportCard[];
    insights: ReportCard[];
    concepts: ReportCard[];
    participants: Array<{ name: string; role: string }>;
    removedCards: ReportCard[];
    removedRelations: ReportRelation[];
    setAsideCards: ReportCard[];
    blueprintComponents: ReportCard[];
};

function dataOf(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === "string" ? value : "";
}

function isoField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The graph the report describes, and the derivations over it.
 *
 * Exported because two callers need the *same* answer and must not each decide for themselves: the
 * model below, and whoever builds the locator index that numbers the artifacts. Phase codes are only
 * meaningful over the unfiltered live graph at the latest playhead (`LOCATOR_PHASE_CONTRACT`), so if
 * the index clustered one graph and the document another, `P1` in the text and `P1` on the canvas
 * would be different phases.
 */
export type ReportGraphContext = {
    liveNodes: nodeType[];
    liveEdges: edgeType[];
    membership: Map<string, string>;
    salience: ReturnType<typeof buildSalienceIndex>;
    clusters: ActivityCluster[];
};

export function buildReportGraphContext(snapshot: ReportSnapshot): ReportGraphContext {
    // Delegated, so the document and the canvas cannot number codes over two different graphs.
    return locatorGraphScope(
        snapshot.nodes,
        snapshot.edges,
        snapshot.timeline.stages.map((stage) => ({
            name: stage.name,
            start: stage.startIso,
            end: stage.endIso,
        })),
    );
}

export function buildReportModel(
    snapshot: ReportSnapshot,
    codes: LocatorIndex,
    context: ReportGraphContext = buildReportGraphContext(snapshot),
): ReportModel {
    const { nodes, edges } = snapshot;
    const { liveNodes, liveEdges, membership, salience, clusters } = context;

    const codeOf = (nodeId: string): string | null => codes.byTargetId.get(nodeId)?.code ?? null;

    const toCard = (node: nodeType): ReportCard => {
        const data = dataOf(node);
        return {
            nodeId: node.id,
            code: codeOf(node.id),
            label: normalizeNodeLabel(nodeLabelOf(node)),
            title: stringField(data, "title").trim() || "Untitled",
            description: stringField(data, "description"),
            quotation: stringField(data, "reference"),
            originFileId: isoField(data, "origin"),
            attachmentIds: Array.isArray(data.attachmentIds)
                ? data.attachmentIds.filter((id): id is string => typeof id === "string")
                : [],
            createdAtIso: isoField(data, "createdAt"),
            deletedAtIso: isoField(data, "deletedAt"),
            authorship: isModelDerivedNodeData(data) ? "model-proposed" : "authored",
            relevant: data.relevant !== false,
            salience: salience.score.get(node.id) ?? 0,
            degree: salience.degree.get(node.id) ?? 0,
            crossTreeDegree: salience.crossTreeDegree.get(node.id) ?? 0,
            dataRevisions: countNodeDataRevisions(node),
            firstSeenMs: firstNodeHistoryAtMs(node),
            lastEditedMs: lastNodeHistoryAtMs(node),
        };
    };

    const cardsById = new Map<string, ReportCard>();
    for (const node of nodes) cardsById.set(node.id, toCard(node));

    const titleOfNode = (nodeId: string): string => cardsById.get(nodeId)?.title ?? "Unknown";

    const toRelation = (edge: edgeType): ReportRelation => {
        const data = (edge.data ?? {}) as Record<string, unknown>;
        const sourceLabel = cardsById.get(edge.source)?.label ?? "";
        const targetLabel = cardsById.get(edge.target)?.label ?? "";
        const label = (typeof edge.label === "string" && edge.label.trim() !== "")
            ? edge.label
            : stringField(data, "label").trim()
                || relationLabelFor(sourceLabel, targetLabel)
                || "related to";
        return {
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            sourceCode: codeOf(edge.source),
            targetCode: codeOf(edge.target),
            sourceTitle: titleOfNode(edge.source),
            targetTitle: titleOfNode(edge.target),
            label,
            kind: connectionKindFromEdge(edge),
            // Three states, never two. A missing `manual` postdates the graph, so its absence is not
            // evidence that a model drew the edge — `edgeProvenance` is emphatic about this, and a
            // provenance section that guessed here would be exactly the overclaim it exists to avoid.
            origin: isModelDerivedEdgeData(data)
                ? "model-derived"
                : data.manual === true
                    ? "hand-drawn"
                    : "unknown",
            similarity: numberField(data, "similarity"),
            similarityMargin: numberField(data, "similarityMargin"),
            createdAtIso: isoField(data, "createdAt"),
            deletedAtIso: isoField(data, "deletedAt"),
        };
    };

    /**
     * A relation is only live if **both of its ends are**.
     *
     * `isEdgeActive` alone is not enough. Deleting a node is supposed to soft-delete every edge
     * touching it, but that is a cascade in the editor rather than an invariant of the data, and a
     * document that renders "R1 —tackled in→ B1" three lines from "B1 was deleted" is worse than one
     * that quietly drops the dangling half. The tray applies the same rule to its own edge set.
     */
    const liveNodeIds = new Set(liveNodes.map((node) => node.id));
    const bothEndsLive = (edge: edgeType) => (
        liveNodeIds.has(edge.source) && liveNodeIds.has(edge.target)
    );

    /**
     * An end that was set aside takes its relation with it.
     *
     * Same argument as `bothEndsLive` above, one step weaker: a relation is a claim about two cards,
     * and printing "R1 —informs→ O4" three lines after the document decided O4 is not part of the
     * study leaves `O4` as a code with nothing to link to. The tray applies the deletion half of this
     * rule; this is the relevance half.
     */
    const relevantNodeIds = new Set(
        liveNodes.filter((node) => (node.data as Record<string, unknown> | undefined)?.relevant !== false)
            .map((node) => node.id),
    );
    const bothEndsRelevant = (edge: edgeType) => (
        relevantNodeIds.has(edge.source) && relevantNodeIds.has(edge.target)
    );

    const relations = liveEdges.filter(bothEndsLive).filter(bothEndsRelevant).map(toRelation);
    const removedRelations = edges
        .filter((edge) => !isEdgeActive(edge) || !bothEndsLive(edge))
        .map(toRelation);

    // --- Phases, from the same clustering the canvas runs, over the unfiltered live graph.
    const activities = liveNodes.filter((node) => normalizeNodeLabel(nodeLabelOf(node)) === "activity");

    const membersOfActivity = new Map<string, nodeType[]>();
    for (const node of liveNodes) {
        const owner = membership.get(node.id);
        if (owner === undefined) continue;
        const list = membersOfActivity.get(owner) ?? [];
        list.push(node);
        membersOfActivity.set(owner, list);
    }

    const activityById = new Map(activities.map((node) => [node.id, node]));
    const relationsBySource = new Map<string, ReportRelation[]>();
    for (const relation of relations) {
        for (const nodeId of [relation.sourceNodeId, relation.targetNodeId]) {
            const list = relationsBySource.get(nodeId) ?? [];
            list.push(relation);
            relationsBySource.set(nodeId, list);
        }
    }

    const buildThread = (activityId: string): ReportThread | null => {
        const activity = activityById.get(activityId);
        if (!activity) return null;
        const members = membersOfActivity.get(activityId) ?? [];
        const satellites = members.filter((node) => node.id !== activityId);

        // Exactly what level 2 promotes, from exactly the same function.
        const headline = pickTop(
            satellites,
            salience.score,
            new Set(["insight", "requirement"]),
            ACTIVITY_PROMOTED_MAX,
        ).map((node) => cardsById.get(node.id)!).filter(Boolean);

        const bodyCards = satellites
            .filter((node) => !isPerson(node))
            .slice()
            .sort((a, b) => compareBySalience(a, b, salience.score))
            .map((node) => cardsById.get(node.id)!)
            .filter(Boolean);

        const memberIds = new Set(members.map((node) => node.id));
        const internal: ReportRelation[] = [];
        const outbound: ReportRelation[] = [];
        const seen = new Set<string>();
        for (const node of members) {
            for (const relation of relationsBySource.get(node.id) ?? []) {
                if (seen.has(relation.edgeId)) continue;
                seen.add(relation.edgeId);
                const bothInside = memberIds.has(relation.sourceNodeId)
                    && memberIds.has(relation.targetNodeId);
                (bothInside ? internal : outbound).push(relation);
            }
        }
        const byEdgeId = (a: ReportRelation, b: ReportRelation) => a.edgeId.localeCompare(b.edgeId);

        return {
            activityNodeId: activityId,
            code: codeOf(activityId),
            title: cardsById.get(activityId)?.title ?? "Untitled",
            relevant: relevantNodeIds.has(activityId),
            createdAtIso: cardsById.get(activityId)?.createdAtIso ?? null,
            // A set-aside `person` is a name the document is not entitled to print, and the
            // participants line is the one place a card's *title* reaches the body without going
            // through `cards`.
            participants: collectParticipants(members.filter((node) => relevantNodeIds.has(node.id))),
            headline,
            cards: bodyCards.filter((card) => card.relevant),
            internalRelations: internal.sort(byEdgeId),
            outboundRelations: outbound.sort(byEdgeId),
            setAside: bodyCards.filter((card) => !card.relevant),
        };
    };

    const clusterOfActivity = new Map<string, ActivityCluster>();
    for (const cluster of clusters) {
        for (const activityId of cluster.memberActivityIds) clusterOfActivity.set(activityId, cluster);
    }

    const phases: ReportPhase[] = clusters.map((cluster) => {
        const memberNodes: nodeType[] = [];
        for (const activityId of cluster.memberActivityIds) {
            const activity = activityById.get(activityId);
            if (activity) memberNodes.push(activity);
            memberNodes.push(...(membersOfActivity.get(activityId) ?? []).filter((n) => n.id !== activityId));
        }
        const satellites = memberNodes.filter((node) => (
            normalizeNodeLabel(nodeLabelOf(node)) !== "activity"
        ));
        // Exactly what level 1 promotes: two requirements plus two concepts.
        const headline = [
            ...pickTop(satellites, salience.score, new Set(["requirement"]), PHASE_PROMOTED_PER_LABEL),
            ...pickTop(satellites, salience.score, new Set(["concept"]), PHASE_PROMOTED_PER_LABEL),
        ].map((node) => cardsById.get(node.id)!).filter(Boolean);

        return {
            clusterId: cluster.id,
            anchorActivityNodeId: cluster.anchorActivityId,
            code: codes.entries.find((entry) => (
                entry.locator.kind === "phase" && entry.targetId === cluster.anchorActivityId
            ))?.code ?? null,
            anchorCode: codeOf(cluster.anchorActivityId),
            label: cluster.label,
            labelSource: cluster.labelSource,
            startIso: cluster.startAt,
            endIso: cluster.endAt,
            // Counted over the complete member set, not the folded remainder — but only over what
            // the document actually contains, so a phase's totals agree with the threads under it.
            composition: countLabels(memberNodes.filter((node) => relevantNodeIds.has(node.id))),
            participants: collectParticipants(memberNodes.filter((node) => relevantNodeIds.has(node.id))),
            cardCount: memberNodes.filter((node) => (
                !isPerson(node) && relevantNodeIds.has(node.id)
            )).length,
            headline,
            threads: cluster.memberActivityIds
                .map(buildThread)
                .filter((thread): thread is ReportThread => thread !== null),
        };
    });

    const clusteredActivityIds = new Set(clusters.flatMap((cluster) => cluster.memberActivityIds));
    const looseThreads = activities
        .filter((activity) => !clusteredActivityIds.has(activity.id))
        .map((activity) => buildThread(activity.id))
        .filter((thread): thread is ReportThread => thread !== null);

    const unassignedCards = liveNodes
        .filter((node) => (
            relevantNodeIds.has(node.id)
            && membership.get(node.id) === undefined
            && normalizeNodeLabel(nodeLabelOf(node)) !== "blueprint_component"
            && normalizeNodeLabel(nodeLabelOf(node)) !== "blueprint_group"
            && normalizeNodeLabel(nodeLabelOf(node)) !== "blueprint"
            && !isPerson(node)
        ))
        .sort((a, b) => compareBySalience(a, b, salience.score))
        .map((node) => cardsById.get(node.id)!)
        .filter(Boolean);

    // --- Cross-phase relations: which phases talk to which.
    const phaseOfNode = (nodeId: string): string | null => {
        const owner = membership.get(nodeId);
        if (owner === undefined) return null;
        return clusterOfActivity.get(owner)?.id ?? null;
    };
    const crossPhaseRelations = relations.filter((relation) => {
        const a = phaseOfNode(relation.sourceNodeId);
        const b = phaseOfNode(relation.targetNodeId);
        return a !== null && b !== null && a !== b;
    });

    // --- Requirements and the components answering them.
    const attached = attachedComponentIds(liveNodes, liveEdges);
    const blueprintEventByComponent = new Map(
        snapshot.timeline.blueprintEvents
            .filter((event) => typeof event.componentNodeId === "string" && event.componentNodeId !== "")
            .map((event) => [event.componentNodeId as string, event]),
    );

    const requirements = liveNodes
        .filter((node) => (
            normalizeNodeLabel(nodeLabelOf(node)) === "requirement"
            && relevantNodeIds.has(node.id)
        ))
        .sort((a, b) => compareBySalience(a, b, salience.score))
        .map((node) => cardsById.get(node.id)!)
        .filter(Boolean);

    /**
     * When each component was attached, taken from the `tackled in` **edge** rather than from the
     * blueprint event.
     *
     * The event used to be minted by the attach gesture, so its instant was the attach instant. It is
     * now minted when the component is *created* (so the timeline's Blueprint track shows components
     * that answer nothing yet), which means reading the attach date off it would print a component's
     * birthday under the words "attached". The edge is the attachment — that is the whole of
     * contract 28 — so the edge is what carries its date.
     */
    const attachedAtByPair = new Map<string, string | null>();
    const pairKey = (requirementId: string, componentId: string) => `${requirementId}::${componentId}`;

    const componentsForRequirement = new Map<string, string[]>();
    for (const edge of liveEdges) {
        const sourceLabel = cardsById.get(edge.source)?.label ?? "";
        const targetLabel = cardsById.get(edge.target)?.label ?? "";
        let requirementId: string | null = null;
        let componentId: string | null = null;
        if (sourceLabel === "requirement" && targetLabel === "blueprint_component") {
            requirementId = edge.source;
            componentId = edge.target;
        } else if (targetLabel === "requirement" && sourceLabel === "blueprint_component") {
            requirementId = edge.target;
            componentId = edge.source;
        }
        if (requirementId === null || componentId === null) continue;
        if (!attached.has(componentId)) continue;
        if (!relevantNodeIds.has(componentId)) continue;
        const list = componentsForRequirement.get(requirementId) ?? [];
        if (!list.includes(componentId)) list.push(componentId);
        componentsForRequirement.set(requirementId, list);
        // A component may answer one requirement through more than one edge only if somebody drew a
        // duplicate; the earliest is the one that attached it.
        //
        // `DEFAULT_HISTORY_TIMESTAMP` is not a date. `flowSlice.ensureEdgeTimestamps` stamps it on any
        // edge that arrived without one — every edge in a document saved before edge timestamps were
        // recorded — and printing it verbatim would tell the reader a component was attached in 1970.
        // It also has to be excluded from the earliest-wins tie-break, where a sentinel beats every
        // real date it is compared against.
        const key = pairKey(requirementId, componentId);
        const rawDrawnAt = isoField((edge.data ?? {}) as Record<string, unknown>, "createdAt");
        const drawnAt = rawDrawnAt === DEFAULT_HISTORY_TIMESTAMP ? null : rawDrawnAt;
        const known = attachedAtByPair.get(key) ?? null;
        if (known === null || (drawnAt !== null && drawnAt < known)) {
            attachedAtByPair.set(key, drawnAt);
        }
    }

    const requirementAnswers: ReportRequirementAnswer[] = [];
    const unansweredRequirements: ReportCard[] = [];
    for (const requirement of requirements) {
        const componentIds = (componentsForRequirement.get(requirement.nodeId) ?? []).slice().sort();
        if (componentIds.length === 0) {
            unansweredRequirements.push(requirement);
            continue;
        }
        requirementAnswers.push({
            requirement,
            components: componentIds.map((componentId) => {
                const componentNode = liveNodes.find((node) => node.id === componentId);
                const componentData = componentNode ? dataOf(componentNode) : {};
                // Read off the node, with the timeline event only as a fallback for a document whose
                // component predates the field. The event used to be the source of both, which was
                // always a copy of what the node already held and is now not even guaranteed to
                // exist — the track derives its markers rather than storing them.
                const blueprintComponent = componentData.blueprintComponent
                    && typeof componentData.blueprintComponent === "object"
                    ? componentData.blueprintComponent as Record<string, unknown>
                    : {};
                const event = blueprintEventByComponent.get(componentId) ?? null;
                return {
                    card: cardsById.get(componentId)!,
                    paperTitle: stringField(componentData, "blueprintPaperTitle") || event?.paperTitle || null,
                    referenceCitation: stringField(blueprintComponent, "referenceCitation")
                        || event?.referenceCitation
                        || null,
                    attachedAtIso: attachedAtByPair.get(pairKey(requirement.nodeId, componentId)) ?? null,
                };
            }).filter((entry) => entry.card !== undefined),
        });
    }

    const byLabel = (label: string): ReportCard[] => liveNodes
        .filter((node) => (
            normalizeNodeLabel(nodeLabelOf(node)) === label
            && relevantNodeIds.has(node.id)
        ))
        .sort((a, b) => compareBySalience(a, b, salience.score))
        .map((node) => cardsById.get(node.id)!)
        .filter(Boolean);

    // Deliberately *not* relevance-filtered: this is the complete live set, and `setAsideCards` is
    // derived from it. The appendix filters it again on its own way past (`card.relevant`), so the
    // completeness costs the document nothing and buys it the record of what was ruled out.
    const allCards = liveNodes
        .filter((node) => {
            const label = normalizeNodeLabel(nodeLabelOf(node));
            return label !== "blueprint_group" && label !== "blueprint";
        })
        .map((node) => cardsById.get(node.id)!)
        .filter(Boolean);

    return {
        snapshot,
        codes,
        phases,
        looseThreads,
        unassignedCards,
        cardsById,
        allCards,
        relations,
        crossPhaseRelations,
        requirementAnswers,
        unansweredRequirements,
        insights: byLabel("insight"),
        concepts: byLabel("concept"),
        participants: snapshot.timeline.participants.map((entry) => ({
            name: entry.name,
            role: entry.role,
        })),
        removedCards: nodes
            .filter((node) => !isNodeActive(node))
            .map((node) => cardsById.get(node.id)!)
            .filter(Boolean),
        removedRelations,
        setAsideCards: allCards.filter((card) => !card.relevant),
        blueprintComponents: byLabel("blueprint_component"),
    };
}
