# Functional Contract Baseline

Last updated: 2026-03-25  
Status: Baseline for optimization planning (no functional changes in this pass)

## Purpose

This document defines behavior that must be preserved while simplifying data structures and reducing storage usage.

Use this as a no-regression contract before changing:
- canvas/timeline provenance structures,
- revision storage strategy,
- timeline link/event representations,
- file/attachment persistence.

## Scope

Covered areas:
- project setup and templates,
- knowledge extraction and card graph behavior,
- views/filtering/chat,
- timeline tracks and playback semantics,
- blueprint edge/group behavior,
- GitHub/codebase integration,
- system screenshot versioning,
- import/export/reporting.

## Global Invariants (Must Preserve)

1. **Playhead default behavior**
- If `playbackAt` is unset, playhead defaults to latest knowledge edit.
- If there is no knowledge event, fallback is timeline-domain aware and clamped; it must not blindly jump to domain end when today is out of range.

2. **Clear next edits semantics**
- `Clear next edits` must treat current playhead as the new present.
- It must remove future edits relevant to historical lock release, not only a narrow subset.
- Editing must be possible immediately after the clear operation.

3. **Historical lock semantics**
- Editing lock is determined by historical playback (`playbackAt` vs latest effective canvas change).
- Stale/future timestamps outside effective range must not keep lock active.

4. **Soft delete behavior**
- Edge deletes are soft-deletes (`deletedAt`) to preserve history.
- Duplicate/active checks must ignore soft-deleted edges.
- Reconnecting a previously deleted relation must succeed.

5. **Blueprint group resize behavior**
- Parent/group boxes must resize both width and height as children are changed/deleted.
- Soft-deleted/inactive children must not affect current size.

6. **Playback-aware timestamping**
- Operations tied to user actions on historical playback must use action-resolved timestamps.
- Attachment and evolution visibility must remain valid for any playback time after creation.

7. **Review-only import mode**
- `.vi` imports are preview/review-only and non-editable.

8. **Search/chat fallback robustness**
- Query/chat must still work when vector search is unavailable (historical query, no embeddings table, or embedding failures).

## Functional Contracts by Area

## 1) Project Setup

### Contract
- Setup supports structured form + JSON DSL editing.
- JSON can be applied/imported/exported.
- Goal text can trigger LLM-generated milestones merged into timeline setup.
- Literature templates can populate participants and timeline.
- Previous project can be used as a template source.

### Notes
- Current behavior includes exporting setup as `Everything` or `Configs only` (participants + timeline).
- Current behavior for "previous project template" should be treated carefully during refactor; confirm participant behavior with product intent before changing.

## 2) Knowledge Extraction and Representation

### Contract
- Attaching a non-video file to an activity card can trigger LLM explosion into card tree.
- Generated cards/edges are timestamped to action context.
- Extracted tree connects to activity root.
- Cross-tree linking is embeddings-based and constrained to relation types:
  - `iteration of`
  - `referenced by`

### Contract Details
- If extraction fails, root attachment still persists.
- Similarity-based relations are applied using threshold logic.

## 3) Cards

### Contract
- Cards support:
  - file attachment,
  - attachment preview (markdown/pdf/notebook/text),
  - manual title/description edits,
  - relevance labeling (`relevant`/`irrelevant`),
  - requirement assignment to participants.

### Contract Details
- Card edits update edit metadata/timestamp.
- Requirement assignment options come from project participants.

## 4) Views, Filtering, Recommendations, and Chat

### Contract
- View modes:
  - `explore`,
  - `evolution`,
  - `blueprintComponents` (system view),
  - `features`.
- Evolution view repositions by temporal/graph logic and excludes blueprint components.
- System view hides cards and keeps blueprint components (+ needed ancestors).
- Card type filtering applies to relevant card labels while preserving non-card scope behavior.
- Natural-language query and chat are playback-aware and can apply node filters.
- VA-blueprint recommendations are available via ranking backend.

### Contract Details
- Query/chat retrieval pipeline supports structured + semantic/vector behavior with fallback ranking.

## 5) Timeline Core

### Contract
- Stages can be created and resized.
- Substages can be created inside stages, renamed/moved/deleted.
- Timeline has four base lanes plus dynamic subtrack rendering.
- Event visuals retain type-specific glyph semantics:
  - design-study (diamond),
  - knowledge (circle),
  - blueprint (triangle),
  - codebase (square).

### Link Contract
- Timeline link kinds include:
  - `regular`,
  - `referenced_by`,
  - `iteration_of`.

