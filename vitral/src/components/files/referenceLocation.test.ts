/**
 * Behaviour check for `referenceLocation.ts`. Run with `npm run test:reference-location`.
 *
 * The failure this guards against is the quiet one: the source panel opens, nothing scrolls, and
 * the reader has no way to tell whether the passage is missing or the search is broken. So the
 * cases here are the ways a stored excerpt legitimately differs from the rendered document --
 * rewrapped lines, lost markdown syntax, a model-added quote mark, a tidied tail -- plus the floor
 * that stops a short prefix from matching a coincidence.
 *
 * Kept inside `src` so `tsc` typechecks it against the module it exercises; it uses no DOM and no
 * Node-only globals, and runs standalone under esbuild + node.
 */

import { locateReference, normalizeForMatch, REFERENCE_MATCH_TUNING } from "@/components/files/referenceLocation";

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

/** What the reader sees, with the line breaks a PDF text layer or a wrapped paragraph would have. */
const DOC = [
    "Introduction",
    "",
    "The specialists emphasised that analyses are exploratory and",
    "rarely   follow a fixed sequence of steps, which shaped the tool.",
    "",
    "They also asked to export the data as CSV for the clinical report.",
].join("\n");

const sliceOf = (match: { start: number; end: number } | null) =>
    (match ? DOC.slice(match.start, match.end).replace(/\s+/g, " ") : null);

// --- the easy case -----------------------------------------------------------------------------

check("finds a quote inside one line",
    sliceOf(locateReference(DOC, "export the data as CSV")),
    "export the data as CSV");

// --- the cases that make an exact indexOf useless ----------------------------------------------

check("matches across a line break",
    sliceOf(locateReference(DOC, "analyses are exploratory and rarely follow a fixed sequence")),
    "analyses are exploratory and rarely follow a fixed sequence");

check("ignores runs of whitespace in the document",
    sliceOf(locateReference(DOC, "rarely follow a fixed sequence of steps")),
    "rarely follow a fixed sequence of steps");

check("is case-insensitive",
    sliceOf(locateReference(DOC, "THE SPECIALISTS EMPHASISED")),
    "The specialists emphasised");

check("tolerates quote marks the model added",
    sliceOf(locateReference(DOC, "“export the data as CSV”")),
    "export the data as CSV");

check("tolerates a leading ellipsis",
    sliceOf(locateReference(DOC, "...export the data as CSV")),
    "export the data as CSV");

// --- degrading by shortening, not by loosening --------------------------------------------------

{
    // The model kept the opening verbatim and then paraphrased the tail, which is the common shape
    // of a near-miss. A prefix of the quote is still the quote.
    const match = locateReference(DOC, "The specialists emphasised that analyses are exploratory and rarely follow any predetermined order whatsoever");
    check("falls back to a prefix", sliceOf(match)?.startsWith("The specialists emphasised that analyses are exploratory"), true);
    check("a prefix match reports itself as inexact", match?.exact, false);
    check("a whole-quote match reports itself as exact", locateReference(DOC, "export the data as CSV")?.exact, true);
}

{
    // The case that motivated searching windows rather than prefixes, taken from a real project:
    // the model rewrote the *opening* of the quote and left the rest verbatim, so every prefix of
    // it is wrong while almost all of it is exact.
    const match = locateReference(DOC, "The analyses are exploratory and rarely follow a fixed sequence of steps");
    check("recovers when the quote diverges at the front",
        sliceOf(match), "analyses are exploratory and rarely follow a fixed sequence of steps");
    check("a front-divergent match is inexact", match?.exact, false);
}

// --- the floor that stops a coincidence ----------------------------------------------------------

{
    // A short run of a long quote is not evidence that the document says what the card claims.
    // Measured against a real project, a six-word window of a thirty-word quote landed on an
    // unrelated sentence, which is worse than not moving at all.
    const longQuote = [
        "Be able to see two different groups of data or two different patients side by side",
        "with linked brushing and a shared colour scale across every panel of the report",
    ].join(", ");
    check("a short run of a long quote is refused", locateReference(DOC, longQuote), null);

    // ...but the same run, as most of a short quote, is the quote.
    check("the same run carries a short quote",
        sliceOf(locateReference(DOC, "asked to export the data as CSV")),
        "asked to export the data as CSV");
}


check("a quote that is simply absent finds nothing",
    locateReference(DOC, "the participants requested a heatmap of weekly totals per district"), null);

check("a short quote is not padded out into a match",
    locateReference(DOC, "the and of"), null);

check("empty inputs are safe", [
    locateReference(DOC, ""),
    locateReference("", "anything at all in here"),
    locateReference(DOC, "   "),
], [null, null, null]);

// --- offsets point into the original text, not the normalized one ---------------------------------

{
    const match = locateReference(DOC, "clinical report");
    check("offsets index the original string", DOC.slice(match!.start, match!.end), "clinical report");
}

// --- normalization keeps a usable map -------------------------------------------------------------

{
    const { text, map } = normalizeForMatch("  Hello   World  ");
    check("normalization collapses and trims", text, "hello world");
    check("map has one entry per output character", map.length, text.length);
    check("map points back at the original characters", "  Hello   World  "[map[6]], "W");
}

check("the prefix floor is stated in the module", [
    REFERENCE_MATCH_TUNING.MIN_PREFIX_WORDS >= 4,
    REFERENCE_MATCH_TUNING.MIN_PREFIX_CHARS >= 16,
], [true, true]);

if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} reference location check(s) failing`);
}
console.log("ALL PASS");
