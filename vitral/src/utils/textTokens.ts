/**
 * Cheap lexical overlap, shared by the two places that need a second opinion on whether two cards
 * are about the same thing: phase clustering (`canvasClusters.ts`) and the `iteration of` test
 * (`similarityDecision.ts`).
 *
 * It exists precisely because it is *independent* of the embeddings. Where an embedding says two
 * cards occupy similar meaning-space, this says they reuse the same words — and requiring both to
 * agree is what makes a claim as strong as "this supersedes that" defensible without a better
 * model.
 */

const STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "into", "onto", "was", "were", "are",
    "has", "have", "had", "its", "our", "their", "his", "her", "not", "but", "all", "any", "can",
    "how", "why", "what", "when", "where", "who", "which", "about", "over", "under", "than",
    "then", "them", "they", "she", "him", "you", "your", "out", "off", "per", "via", "new",
]);

/** Lowercased words of three or more characters, stopwords dropped. */
export function tokenize(...parts: Array<string | undefined | null>): Set<string> {
    const tokens = new Set<string>();
    for (const raw of parts.join(" ").toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3) continue;
        if (STOPWORDS.has(raw)) continue;
        tokens.add(raw);
    }
    return tokens;
}

/** Shared tokens over combined tokens. Zero when either side has nothing to compare. */
export function jaccardOverlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of small) {
        if (large.has(token)) shared += 1;
    }
    const union = a.size + b.size - shared;
    return union === 0 ? 0 : shared / union;
}