## 6) Design Study Track

### Contract
- Supports manual milestones.
- Supports LLM suggested/interpolated milestones from existing context.

## 7) Knowledge Base Track

### Contract
- Card creation events are represented.
- Events can appear standalone or grouped into tree pills rooted in activity context.
- Users can create knowledge subtracks and drag/group events.
- Knowledge events can link to other knowledge events and blueprint events according to canvas relationships.

## 8) Blueprint Track

### Contract
- Requirement-to-blueprint relationships create blueprint timeline events.
- Blueprint timeline events can be connected following canvas graph relations.
- If the same GitHub file is attached to blueprint component and codebase subtrack, timeline association is represented.

## 9) Codebase Track

### Contract
- Linked GitHub repo commits are ingested and shown.
- Users can create/manage subtracks.
- Users can attach GitHub files to subtracks.
- LLM can infer candidate files for subtracks based on subtrack context.
- Subtracks can be marked inactive/finished.

### Visual Evolution Contract
- Panoramic visual evolution supports:
  - whole-system view,
  - subtrack-focused view.

## 10) System Screenshot Versioning

### Contract
- Users can upload system screenshots as version markers.
- Screenshot is tied to timeline timestamp context.
- Image can be segmented into zones linked to files/subtracks (VLM/LLM-assisted mapping).
- Timeline and side panel support zone/file interaction.

## 11) Export / Import / Reporting

### Contract
- Export/import project as `.vi` binary.
- Imported `.vi` opens in review-only mode.
- Export project as markdown report (LLM generated sections).
- Export/import project setup/settings as JSON.

### `.vi` Payload Contract (Current)
- Includes document state/timeline, revisions, files, embeddings, and GitHub events.

## 12) Persistence and Provenance Expectations

### Contract
- Playback reconstruction depends on created/deleted timestamps and provenance-aware state interpretation.
- Soft-deleted entities must remain available for historical replay.
- Timeline connections derived from graph relationships must remain consistent after persistence/reload.

## Feature -> Required Data -> Regression Checks Matrix

