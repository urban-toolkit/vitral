/**
 * Properties of the evaluation metrics. Run with `npm run test:eval-metrics`.
 *
 * These numbers are going into a paper, so the arithmetic behind them has to be pinned before the
 * output is trusted. Every case below has a hand-computed answer stated in its own comment: a
 * document whose coverage is a fraction you can check by counting characters, an excerpt that was
 * tampered with, two runs whose overlap is known by construction, a corpus whose gates admit a
 * countable number of links.
 *
 * What is deliberately *not* tested here is the model. The benchmark runner calls a real model and
 * cannot assert anything about what comes back; this file asserts that whatever comes back is
 * measured correctly.
 *
 * Kept inside `src` so `tsc` typechecks it against the modules it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import {
    checkQuotation,
    containment,
    numericTokens,
    ORIGIN_CONTAINMENT,
    tallyDefects,
    tallyQuotations,
    unsupportedNumbers,
} from "@/eval/groundedness";
import {
    buildConsensus,
    spanOverlap,
    summariseConsensus,
} from "@/eval/consensus";
import {
    mean,
    measureRun,
    measureYieldStability,
    poolGroundedness,
    stdDev,
    unionLength,
} from "@/eval/shardingMetrics";
import {
    ablateGates,
    cosine,
    inputFromEmbeddings,
    median,
    replay,
    type EmbeddedCard,
} from "@/eval/crossLinkMetrics";
import type { EvalRun, EvalShard } from "@/eval/evalTypes";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean) {
    checks += 1;
    if (condition) return;
    failures += 1;
    console.log(`FAIL  ${label}`);
}

function equal(label: string, actual: unknown, expected: unknown) {
    check(
        `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
        JSON.stringify(actual) === JSON.stringify(expected),
    );
}

function close(label: string, actual: number, expected: number, tolerance = 1e-9) {
    check(`${label} (expected ~${expected}, got ${actual})`, Math.abs(actual - expected) <= tolerance);
}

// --- Fixtures -----------------------------------------------------------------------------------

function shard(extra: Partial<EvalShard> = {}): EvalShard {
    return {
        entity: "insight",
        label: "insight",
        title: "A finding",
        description: "",
        reference: "",
        ...extra,
    };
}

function run(extra: Partial<EvalRun> = {}): EvalRun {
    return {
        document: "doc.md",
        runIndex: 0,
        config: "baseline",
        model: "test",
        promptName: "CardsFromText",
        sourceText: "",
        contextText: "",
        shards: [],
        elapsedMs: 0,
        ...extra,
    };
}

/** 100 characters exactly, so coverage fractions can be read off by eye. */
const DOC = [
    "The participants asked which parts the tool wrote down.", // 55 chars, [0,55)
    " Analyses are exploratory and rarely fixed.",             // 43 chars, [55,98)
    " Ok.",                                                    //  4 chars, [98,102)
].join("");

