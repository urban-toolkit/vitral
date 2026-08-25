/**
 * Behaviour check for `noteClassification.ts`. Run with `npm run test:note-classification`.
 *
 * The classifier is a guess, so what is worth pinning down is not which label any one sentence
 * gets -- that will drift as the cue table grows -- but the properties the note tool depends on:
 * the raw sentence survives untouched, an ambiguous note falls back instead of committing, a
 * `person` card is never minted from a role word alone, and the same input always classifies the
 * same way.
 *
 * Kept inside `src` so `tsc` typechecks it against the module it exercises; it uses no Node-only
 * globals so it needs no separate tsconfig, and it runs standalone under esbuild + node.
 */

import type { ProjectParticipant } from "@/config/types";
import { classifyNote, deriveNoteTitle } from "@/pages/projectEditor/noteClassification";

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

const participants: ProjectParticipant[] = [
    { id: "p1", name: "Ana", role: "Domain Expert" },
    { id: "p2", name: "You", role: "Researcher" },
];

// --- one clear case per label -------------------------------------------------------------

check("meeting -> activity",
    classifyNote("Kickoff meeting with the transport group").label, "activity");

check("need -> requirement",
    classifyNote("They need to compare two corridors side by side").label, "requirement");

check("finding -> insight",
    classifyNote("Turns out the analysts never follow a fixed sequence").label, "insight");

check("definition -> concept",
    classifyNote("Accessibility here refers to travel time under 30 minutes").label, "concept");

check("dataset -> object",
    classifyNote("The taxi dataset lives in a notebook on the shared drive").label, "object");

check("participant name -> person",
    classifyNote("Ana is joining the study as a second expert", participants).label, "person");

// --- the raw sentence is never rewritten --------------------------------------------------

const messy = "  we should CHECK whether  the pipeline drops rows.\n\nAna flagged it.  ";
check("description is the input, byte for byte",
    classifyNote(messy, participants).description, messy);

// --- ambiguity falls back rather than committing -------------------------------------------

// "should" (requirement) against "called" (concept): both fire at the same weight, so neither
// leads by the margin and the note is not committed to either reading.
const ambiguous = classifyNote("We should use what they called the corridor view");
check("tie falls back to insight", ambiguous.label, "insight");
check("tie is reported as weak", ambiguous.confidence, "weak");

const unscored = classifyNote("Colour ramp on the third panel");
check("no cues falls back to insight", unscored.label, "insight");
check("no cues is reported as weak", unscored.confidence, "weak");
check("no cues reports no reasons", unscored.matchedCues, []);

// --- person is never minted from a role word alone -----------------------------------------

const roleOnly = classifyNote("The domain expert walked us through the workflow");
check("role word alone does not produce a person", roleOnly.label === "person", false);

// A near-miss on a participant name must not match: "Anagram" is not "Ana".
const nearMiss = classifyNote("Anagram puzzles came up as an analogy", participants);
check("near-miss name does not produce a person", nearMiss.label === "person", false);

// --- a strong verdict reports why it decided ------------------------------------------------

const strong = classifyNote("Turns out the analysts never follow a fixed sequence");
check("strong verdict is reported as strong", strong.confidence, "strong");
check("strong verdict names its cue", strong.matchedCues.length > 0, true);

// --- titles clip, never paraphrase -----------------------------------------------------------

check("title takes the first sentence",
    deriveNoteTitle("Analysts work in bursts. That surprised everyone."),
    "Analysts work in bursts");

check("short note keeps its question mark",
    deriveNoteTitle("Do they ever revisit an old run?"),
    "Do they ever revisit an old run?");

const longTitle = deriveNoteTitle(
    "The specialists want to compare corridors across several years without exporting anything",
);
check("long title is clipped to budget", longTitle.length <= 61, true);
check("long title is a prefix of the note",
    "The specialists want to compare corridors across several years without exporting anything"
        .startsWith(longTitle.replace(/…$/, "")),
    true);

check("empty note still gets a title", deriveNoteTitle("   "), "Untitled");

// --- determinism ------------------------------------------------------------------------------

const twice = [
    classifyNote("Ana said the export step is the real pain", participants),
    classifyNote("Ana said the export step is the real pain", participants),
];
check("same input classifies identically", twice[0], twice[1]);

if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} note classification check(s) failing`);
}
console.log("ALL PASS");
