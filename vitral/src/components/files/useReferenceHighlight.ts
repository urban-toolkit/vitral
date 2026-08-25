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

type TextIndexEntry = { node: Text; start: number };

function collectText(root: HTMLElement): { text: string; entries: TextIndexEntry[] } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const entries: TextIndexEntry[] = [];
    let text = "";

    let current = walker.nextNode();
    while (current) {
        const node = current as Text;
        const value = node.nodeValue ?? "";
        if (value.length > 0) {
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
                if (attempt()) {
                    cancelled = true;
                }
            }, delay));
        }

        return () => {
            cancelled = true;
            for (const timer of timers) window.clearTimeout(timer);
            clearHighlight();
        };
    }, [containerRef, reference, contentKey]);
}
