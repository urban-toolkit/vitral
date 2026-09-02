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
- The back of a card gives its description all the space; the citation, the source file and the participant assignment are icons in one row beneath it, each explained on hover.
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
- The canvas shows a blueprint component exactly when it answers a requirement that is itself on screen; the rest of the blueprint lives in the floating tray. Group boxes and the `feeds into` wiring between components are tray-only.
- Card type filtering applies to relevant card labels while preserving non-card scope behavior.
- Natural-language query and chat are playback-aware and can apply node filters.
- VA-blueprint recommendations are available via ranking backend, at two granularities: whole systems ranked against every requirement, and individual components ranked against the requirement cards selected on the canvas.

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
- **Every live blueprint component has a timeline marker, from the moment it is created.** It is dated from the component's own `createdAt`, so the marker sits where the component sits on the canvas time axis. A component that answers no requirement yet is drawn dashed and dimmed rather than omitted.
- **Markers are derived from the graph, never written into the document.** Opening a project must not change it: back-filling markers would alter the save hash and append a revision snapshot to the provenance record. A derived marker also means guests and readers of a published project see the same track the owner does.
- Requirement-to-blueprint relationships are what the track *emphasises*, not what brings a component onto it.
- Blueprint timeline events can be connected following canvas graph relations.
- If the same GitHub file is attached to blueprint component and codebase subtrack, timeline association is represented.

### Tray Contract
- The blueprint lives in a floating tray, not on the temporal canvas. Components can be positioned and wired there freely; group boxes can be dissolved so their contents become loose.
- A component is attached to a requirement by dragging it onto that card. Attaching renders it on the canvas beside the requirement and leaves it in the tray; one component may answer several requirements.
- Detaching is deleting the relation. The component leaves the canvas and stays in the tray, and its timeline marker goes back to the dashed "answers nothing yet" state rather than disappearing.
- The tray is not scoped by the playhead. The canvas rendering of a component is, through the requirement it answers.
- Existing projects need no migration: the same nodes render in the tray at their stored positions.

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
- Export project as a **deterministic** markdown report, generated from the Focus+Context
  aggregations. Machine-written prose is limited to an optional abstract, fenced by
  `vitral:abstract:begin` / `:end` comments so it stays findable and removable by a script.
- Cards the researcher marked **not relevant** are excluded from the report body. They are named once,
  under "Set aside", because the judgement is part of the record; nothing else in the document
  reproduces their content.
- Every artifact the report names carries a short code (`P1` phase, `A3` thread, `R7`/`I2`/`C4`/`O5`/`H1`
  card, `B1` component, `F2` file, `S1` stage, `E1` milestone). The letter fixes the level of
  abstraction; the code resolves to an anchor in the document and to a canvas viewpoint. An optional
  suffix chooses a different view of the same artifact — `R7P` its phase, `R7A` its root activity,
  `R7T` its thread, `R7F` its attached file, `R7AF` that activity's attached file — and a **How to
  read a reference** section explains the whole grammar. Each entry in the card index carries its
  further views as links, written `R1 (P / A / T / F)`, with any view the artifact does not have left
  out. The canvas takes the same references in its **Go to reference** box, and following a link from
  an exported document opens the canvas at what the reference names.
- Export/import project setup/settings as JSON.

### `.vi` Payload Contract (Current)
- Includes document state/timeline, revisions, files, embeddings, and GitHub events.
- Sections and field names are unchanged by the brotli container swap; the bundle's own
  `version` stays `1`. Only the byte after the `VITRALVI` magic moved, from `1` (gzip) to
  `2` (brotli), and version-1 files still import.

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
| VA-blueprint recommendations (whole systems) | System papers index + BM25F ranking inputs | Request recommendations; verify ranked response appears and is stable on reload. |
| VA component search | Per-component BM25F index, canvas selection of requirement cards | Select one or more requirement cards; verify the component search enables, returns a blended list drawn from more than one paper, and that each result names its source paper and block path. |
| Blueprint tray | Blueprint nodes/edges in `flow`, stored positions | Drag a whole paper and single components into the tray; move and wire them; reload and verify positions and wiring persisted. |
| Dissolve a group box | Group `deletedAt`, child `parentId`/position | Dissolve a box; verify children stay put on screen, become freely placeable, and the box is soft-deleted rather than removed. |
| Create a component | Blueprint component node, blueprint events | Make a component in the tray and attach nothing to it; verify a marker appears on the Blueprint track, dated to the component's own creation, drawn dashed and dimmed. |
| Attach / detach a component | `tackled in` edge, blueprint events | Attach a component to a requirement; verify it appears on the canvas orbiting that requirement, stays in the tray, and its existing timeline marker stops being dashed. Detach and re-attach; verify the marker keeps its original date throughout. |
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
| Markdown export | Focus+Context aggregations, locator codes, provenance tallies, download | Export markdown twice and verify the bytes are identical; verify Provenance names removed and set-aside cards; verify every cited code resolves to a heading. |
| Locator codes | Node/edge ids, `__history`, clustering anchors | Add a card while the playhead is scrubbed back, correct a card's date, and soft-delete a card; verify no existing code changes what it points at. |
| JSON settings import/export | Setup config schema (participants/timeline/etc.) | Export JSON, import into new setup, and verify functional equivalence. |
| Playback visibility over time | Node/edge created/deleted timestamps, projection logic | Move playhead across key timestamps; verify entities appear/disappear exactly at boundaries. |
| Search/chat resilience without vectors | Embeddings table presence/error fallback path | Simulate missing/failing embeddings and confirm query/chat still return ranked results. |

## Strategic Optimization Targets (Guidance, No Changes Yet)

1. **Revision storage volume**
- Current system stores frequent full-state snapshots/revisions.
- Candidate: delta/diff or tiered retention, only if replay/import guarantees remain intact.

2. **`.vi` size** — *addressed for the compressible sections; assets remain*
- The revision log used to dominate the file. It no longer does: a container with a window wide
  enough to span consecutive snapshots takes that section from 14.2 MB to 0.17 MB on a
  1204-revision project, and the whole export from 32.7 MB to 18.6 MB.
- What is left is ~98% asset bytes — already-compressed PNGs and PDFs. Export profiles would only
  help by *omitting* assets, so the remaining candidates are downscaling images at upload time, or
  target 1 above (storing fewer full snapshots), not a change to the export format.

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

