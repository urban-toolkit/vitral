/**
 * Which cards the document prints in full, and which it only names.
 *
 * ## Why there is a cut at all
 *
 * Every other rule in this generator says the document must not summarise: the report the reviewers
 * saw was superficial *because* it summarised, and length was supposed to go to the appendices. That
 * is still the right instinct and it is why the cut here is deliberately shy — but an appendix that
 * prints a description and a source quotation for every card in a growing study grows with it, and a
 * file nobody can read is not a record either. So the document now has two registers: cards it
 * *prints*, and cards it *names*. Nothing is dropped; `Also indexed` in Appendix A carries the rest,
 * and the front-matter totals still count them, because they are still in the document.
 *
 * ## Why rank by salience
 *
 * Because the canvas already does. `buildSalienceIndex` is what decides which cards Overview and
 * Threads promote out of a glyph, so a reader who has met the study on screen meets the same cards
 * first in the document. Reusing it is also the only way the two cannot drift: there is one rule
 * about what is central to this project, not two.
 *
 * ## The shape of the curve, and why it is not a constant
 *
 * A fixed top-N trims a 16-card thread and a 200-card thread to the same size, which reads as
 * arbitrary. The curve here has three regimes and each one answers a different objection:
 *
 * - **Up to `REPORT_KEEP_ALL_BELOW`, everything.** A cut that saves four rows is not worth the
 *   sentence explaining it, and small projects — every project, early on — must be unaffected.
 * - **Then a share, with a floor.** `REPORT_KEEP_SHARE` is the generous end on purpose: two thirds
 *   of a container survives, and `REPORT_KEEP_FLOOR` stops the share from taking a container below
 *   what it would have kept one card earlier, so the function is monotone across the boundary.
 * - **Then a ceiling.** `REPORT_KEEP_MAX` is the only term that actually bounds the file. Without it
 *   the share is still linear and the document still grows without limit.
 *
 * Pure, total, and free of any clock — `npm run test:report` pins the whole curve.
 */

/** A container this size or smaller prints every card it holds. */
export const REPORT_KEEP_ALL_BELOW = 15;

/** Above that, the share of a container that is printed in full. */
export const REPORT_KEEP_SHARE = 0.65;

/** ...but never fewer than this, so the curve does not step backwards at the boundary. */
export const REPORT_KEEP_FLOOR = 15;

/** ...and never more than this. This is the term that bounds the document's length. */
export const REPORT_KEEP_MAX = 40;

/**
 * How many of a container's cards are printed in full, given how many it holds.
 *
 * Monotone non-decreasing in `n`, and never greater than `n`:
 * `15 -> 15`, `20 -> 15`, `30 -> 20`, `50 -> 33`, `62 -> 40`, `200 -> 40`.
 */
export function emphasisKeepCount(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= REPORT_KEEP_ALL_BELOW) return n;
    return Math.min(
        n,
        REPORT_KEEP_MAX,
        Math.max(REPORT_KEEP_FLOOR, Math.ceil(n * REPORT_KEEP_SHARE)),
    );
}
