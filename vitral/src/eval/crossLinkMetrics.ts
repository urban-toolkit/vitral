import {
    decideSimilarityEdges,
    SIMILARITY_TUNING,
    type IterationEvidence,
    type SimilarityBaseline,
    type SimilarityMatch,
    type SimilarityTuning,
} from "@/pages/projectEditor/similarityDecision";
import { canAutoLink } from "@/pages/projectEditor/graphSemantics";

/**
 * What each gate in the cross-link rule actually contributes.
 *
 * The retrospective route to this number does not exist. In the one real project available, six
 * links were inferred and all six are soft-deleted — but every deletion timestamp is byte-identical
 * to its source card's, so the researcher deleted cards and the links went with them as cascades.
 * Not one was ever judged. A harness that counted them would have reported "0 of 6 kept" and would
 * have been measuring card deletion.
 *
 * So this measures **selectivity** instead of accuracy, and says so. Given the real embeddings of a
 * real corpus, how many links does each gate admit, and how large a hub does removing it create?
 * That answers "what is this component for" without a single label, which is the question an
 * ablation asks. It does not answer "is the link correct", and the report must not imply it does.
 *
 * The decision itself is the shipped `decideSimilarityEdges`, driven through its `tuning` override
 * rather than reimplemented here. A second copy of the rule sitting next to the measurements would
 * be measuring the copy.
 */

export type EmbeddedCard = {
    id: string;
    label: string;
    title: string;
    createdAtMs: number | null;
    embedding: number[];
};

