import { locateReference } from "@/components/files/referenceLocation";
import { tokenize } from "@/utils/textTokens";
import type { EvalShard, Span } from "./evalTypes";

/**
 * Whether the model's claims are in the document it claims they came from.
 *
 * The extraction prompt asks for a `reference` that is verbatim from the source, and nothing in the
 * product checks it: `llmCardsToNodes` writes whatever came back. So the claim is auditable, has
 * never been audited, and is the single richest hallucination signal the system produces.
 *
 * The oracle is `locateReference`, the same function the citation affordance uses, reused rather
 * than reimplemented so the verdict is the product's own notion of "the document contains this".
 * Its coincidence floor was calibrated against a real project (`MIN_PREFIX_WORDS 6`,
 * `MIN_COVERAGE 0.5`, `STRONG_WINDOW_WORDS 12`) precisely to stop a short common run counting as
 * evidence, which is exactly the property a fabrication check needs.
 *
 * ## Five verdicts, because "the citation does not resolve" and "the model made it up" are
 * different failures
 *
 * Two verdicts would have been easier and wrong. `locateReference` answers one question — does a
 * contiguous run of this quote appear in the document — and a `null` from it bundles together a
 * model that invented a sentence, a model that reassembled two real bullet points into one line
 * with a semicolon, and a model that quoted the study context injected beside the document. The
 * first is hallucination. The second is a real finding whose citation happens not to resolve. The
 * third is a prompt bug. Reporting them as one number would be indefensible in either direction:
 * it overstates fabrication, and it hides two problems that have different fixes.
 *
 * All three of those were produced by the *first* benchmark run of a two-page markdown file, which
 * is why the taxonomy is this shape rather than something tidier.
 *
 * The separation is done by token **containment** rather than by loosening the matcher.
 * `locateReference` stays exactly as the product uses it, because the `exact`/`drifted` verdicts are
 * the product's own claim about itself and must not be measured with a kinder instrument. Whether
 * the words came from the document at all is a different question, and a set test answers it
 * without caring about punctuation, order or reflowing — which is precisely what defeats substring
 * matching here.
 */

export type QuotationVerdict =
    /** The whole excerpt is present, up to case and whitespace. The citation resolves. */
    | "exact"
    /** A long contiguous run of it is present; the quote drifted at an edge. It still resolves. */
    | "partial"
    /**
     * No contiguous run resolves, but nearly every word is the document's.
     *
     * The model reassembled real material — joining two list items with a semicolon, flattening a
     * markdown heading into the sentence beneath it. The *content* is grounded and the *citation* is
     * broken, so the reader clicks it and nothing highlights. A defect, and not a fabrication.
     */
    | "reassembled"
    /**
     * The words belong to the rest of the prompt — the file name, or the injected project-settings
     * block — rather than to the artifact.
     *
     * The model cited the wrong half of its input. Nothing was invented, so counting it as
     * hallucination would overstate the case; the fix is in the prompt, not the model.
     */
    | "context"
    /** The words are in neither the artifact nor the prompt. This is the fabrication rate. */
    | "absent"
    /** The model returned no excerpt at all. Counted separately: a non-answer is not a lie. */
    | "missing";

/**
 * How much of the excerpt's own vocabulary the haystack accounts for.
 *
 * Containment, not Jaccard: the context block and the document are both far longer than any one
 * excerpt, so a symmetric measure would be near zero for a quote that is entirely theirs. The
 * question is whether *this excerpt* is made of *that text's* words.
 *
 * `tokenize` is the tokenizer the `iteration of` test already uses — words of three characters or
 * more, minus a stopword list — so a short excerpt of common words cannot reach the threshold on
 * filler alone.
 */
export function containment(needle: string, haystack: string): number {
    const wanted = new Set(tokenize(needle));
    if (wanted.size === 0) return 0;
    const available = new Set(tokenize(haystack));
    let shared = 0;
    for (const token of wanted) if (available.has(token)) shared += 1;
    return shared / wanted.size;
}

/**
 * How much of an excerpt's vocabulary a text must account for to be called its origin.
 *
 * High on purpose. The two failures being separated here are "reassembled from this text" and
 * "invented", and the cost of getting it wrong is asymmetric: crediting a fabrication to the
 * document understates the hallucination rate, which is the one direction a paper must not err in.
 * At 0.8 an excerpt has to be almost entirely built from the text's own words.
 */
export const ORIGIN_CONTAINMENT = 0.8;

export type QuotationCheck = {
    verdict: QuotationVerdict;
    /** Where it was found, for the coverage metrics. Null unless `exact` or `partial`. */
    span: Span | null;
};

export function checkQuotation(
    sourceText: string,
    reference: string,
    contextText = "",
): QuotationCheck {
    if (typeof reference !== "string" || reference.trim() === "") {
        return { verdict: "missing", span: null };
    }
    const match = locateReference(sourceText, reference);
    if (match !== null) {
        return {
            verdict: match.exact ? "exact" : "partial",
            span: { start: match.start, end: match.end },
        };
    }

    // The artifact is asked first and wins ties: a shard claims to quote the document it came from,
    // so material present in both is the document's.
    if (containment(reference, sourceText) >= ORIGIN_CONTAINMENT) {
        return { verdict: "reassembled", span: null };
    }
    if (contextText !== "" && containment(reference, contextText) >= ORIGIN_CONTAINMENT) {
        return { verdict: "context", span: null };
    }
    return { verdict: "absent", span: null };
}

