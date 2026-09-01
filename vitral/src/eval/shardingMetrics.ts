import { checkQuotation, tallyDefects, tallyQuotations, unsupportedNumbers } from "./groundedness";
import type { DefectTally, QuotationTally } from "./groundedness";
import type { EvalRun, Span } from "./evalTypes";

/**
 * What one run of the sharder did to one document, and how the runs compare.
 *
 * Everything here is per-run first and aggregated second, on purpose: a mean shard count is far less
 * informative than the spread around it, and the spread *is* the answer to "how reliable is
 * sharding". Aggregation that throws away the run dimension would leave the benchmark reporting the
 * same kind of single number the reviewer already objected to.
 */

export function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n-1). With one run there is no spread to report, so it is 0. */
export function stdDev(values: readonly number[]): number {
    if (values.length < 2) return 0;
    const average = mean(values);
    const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
}

/** Merge overlapping spans, so a character covered twice is counted once. */
export function unionLength(spans: readonly Span[]): number {
    const sorted = [...spans].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
    let total = 0;
    let openStart = -1;
    let openEnd = -1;
    for (const span of sorted) {
        if (openEnd < span.start) {
            if (openStart >= 0) total += openEnd - openStart;
            openStart = span.start;
            openEnd = span.end;
        } else if (span.end > openEnd) {
            openEnd = span.end;
        }
    }
    if (openStart >= 0) total += openEnd - openStart;
    return total;
}

export type RunMetrics = {
    document: string;
    config: string;
    runIndex: number;
    shards: number;
    /** Shards per label, after `normalizeArtifactEntity`. */
    labelMix: Record<string, number>;
    quotations: QuotationTally;
    defects: DefectTally;
    /** Union of located excerpts ÷ source length. How much of the document was carried across. */
    coverage: number;
    /**
     * Located excerpt length ÷ union length. 1.0 means no two shards quote the same characters;
     * 2.0 means the document was, on average, shredded twice.
     */
    redundancy: number;
    /** Shards whose written title or description contains a number the source does not. */
    shardsWithUnsupportedNumber: number;
    /** Every distinct unsupported number, for eyeballing. Sorted, so the report is stable. */
    unsupportedNumbers: string[];
};

export function measureRun(run: EvalRun): RunMetrics {
    const checks = run.shards.map(
        (shard) => checkQuotation(run.sourceText, shard.reference, run.contextText),
    );
    const spans = checks.map((check) => check.span).filter((span): span is Span => span !== null);

    const labelMix: Record<string, number> = {};
    for (const shard of run.shards) {
        labelMix[shard.label] = (labelMix[shard.label] ?? 0) + 1;
    }

    const covered = unionLength(spans);
    const quoted = spans.reduce((sum, span) => sum + (span.end - span.start), 0);

    const unsupported = new Set<string>();
    let shardsWithUnsupportedNumber = 0;
    for (const shard of run.shards) {
        const found = unsupportedNumbers(run.sourceText, `${shard.title} ${shard.description}`);
        if (found.length === 0) continue;
        shardsWithUnsupportedNumber += 1;
        for (const token of found) unsupported.add(token);
    }

    return {
        document: run.document,
        config: run.config,
        runIndex: run.runIndex,
        shards: run.shards.length,
        labelMix,
        quotations: tallyQuotations(checks),
        defects: tallyDefects(run.shards),
        coverage: run.sourceText.length === 0 ? 0 : covered / run.sourceText.length,
        redundancy: covered === 0 ? 0 : quoted / covered,
        shardsWithUnsupportedNumber,
        unsupportedNumbers: Array.from(unsupported).sort(),
    };
}

export type YieldStability = {
    runs: number;
    meanShards: number;
    sdShards: number;
    /** sd ÷ mean. The scale-free way to say "how much does the yield wobble". */
    coefficientOfVariation: number | null;
    minShards: number;
    maxShards: number;
};

export function measureYieldStability(runs: readonly RunMetrics[]): YieldStability {
    const counts = runs.map((run) => run.shards);
    const average = mean(counts);
    const sd = stdDev(counts);
    return {
        runs: counts.length,
        meanShards: average,
        sdShards: sd,
        coefficientOfVariation: average === 0 ? null : sd / average,
        minShards: counts.length === 0 ? 0 : Math.min(...counts),
        maxShards: counts.length === 0 ? 0 : Math.max(...counts),
    };
}

/** Pooled quotation verdicts across a set of runs, plus the spread of the per-run rate. */
export type PooledGroundedness = {
    pooled: QuotationTally;
    /** Per-run absent rates, for a confidence interval rather than a single point. */
    perRunAbsentRate: number[];
    meanAbsentRate: number | null;
    sdAbsentRate: number;
};

export function poolGroundedness(runs: readonly RunMetrics[]): PooledGroundedness {
    const pooled: QuotationTally = {
        exact: 0, partial: 0, reassembled: 0, context: 0, absent: 0, missing: 0,
        claimed: 0, absentRate: null, unresolvedRate: null,
    };
    for (const run of runs) {
        pooled.exact += run.quotations.exact;
        pooled.partial += run.quotations.partial;
        pooled.reassembled += run.quotations.reassembled;
        pooled.context += run.quotations.context;
        pooled.absent += run.quotations.absent;
        pooled.missing += run.quotations.missing;
        pooled.claimed += run.quotations.claimed;
    }
    pooled.absentRate = pooled.claimed === 0 ? null : pooled.absent / pooled.claimed;
    pooled.unresolvedRate = pooled.claimed === 0
        ? null
        : (pooled.reassembled + pooled.context + pooled.absent) / pooled.claimed;

    const rates = runs
        .map((run) => run.quotations.absentRate)
        .filter((rate): rate is number => rate !== null);

    return {
        pooled,
        perRunAbsentRate: rates,
        meanAbsentRate: rates.length === 0 ? null : mean(rates),
        sdAbsentRate: stdDev(rates),
    };
}
