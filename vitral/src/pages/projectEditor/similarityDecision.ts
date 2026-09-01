import { jaccardOverlap, tokenize } from "@/utils/textTokens";

/**
 * Whether an automatically discovered card pair is worth an edge, and which kind.
 *
 * The old rule was one absolute cutoff on raw cosine: >= 0.70 became `referenced by`, > 0.85 became
 * `iteration of`. Two things went wrong with that as a project grew.
 *
 * A raw cosine from `text-embedding-3-small` has no absolute meaning. Unrelated short texts sit
 * comfortably in the 0.7-0.8 band, so 0.70 was at or below the noise floor -- and because only the
 * single best match was ever considered, every new card got an edge as long as *something* on the
 * canvas cleared it. The chance of that approaches certainty as the canvas fills, so edge count
 * grew by roughly one per generated card forever.
 *
 * Worse, the winner was systematically the wrong card. A long, topic-summarising title sits near
 * the centroid of the whole project's subject matter, so it beats everything on cosine and collects
 * edges from cards that have nothing to do with each other. That is what turns the canvas into
 * spaghetti, and because salience weights degree and cross-tree links, a spurious hub also hijacks
 * which cards get promoted at Overview.
 *
 * Three gates, in the order they do work:
 *
 * 1. **Level** -- the score has to clear an absolute floor. This gate only became meaningful once
 *    the embedding text stopped carrying `Card label:/Card title:/Card description:` scaffolding
 *    (see `EMBEDDING_TEXT_VERSION`); with that constant component gone, scores spread across the
 *    whole range instead of bunching in a narrow band near the top.
 * 2. **Separation** -- whatever is accepted has to be clear of the best thing rejected. A card
 *    equally similar to twelve others is not meaningfully similar to any of them, and this is the
 *    gate that actually kills a hub: its runner-up is always right behind it.
 * 3. **Degree** -- a card that has already collected enough automatic edges takes no more, which
 *    caps the damage whatever the scores say.
 *
 * Every threshold below was measured, not guessed. Probing a real project with known-good and
 * known-bad pairs (exact duplicate, paraphrase, revision, sibling requirement, same-topic-but-
 * different, unrelated, gibberish) gave:
 *
 *     absolute score   linked [0.73..1.00]  rejected [0.16..0.65]   separates
 *     margin           linked [0.26..0.56]  rejected [0.00..0.25]   separates
 *     robust z-score   linked [1.93..4.93]  rejected [1.50..2.73]   OVERLAPS
 *
 * The z-score was the original idea here -- a self-calibrating bar that would rise as a project's
 * cards grew more alike -- and it does not survive contact with the data. Its denominator depends
 * on how topically central the query card happens to be, so a broad summarising card gets a small z
 * for an unmistakable match while an unrelated card gets a large one against a tight cohort. It is
 * still computed and stored on the edge, because it is useful evidence when revisiting these
 * numbers, but it is deliberately **not** a gate.
 *
 * What survives of the self-calibrating idea is narrower and does hold up: when there is no
 * runner-up to measure against, the cohort's own median stands in as the separation reference.
 */

export type SimilarityCandidate = {
    existingCardId: string;
    similarity: number;
};

export type SimilarityBaseline = {
    median: number;
    mad: number;
    sampled: number;
};

export type SimilarityMatch = {
    newCardId: string;
    candidates: SimilarityCandidate[];
    baseline: SimilarityBaseline | null;
};

export type SimilarityKind = "referenced_by" | "iteration_of";

export type SimilarityVerdict = {
    existingCardId: string;
    kind: SimilarityKind;
    similarity: number;
    /** How many MADs above the cohort median, or null when the cohort was too small to calibrate. */
    z: number | null;
    /** Gap to the best rejected candidate. */
    margin: number;
};

/** Card facts the `iteration of` test needs, looked up from the live canvas. */
export type IterationEvidence = {
    title: string;
    createdAtMs: number | null;
};

