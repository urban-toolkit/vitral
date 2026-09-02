# Quantitative Evaluation

## Running it

The backend must be up (`docker compose --file docker-compose.dev.yml up`). No sign-in is needed —
`/llm/chat`, `/docling/convert/file` and `POST /state` all work unauthenticated.

```bash
npm run test:eval-metrics     # pin the arithmetic first; fixtures with hand-computed answers
npm run eval:run -- --runs 10 # push eval/corpus through the real pipeline, 10x per config
npm run eval:report           # tables A-D from the newest run file
npm run eval:crosslink        # the gate ablation, over the shards that run produced
```

`eval:run` is the only command that costs anything. It writes raw output to `eval/runs/` and computes
nothing; `eval:report` re-derives every number from that file. `eval:crosslink -- --matches <file>` likewise
re-analyses without touching the network.

Flags: `--runs N`, `--corpus DIR`, `--configs baseline,no-context,gpt-5-mini`, and for the cross-link
script `--keep` to leave its throwaway project on the canvas.

## What is measured

**Sharding reliability.** Runs of one artifact are compared with each other. A shard is matched across
runs by the *span its quotation occupies in the source*, not by its title, which is reworded every
run. The headline is how many shards every run finds and how many appear once: a shard produced in one
run of ten is, by the system's own behaviour, not a finding.

**Hallucination.** Every shard claims a verbatim excerpt. Each is
tested against the exact prompt text, with five outcomes rather than two, because *the citation does
not resolve* and *the model made it up* are different failures with different fixes:

- **exact** / **drifted** — the citation resolves.
- **reassembled** — no contiguous run resolves, but nearly every word is the document's. The model
  stitched real passages together: content grounded, citation broken.
- **context** — the words belong to the injected project-settings block rather than to the artifact.
  The model cited the wrong half of its input; the fix is in the prompt.
- **absent** — in neither. This is the fabrication rate.

All three of the middle cases turned up in the *first* run of a two-page markdown file, which is why
the taxonomy is this shape. Collapsing them would have reported 12% hallucination where the true
fabrication rate was 0% and the real defect was a prompt bug.

**Cross-link inference.** Selectivity, not accuracy: the shipped rule replayed over real embeddings
with each gate neutralised in turn, reporting links admitted and the maximum node degree — the hub the
separation gate exists to prevent. Plus a sweep of the two thresholds that were set from eight
hand-checked pairs, so it is visible whether they sit on a plateau or a cliff.

## What this does not measure

- **Whether a shard is *correct*.** Groundedness is a necessary condition, not a sufficient one: a
  faithfully quoted passage can still be the wrong thing to have shredded out. That needs labels.
- **Whether an inferred link is *right*.** The ablation says what each gate admits, not whether the
  admitted links are good. Say "selectivity" in the paper, not "precision".
- **Images.** Their prompt path compresses through a canvas, which has no headless equivalent, so the
  harness covers text, code, data, PDF and DOCX only.
- **The order effects of a real session.** Every card is offered against the whole corpus; in the
  product, cards are offered as they are created, against a canvas that was smaller at the time.
