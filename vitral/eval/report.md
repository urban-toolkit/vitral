# Sharding, cross-link and hallucination benchmark

Captured 2026-09-02T21:34:52.419Z. 20 runs, 0 failed, 10 repetitions per document per configuration.

Every figure below is computed from stored output by `src/eval/`, whose arithmetic is pinned by `npm run test:eval-metrics`. Rates are never averaged across documents: an artifact that is easy to decompose and one that is hard are two findings, not one mean.

## A. Sharding reliability

Runs of the same artifact are compared with each other, so no labelling is involved. A shard is matched across runs by the span its quotation occupies in the source, not by its title, which is reworded every run.

| Document | Config | Runs | Shards/run | CV | Distinct | Unanimous | Once only | Mean support | Run agreement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| meeting_notes.txt | gpt-5.2 | 10 | 19.2 ± 2.3 | 11.7% | 34 | 20.6% | 35.3% | 50.0% | 63.1% |
| notes-week4.md | gpt-5.2 | 10 | 22.5 ± 2.0 | 9.0% | 26 | 69.2% | 15.4% | 79.2% | 87.0% |

*Distinct* is how many different shards the runs found between them; *unanimous* the share found by every run and *once only* the share found by a single run. A shard found once in ten is, by the system's own behaviour, not a finding.

## B. Coverage and redundancy

How much of each artifact reaches the canvas, and how often the same passage is shredded twice. Both are measured over located quotations only, so a fabricated excerpt covers nothing.

| Document | Config | Mean coverage | Mean redundancy |
| --- | --- | --- | --- |
| meeting_notes.txt | gpt-5.2 | 18.8% | 1.08 |
| notes-week4.md | gpt-5.2 | 64.1% | 1.07 |

## C. Hallucination: are the quotations real?

Every shard claims a verbatim excerpt and nothing in the product checks it. Each claim is tested against **the exact string the model was given**, captured at request time.

Five outcomes, because a citation that fails to resolve and a claim the model invented are different failures with different fixes:

- **Exact** — present verbatim, up to case and whitespace.
- **Drifted** — a long contiguous run is present; the quote wandered at an edge.
- **Reassembled** — no run resolves, but nearly every word is the document's: the model stitched real passages together. The content is grounded; the citation is broken.
- **Context** — the words belong to the injected study-settings block rather than to the artifact. The model cited the wrong half of its input; the fix is in the prompt.
- **Absent** — in neither. This is the fabrication rate.

The two rightmost columns are the ones to quote. *Unresolved* is what the product promises against — the share of citations that highlight nothing when a reader clicks through. *Fabricated* is what the model is culpable for. The first is always the larger, and collapsing them into one number would misstate both.

| Document | Config | Claims | Exact | Drifted | Reassembled | Context | Unresolved | Fabricated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| meeting_notes.txt | gpt-5.2 | 192 | 93.2% | 6.8% | 0.0% | 0.0% | 0.0% | 0.0% (per run 0.0% ± 0.0pp) |
| notes-week4.md | gpt-5.2 | 225 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (per run 0.0% ± 0.0pp) |

## D. Written prose, and what the pipeline does not check

A shard's title and description are written rather than quoted, so a figure in them can be invented. Numbers are compared as token sets against the source; thousands separators are normalised away. Small numbers often match by coincidence, so this understates fabrication rather than overstating it.

| Document | Config | Shards | With unsupported number | Bad entity | Empty title | Empty description | Duplicates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| meeting_notes.txt | gpt-5.2 | 192 | 0.0% | 0 | 0 | 0 | 0 |
| notes-week4.md | gpt-5.2 | 225 | 0.0% | 0 | 0 | 0 | 0 |

*Bad entity*, *empty title* and *duplicates* are all reachable today: the response is coerced rather than rejected, the model's raw entity string is stored, and nothing dedupes shards within a document.