// --- 1. The quotation oracle --------------------------------------------------------------------
{
    equal("a verbatim quote is exact", checkQuotation(DOC, "which parts the tool wrote down").verdict, "exact");
    equal("case and spacing do not matter",
        checkQuotation(DOC, "  WHICH   PARTS the tool wrote   down ").verdict, "exact");

    // The model tidied the tail. Most of a long quote is still present as one run, so this is drift
    // rather than fabrication, and conflating the two would inflate the headline number.
    equal("a drifted tail is partial",
        checkQuotation(DOC, "The participants asked which parts the tool produced").verdict, "partial");

    // Nothing in the document says this. Above the coincidence floor, so it is a real verdict.
    equal("an invented sentence is absent",
        checkQuotation(DOC, "Every participant preferred the second prototype by a wide margin").verdict,
        "absent");

    // A non-answer is not a lie, and must not land in the same bucket.
    equal("no excerpt at all is missing", checkQuotation(DOC, "").verdict, "missing");
    equal("whitespace is also missing", checkQuotation(DOC, "   ").verdict, "missing");

    // All three of the following came out of the first real benchmark run, and each needs its own
    // verdict. Substring matching cannot separate them: the model reformats, so `locateReference`
    // returns null for all three and would call every one a fabrication.

    // (a) Reassembled: the model joined two real passages with a semicolon. No contiguous run
    // resolves, so the citation is broken — but every word is the document's and nothing was made
    // up. Reporting this as hallucination would be wrong about the model and about the fix.
    // Three short fragments of the document, stitched together. No six-word window of the result
    // occurs anywhere in the source, so nothing resolves; every content word is still the
    // document's own.
    equal("reassembled real material is not a fabrication",
        checkQuotation(DOC, "rarely fixed; participants asked; the tool wrote down").verdict,
        "reassembled");

    // (b) Context: asked to quote the artifact, the model handed back a line from the study
    // settings injected beside it. Note it is *not* a substring of the JSON either — the model
    // rewrote the punctuation — which is exactly why containment does this and the matcher cannot.
    const CONTEXT = '{"projectTitle":"Benchmark study","participants":[{"name":"P01","role":"domain expert"}]}';
    equal("quoting the injected context is its own verdict",
        checkQuotation(DOC, 'participants: [{ name: "P01", role: "domain expert" }]', CONTEXT).verdict,
        "context");
    // With no context supplied there is no evidence for that verdict, so it is not guessed at.
    equal("and is absent when there is no context to check",
        checkQuotation(DOC, 'participants: [{ name: "P01", role: "domain expert" }]').verdict,
        "absent");

    // (c) The artifact wins a tie: a shard claims to quote the document it came from.
    equal("a passage in both is credited to the artifact",
        checkQuotation(DOC, "which parts the tool wrote down", DOC).verdict, "exact");

    // Containment is what separates them, and it is asymmetric on purpose.
    close("an excerpt built entirely from the text is fully contained",
        containment("participants asked which parts", DOC), 1);
    check("and an invented one is not",
        containment("Every participant preferred the second prototype", DOC) < ORIGIN_CONTAINMENT);

    const located = checkQuotation(DOC, "Analyses are exploratory");
    check("a located quote reports where it is", located.span !== null);
    if (located.span) {
        equal("and the offsets index the source",
            DOC.slice(located.span.start, located.span.end), "Analyses are exploratory");
    }
}

// --- 2. The rate is over what was claimed, not over everything -----------------------------------
// A run of four shards where one quoted nothing: the denominator is 3, not 4. Counting the silent
// one as grounded would reward a model for declining to cite.
{
    const tally = tallyQuotations([
        { verdict: "exact", span: null },
        { verdict: "partial", span: null },
        { verdict: "absent", span: null },
        { verdict: "missing", span: null },
    ]);
    equal("claimed excludes the silent shard", tally.claimed, 3);
    close("and the absent rate is one in three", tally.absentRate ?? -1, 1 / 3);

    // The two rates answer different questions and must not be collapsed. Of four claims, one
    // resolves; three do not; only one of those three was invented.
    const split = tallyQuotations([
        { verdict: "exact", span: null },
        { verdict: "reassembled", span: null },
        { verdict: "context", span: null },
        { verdict: "absent", span: null },
    ]);
    equal("every excerpt is a claim", split.claimed, 4);
    close("fabrication counts only the invented one", split.absentRate ?? -1, 1 / 4);
    close("but three citations in four will not resolve", split.unresolvedRate ?? -1, 3 / 4);

    equal("nothing claimed reports no rate", tallyQuotations([{ verdict: "missing", span: null }]).absentRate, null);
}

// --- 3. Numbers written into prose ---------------------------------------------------------------
{
    equal("thousands separators are stripped",
        Array.from(numericTokens("49,768 curb ramps")), ["49768"]);
    equal("decimals survive", Array.from(numericTokens("a score of 0.85")), ["0.85"]);

    // The whole reason this compares token sets rather than substrings: "40" really does occur
    // inside "1408", and a substring test would call an invented figure supported.
    equal("a number is not found inside a longer one",
        unsupportedNumbers("the run took 1408 seconds", "40 attributes"), ["40"]);

    // The week-4 example, which is exactly this case: the source writes 49,768 and the model 49768.
    equal("a reformatted figure is supported",
        unsupportedNumbers("Downloaded 49,768 curb ramps", "49768 curb ramps"), []);

    equal("an invented figure is reported",
        unsupportedNumbers("the dataset has 40 attributes", "40 attributes across 12 cities"), ["12"]);
}

