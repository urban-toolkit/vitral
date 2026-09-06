import { useEffect, type RefObject } from "react";

import { locateReference } from "@/components/files/referenceLocation";

/**
 * Scroll an opened document to the passage a card was extracted from, and mark it.
 *
 * Works off the rendered text rather than the source, because that is the only representation all
 * four renderers share: markdown has been through `react-markdown`, a PDF is a text layer split
 * into a span per line, a notebook is a mix of prose and code. Flattening the rendered subtree into
 * one string and keeping an index back to the text nodes means the same code handles a quote that
 * sits inside one paragraph and one that runs across six PDF line spans.
 *
 * The mark uses the CSS Custom Highlight API, which paints over a `Range` without touching the DOM
 * -- important here, because the alternative (wrapping the match in an element) has to split text
 * nodes inside a subtree React owns and will re-render out from under it. Where the API is missing
 * the passage is still scrolled to, just not tinted; losing the tint is a much smaller loss than
 * losing the position.
 */

const HIGHLIGHT_NAME = "vitral-reference";

/** react-pdf renders each page's text layer asynchronously, so the text may not be there yet. */
const RETRY_DELAYS_MS = [0, 120, 400, 900, 1800];

/**
 * ...and then keep watching, because that schedule is not long enough for a PDF.
 *
 * Every page of a PDF is mounted at once and each builds its text layer on its own timer, so in a
 * document of any size the page holding the passage can still be empty when the last retry fires.
 * Rather than make everyone wait longer, watch the subtree and try again when text actually
 * arrives. Bounded, so a document that simply does not contain the quote stops costing anything.
 */
const OBSERVE_TIMEOUT_MS = 20_000;
/**
 * A text layer lands as a burst of hundreds of spans, and every retry walks the whole subtree, so
 * the coalesce window is what keeps this from turning one page render into a hundred full traversals.
 */
const OBSERVE_COALESCE_MS = 250;

/**
 * Elements that end a line of rendered text.
 *
 * Tag names rather than `getComputedStyle`, which would be a layout read per element on a subtree
 * that can hold thousands of them. The list only has to be right about the elements these four
 * renderers actually emit.
 */
const LINE_BREAKING_TAGS: ReadonlySet<string> = new Set([
    "BR", "P", "DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE", "HEADER", "FOOTER", "NAV",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "UL", "OL", "LI", "DL", "DT", "DD",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION",
    "PRE", "BLOCKQUOTE", "HR", "FIGURE", "FIGCAPTION",
]);

type TextIndexEntry = { node: Text; start: number };

/**
 * The rendered text under `root`, and an index from offsets in it back to the text nodes.
 *
 * **A block boundary counts as whitespace.** Walking text nodes alone concatenates straight across
 * every element that ends a line: `<p>one</p><p>two</p>` reads as `onetwo`, and a PDF is the worst
 * case of it, because pdf.js ends each line with a bare `<br>` that contributes no text node at all.
 * Every quote longer than one line would then match nothing -- which is most of them, and it would
 * have made turning the text layer on (`preview/PdfView.tsx`) look like it had not worked.
 *
 * The separator goes into `text` **without an entry of its own**, so the offsets still map to real
 * nodes. `normalizeForMatch` folds it into the surrounding whitespace, and a match can never begin
 * or end on whitespace -- the needle is trimmed and normalized before it is searched for -- so no
 * offset this hook resolves ever lands in the gap.
 */
function collectText(root: HTMLElement): { text: string; entries: TextIndexEntry[] } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const entries: TextIndexEntry[] = [];
    let text = "";
    let pendingBreak = false;

    let current = walker.nextNode();
    while (current) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            if (LINE_BREAKING_TAGS.has((current as Element).tagName)) pendingBreak = true;
            current = walker.nextNode();
            continue;
        }

        const node = current as Text;
        const value = node.nodeValue ?? "";
        if (value.length > 0) {
            // Never leading: a separator before the first character would only be trimmed away, and
            // it would push every offset one past where the caller expects it.
            if (pendingBreak && text.length > 0) text += "\n";
            pendingBreak = false;
            entries.push({ node, start: text.length });
            text += value;
        }
        current = walker.nextNode();
    }

    return { text, entries };
}

