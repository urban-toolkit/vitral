import { compareCardsSimilarity } from "@/api/stateApi";
import {
    SIMILARITY_TUNING,
    decideSimilarityEdges,
    type IterationEvidence,
} from "@/pages/projectEditor/similarityDecision";
import {
    canAutoLink,
    connectionKindFromEdge,
    isEdgeActive,
    normalizeArtifactEntity,
} from "@/pages/projectEditor/graphSemantics";
import { connectEdges } from "@/store/flowSlice";
import type { AppDispatch } from "@/store";
import type { edgeType, nodeType } from "@/config/types";

/**
 * Offering newly created cards to the rest of the canvas, and taking whatever the evidence gates
 * allow.
 *
 * This used to live inside the file-drop path, which meant a card only ever got automatic relations
 * if a model had produced it from a document. A card the researcher typed arrived on the canvas
 * unconnected to anything, which is exactly backwards: their own reading of the study is the part
 * most worth situating against what is already there.
 *
 * The gates are unchanged and deliberately shared rather than reimplemented -- `decideSimilarityEdges`
 * with its absolute floor, its separation from the runner-up, and its per-card degree cap. A note
 * the researcher wrote gets no easier a ride than a card the model extracted; the point is that it
 * gets the same one.
 */

const REFERENCED_BY_LABEL = "referenced by";
const ITERATION_OF_LABEL = "iteration of";
const DEBUG_SIMILARITY_SCORES = String(import.meta.env.VITE_DEBUG_SIMILARITY_SCORES ?? "").toLowerCase() === "true";

/**
 * Automatic edges already attached to each card, both ends counted.
 *
 * This is what stops one card becoming a hub. A long, topic-summarising title sits near the centre
 * of a project's subject matter and therefore wins "most similar" against cards that have nothing
 * to do with each other -- and because salience weights degree, such a hub does not just clutter the
 * canvas, it hijacks which cards get promoted when the canvas is abstracted.
 */
