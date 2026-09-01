import { jaccardOverlap, tokenize } from "@/utils/textTokens";
import { checkQuotation } from "./groundedness";
import type { EvalRun, EvalShard, Span } from "./evalTypes";

/**
 * Which shards the sharder finds *every* time, and which it finds once.
 *
 * This is the reliability question, and it is answerable without a single label: run the same
 * document R times and see what survives repetition. A shard produced in one run of ten is, by the
 * system's own behaviour, not a finding — whatever a rater would have said about it in isolation.
 *
 * ## Matching across runs is done on spans, not on titles
 *
 * Titles are rewritten every run — "No null rows" and "Dataset has no fully-null rows" are the same
 * shard — so clustering on them measures the model's phrasing variance rather than its decomposition
 * variance. The span a shard's excerpt occupies in the source is the objective thing: two runs that
 * cut the document in the same place found the same shard, whatever they called it.
 *
 * Titles are the fallback, and only where a span is unavailable — the excerpt was missing, or it was
 * fabricated and cannot be located. Those shards genuinely have no position, and refusing to cluster
 * them at all would quietly drop exactly the material the groundedness metric is most interested in.
 * `jaccardOverlap`/`tokenize` are borrowed from the `iteration of` test rather than reinvented, for
 * the same reason it uses them: lexical overlap is an opinion independent of the embeddings.
 *
 * Greedy and order-dependent by construction, which is fine and is why the order is fixed: runs in
 * index order, shards in the order the model emitted them, clusters in creation order. The same
 * input therefore always produces the same clustering, which the analysis half has to guarantee even
 * though the run half cannot.
 */

/** Fraction of the shorter span the two share. Not true IoU: a run that quotes a longer passage
 *  around the same sentence found the same shard, and intersection-over-union would deny it. */
export function spanOverlap(a: Span, b: Span): number {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end <= start) return 0;
    const shorter = Math.min(a.end - a.start, b.end - b.start);
    return shorter <= 0 ? 0 : (end - start) / shorter;
}

export const CONSENSUS_TUNING = {
    /** How much of the shorter excerpt two shards must share to be the same shard. */
    SPAN_OVERLAP: 0.5,
    /** Title agreement required when neither shard could be placed in the source. */
    TITLE_JACCARD: 0.5,
} as const;

export type PlacedShard = EvalShard & {
    runIndex: number;
    /** Where its excerpt sits in the source, or null when it is missing or unlocatable. */
    span: Span | null;
};

export type ConsensusCluster = {
    members: PlacedShard[];
    /** Distinct runs represented. A run that emitted the same shard twice still counts once. */
    runsPresent: number;
    /** `runsPresent / repetitions`. 1 means every run found it. */
    support: number;
    /** The first member's title, as a human-readable handle. Not used for anything. */
    exemplar: string;
};

export function placeShards(run: EvalRun): PlacedShard[] {
    return run.shards.map((shard) => ({
        ...shard,
        runIndex: run.runIndex,
        span: checkQuotation(run.sourceText, shard.reference, run.contextText).span,
    }));
}

function sameShard(a: PlacedShard, b: PlacedShard): boolean {
    if (a.span !== null && b.span !== null) {
        return spanOverlap(a.span, b.span) >= CONSENSUS_TUNING.SPAN_OVERLAP;
    }
    return jaccardOverlap(tokenize(a.title), tokenize(b.title)) >= CONSENSUS_TUNING.TITLE_JACCARD;
}

/**
 * Cluster the shards of several runs of one document.
 *
 * `runs` must all be the same document under the same configuration; mixing configurations here
 * would measure the ablation and the model's variance at once and be able to tell you neither.
 */
export function buildConsensus(runs: readonly EvalRun[]): ConsensusCluster[] {
    const repetitions = new Set(runs.map((run) => run.runIndex)).size;
    if (repetitions === 0) return [];

    const clusters: PlacedShard[][] = [];
    for (const run of [...runs].sort((a, b) => a.runIndex - b.runIndex)) {
        for (const shard of placeShards(run)) {
            const home = clusters.find((cluster) => cluster.some((member) => sameShard(member, shard)));
            if (home) home.push(shard);
            else clusters.push([shard]);
        }
    }

    return clusters.map((members) => {
        const runsPresent = new Set(members.map((member) => member.runIndex)).size;
        return {
            members,
            runsPresent,
            support: runsPresent / repetitions,
            exemplar: members[0].title,
        };
    });
}

export type ConsensusSummary = {
    repetitions: number;
    /** Distinct shards the runs found between them. */
    clusters: number;
    /** Found by every run. */
    unanimous: number;
    /** Found by more than half. */
    majority: number;
    /** Found once. */
    singleton: number;
    /** Mean support across clusters — the headline reliability figure. */
    meanSupport: number;
    /** Mean pairwise agreement between runs, over clusters. Jaccard, averaged over all run pairs. */
    meanPairwiseAgreement: number | null;
};

/**
 * `runIndices` is passed rather than derived, because a run that produced nothing at all contributes
 * to no cluster and would otherwise vanish from the denominator — turning a total extraction failure
 * into perfect agreement among the runs that survived.
 */
export function summariseConsensus(
    clusters: readonly ConsensusCluster[],
    runIndices: readonly number[],
): ConsensusSummary {
    const repetitions = new Set(runIndices).size;
    const total = clusters.length;
    const unanimous = clusters.filter((cluster) => cluster.runsPresent === repetitions).length;
    const majority = clusters.filter((cluster) => cluster.runsPresent * 2 > repetitions).length;
    const singleton = clusters.filter((cluster) => cluster.runsPresent === 1).length;
    const meanSupport = total === 0
        ? 0
        : clusters.reduce((sum, cluster) => sum + cluster.support, 0) / total;

    return {
        repetitions,
        clusters: total,
        unanimous,
        majority,
        singleton,
        meanSupport,
        meanPairwiseAgreement: pairwiseAgreement(clusters, runIndices),
    };
}

/**
 * Mean Jaccard between every pair of runs, counting a cluster as a member of a run's set when that
 * run contributed to it.
 *
 * Reported beside mean support because the two fail differently: support stays high when one run is
 * wildly different from nine identical ones, and pairwise agreement does not.
 */
function pairwiseAgreement(
    clusters: readonly ConsensusCluster[],
    runIndices: readonly number[],
): number | null {
    const indices = Array.from(new Set(runIndices)).sort((a, b) => a - b);
    if (indices.length < 2) return null;

    const setOf = (runIndex: number) => new Set(
        clusters
            .map((cluster, index) => (cluster.members.some((m) => m.runIndex === runIndex) ? index : -1))
            .filter((index) => index >= 0),
    );
    const sets = indices.map(setOf);

    let total = 0;
    let pairs = 0;
    for (let i = 0; i < sets.length; i += 1) {
        for (let j = i + 1; j < sets.length; j += 1) {
            const shared = [...sets[i]].filter((value) => sets[j].has(value)).length;
            const union = new Set([...sets[i], ...sets[j]]).size;
            total += union === 0 ? 1 : shared / union;
            pairs += 1;
        }
    }
    return pairs === 0 ? null : total / pairs;
}
