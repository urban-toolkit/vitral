/**
 * What one benchmark run records, and what the metrics read.
 *
 * The benchmark answers a reviewer's question — how reliable is sharding, how often does the model
 * quote something that is not there — and it answers it by *repetition* rather than by labelling.
 * The same artifact goes through the real extraction path R times and the runs are compared with
 * each other, so the only ground truth needed is the input itself.
 *
 * The field that makes the whole thing work is `sourceText`: the exact string the model was handed,
 * captured from `buildFilePromptRequest` at the moment the request was built. Nothing in the product
 * stores it — `document_files.content_text` was dropped in migration 007, and the docling markdown
 * behind a PDF is built for the prompt and discarded — so a retrospective evaluation has to
 * reconstruct the haystack and ends up measuring its own reconstruction error next to the model's.
 * Here the haystack is not an approximation of what the model saw. It is what the model saw.
 */

/** One shard exactly as the extraction path produced it, before anything touched it. */
export type EvalShard = {
    /** The model's own entity string, unmapped — so an out-of-vocabulary answer stays visible. */
    entity: string;
    /** The same string after `normalizeArtifactEntity`, which is what the canvas would store. */
    label: string;
    title: string;
    description: string;
    /** The excerpt the model claims is verbatim from the source. */
    reference: string;
};

/** One extraction of one document, under one configuration. */
export type EvalRun = {
    /** Corpus file name, e.g. `notes-week4.md`. */
    document: string;
    /** Which repetition this is, 0-based. */
    runIndex: number;
    /** Ablation configuration name, e.g. `baseline`, `no-project-settings`, `gpt-5-mini`. */
    config: string;
    model: string;
    /** Prompt file the extension dispatched to, e.g. `CardsFromText`. */
    promptName: string;
    /** **The exact artifact text the model was given.** See the note above. */
    sourceText: string;
    /**
     * The rest of the prompt payload: the file name, its extension and the project settings block.
     *
     * Recorded because the model quotes it. Asked for "a reference to the portion of the content
     * that generated the card, verbatim", it will sometimes hand back a line from the injected study
     * context instead — a participant roster, the project goal. That is not a fabrication and must
     * not be counted as one; it is the model citing the wrong half of its input, which is a prompt
     * problem with a prompt fix. Keeping the two apart is the difference between a finding and a
     * misattribution.
     */
    contextText: string;
    shards: EvalShard[];
    elapsedMs: number;
    /** Set when the run failed outright; `shards` is then empty and the run is excluded from rates. */
    error?: string;
};

/** Everything one `eval:run` invocation produced, as written to disk. */
export type EvalRunFile = {
    startedAt: string;
    /** Repetitions requested per document per configuration. */
    repetitions: number;
    runs: EvalRun[];
};

export type Span = { start: number; end: number };