export type QuotationTally = {
    exact: number;
    partial: number;
    reassembled: number;
    context: number;
    absent: number;
    missing: number;
    /** Shards that claimed an excerpt, i.e. everything but `missing`. The denominator for both rates. */
    claimed: number;
    /**
     * `absent / claimed`. The **fabrication** rate: the excerpt's words are in neither the artifact
     * nor anything else the model was shown.
     */
    absentRate: number | null;
    /**
     * `(reassembled + context + absent) / claimed`. The **unresolvable citation** rate: the share of
     * excerpts that will not highlight anything when a reader clicks through to the source.
     *
     * Reported beside the fabrication rate rather than instead of it. It is the larger number and
     * the one the product promises against; the smaller one is what the model is culpable for.
     */
    unresolvedRate: number | null;
};

export function tallyQuotations(checks: readonly QuotationCheck[]): QuotationTally {
    const tally = { exact: 0, partial: 0, reassembled: 0, context: 0, absent: 0, missing: 0 };
    for (const check of checks) tally[check.verdict] += 1;
    const claimed = tally.exact + tally.partial + tally.reassembled + tally.context + tally.absent;
    return {
        ...tally,
        claimed,
        absentRate: claimed === 0 ? null : tally.absent / claimed,
        unresolvedRate: claimed === 0
            ? null
            : (tally.reassembled + tally.context + tally.absent) / claimed,
    };
}

/**
 * Numbers written into a shard's title or description that are not in the source.
 *
 * The excerpt is quoted; the title and description are *written*, and that is where a model invents
 * a figure. Numbers are the one kind of specific that can be checked without a language model of
 * one's own: they are exact, they are the claims a reader is most likely to reuse, and a wrong one
 * is unambiguously wrong.
 *
 * Compared as **token sets, never as substrings**. Asking whether "40" appears anywhere in the
 * source's digits would find it inside "1408" and call an invented figure supported.
 *
 * Thousands separators are stripped from both sides, because the model reformats them and the
 * difference is not a claim — the week-4 example already shows `49,768` coming back as `49768`.
 * Decimal points survive. This is an English-corpus assumption: a locale that writes `1,5` for
 * three-halves would be mis-normalised, and the benchmark corpus is deliberately English (the
 * server appends a translate-to-English instruction to every extraction prompt, which would
 * otherwise make a faithful excerpt match nothing at all).
 *
 * Deliberately conservative in one direction: a small number like `2` will often be present by
 * coincidence and be scored as supported. That understates fabrication rather than overstating it,
 * which is the right way for a claim like this to be wrong.
 */
const NUMERIC_TOKEN = /\d[\d,]*(?:\.\d+)?/g;

export function numericTokens(text: string): Set<string> {
    const found = new Set<string>();
    for (const raw of String(text ?? "").match(NUMERIC_TOKEN) ?? []) {
        const canonical = raw.replace(/,/g, "").replace(/\.$/, "");
        if (canonical === "") continue;
        found.add(canonical);
    }
    return found;
}

export function unsupportedNumbers(sourceText: string, written: string): string[] {
    const supported = numericTokens(sourceText);
    const claimed = numericTokens(written);
    return Array.from(claimed).filter((token) => !supported.has(token)).sort();
}

export type DefectTally = {
    /** The model answered with an entity the ontology does not define. */
    outOfVocabulary: number;
    emptyTitle: number;
    emptyDescription: number;
    emptyReference: number;
    /** Shards indistinguishable from an earlier one in the same run, by title and excerpt. */
    duplicate: number;
    total: number;
};

/**
 * What the pipeline does not currently check, counted.
 *
 * Each of these is reachable today: `normalizeLlmCardsResponse` coerces rather than rejects, so an
 * empty title survives; the raw entity string is stored and only `task` is mapped, so an invented
 * kind survives as an `object`; and nothing dedupes cards, so the same finding can be shredded
 * twice. An audit that reports its own failure modes is the kind a reviewer believes.
 */
const KNOWN_ENTITIES: ReadonlySet<string> = new Set([
    "person", "requirement", "concept", "insight", "object", "task",
]);

export function tallyDefects(shards: readonly EvalShard[]): DefectTally {
    const seen = new Set<string>();
    const tally: DefectTally = {
        outOfVocabulary: 0,
        emptyTitle: 0,
        emptyDescription: 0,
        emptyReference: 0,
        duplicate: 0,
        total: shards.length,
    };

    for (const shard of shards) {
        if (!KNOWN_ENTITIES.has(shard.entity.trim().toLowerCase())) tally.outOfVocabulary += 1;
        if (shard.title.trim() === "") tally.emptyTitle += 1;
        if (shard.description.trim() === "") tally.emptyDescription += 1;
        if (shard.reference.trim() === "") tally.emptyReference += 1;

        const key = `${shard.title.trim().toLowerCase()}|${shard.reference.trim().toLowerCase()}`;
        if (seen.has(key)) tally.duplicate += 1;
        else seen.add(key);
    }

    return tally;
}