export function cosine(a: readonly number[], b: readonly number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        dot += a[index] * b[index];
        normA += a[index] * a[index];
        normB += b[index] * b[index];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The cohort statistics the similarity route computes in SQL, reproduced.
 *
 * Mirrors `POST /state/:id/cards/similarity`: candidates come only from the **same label**, ranked by
 * cosine, and the baseline is the median and median-absolute-deviation of that cohort. The route
 * caps the cohort at the nearest 512 and returns the top 8 candidates; both are reproduced so a
 * replay decides on the same evidence the product would have had. `person` cards are excluded at
 * both ends, as `autoLinkNewCards` does — a name embeds into whatever surrounds it.
 */
export const REPLAY_LIMITS = {
    COHORT: 512,
    CANDIDATES: 8,
} as const;

export function buildMatch(card: EmbeddedCard, corpus: readonly EmbeddedCard[]): SimilarityMatch | null {
    if (!canAutoLink(card.label)) return null;

    const cohort = corpus
        .filter((other) => other.id !== card.id && other.label === card.label && canAutoLink(other.label))
        .map((other) => ({ existingCardId: other.id, similarity: cosine(card.embedding, other.embedding) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, REPLAY_LIMITS.COHORT);

    if (cohort.length === 0) return null;

    const scores = cohort.map((entry) => entry.similarity);
    const cohortMedian = median(scores);
    const baseline: SimilarityBaseline = {
        median: cohortMedian,
        mad: median(scores.map((score) => Math.abs(score - cohortMedian))),
        sampled: cohort.length,
    };

    return {
        newCardId: card.id,
        candidates: cohort.slice(0, REPLAY_LIMITS.CANDIDATES),
        baseline,
    };
}

/**
 * Everything a replay needs, however it was obtained.
 *
 * Two producers, and the distinction matters for what a number means. `inputFromEmbeddings` computes
 * the cohort here from raw vectors, which is what the unit tests use because it is deterministic and
 * needs no server. `evalRunner` instead asks the live similarity route, so the candidates and the
 * baseline are the ones the product would actually have decided on — the same SQL, the same cohort
 * cap, the same top-8 slice. Prefer the second wherever a published number is concerned.
 */
export type ReplayInput = {
    matches: SimilarityMatch[];
    /** Title and creation instant per card id, for the `iteration of` test. */
    evidence: Map<string, IterationEvidence>;
};

export type ReplayedLink = {
    sourceId: string;
    targetId: string;
    kind: string;
    similarity: number;
    margin: number;
};

export type ReplayResult = {
    configuration: string;
    links: ReplayedLink[];
    /** Distinct undirected pairs linked. Two runs of the rule can propose A→B and B→A. */
    pairs: number;
    /** The hub the separation gate exists to prevent. */
    maxDegree: number;
    meanSimilarity: number | null;
    /** Cards that took at least one link. */
    cardsLinked: number;
};

/** Cohorts computed here from raw vectors. Deterministic and server-free; used by the tests. */
export function inputFromEmbeddings(corpus: readonly EmbeddedCard[]): ReplayInput {
    const matches: SimilarityMatch[] = [];
    for (const card of corpus) {
        const match = buildMatch(card, corpus);
        if (match !== null) matches.push(match);
    }
    return {
        matches,
        evidence: new Map(corpus.map((card) => [
            card.id,
            { title: card.title, createdAtMs: card.createdAtMs },
        ])),
    };
}

/**
 * Replay every match through the rule once, under one set of thresholds.
 *
 * Every card is offered against the whole corpus, which is *not* what the product does — there, only
 * newly created cards are offered, against a canvas that was smaller at the time. The difference is
 * deliberate and has to be stated wherever the number is used: this is the rule's selectivity over a
 * fixed corpus, not a reconstruction of a session. Reconstructing that would need the canvas as it
 * stood at each drop, and would measure the order artifacts happened to be added in as much as it
 * measures the rule.
 *
 * The degree cap accumulates across the pass, as it does in `autoLinkNewCards`, so one pass cannot
 * pile links onto the same card by never noticing its own work. That makes the result order-
 * dependent, which is why the matches are sorted by id first: a replay has to be reproducible.
 */
export function replay(
    input: ReplayInput,
    configuration: string,
    tuning?: Partial<SimilarityTuning>,
): ReplayResult {
    const degree = new Map<string, number>();
    const links: ReplayedLink[] = [];

    const ordered = [...input.matches].sort((a, b) => a.newCardId.localeCompare(b.newCardId));

    for (const match of ordered) {
        const verdicts = decideSimilarityEdges(match, {
            evidenceOf: (cardId) => input.evidence.get(cardId) ?? null,
            autoDegreeOf: (cardId) => degree.get(cardId) ?? 0,
            tuning,
        });

        for (const verdict of verdicts) {
            links.push({
                sourceId: match.newCardId,
                targetId: verdict.existingCardId,
                kind: verdict.kind,
                similarity: verdict.similarity,
                margin: verdict.margin,
            });
            degree.set(match.newCardId, (degree.get(match.newCardId) ?? 0) + 1);
            degree.set(verdict.existingCardId, (degree.get(verdict.existingCardId) ?? 0) + 1);
        }
    }

    const pairs = new Set(links.map((link) => [link.sourceId, link.targetId].sort().join("|")));
    const similarities = links.map((link) => link.similarity);

    return {
        configuration,
        links,
        pairs: pairs.size,
        maxDegree: degree.size === 0 ? 0 : Math.max(...degree.values()),
        meanSimilarity: similarities.length === 0
            ? null
            : similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
        cardsLinked: Array.from(degree.values()).filter((value) => value > 0).length,
    };
}

/**
 * The ablation table: the shipped rule, and the same rule with one gate removed at a time.
 *
 * Removing a gate means neutralising its threshold rather than branching around it, which is what
 * keeps every row running the same code. A floor of 0 admits any score; a separation margin of 0
 * admits any winner; an unbounded degree cap admits hubs; a twin delta of 1 admits the whole ranked
 * prefix rather than only the cluster at the top.
 */
export function ablateGates(input: ReplayInput): ReplayResult[] {
    return [
        replay(input, "shipped rule"),
        replay(input, "no level floor", { ABSOLUTE_FLOOR: 0 }),
        replay(input, "no separation gate", { SEPARATION_MARGIN: 0 }),
        replay(input, "no degree cap", { MAX_AUTO_DEGREE: Number.POSITIVE_INFINITY }),
        replay(input, "no twin rule", { TWIN_DELTA: 1 }),
        replay(input, "no gates at all", {
            ABSOLUTE_FLOOR: 0,
            SEPARATION_MARGIN: 0,
            TWIN_DELTA: 1,
            MAX_AUTO_DEGREE: Number.POSITIVE_INFINITY,
        }),
    ];
}

/**
 * How link count responds to the two thresholds that were measured rather than derived.
 *
 * The current defence of `ABSOLUTE_FLOOR` and `SEPARATION_MARGIN` is eight frozen probes from one
 * project. A curve says whether the shipped values sit on a plateau — where being slightly wrong
 * costs nothing — or on a cliff, where it costs everything.
 */
export function sweepThreshold(
    input: ReplayInput,
    key: "ABSOLUTE_FLOOR" | "SEPARATION_MARGIN",
    values: readonly number[],
): Array<{ value: number; shipped: boolean; result: ReplayResult }> {
    return values.map((value) => ({
        value,
        shipped: value === SIMILARITY_TUNING[key],
        result: replay(input, `${key}=${value}`, { [key]: value }),
    }));
}
