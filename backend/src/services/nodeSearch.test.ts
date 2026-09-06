/**
 * The label vocabulary, pinned.
 *
 * `canonicalCardLabel` is consulted from three places -- the parse prompt's sanitizer, the keyword
 * ranker, and the prompt text itself -- so a wrong mapping is wrong three times over, and the failure
 * is silent: the assistant simply answers about the wrong kind of card. The de-pluralisation is the
 * part that actually needed a test. A single `-es` rule reads correct and turns "notes" into "not".
 *
 * Run with `npm run test:node-search` (plain `tsx`, no bundler -- this is the backend).
 */
import {
    applyStructuredFilters,
    applyStructuredFiltersWithFallback,
    canonicalCardLabel,
    type CardNodeForSearch,
} from "./nodeSearch.js";

const cases: Array<[string, string]> = [
    // the seven, as themselves
    ["insight", "insight"], ["blueprint_component", "blueprint_component"],
    // plurals of the labels
    ["requirements", "requirement"], ["insights", "insight"], ["activities", "activity"],
    ["objects", "object"], ["concepts", "concept"], ["people", "person"],
    // the -es trap: these all used to resolve to a truncated stem
    ["notes", "object"], ["images", "object"], ["themes", "concept"],
    ["objectives", "requirement"], ["sketches", "object"],
    // synonyms, both numbers
    ["findings", "insight"], ["finding", "insight"], ["takeaways", "insight"],
    ["interviews", "activity"], ["workshops", "activity"], ["stakeholders", "person"],
    ["documents", "object"], ["datasets", "object"], ["transcripts", "object"],
    ["goals", "requirement"], ["tasks", "requirement"], ["criteria", "requirement"],
    ["components", "blueprint_component"], ["blueprint components", "blueprint_component"],
    ["system component", "blueprint_component"],
    // deliberately NOT mapped: ordinary domain vocabulary that would bias every query
    // An unmapped word comes back as itself, not as a stem: de-pluralisation is only ever a way to
    // find a mapping, never a transformation applied to the answer.
    ["data", "data"], ["user", "user"], ["users", "users"], ["code", "code"],
    ["study", "study"], ["result", "result"], ["learning", "learning"], ["view", "view"],
    // nonsense passes through, lowercased
    ["Widgets", "blueprint_component"], ["zzz", "zzz"], ["processes", "processes"],
];