// --- 4. The defect audit -------------------------------------------------------------------------
{
    const tally = tallyDefects([
        shard({ entity: "finding", title: "Invented kind" }),
        shard({ title: "" }),
        shard({ title: "Same", reference: "x" }),
        shard({ title: "Same", reference: "x" }),
    ]);
    // `finding` is not one of the six the ontology defines; the pipeline stores it and draws it as
    // an object, so it is silently possible and worth counting.
    equal("an out-of-vocabulary entity is counted", tally.outOfVocabulary, 1);
    equal("an empty title is counted", tally.emptyTitle, 1);
    // All four lack a description; the first two lack an excerpt.
    equal("empty descriptions are counted", tally.emptyDescription, 4);
    equal("empty excerpts are counted", tally.emptyReference, 2);
    // Only the second of the identical pair counts, so a duplicated shard costs one, not two.
    equal("a duplicate within a run is counted once", tally.duplicate, 1);
}

// --- 5. Spans, unions and coverage ---------------------------------------------------------------
{
    equal("disjoint spans add up", unionLength([{ start: 0, end: 10 }, { start: 20, end: 25 }]), 15);
    equal("overlapping spans are merged",
        unionLength([{ start: 0, end: 10 }, { start: 5, end: 20 }]), 20);
    equal("a contained span adds nothing",
        unionLength([{ start: 0, end: 30 }, { start: 5, end: 10 }]), 30);
    equal("touching spans merge", unionLength([{ start: 0, end: 10 }, { start: 10, end: 15 }]), 15);
    equal("empty spans are ignored", unionLength([{ start: 5, end: 5 }]), 0);

    // Overlap is measured against the *shorter* span, so a run that quoted a longer passage around
    // the same sentence is still recognised as having found the same shard.
    close("a contained span fully overlaps",
        spanOverlap({ start: 0, end: 100 }, { start: 10, end: 20 }), 1);
    close("half of the shorter span is a half",
        spanOverlap({ start: 0, end: 10 }, { start: 5, end: 15 }), 0.5);
    equal("disjoint spans do not overlap",
        spanOverlap({ start: 0, end: 10 }, { start: 10, end: 20 }), 0);
}

// --- 6. One run, measured end to end -------------------------------------------------------------
// Two shards quoting [0,55) and [55,98) of a 102-character document, and one fabrication.
{
    const metrics = measureRun(run({
        sourceText: DOC,
        shards: [
            shard({ label: "insight", reference: "The participants asked which parts the tool wrote down." }),
            shard({ label: "requirement", reference: "Analyses are exploratory and rarely fixed." }),
            shard({ label: "insight", reference: "Every participant preferred the second prototype by a wide margin" }),
        ],
    }));

    equal("shards are counted", metrics.shards, 3);
    equal("the label mix is reported", metrics.labelMix, { insight: 2, requirement: 1 });
    equal("two quotes were verbatim", metrics.quotations.exact, 2);
    equal("and one was fabricated", metrics.quotations.absent, 1);
    close("so a third of the claims are ungrounded", metrics.quotations.absentRate ?? -1, 1 / 3);

    // The first sentence is 55 characters and the second 42 (the space between them belongs to
    // neither quote), so 97 of the document's 102. The fabricated shard covers nothing.
    close("coverage is the located union over the source", metrics.coverage, 97 / 102);
    // No two located spans overlap, so nothing was shredded twice.
    close("redundancy is 1 when nothing overlaps", metrics.redundancy, 1);
}

// --- 6b. Redundancy notices a document shredded twice --------------------------------------------
{
    const metrics = measureRun(run({
        sourceText: DOC,
        shards: [
            shard({ reference: "The participants asked which parts the tool wrote down." }),
            shard({ reference: "participants asked which parts the tool wrote" }),
        ],
    }));
    close("coverage counts the union once", metrics.coverage, 55 / 102);
    check("redundancy exceeds 1 when two shards quote the same passage", metrics.redundancy > 1.5);
}