| Feature | Required Data / State | Regression Checks |
|---|---|---|
| Playhead default to latest knowledge edit | `playbackAt`, knowledge event timestamps, timeline domain start/end | Open project with `playbackAt` unset; verify needle lands on latest knowledge edit. If no knowledge edit and today out of range, verify fallback clamps correctly. |
| Historical edit lock | `playbackAt`, latest effective canvas change timestamp, timeline range | Move playhead before latest change and confirm editing is locked; move to present and confirm editing unlocks. |
| Clear next edits | Playhead cutoff, node/edge timestamps, timeline projections (events/pills/links) | Clear next at mid-history; verify future knowledge/blueprint-impacting edits are removed and editing unlocks immediately. |
| Clear previous edits | Cutoff timestamp, retained current graph, edge pruning rules | Clear previous and verify expected pre-cutoff history is dropped while current graph remains valid. |
| Stage create/resize | Stage IDs, ordered timeline boundaries, drag guard rules | Create stage, resize boundaries, ensure no overlap/inversion, reload and verify persistence. |
| Substage create/edit/delete | Substage IDs, parent stage relation, date range | Brush-create substage, rename/move/delete, reload and verify exact placement. |
| Knowledge explosion from activity file | Activity card type, attachment metadata, extraction results, generated edges | Attach non-video file to activity; confirm cards/edges appear and root attachment persists even if extraction partially fails. |
| Cross-tree relation inference | Node embeddings, similarity scores, label constraints, relation thresholds | Trigger extraction with similar cards; confirm only `iteration of` / `referenced by` edges are added by threshold rules. |
| Card relevance label | Card node data (`relevance`) | Toggle relevant/irrelevant and verify filters/query behavior reflects state. |
| Requirement assignment | Participants list, card assignment field | Assign requirement card to participant; reload and verify assignment persists and displays correctly. |
| Manual card editing | Card title/description + edit timestamp metadata | Edit title/description; reload and verify content + edit metadata behavior. |
| Attachment preview | File metadata/content endpoints, supported MIME/text handlers | Open markdown/pdf/notebook/text attachments; verify content renders. |
| Explore view behavior | Full active graph + edit affordances | In explore mode verify drag/create/drop/edit behavior is available. |
| Evolution view behavior | Node timestamps, graph topology, deterministic layout inputs | Switch to evolution mode; verify blueprint nodes hidden and horizontal temporal layout is stable. |
| System view behavior | Blueprint component filtering + ancestor retention | Switch to system view; verify cards hidden and relevant blueprint structure preserved. |
| Card type filter | Selected labels, node labels/types | Apply label filter; verify matching cards filter while non-card behavior stays consistent with current UX. |
| Natural-language node query | Query endpoint, optional `at`, structured parser, vector/fallback ranking | Run query at current + historical playback; ensure results are returned in both vector and fallback conditions. |
| Canvas chat with optional filter application | Chat retrieval pipeline, `applyFilter` flag, matched node IDs | Ask chat question expected to filter; confirm filter applies only when `applyFilter=true`. |
| VA-blueprint recommendations | System papers index + BM25F ranking inputs | Request recommendations; verify ranked response appears and is stable on reload. |
| Soft-delete edge reconnect | Edge `createdAt/deletedAt`, active-edge duplicate checks | Create edge, delete it, reconnect same relation; verify reconnect succeeds and history is preserved. |
| Blueprint parent box resize | Group/child geometry, active child filtering, compaction logic | Delete/move children in parent group; verify width and height shrink/expand correctly and ignore deleted children. |
| Knowledge subtracks and event grouping | Knowledge events, `treeId`, subtrack assignments | Create subtrack, drag grouped/standalone events, reload and verify grouping/placement persists. |
| Blueprint timeline links | Blueprint events + graph edge-to-event mapping | Create linked blueprint components and confirm corresponding timeline links render and persist. |
| GitHub repo link/sync | OAuth/link tokens, repo metadata, sync cursor, commit payload | Link repo, sync commits, reload and verify commit timeline events remain. |
| Codebase subtracks | Subtrack metadata, file paths, commit `filesAffected` | Add subtrack and attach files; verify matching commits appear under correct subtrack. |
| LLM file inference for subtrack | Repo tree snapshot, subtrack name/context, LLM result filtering | Run infer-files action; verify suggested files are valid repo paths and attach cleanly. |
| Blueprint <-> codebase correlation | Blueprint attachments, codebase file paths, reconciliation logic | Attach same file to blueprint component + codebase subtrack; verify timeline association appears. |
| Screenshot version marker | Marker timestamp, image file metadata/storage | Add marker and upload screenshot; verify marker persists and appears on timeline. |
| Screenshot zone linkage | Zone metadata, linked file paths/subtracks | Generate zones; hover/select zones and verify linked files/subtracks highlight correctly. |
| Panoramic visual evolution | Screenshot timeline series, zone/subtrack selection state | Open panoramic mode for whole system and subtrack focus; verify expected frame filtering and overlays. |
| `.vi` export | Document state, revisions, files, embeddings, GitHub events | Export `.vi`, inspect size sanity, re-import, and verify project opens in review mode with expected data. |
| `.vi` import review-only | Imported doc metadata (`review_only`) + editor gating | Import `.vi`; confirm editing actions are disabled and review badge/banner appears. |
| Markdown export | LLM report prompts, section generation, download | Export markdown and verify required sections are present and non-empty. |
| JSON settings import/export | Setup config schema (participants/timeline/etc.) | Export JSON, import into new setup, and verify functional equivalence. |
| Playback visibility over time | Node/edge created/deleted timestamps, projection logic | Move playhead across key timestamps; verify entities appear/disappear exactly at boundaries. |
| Search/chat resilience without vectors | Embeddings table presence/error fallback path | Simulate missing/failing embeddings and confirm query/chat still return ranked results. |

## Strategic Optimization Targets (Guidance, No Changes Yet)

1. **Revision storage volume**
- Current system stores frequent full-state snapshots/revisions.
- Candidate: delta/diff or tiered retention, only if replay/import guarantees remain intact.

2. **`.vi` size**
- Current export includes large contributors (file bytes, revisions, embeddings, GitHub events).
- Candidate: optional export profiles or deduplicated payload sections with explicit compatibility contract.

3. **Parallel representations**
- Similar relationships appear across canvas edges, timeline links, and derived event projections.
- Candidate: normalize source-of-truth + deterministic derivation layer; preserve current replay/link semantics.

4. **Knowledge timeline duplication**
- Multiple intermediate knowledge event/pill collections exist.
- Candidate: reduce in-memory duplication, but preserve grouping/link rendering behavior and clear-edits semantics.

## Suggested Use During Refactor

1. Before any schema/data-model change, map impacted rows from the matrix.
2. For each impacted feature, run its regression checks manually (or automate).
3. Only accept storage optimizations that pass all checks in affected rows.