/** Which text node an offset into the flattened string falls in, and where inside it. */
function resolve(entries: TextIndexEntry[], offset: number): { node: Text; offset: number } | null {
    let low = 0;
    let high = entries.length - 1;
    let found: TextIndexEntry | null = null;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const entry = entries[mid];
        const length = entry.node.nodeValue?.length ?? 0;
        if (offset < entry.start) {
            high = mid - 1;
        } else if (offset >= entry.start + length) {
            low = mid + 1;
        } else {
            found = entry;
            break;
        }
    }

    if (!found) return null;
    return { node: found.node, offset: offset - found.start };
}

function clearHighlight() {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    registry?.delete(HIGHLIGHT_NAME);
}

function paint(range: Range) {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(range));
}

export function useReferenceHighlight(
    containerRef: RefObject<HTMLElement | null>,
    reference: string | null | undefined,
    /** Bumped whenever the rendered content changes, so the search runs again on new text. */
    contentKey: unknown,
) {
    useEffect(() => {
        const root = containerRef.current;
        const needle = typeof reference === "string" ? reference.trim() : "";
        if (!root || !needle) {
            clearHighlight();
            return;
        }

        let cancelled = false;
        const timers: number[] = [];
        let observer: MutationObserver | null = null;

        /** Stop looking, whether because the passage was found or because the effect is tearing down. */
        const stop = () => {
            cancelled = true;
            observer?.disconnect();
            observer = null;
            for (const timer of timers) window.clearTimeout(timer);
        };

        const attempt = () => {
            if (cancelled) return false;
            const { text, entries } = collectText(root);
            if (entries.length === 0) return false;

            const match = locateReference(text, needle);
            if (!match) return false;

            const from = resolve(entries, match.start);
            // `end` is exclusive, so the last included character is at `end - 1`; resolving that and
            // adding one keeps the range inside the node it lands in.
            const to = resolve(entries, Math.max(match.start, match.end - 1));
            if (!from || !to) return false;

            const range = document.createRange();
            try {
                range.setStart(from.node, Math.min(from.offset, from.node.nodeValue?.length ?? 0));
                range.setEnd(to.node, Math.min(to.offset + 1, to.node.nodeValue?.length ?? 0));
            } catch {
                return false;
            }

            paint(range);

            // Scroll the element the passage starts in, rather than the range: a Range has no
            // scrollIntoView, and the containing element is what the reader needs on screen.
            const anchor = from.node.parentElement;
            anchor?.scrollIntoView({ block: "center", behavior: "smooth" });
            return true;
        };

        // The document may still be rendering -- a lazily imported renderer, a PDF page's text
        // layer. Retry on a short decaying schedule and stop at the first hit.
        for (const delay of RETRY_DELAYS_MS) {
            timers.push(window.setTimeout(() => {
                if (cancelled) return;
                if (attempt()) stop();
            }, delay));
        }

        // And past the end of that schedule, react to the text arriving rather than guessing when.
        if (typeof MutationObserver !== "undefined") {
            let scheduled = false;
            observer = new MutationObserver(() => {
                if (cancelled || scheduled) return;
                scheduled = true;
                timers.push(window.setTimeout(() => {
                    scheduled = false;
                    if (cancelled) return;
                    if (attempt()) stop();
                }, OBSERVE_COALESCE_MS));
            });
            // `childList` only: a text layer arrives as new nodes, never as edits to existing ones,
            // so watching `characterData` would only multiply callbacks during the same burst.
            observer.observe(root, { childList: true, subtree: true });
            timers.push(window.setTimeout(() => {
                observer?.disconnect();
                observer = null;
            }, OBSERVE_TIMEOUT_MS));
        }

        return () => {
            stop();
            clearHighlight();
        };
    }, [containerRef, reference, contentKey]);
}