// --- 7. Consensus across runs --------------------------------------------------------------------
// Three runs. The first sentence is found by all three (reworded every time, which is the point of
// matching on spans); the second by one only.
{
    const first = "The participants asked which parts the tool wrote down.";
    const second = "Analyses are exploratory and rarely fixed.";
    const runs: EvalRun[] = [
        run({ runIndex: 0, sourceText: DOC, shards: [shard({ title: "Provenance was unclear", reference: first })] }),
        run({ runIndex: 1, sourceText: DOC, shards: [shard({ title: "Readers wanted attribution", reference: first })] }),
        run({
            runIndex: 2,
            sourceText: DOC,
            shards: [
                shard({ title: "Which parts did the tool write", reference: first }),
                shard({ title: "Analysis is exploratory", reference: second }),
            ],
        }),
    ];

    const clusters = buildConsensus(runs);
    equal("two distinct shards were found between the runs", clusters.length, 2);

    const summary = summariseConsensus(clusters, [0, 1, 2]);
    equal("one is unanimous", summary.unanimous, 1);
    equal("one was found once", summary.singleton, 1);
    equal("the unanimous one is in the majority too", summary.majority, 1);
    // Supports are 3/3 and 1/3, so the mean is 2/3.
    close("mean support averages the two", summary.meanSupport, 2 / 3);

    // Runs 0 and 1 agree completely (1.0); each agrees with run 2 on one of two clusters (0.5).
    close("pairwise agreement averages over run pairs", summary.meanPairwiseAgreement ?? -1, 2 / 3);
}

// --- 7b. A run that produced nothing still counts against agreement -------------------------------
// The reason `summariseConsensus` is given the run indices rather than deriving them: a total
// extraction failure contributes to no cluster and would otherwise vanish from the denominator,
// turning a failed run into perfect agreement among the survivors.
{
    const first = "The participants asked which parts the tool wrote down.";
    const clusters = buildConsensus([
        run({ runIndex: 0, sourceText: DOC, shards: [shard({ reference: first })] }),
        run({ runIndex: 1, sourceText: DOC, shards: [shard({ reference: first })] }),
        run({ runIndex: 2, sourceText: DOC, shards: [] }),
    ]);
    equal("the empty run adds no cluster", clusters.length, 1);

    const summary = summariseConsensus(clusters, [0, 1, 2]);
    equal("and the surviving shard was found by two runs", clusters[0].runsPresent, 2);
    close("so mean support is not 1", summary.meanSupport, 2 / 3);
    equal("nothing is unanimous", summary.unanimous, 0);
}

// --- 7c. Unlocatable shards fall back to titles ---------------------------------------------------
// A fabricated excerpt has no position in the source, so span matching cannot see it. Refusing to
// cluster it would quietly drop exactly the material the groundedness metric cares most about.
{
    const clusters = buildConsensus([
        run({ runIndex: 0, sourceText: DOC, shards: [shard({ title: "Latency budget exceeded", reference: "not in the document at all, invented" })] }),
        run({ runIndex: 1, sourceText: DOC, shards: [shard({ title: "Latency budget exceeded", reference: "also invented, quite differently" })] }),
    ]);
    equal("two ungrounded shards with the same title are one shard", clusters.length, 1);
    equal("found by both runs", clusters[0].runsPresent, 2);
}

// --- 8. Yield stability and pooling ---------------------------------------------------------------
{
    equal("mean of nothing is zero", mean([]), 0);
    close("mean averages", mean([2, 4, 6]), 4);
    // Sample sd of [2,4,6]: deviations 2,0,2 -> sum of squares 8, /2 = 4, sqrt = 2.
    close("sample standard deviation uses n-1", stdDev([2, 4, 6]), 2);
    equal("one value has no spread", stdDev([5]), 0);

    const runs = [4, 6, 5].map((count, index) => measureRun(run({
        runIndex: index,
        sourceText: DOC,
        shards: Array.from({ length: count }, () => shard()),
    })));
    const stability = measureYieldStability(runs);
    equal("three runs", stability.runs, 3);
    close("mean shard count", stability.meanShards, 5);
    equal("min and max bracket it", [stability.minShards, stability.maxShards], [4, 6]);
    close("coefficient of variation is sd over mean", stability.coefficientOfVariation ?? -1, 1 / 5);

    const pooled = poolGroundedness(runs);
    // Every fixture shard has an empty excerpt, so nothing was claimed and there is no rate.
    equal("no claims pools to no rate", pooled.pooled.absentRate, null);
    equal("and there are no per-run rates to average", pooled.perRunAbsentRate, []);
}

