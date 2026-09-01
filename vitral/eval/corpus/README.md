# Benchmark corpus

Artifacts the harness pushes through the real sharding pipeline, R times each.

Two files are committed as a seed so the harness runs out of the box; both come from
`examples/` at the repository root. Add study artifacts here to widen the corpus — and check
before committing them, since real study material is often not publishable.

Supported: `md`, `txt`, `csv`, `json`, `ipynb`, `py`, `js`, `ts`, `html`, `css`, `pdf`, `docx`.
Images are excluded: their prompt path compresses through a canvas, which has no headless
equivalent, so benchmarking them here would measure something the product does not do.