export function countAutoLinkDegree(edges: edgeType[]): Map<string, number> {
    const degree = new Map<string, number>();
    for (const edge of edges) {
        if (!isEdgeActive(edge)) continue;
        if (connectionKindFromEdge(edge) === "regular") continue;
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    return degree;
}

export type AutoLinkParams = {
    projectId: string;
    /** The cards just added to the canvas. Only these are offered; the server holds the rest. */
    newNodes: nodeType[];
    /** Live graph, read after the round trip rather than snapshotted before it. */
    nodesRef: { current: nodeType[] };
    edgesRef: { current: edgeType[] };
    dispatch: AppDispatch;
    /** Stamped on every edge created, so playback places them with the cards they explain. */
    createdAt: string;
    signal?: AbortSignal;
};

export async function autoLinkNewCards({
    projectId,
    newNodes,
    nodesRef,
    edgesRef,
    dispatch,
    createdAt,
    signal,
}: AutoLinkParams): Promise<void> {
    const aborted = () => signal?.aborted === true;

    // `person` cards are excluded at the source rather than filtered out of the verdicts: a name
    // has no content to be similar *about*, so shipping one only buys a retrieval round-trip whose
    // every answer would be thrown away. See `AUTO_LINK_EXCLUDED_LABELS`.
    const newCardsForSimilarity = newNodes
        .map((node) => {
            const data = node.data as Record<string, unknown>;
            return {
                id: node.id,
                label: normalizeArtifactEntity(String(data.label ?? "")),
                title: typeof data.title === "string" ? data.title : "",
                description: typeof data.description === "string" ? data.description : "",
            };
        })
        // A card with nothing written on it yet has nothing to match on, and asking anyway would
        // spend a round trip to compare an empty string against the whole project.
        .filter((card) => canAutoLink(card.label) && `${card.title} ${card.description}`.trim() !== "");

    if (newCardsForSimilarity.length === 0) return;

    const newNodeById = new Map(newNodes.map((node) => [node.id, node]));

    try {
        // Only the new cards travel: the server holds the canvas and searches its own vector index.
        const similarity = await compareCardsSimilarity(projectId, {
            newCards: newCardsForSimilarity,
        }, signal);
        if (aborted()) return;

        if (similarity.status !== "ok") {
            console.warn(
                `Similarity lookup unavailable (${similarity.status}); no automatic relations were added.`,
            );
            return;
        }

        const relationEdges: edgeType[] = [];

        // Rebuilt per pass rather than snapshotted once: the similarity edges are queued after an
        // await, by which point the canvas has already gained the new cards.
        const edgeKeyOf = (edge: edgeType) => {
            const edgeLabel = typeof edge.label === "string"
                ? edge.label
                : (typeof edge.data?.label === "string" ? edge.data.label : "");
            return `${edge.source}|${edge.target}|${edgeLabel}`;
        };
        const knownEdgeKeys = new Set(edgesRef.current.map(edgeKeyOf));
        const queueRelationEdge = (edge: edgeType) => {
            const edgeKey = edgeKeyOf(edge);
            if (knownEdgeKeys.has(edgeKey)) return;
            knownEdgeKeys.add(edgeKey);
            relationEdges.push({
                ...edge,
                data: {
                    ...(edge.data && typeof edge.data === "object" ? edge.data : {}),
                    createdAt,
                },
            });
        };

        // Degree is counted against the live graph *plus* what this pass has already queued, so one
        // pass cannot pile six edges onto the same card by never noticing its own work.
        const autoDegree = countAutoLinkDegree(edgesRef.current);

        const nodeFor = (cardId: string): nodeType | undefined => (
            newNodeById.get(cardId) ?? nodesRef.current.find((candidate) => candidate.id === cardId)
        );

        const evidenceOf = (cardId: string): IterationEvidence | null => {
            const node = nodeFor(cardId);
            if (!node) return null;
            const data = (node.data ?? {}) as Record<string, unknown>;
            const created = typeof data.createdAt === "string" ? Date.parse(data.createdAt) : NaN;
            return {
                title: typeof data.title === "string" ? data.title : "",
                createdAtMs: Number.isFinite(created) ? created : null,
            };
        };

        /**
         * The far end of the edge is filtered *before* the gates run, not after. A `person`
         * candidate left in the ranking would still consume one of the two edges a new card may
         * take, and would still set the separation floor the real matches have to clear -- so
         * dropping its verdict afterwards would silently weaken the decision for every other
         * candidate. Unknown ids are kept: the retrieval index can lag the live canvas, and "not
         * found" is not evidence of a person.
         */
        const isAutoLinkableCard = (cardId: string): boolean => {
            const node = nodeFor(cardId);
            if (!node) return true;
            return canAutoLink(String((node.data as Record<string, unknown>)?.label ?? ""));
        };

        for (const rawMatch of similarity.matches) {
            const match = {
                ...rawMatch,
                candidates: rawMatch.candidates.filter(
                    (candidate) => isAutoLinkableCard(candidate.existingCardId),
                ),
            };
            const verdicts = decideSimilarityEdges(match, {
                evidenceOf,
                autoDegreeOf: (cardId) => autoDegree.get(cardId) ?? 0,
            });

            if (DEBUG_SIMILARITY_SCORES) {
                console.log("[similarity]", {
                    newCardId: match.newCardId,
                    baseline: match.baseline,
                    candidates: rawMatch.candidates,
                    eligibleCandidates: match.candidates,
                    accepted: verdicts,
                    tuning: SIMILARITY_TUNING,
                });
            }

            for (const verdict of verdicts) {
                const newNode = newNodeById.get(match.newCardId);
                const normalizedEntity = normalizeArtifactEntity(
                    String((newNode?.data as Record<string, unknown> | undefined)?.label ?? ""),
                );
                const existingNode = nodesRef.current.find((node) => node.id === verdict.existingCardId);
                const existingLabel = normalizeArtifactEntity(
                    String((existingNode?.data as Record<string, unknown> | undefined)?.label ?? normalizedEntity),
                );
                const label = verdict.kind === "iteration_of"
                    ? ITERATION_OF_LABEL
                    : REFERENCED_BY_LABEL;

                queueRelationEdge({
                    id: crypto.randomUUID(),
                    source: match.newCardId,
                    target: verdict.existingCardId,
                    type: "relation",
                    label,
                    data: {
                        label,
                        from: normalizedEntity,
                        to: existingLabel,
                        kind: verdict.kind,
                        // Kept on the edge so a questionable relation can be explained after the
                        // fact, and so thresholds can be retuned against real projects rather than
                        // guessed at.
                        autoLinked: true,
                        similarity: verdict.similarity,
                        similarityZ: verdict.z,
                        similarityMargin: verdict.margin,
                    },
                });
                autoDegree.set(
                    verdict.existingCardId,
                    (autoDegree.get(verdict.existingCardId) ?? 0) + 1,
                );
            }
        }

        if (relationEdges.length > 0 && !aborted()) {
            dispatch(connectEdges(relationEdges));
        }
    } catch (error) {
        if (aborted()) return;
        console.error("Failed to compare new cards with existing cards.", error);
    }
}
