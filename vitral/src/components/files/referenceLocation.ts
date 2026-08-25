/**
 * Finding the passage a card was extracted from, inside the document it came from.
 *
 * A card's `reference` is supposed to be a verbatim excerpt -- the extraction prompt asks for one --
 * but "verbatim" only holds against the text the model was shown, and that is not the text the
 * reader sees. Markdown gets rendered (`**bold**` loses its asterisks), a PDF's text layer breaks
 * lines wherever the page did, a notebook's source is reflowed, and the model itself is prone to
 * tidying a trailing comma. So an exact `indexOf` finds the passage in the easy cases and nothing at
 * all in the rest, which is the worst possible failure: the panel opens and silently does not move.
 *
 * The matching here is therefore deliberately forgiving in the two ways that cost nothing --
 * whitespace and case -- and then degrades by *shortening the needle* rather than by loosening it.
 * A prefix of the quote is still the quote; a fuzzy match of the whole quote could land anywhere.
 *
 * Kept free of the DOM so the interesting half can be tested (`npm run test:reference-location`).
 */

export type ReferenceMatch = {
    /** Offsets into the ORIGINAL haystack, not the normalized one. */
    start: number;
    end: number;
    /** False when only a leading portion of the reference could be found. */
    exact: boolean;
};

export const REFERENCE_MATCH_TUNING = {
    /**
     * Shortest window worth searching for, in words. Below this a "match" stops being evidence:
     * three or four common words will occur somewhere in any document of any length, and scrolling
     * the reader to a coincidence is worse than not scrolling them at all.
     */
    MIN_PREFIX_WORDS: 6,
    /** And in characters, for languages and quotes that do not split into many words. */
    MIN_PREFIX_CHARS: 24,
    /**
     * How much of a quote is considered when falling back. The window search is quadratic in this,
     * and a reference this long has already matched or already failed for a structural reason.
     */
    MAX_WINDOW_WORDS: 120,
    /**
     * How much of the quote a window has to account for.
     *
     * The word floor alone is not enough once windows can start anywhere: measured against a real
     * project, a six-word run of a thirty-word quote ("two different groups of data or") matched a
     * sentence that had nothing to do with the card. Six words is a long coincidence in isolation
     * and a weak one as a fraction of a long quote, and it is the fraction that says whether the
     * document really contains what the card claims.
     */
    MIN_COVERAGE: 0.5,
    /**
     * ...unless the run is simply long. A quote assembled out of several reformatted list items
     * may share no single long run with the document, but a fifteen-word verbatim stretch is the
     * passage whatever fraction of the quote it represents.
     */
    STRONG_WINDOW_WORDS: 12,
} as const;

/**
 * Collapse runs of whitespace and lowercase, keeping a map from each character in the result back
 * to its index in the input, so a match found in the normalized text can be reported against the
 * original.
 */
export function normalizeForMatch(raw: string): { text: string; map: number[] } {
    const out: string[] = [];
    const map: number[] = [];
    let pendingSpace = false;

    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];
        if (/\s/.test(char)) {
            // Leading whitespace is dropped entirely; interior runs collapse to one space, emitted
            // lazily so a trailing run never makes it into the result.
            if (out.length > 0) pendingSpace = true;
            continue;
        }
        if (pendingSpace) {
            out.push(" ");
            map.push(i);
            pendingSpace = false;
        }
        out.push(char.toLowerCase());
        map.push(i);
    }

    return { text: out.join(""), map };
}

/** Quote marks and ellipses the model likes to wrap an excerpt in, and that the document will not have. */
function trimQuoting(needle: string): string {
    return needle
        .trim()
        .replace(/^[\s"'‘’“”«»]+/, "")
        .replace(/[\s"'‘’“”«»]+$/, "")
        .replace(/^\.{3}|^…/, "")
        .replace(/\.{3}$|…$/, "")
        .trim();
}

/**
 * Locate `needle` in `haystack`, returning offsets into `haystack`.
 *
 * Tries the whole reference first, then progressively shorter prefixes of it, stopping well before
 * a prefix gets short enough to match by accident.
 */
export function locateReference(haystack: string, needle: string): ReferenceMatch | null {
    const cleaned = trimQuoting(needle ?? "");
    if (!cleaned || !haystack) return null;

    const hay = normalizeForMatch(haystack);
    const target = normalizeForMatch(cleaned);
    if (target.text.length === 0 || hay.text.length === 0) return null;

    const at = (normalizedStart: number, normalizedLength: number, exact: boolean): ReferenceMatch => {
        const start = hay.map[normalizedStart];
        // The map holds the index of each character's first byte, so the end of the match is one
        // past the last matched character's original index.
        const lastIndex = hay.map[normalizedStart + normalizedLength - 1];
        return { start, end: lastIndex + 1, exact };
    };

    const exactIndex = hay.text.indexOf(target.text);
    if (exactIndex >= 0) return at(exactIndex, target.text.length, true);

    const words = target.text.split(" ").slice(0, REFERENCE_MATCH_TUNING.MAX_WINDOW_WORDS);

    /*
     * The longest contiguous run of the quote that the document actually contains.
     *
     * Shortening only from the end is not enough, and real data says so: a model that quotes
     * "The first and last two seconds contain erroneous values" from a source reading "the data's
     * first and last two seconds contain erroneous values" has diverged at the *front*, and every
     * prefix of the quote is therefore wrong while almost all of it is verbatim. Sliding a window
     * covers that case and the mirror of it without loosening what counts as a match: a contiguous
     * run of the quote is still the quote, wherever in it that run happens to start.
     *
     * Longest-first, so the answer is the most evidence available rather than the first thing that
     * happens to hit, and bounded below by the same floors as before so a short run can never win.
     */
    const coversEnough = (length: number) => (
        length >= REFERENCE_MATCH_TUNING.STRONG_WINDOW_WORDS ||
        length / words.length >= REFERENCE_MATCH_TUNING.MIN_COVERAGE
    );

    for (let length = words.length - 1; length >= REFERENCE_MATCH_TUNING.MIN_PREFIX_WORDS; length -= 1) {
        if (!coversEnough(length)) break;
        for (let start = 0; start + length <= words.length; start += 1) {
            const window = words.slice(start, start + length).join(" ");
            if (window.length < REFERENCE_MATCH_TUNING.MIN_PREFIX_CHARS) continue;
            const index = hay.text.indexOf(window);
            if (index >= 0) return at(index, window.length, false);
        }
    }

    // A quote with no spaces at all (an identifier, a path) still deserves one try, on the same
    // character floor as the word windows.
    if (words.length === 1 && target.text.length >= REFERENCE_MATCH_TUNING.MIN_PREFIX_CHARS) {
        for (let length = target.text.length - 1; length >= REFERENCE_MATCH_TUNING.MIN_PREFIX_CHARS; length -= 1) {
            const index = hay.text.indexOf(target.text.slice(0, length));
            if (index >= 0) return at(index, length, false);
        }
    }

    return null;
}