let failures = 0;
for (const [input, expected] of cases) {
    const actual = canonicalCardLabel(input);
    if (actual !== expected) {
        failures += 1;
        console.log(`FAIL  ${JSON.stringify(input)} -> ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
}
const labelFailures = failures;

// --- the relaxation ladder ------------------------------------------------------------------------
//
// The chat's whole recall problem was that structured filters were absolute: one content word the
// parser lifted into `titleContains` deleted every semantically relevant card that did not spell it,
// and the embedding search then had nothing left to rank. What has to hold is that the ladder gives
// up the parser's *guesses* before the user's *statements*, and that it never invents matches.

function node(id: string, label: string, title: string, description = "", createdAt: string | null = null): CardNodeForSearch {
    return { id, label, title, description, createdAt };
}

const CARDS: CardNodeForSearch[] = [
    node("a1", "activity", "Kickoff workshop", "First session with the team", "2026-01-05T00:00:00.000Z"),
    node("r1", "requirement", "Compare districts", "Side by side over time", "2026-02-01T00:00:00.000Z"),
    node("r2", "requirement", "Filter by season", "Winter and summer split", "2026-03-01T00:00:00.000Z"),
    node("i1", "insight", "Analysts distrust gaps", "Missing sensor data reads as zero", "2026-03-05T00:00:00.000Z"),
];

const ids = (nodes: CardNodeForSearch[]) => nodes.map((n) => n.id).sort().join(",");

function expect(name: string, actual: unknown, wanted: unknown) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(wanted);
    if (a !== b) {
        failures += 1;
        console.log(`FAIL  ${name}: ${a}, expected ${b}`);
    }
}

// A constraint that matches is kept, untouched.
{
    const out = applyStructuredFiltersWithFallback(CARDS, { labels: ["requirement"] });
    expect("a label that matches is kept", [ids(out.nodes), out.relaxed], ["r1,r2", false]);
}

// A text guess that matches nothing is surrendered, and the label the user named survives it.
{
    const out = applyStructuredFiltersWithFallback(CARDS, {
        labels: ["requirement"],
        titleContains: ["choropleth"],
    });
    expect("an unmatched text guess is dropped, the label is not",
        [ids(out.nodes), out.relaxed], ["r1,r2", true]);
}

// Text guesses go before dates: a date is something a user says out loud.
{
    const out = applyStructuredFiltersWithFallback(CARDS, {
        createdAtFrom: "2026-02-15T00:00:00.000Z",
        titleContains: ["choropleth"],
    });
    expect("the date bound outlives the text guess", [ids(out.nodes), out.relaxed], ["i1,r2", true]);
}

/*
 * A label the user stated is never relaxed away.
 *
 * "Show me the person cards" on a project with no person cards has a true answer -- there are none --
 * and widening to the whole canvas replaces it with a false one, because the reply model is then
 * handed activities and requirements under a question about people. Guesses relax; statements do not.
 */
{
    const stated = applyStructuredFiltersWithFallback(CARDS, {
        labels: ["person"],
        titleContains: ["choropleth"],
    });
    expect("the text guess is surrendered but the stated label is not",
        [ids(stated.nodes), stated.relaxed], ["", true]);

    const statedAlone = applyStructuredFiltersWithFallback(CARDS, { labels: ["person"] });
    expect("a stated label that matches nothing answers nothing",
        [ids(statedAlone.nodes), statedAlone.relaxed], ["", false]);

    // ...whereas a filter made only of the parser's guesses relaxes all the way, which is the case
    // the ladder exists for.
    const guessAlone = applyStructuredFiltersWithFallback(CARDS, { titleContains: ["choropleth"] });
    expect("a guess that matches nothing relaxes to everything",
        [ids(guessAlone.nodes), guessAlone.relaxed], ["a1,i1,r1,r2", true]);
}

// No filters at all is not "relaxed" -- there was nothing to give up.
{
    const out = applyStructuredFiltersWithFallback(CARDS, undefined);
    expect("no filters is not a relaxation", [ids(out.nodes), out.relaxed], ["a1,i1,r1,r2", false]);
}

/*
 * The two text keys are ONE constraint over BOTH fields.
 *
 * They used to be two gates ANDed together -- a card had to contain one of `titleContains` in its
 * title *and* one of `descriptionContains` in its description -- so a parser that split one idea
 * across the two keys demanded the same thing be said twice, and a card whose title said it plainly
 * was dropped for not repeating itself in its description. Which key a phrase landed in was the
 * parser's guess, never a claim the user made.
 *
 * Merging them widens the filter, and that is the intended direction: this runs *before* ranking, so
 * a needle that over-matches costs precision the ranker then recovers, while one that under-matches
 * deletes the answer outright. The ladder above is the other half of the same argument.
 */
{
    // The needle is in the description, and it was asked for as a title constraint.
    const crossField = applyStructuredFilters(CARDS, { titleContains: ["missing sensor"] });
    expect("a title needle is honoured by a description match", ids(crossField), "i1");

    // And the two keys pool rather than intersect.
    const pooled = applyStructuredFilters(CARDS, {
        titleContains: ["districts"],
        descriptionContains: ["season"],
    });
    expect("needles from both keys are ORed, not ANDed", ids(pooled), "r1,r2");

    // A needle nothing contains still excludes -- widening is not the same as ignoring.
    const unmatched = applyStructuredFilters(CARDS, { titleContains: ["choropleth"] });
    expect("an unmatched needle still excludes everything", ids(unmatched), "");
}

console.log(`ok    ${cases.length - labelFailures}/${cases.length} label mappings`);
if (failures > 0) throw new Error(`${failures} nodeSearch check(s) failed`);
console.log("ALL PASS");
