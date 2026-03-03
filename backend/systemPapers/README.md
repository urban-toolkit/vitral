# System Paper JSON Corpus

Place your system-component JSON files in this folder.

Each file should follow this shape:

```ts
interface SystemPaper {
  PaperTitle: string;
  Year: number;
  HighBlocks: HighBlock[];
}

interface HighBlock {
  HighBlockName: string;
  IntermediateBlocks: IntermediateBlock[];
}

interface IntermediateBlock {
  IntermediateBlockName: string;
  GranularBlocks: GranularBlock[];
}

interface GranularBlock {
  GranularBlockName: string;
  ID: number;
  PaperDescription: string;
  Inputs: string[];
  Outputs: string[];
  ReferenceCitation: string;
  FeedsInto: number[];
}
```

## Query Endpoint

`POST /api/system-papers/query`

Body can include:

- `cards`: array of requirement/task cards (title/description/text/content).
- `nodes`: array of canvas nodes (uses `node.data` if present; filters label to requirement/task when label exists).
- `query`: optional free-text extra query.
- `limit`: optional max results (default `5`, max `20`).

The endpoint applies field-aware BM25 (BM25F) with field weighting:

- `PaperTitle`: high
- `GranularBlockName`: high
- `PaperDescription`: medium
- `ReferenceCitation`: low

and per-field length normalization.

## Optional Directory Override

Set `SYSTEM_PAPERS_DIR` to load from another directory instead of this folder.
