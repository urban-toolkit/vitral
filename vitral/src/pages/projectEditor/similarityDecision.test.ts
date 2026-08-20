/**
 * Threshold regression check for `similarityDecision.ts`. Run with `npm run test:similarity`.
 *
 * The numbers in `measured` below were taken from probing a real project through
 * `POST /state/:id/cards/similarity` with pairs whose correct answer was known by construction --
 * an exact duplicate, a paraphrase, a revision, a sibling requirement, a same-topic-different-card,
 * an unrelated card, and gibberish. They are here so that changing a threshold, the embedding text,
 * or the embedding model has to explain itself against evidence rather than intuition.
 *
 * Kept inside `src` so `tsc` typechecks it against the module it exercises; it uses no Node-only
 * globals so it needs no separate tsconfig, and it runs standalone under esbuild + node.
 */

import { decideSimilarityEdges, robustZScore, type SimilarityMatch } from "@/pages/projectEditor/similarityDecision";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures += 1;
        console.log(`FAIL  ${name}\n      expected ${e}\n      actual   ${a}`);
    } else {
        console.log(`ok    ${name}  -> ${a}`);
    }
}

const noEvidence = {
    evidenceOf: () => null,
    autoDegreeOf: () => 0,
};

// A tight cohort where one card genuinely stands out.
const outlier: SimilarityMatch = {
    newCardId: "new",
    candidates: [
        { existingCardId: "a", similarity: 0.91 },
        { existingCardId: "b", similarity: 0.62 },
        { existingCardId: "c", similarity: 0.60 },
    ],
    baseline: { median: 0.60, mad: 0.03, sampled: 40 },
};
check("clear outlier links", decideSimilarityEdges(outlier, noEvidence).map((v) => v.existingCardId), ["a"]);

// The old failure: everything is similar to the hub, nothing stands out.
const flat: SimilarityMatch = {
    newCardId: "new",
    candidates: [
        { existingCardId: "hub", similarity: 0.78 },
        { existingCardId: "b", similarity: 0.775 },
        { existingCardId: "c", similarity: 0.77 },
    ],
    baseline: { median: 0.74, mad: 0.03, sampled: 40 },
};
check("flat cohort links nothing", decideSimilarityEdges(flat, noEvidence), []);

// Above the old 0.70 cutoff, but ordinary for this cohort.
const typical: SimilarityMatch = {
    newCardId: "new",
    candidates: [{ existingCardId: "a", similarity: 0.74 }],
    baseline: { median: 0.72, mad: 0.04, sampled: 60 },
};
check("high score, low z links nothing", decideSimilarityEdges(typical, noEvidence), []);

// Hub that has already collected its quota.
check(
    "degree cap blocks the hub",
    decideSimilarityEdges(outlier, { evidenceOf: () => null, autoDegreeOf: (id) => (id === "a" ? 6 : 0) }),
    [],
);

// Two genuine near-duplicates should both survive.
const twin: SimilarityMatch = {
    newCardId: "new",
    candidates: [
        { existingCardId: "a", similarity: 0.94 },
        { existingCardId: "b", similarity: 0.93 },
        { existingCardId: "c", similarity: 0.61 },
    ],
    baseline: { median: 0.60, mad: 0.03, sampled: 40 },
};
check("two strong twins both link", decideSimilarityEdges(twin, noEvidence).map((v) => v.existingCardId), ["a", "b"]);

// Tiny project: no cohort to calibrate against, so only floor + separation apply.
const tiny: SimilarityMatch = {
    newCardId: "new",
    candidates: [
        { existingCardId: "a", similarity: 0.88 },
        { existingCardId: "b", similarity: 0.55 },
    ],
    baseline: { median: 0.55, mad: 0.0, sampled: 2 },
};
check("small project still links a strong match", decideSimilarityEdges(tiny, noEvidence).map((v) => v.existingCardId), ["a"]);

check("weak match under the floor", decideSimilarityEdges({
    newCardId: "new",
    candidates: [{ existingCardId: "a", similarity: 0.41 }],
    baseline: { median: 0.20, mad: 0.02, sampled: 30 },
}, noEvidence), []);