export type DecideSimilarityOptions = {
    /** Facts about the new card and any candidate, from the live graph. */
    evidenceOf: (cardId: string) => IterationEvidence | null;
    /** Automatic edges a candidate already carries. */
    autoDegreeOf: (cardId: string) => number;
    /**
     * Thresholds to use instead of the shipped ones. **Never passed in the product** — the canvas
     * always runs the measured values below.
     *
     * It exists for the evaluation harness (`src/eval/`), which answers "what does each gate
     * actually contribute" by replaying real card pairs with one gate relaxed at a time. That
     * question can only be asked of *this* function: a second copy of the rule written next to the
     * measurements would be measuring the copy. Setting `ABSOLUTE_FLOOR` to 0 disables the level
     * gate, `SEPARATION_MARGIN` to 0 the separation gate, `MAX_AUTO_DEGREE` to `Infinity` the cap.
     */
    tuning?: Partial<SimilarityTuning>;
};

/**
 * Measured: rejected pairs topped out at 0.65, accepted ones started at 0.73. Sitting in that gap
 * rather than at either edge of it, because it was measured on one project.
 */
const ABSOLUTE_FLOOR = 0.7;
/**
 * Gap an accepted match must hold over the best rejected one. Measured: rejected pairs topped out
 * at 0.25 and accepted ones started at 0.26, which is too thin to sit inside, so this is set below
 * the observed boundary and leans on the floor above to reject what falls through. The two
 * together classified all eight probes correctly.
 */
const SEPARATION_MARGIN = 0.15;
/** Converts a MAD into a standard-deviation equivalent for normally distributed data. */
const MAD_TO_SIGMA = 0.6745;
/** Below this the cohort is too small to describe its own spread and no z is reported. */
const MIN_COHORT_FOR_STATS = 8;
/** A cohort of near-identical cards has a MAD near zero, which would make any z explode. */
const MIN_MAD = 0.01;
/** At most this many automatic edges per newly created card. */
const MAX_EDGES_PER_NEW_CARD = 2;
/**
 * How close a runner-up has to be to the best match to count as the same find rather than a second,
 * weaker one. Two genuine near-duplicates of a new card should both be linked; a merely-decent
 * second place should not ride in on the first one's coat-tails.
 */
const TWIN_DELTA = 0.03;
/** A card already carrying this many automatic edges takes no more. */
const MAX_AUTO_DEGREE = 6;

/** `iteration of` claims one card supersedes another, so it needs more than a high score. */
const ITERATION_FLOOR = 0.8;
const ITERATION_TITLE_OVERLAP = 0.5;

export type SimilarityTuning = {
    ABSOLUTE_FLOOR: number;
    MIN_COHORT_FOR_STATS: number;
    SEPARATION_MARGIN: number;
    TWIN_DELTA: number;
    MAX_EDGES_PER_NEW_CARD: number;
    MAX_AUTO_DEGREE: number;
    ITERATION_FLOOR: number;
    ITERATION_TITLE_OVERLAP: number;
};

const SHIPPED_TUNING: SimilarityTuning = {
    ABSOLUTE_FLOOR,
    MIN_COHORT_FOR_STATS,
    SEPARATION_MARGIN,
    TWIN_DELTA,
    MAX_EDGES_PER_NEW_CARD,
    MAX_AUTO_DEGREE,
    ITERATION_FLOOR,
    ITERATION_TITLE_OVERLAP,
};

/** The shipped values, with any harness override laid over them. */
function resolveTuning(overrides: Partial<SimilarityTuning> | undefined): SimilarityTuning {
    return overrides === undefined ? SHIPPED_TUNING : { ...SHIPPED_TUNING, ...overrides };
}

export function robustZScore(similarity: number, baseline: SimilarityBaseline | null): number | null {
    if (!baseline) return null;
    if (baseline.sampled < MIN_COHORT_FOR_STATS) return null;
    if (!Number.isFinite(baseline.median) || !Number.isFinite(baseline.mad)) return null;
    const mad = Math.max(baseline.mad, MIN_MAD);
    return (MAD_TO_SIGMA * (similarity - baseline.median)) / mad;
}

