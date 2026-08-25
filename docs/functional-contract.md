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

- Typed notes become cards **deterministically, without the LLM**: one note, one card, with the label guessed from a keyword table and the note kept verbatim as the description.
- Newly created cards are offered automatic `referenced by` / `iteration of` relations against the rest of the canvas under the same evidence gates, whether a model extracted them or the researcher typed them.

### Contract Details
- If extraction fails, root attachment still persists.
- Similarity-based relations are applied using threshold logic.
- The note tool's guessed label is shown before the card is created and stays overridable, both in the input and afterwards on the card. An ambiguous note falls back to `insight` rather than being committed to a reading; a `person` card is never created without an exact match against a project participant's name.
- A note written inside an activity's drop ring is wired to that activity with the pair's canonical relation; one written on empty canvas stays loose until it is connected.

## 3) Cards

### Contract
- Cards support:
  - file attachment (one file per card),
  - attachment preview (markdown/pdf/notebook/text),
  - manual title/description edits,
  - relevance labeling (`relevant`/`irrelevant`),
  - requirement assignment to participants.
- Every card shows whether a person put it there or the model proposed it, as a mark on the card itself rather than as the absence of one, and both are filterable from the sidebar independently.
- A card's citation opens the document it was taken from, scrolled to the passage and marked. When the passage cannot be located the document still opens, at the top.

### Contract Details
- Card edits update edit metadata/timestamp.
- The authorship mark is drawn on the card faces, alongside the model-derived dashed edge, so both survive the `mid` level-of-detail tier where badges are dropped.
- Requirement assignment options come from project participants.

## 4) Views, Filtering, Recommendations, and Chat

### Contract
- Canvas abstraction levels (focus + context):
  - `Detail` — the bare card graph (the default, and unchanged from before the feature),
  - `Threads` — one glyph per activity, with the relations between activities collapsed into weighted edges, and each activity's major decisions and insight turns promoted out as real cards,
  - `Overview` — one glyph per derived phase, with the project's major requirements and concepts promoted out as real cards; blueprint structure is hidden.
- The level is chosen either from the on-canvas control or by canvas zoom, whichever the user picks.
- Opening a glyph drills exactly one level for that branch while the rest of the canvas stays abstract.
- Cluster labels are always borrowed from stored data. This feature never calls the LLM.
- When the abstraction chooses which cards to promote, a card a person wrote is preferred over one the model proposed at comparable centrality. Structural centrality still decides; authorship only breaks the near-ties.
- All views share one layout: views select which nodes are shown, never how they are arranged.
- Activities are positioned by `createdAt`, left to right, one evenly spaced slot per distinct timestamp; activities sharing a timestamp are separated vertically within the slot.
- Every other card orbits the activity it belongs to, on an onion of fixed-radius layers ordered by graph distance from it; a layer that fills up spills into a new layer around the leaves rather than widening. Cards reaching no activity go to an unassigned band below.
- Activity trees that would collide at the slot pitch are offset vertically, so the canvas grows in both axes rather than only sideways.
- Blueprint groups/components keep their nested structure and are translated in as one block.
- Node positions are fully derived; node dragging is disabled in every view.
- Relations are drawn between the card borders that face each other rather than between fixed left/right handles, so a connection reads as a near-straight line whichever way the cards sit; the source -> target direction and its arrow are unchanged.
- System view hides cards and keeps blueprint components (+ needed ancestors).
- Card type filtering applies to relevant card labels while preserving non-card scope behavior.
- Natural-language query and chat are playback-aware and can apply node filters.
- VA-blueprint recommendations are available via ranking backend.

### Contract Details
- Query/chat retrieval pipeline supports structured + semantic/vector behavior with fallback ranking.
- Automatically inferred `referenced by` / `iteration of` edges are the only relations the app creates unasked. A pair is linked only when the match clears an absolute similarity floor *and* stands clear of the next-best candidate; a card that has already accumulated `MAX_AUTO_DEGREE` automatic edges accepts no more, so no single card can become a hub. `iteration of` additionally requires the target to be older and the two titles to overlap lexically.
- Card embeddings cover title and description only; the card label filters the search rather than being embedded. Changing that text requires an embedding version bump, after which the index rebuilds itself lazily.

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
| Cross-tree relation inference | Node embeddings, candidate ranking, label filter, level/separation/degree gates | Trigger extraction with similar cards; confirm `iteration of` / `referenced by` edges are added only where a match clears the absolute floor *and* is clearly ahead of its runner-up, and that no single card accumulates more than `MAX_AUTO_DEGREE` of them. |
| Card relevance label | Card node data (`relevance`) | Toggle relevant/irrelevant and verify filters/query behavior reflects state. |
| Requirement assignment | Participants list, card assignment field | Assign requirement card to participant; reload and verify assignment persists and displays correctly. |
| Manual card editing | Card title/description + edit timestamp metadata | Edit title/description; reload and verify content + edit metadata behavior. |
| Attachment preview | File metadata/content endpoints, supported MIME/text handlers | Open markdown/pdf/notebook/text attachments; verify content renders. |
| Explore view behavior | Full active graph + edit affordances | In explore mode verify create/drop/connect/edit behavior is available (cards are not draggable in any view). |
| Shared time layout | Activity timestamps, graph topology, deterministic layout inputs | In every view verify activities run left to right by date, other cards orbit their activity, unconnected cards sit in the band below, and switching views and back reproduces identical positions. |
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