// --- iteration_of ---
const iterationCandidates: SimilarityMatch = {
    newCardId: "new",
    candidates: [
        { existingCardId: "old", similarity: 0.93 },
        { existingCardId: "other", similarity: 0.60 },
    ],
    baseline: { median: 0.60, mad: 0.03, sampled: 40 },
};
const evidence: Record<string, { title: string; createdAtMs: number | null }> = {
    new: { title: "Compute gait characteristics from data v2", createdAtMs: 2_000 },
    old: { title: "Compute gait characteristics from data", createdAtMs: 1_000 },
    other: { title: "Unrelated", createdAtMs: 500 },
};
check(
    "revision of an older card is an iteration",
    decideSimilarityEdges(iterationCandidates, {
        evidenceOf: (id) => evidence[id] ?? null,
        autoDegreeOf: () => 0,
    }).map((v) => v.kind),
    ["iteration_of"],
);

// The real regression: topically close, but different wording -> referenced_by, not iteration_of.
const topical: Record<string, { title: string; createdAtMs: number | null }> = {
    new: { title: "Estimate fall risk", createdAtMs: 2_000 },
    old: { title: "Explore gait features correlation with recovery time and fall risk", createdAtMs: 1_000 },
};
check(
    "shared topic is not an iteration",
    decideSimilarityEdges(iterationCandidates, {
        evidenceOf: (id) => topical[id] ?? null,
        autoDegreeOf: () => 0,
    }).map((v) => v.kind),
    ["referenced_by"],
);

// Chronology matters: a card cannot be an iteration of something newer than it.
const backwards: Record<string, { title: string; createdAtMs: number | null }> = {
    new: { title: "Compute gait characteristics from data v2", createdAtMs: 1_000 },
    old: { title: "Compute gait characteristics from data", createdAtMs: 2_000 },
};
check(
    "cannot iterate on a newer card",
    decideSimilarityEdges(iterationCandidates, {
        evidenceOf: (id) => backwards[id] ?? null,
        autoDegreeOf: () => 0,
    }).map((v) => v.kind),
    ["referenced_by"],
);

check("z is null for a tiny cohort", robustZScore(0.9, { median: 0.5, mad: 0.05, sampled: 3 }), null);

// --- Measured against a real project. Each row is `[name, shouldLink, best, runnerUp, median, mad]`
// from probing the gait-study canvas with known-good and known-bad requirement cards.
const measured: Array<[string, boolean, number, number, number, number]> = [
    ["exact duplicate", true, 1.000, 0.444, 0.230, 0.114],
    ["paraphrase", true, 0.732, 0.453, 0.197, 0.073],
    ["revision", true, 0.844, 0.398, 0.229, 0.113],
    ["close rewrite of a long card", true, 0.926, 0.671, 0.427, 0.174],
    ["sibling requirement", false, 0.650, 0.402, 0.238, 0.102],
    ["same topic, different card", false, 0.610, 0.508, 0.390, 0.099],
    ["unrelated domain", false, 0.320, 0.203, 0.120, 0.060],
    ["gibberish", false, 0.161, 0.159, 0.090, 0.023],
];
for (const [name, shouldLink, best, runnerUp, median, mad] of measured) {
    const verdicts = decideSimilarityEdges({
        newCardId: "new",
        candidates: [
            { existingCardId: "best", similarity: best },
            { existingCardId: "second", similarity: runnerUp },
        ],
        baseline: { median, mad, sampled: 13 },
    }, noEvidence);
    check(`measured: ${name}`, verdicts.length > 0, shouldLink);
}

// The hub that motivated all of this: everything is similar to it, so nothing stands out.
check("hub cohort links nothing", decideSimilarityEdges({
    newCardId: "new",
    candidates: [
        { existingCardId: "hub", similarity: 0.96 },
        { existingCardId: "b", similarity: 0.955 },
        { existingCardId: "c", similarity: 0.95 },
    ],
    baseline: { median: 0.94, mad: 0.01, sampled: 30 },
}, noEvidence), []);

if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} similarity decision check(s) failing`);
}
console.log("ALL PASS");