// --- 9. Cross-link replay -------------------------------------------------------------------------
{
    close("cosine of a vector with itself is 1", cosine([1, 2, 3], [1, 2, 3]), 1);
    close("orthogonal vectors score zero", cosine([1, 0], [0, 1]), 0);
    equal("a zero vector cannot be compared", cosine([0, 0], [1, 1]), 0);
    close("median of an even list averages the middle", median([1, 2, 3, 4]), 2.5);
    equal("median of nothing is zero", median([]), 0);
}

// --- 10. The gates admit what they are supposed to -------------------------------------------------
// Eight cards. Two are near-identical (the pair that should link); the other six are a flat cohort
// spread around each other, which is the hub case the separation gate exists to refuse.
{
    const axis = (index: number, jitter: number): number[] => {
        const vector = new Array<number>(8).fill(0.1);
        vector[index] = 1 + jitter;
        return vector;
    };
    const corpus: EmbeddedCard[] = [
        { id: "a1", label: "insight", title: "Sessions are long", createdAtMs: 1, embedding: axis(0, 0) },
        { id: "a2", label: "insight", title: "Sessions run long", createdAtMs: 2, embedding: axis(0, 0.001) },
        ...Array.from({ length: 6 }, (_unused, index) => ({
            id: `b${index}`,
            label: "insight",
            title: `Unrelated ${index}`,
            createdAtMs: 10 + index,
            embedding: axis(index + 1, 0),
        })),
    ];

    const input = inputFromEmbeddings(corpus);
    const shipped = replay(input, "shipped rule");
    // a1 and a2 point along the same axis, so they clear the floor and stand clear of the cohort.
    equal("the shipped rule links the near-duplicate pair", shipped.pairs, 1);
    check("and nothing else", shipped.links.every((link) => ["a1", "a2"].includes(link.sourceId)));

    const table = ablateGates(input);
    const byName = new Map(table.map((row) => [row.configuration, row]));

    // Defence in depth, and the ablation is what shows it: the flat cohort is refused by the level
    // floor *and* independently by the separation gate, so removing either one alone changes
    // nothing. Only removing both lets the hub form. An ablation that varied one gate at a time and
    // reported "no effect" for each would have concluded, wrongly, that neither gate does anything.
    equal("removing the level floor alone changes nothing", byName.get("no level floor")!.pairs, shipped.pairs);
    equal("removing the separation gate alone changes nothing",
        byName.get("no separation gate")!.pairs, shipped.pairs);

    const capless = byName.get("no degree cap")!;
    check("dropping the degree cap cannot admit fewer", capless.pairs >= shipped.pairs);

    const ungated = byName.get("no gates at all")!;
    check("with every gate removed the corpus links far more", ungated.pairs > shipped.pairs);
    check("and a hub forms", ungated.maxDegree > shipped.maxDegree);

    // The whole point of the override: it changes the thresholds, never the code being measured.
    equal("the shipped row is the default", replay(input, "x").pairs, shipped.pairs);
}

// --- 11. `person` cards are never offered ---------------------------------------------------------
// Excluded at both ends by `canAutoLink`: a name embeds into whatever surrounds it, so two people
// who attended the same kind of session look similar for reasons about neither of them.
{
    const twin = new Array<number>(4).fill(0.5);
    const corpus: EmbeddedCard[] = [
        { id: "p1", label: "person", title: "P04", createdAtMs: 1, embedding: twin },
        { id: "p2", label: "person", title: "P05", createdAtMs: 2, embedding: twin },
    ];
    equal("two identical person cards are not linked",
        replay(inputFromEmbeddings(corpus), "people").pairs, 0);
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} evaluation metric check(s) failed`);
}
console.log("ALL PASS");