/**
 * `iteration of` means *this replaces that*, which is a claim about time and wording, not only
 * about meaning. Requiring a second, independent signal to agree is what keeps it from firing on
 * two cards that merely share a topic -- the failure that produced
 * "Estimate fall risk" *iteration of* "Explore gait features correlation with recovery time".
 *
 * Deliberately not restricted to one activity tree: a later activity revising an earlier
 * activity's requirement is the most meaningful case there is, and a same-tree rule would drop it.
 */
function isIteration(
    similarity: number,
    newCardId: string,
    candidateId: string,
    options: DecideSimilarityOptions,
    tuning: SimilarityTuning,
): boolean {
    if (similarity < tuning.ITERATION_FLOOR) return false;

    const source = options.evidenceOf(newCardId);
    const target = options.evidenceOf(candidateId);
    if (!source || !target) return false;

    // The thing being superseded has to already exist.
    if (source.createdAtMs === null || target.createdAtMs === null) return false;
    if (target.createdAtMs >= source.createdAtMs) return false;

    return jaccardOverlap(tokenize(source.title), tokenize(target.title)) >= tuning.ITERATION_TITLE_OVERLAP;
}

/**
 * Verdicts for one new card, best first. Empty when nothing clears the gates — which is the common
 * and correct outcome.
 */
export function decideSimilarityEdges(
    match: SimilarityMatch,
    options: DecideSimilarityOptions,
): SimilarityVerdict[] {
    const tuning = resolveTuning(options.tuning);
    const ranked = match.candidates
        .filter((candidate) => candidate.existingCardId && candidate.existingCardId !== match.newCardId)
        .slice()
        .sort((a, b) => b.similarity - a.similarity);
    if (ranked.length === 0) return [];

    // A capped card cannot take another edge, so it is out of the running entirely rather than
    // sitting at the top of the list blocking everything behind it.
    const eligible = ranked.filter(
        (candidate) => options.autoDegreeOf(candidate.existingCardId) < tuning.MAX_AUTO_DEGREE,
    );

    const isStrong = (candidate: SimilarityCandidate): boolean => (
        Number.isFinite(candidate.similarity) && candidate.similarity >= tuning.ABSOLUTE_FLOOR
    );

    // What gets accepted is the tight cluster at the very top -- the best match plus anything
    // indistinguishable from it -- never a ranked prefix. Letting a merely-decent second place in
    // just because it beat a floor is what drags the whole set down to the noise, and then the
    // separation test below fails for a find that was actually good.
    const best = eligible[0];
    if (!best || !isStrong(best)) return [];

    const accepted = eligible
        .filter((candidate) => best.similarity - candidate.similarity <= tuning.TWIN_DELTA)
        .slice(0, tuning.MAX_EDGES_PER_NEW_CARD)
        .filter(isStrong);
    if (accepted.length === 0) return [];

    // The best thing left out is what the accepted cluster has to clear. With nothing left out, the
    // bar becomes "clear of a typical card in this cohort", which asks the same question of the
    // only comparison set available.
    const separationFloor = eligible[accepted.length]?.similarity ?? match.baseline?.median ?? 0;
    const weakest = accepted[accepted.length - 1].similarity;
    if (weakest - separationFloor < tuning.SEPARATION_MARGIN) return [];

    return accepted.map((candidate) => ({
        existingCardId: candidate.existingCardId,
        kind: isIteration(candidate.similarity, match.newCardId, candidate.existingCardId, options, tuning)
            ? "iteration_of"
            : "referenced_by",
        similarity: candidate.similarity,
        z: robustZScore(candidate.similarity, match.baseline),
        margin: candidate.similarity - separationFloor,
    }));
}

export const SIMILARITY_TUNING = SHIPPED_TUNING;
