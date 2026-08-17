# AGENTS.md

## Purpose
This file captures important project context from prior debugging/fix sessions so future agents can avoid regressions, especially around timeline playback, knowledge-track editing, blueprint edges, and asset behavior.

Current product-safety intent (user-study phase): prioritize no-regression usability adjustments. Feature additions/removals remain possible in future work when explicitly requested and reflected in the contract docs.

## High-Importance Behavior Contracts

1. Timeline playhead defaults
- On project open/refresh, when `playbackAt` is unset, the needle should default to the **latest knowledge-base edit**.
- If there are no knowledge events, fallback default behavior applies.
- If "today" is outside `[start, end]`, default should not jump to end; prior fixes aligned fallback toward start and then to latest knowledge edit if present.

2. Clear edits semantics
- `Clear next edits`: the current needle position becomes the new "present". Editing must be enabled after this operation.
- `Clear next edits` must remove future edits even if timestamps are outside visible timeline range.
- `Clear next edits` must not only affect knowledge nodes; future blueprint/canvas edits can otherwise keep playback locked.

3. Playback lock semantics
- Editing lock uses historical playback detection.
- Locking must not be incorrectly held by stale/future timestamps outside effective timeline range.

4. Blueprint edge reconnect
- Deleting an edge is soft-delete (`deletedAt`), preserving history.
- Reconnecting same blueprint component relation must work after deletion.
- Duplicate-edge checks must ignore soft-deleted edges.

5. Blueprint parent box resizing
- Blueprint parent/group boxes must resize both horizontally and vertically as child content is deleted or changed.
- Soft-deleted children should not count toward group size calculations.

6. Asset upload timestamping
- Upload/attach events should align with current timeline action timestamp (playback-aware).
- Attachments should remain visible at any playback time after they were attached (not only at "today").

7. Export/duplicate reliability for large projects
- `.vi` export and project duplication should remain stable with many revisions and assets.
- Requests must not fail at the proxy layer from short upstream timeouts.
- Backend runtime must have enough heap headroom for encode/copy operations over full project history.

8. Async duplication contract
- `POST /api/state/:id/duplicate` is async and should return `202` quickly with a `jobId`.
- Duplication completion/failure is polled via `GET /api/state/duplicate-jobs/:jobId`.
- Job result includes duplicated document metadata (`id`, `title`, etc.) once status is `succeeded`.

9. Review-only conversion contract
- Projects can be permanently converted to review-only mode from the projects list.
- Conversion is one-way (`review_only=true`); editing remains blocked afterward.
- Existing review-only imports and converted projects must follow the same non-editable behavior contract.

10. Review-only UI affordances
- In review mode, destructive timeline controls (delete `X` for stages/substages/subtracks) must be hidden, not only blocked.
- In review mode, the left sidebar settings action must be hidden.

11. Knowledge timeline click navigation
- Clicking knowledge timeline entities (tree pills and individual knowledge events) should navigate/zoom canvas to the related card/tree node when resolvable.
- Behavior should preserve tooltip feedback while triggering navigation.

12. Design-study milestone tooltip editability
- Milestone tooltip title supports inline rename on click (non-review mode only).
- Save on Enter/blur, cancel on Escape, and keep review mode non-editable.

13. Functional baseline source of truth
- `docs/functional-contract.md` is the no-regression baseline for storage/performance refactors.
- Any optimization must preserve contracts in that document unless product approval explicitly changes scope.

14. Canvas file drop is LLM-free
- Dropping a file on the canvas always creates a `object` card titled after the file name (extension stripped), with the file uploaded and attached.
- This path must not call the LLM: the card has to appear as soon as the upload returns.
- `parseFile` is called with `includePreviewText: false` here; only LLM paths need the file contents read into memory.
- Attaching a file to an existing **activity** card is a different flow and still goes through the timestamp modal + LLM card generation (`onAttachFile` -> `PendingFileModal` -> `processFile`).

15. Activity drop rings (non-activity cards hang off activities)
- Dashed rings are drawn around every visible activity card while a file is dragged over the canvas and while the card tool is armed.
- The valid area is the filled disc, not just the ring outline, so clicking/dropping on the activity card itself counts as inside.
- Dropping or clicking inside a ring creates a card connected to that activity with the `activity|object` relation (`generated by`). Where the card lands is decided by the shared layout (contract 16), not by the cursor, so the canvas pans to the new card afterwards.
- Dropping outside every ring still creates the unconnected object card at the cursor; clicking outside every ring with the card tool still creates a root `activity` card (this is how new activities are made).
- Rings are suppressed when `interactionLocked` (review mode / historical playback) or when `viewMode !== "explore"`.
- Creating a card must never be silently invisible: `resetFiltersForCanvasCreation(ensureVisibleLabel)` re-enables the sidebar label chip for the card being created, in addition to clearing the chat-query filter. It is a no-op when nothing is filtered (every `setState` receives its current value, so the `fitView` effect deps stay reference-identical and the camera does not move).
- Window-level drag/pointer tracking for the rings must stay on the **capture** phase. `AttachFileZone` calls `stopPropagation()` on drag events, so bubble-phase listeners miss the drop that ends a drag and the rings stay stuck on screen.

16. One time-based layout for every view
- There is no Evolution view. `CanvasViewMode` is `explore | blueprintComponents | features`, and every view runs the same layout (`activityOrbitLayout.ts`).
- Views differ only in **which** nodes they show; the arrangement is identical in all of them.
- Activities are the only cards where time matters: laid out left to right, one slot per distinct `createdAt`, **evenly spaced by order** (deliberately not proportional to elapsed time). Activities sharing a timestamp share a slot and stack vertically.
- Every other card orbits the activity it belongs to, on a concentric ring chosen by its graph distance (hop count) from that activity. Ties go to the chronologically earlier activity.
- Cards that reach no activity are laid out in an "unassigned" band below everything, so nothing silently disappears.
- Blueprint groups/components keep their own nested structure and are translated in as a single block; they are never treated as orbiting satellites.
- Node dragging is disabled in every view. Stored node positions no longer drive card rendering — only blueprint structure still reads them (relative to its own roots).
- Because of that, any hit test against canvas coordinates must read `displayedNodes`, never the raw store `nodes` (see `isInsideSystemBlueprintParentBox`).

## Key Areas and Files

- Timeline defaults / playhead / context menu cutoff:
  - `vitral/src/components/timeline/Timeline.tsx`
  - `vitral/src/components/timeline/useTimelineChart.ts`
  - `vitral/src/components/timeline/useParsedTimelineData.ts`

- Playback lock, clear edits, connect/delete behavior:
  - `vitral/src/pages/ProjectEditorPage.tsx`

- Edge/node history + dedupe + blueprint group resize:
  - `vitral/src/store/flowSlice.ts`

- Backend snapshot/provenance/files timestamp handling:
  - `backend/src/routes/state.ts`
  - `vitral/src/api/stateApi.ts`
  - `vitral/src/pages/projectEditor/useFileAttachmentProcessing.ts`

- Export/duplicate runtime + proxy behavior:
  - `backend/src/routes/state.ts`
  - `backend/Dockerfile`
  - `docker-compose.yml`
  - `docker-compose.dev.yml`
  - `vitral/nginx.conf`

- Review-only conversion + project list controls:
  - `backend/src/routes/state.ts`
  - `vitral/src/pages/ProjectsPage.tsx`
  - `vitral/src/api/stateApi.ts`

- Review-only editor affordances:
  - `vitral/src/pages/ProjectEditorPage.tsx`
  - `vitral/src/components/timeline/useTimelineChart.ts`
  - `vitral/src/components/sidebar/CanvasSidebar.tsx`

- Knowledge click-to-canvas navigation + milestone tooltip rename:
  - `vitral/src/components/timeline/Timeline.tsx`
  - `vitral/src/components/timeline/useTimelineChart.ts`
  - `vitral/src/pages/projectEditor/TimelineDock.tsx`
  - `vitral/src/components/timeline/timelineTypes.ts`
  - `vitral/src/pages/ProjectEditorPage.tsx`

- Canvas layout shared by all views:
  - `vitral/src/pages/projectEditor/activityOrbitLayout.ts`
  - `vitral/src/pages/ProjectEditorPage.tsx` (`viewBaseNodes` -> `displayedEdges` -> `displayedNodes`)
  - `vitral/src/components/sidebar/CanvasSidebar.tsx` (view switcher)

- Canvas file drop + activity drop rings:
  - `vitral/src/pages/projectEditor/canvasGeometry.ts`
  - `vitral/src/pages/projectEditor/ActivityDropRings.tsx`
  - `vitral/src/pages/projectEditor/useFileAttachmentProcessing.ts`
  - `vitral/src/pages/projectEditor/FlowCanvas.tsx`
  - `vitral/src/pages/ProjectEditorPage.tsx`
  - `vitral/src/func/FileParser.ts`

- Functional baseline contract:
  - `docs/functional-contract.md`

## Repository Map (At-a-Glance)

- Frontend app (React + timeline/canvas UX): `vitral/src`
  - `components/` UI building blocks (timeline, sidebars, cards, blueprint widgets)
  - `pages/` app screens (`ProjectsPage`, `ProjectEditorPage`, setup flow)
  - `store/` Redux slices for canvas, timeline, settings, files
  - `hooks/` sync/playback and side effects
  - `api/` HTTP client layer for backend routes

- Backend API (Fastify + Postgres + S3/MinIO): `backend/src`
  - `routes/` API endpoints (`state.ts` is core project persistence/history/files/export/import)
  - `services/` provenance, embeddings, GitHub orchestration
  - `db/` schema/migrations/bootstrap SQL
  - `utils/` stream/file/export helpers (`projectVi.ts` etc.)

- Operations/runtime
  - `docker-compose.dev.yml` local developer stack
  - `docker-compose.yml` production-like stack
  - `docs/functional-contract.md` feature-preservation baseline

## Implementation Anchors (Observed)

These are concrete spots where the contracts are currently enforced. If behavior regresses, start here first.

1. Timeline playhead defaults
- `Timeline.tsx`: `resolveClearCutoffIso` computes default playback from latest knowledge event (`parsed.kb`), otherwise start/today fallback clamped to timeline domain.
- `useTimelineChart.ts`: mirrored playhead default logic for rendered needle position (`latestKnowledgeDate` + start/today fallback + clamp).

2. Playback lock semantics
- `ProjectEditorPage.tsx`: `latestCanvasChangeTime` includes node/edge `createdAt` and `deletedAt`, plus node history timestamps.
- `ProjectEditorPage.tsx`: `latestCanvasChangeTimeForLock` clamps latest change into timeline range before comparing with `playbackAtTime`.
- `ProjectEditorPage.tsx`: `isHistoricalPlayback` only locks when `playbackAtTime` is explicitly set and earlier than clamped latest change.

3. Clear edits semantics
- `ProjectEditorPage.tsx`: `clearKnowledgeEditsAroundPlayback(direction, cutoffOverrideIso)` is the central implementation for clear previous/next.
- For `"after"` (`Clear next edits`), node processing intentionally applies broadly (`knowledge node OR direction === "after"`), so non-knowledge future changes are also removed.
- For edges in `"after"`, entries created after cutoff are removed; deleted flags after cutoff are rebased/cleared to keep state coherent at new present.
- Timeline menu in `Timeline.tsx` calls `onClearKnowledgePreviousEdits` / `onClearKnowledgeNextEdits` with `resolveClearCutoffIso()`.

4. Edge soft-delete + reconnect
- `ProjectEditorPage.tsx`: edge removal from canvas (`handleEdgesChange`) soft-deletes by setting `edge.data.deletedAt`.
- `ProjectEditorPage.tsx`: duplicate-connect guard checks only active edges (`deletedAt === null`), allowing reconnect after soft-delete.
- `flowSlice.ts`: dedupe key includes active/deleted state (`deleted` token), preventing active/deleted edge collisions.

5. Blueprint parent resize and deleted children
- `flowSlice.ts`: `resizeSystemBlueprintGroups` skips inactive nodes via `isNodeActive` (based on `node.data.deletedAt`).
- `flowSlice.ts`: `compactBlueprintChildren` + size recomputation updates both width and height from active children extents.
- Resize is triggered on relevant updates/removals and node-change removals.

6. Asset upload and playback-aware timestamps
- `useFileAttachmentProcessing.ts`: `resolveActionTimestamp` uses `actionTimestamp` (wired from `playbackAt`) when valid.
- `useFileAttachmentProcessing.ts`: upload path passes `createdAt` into `createFile`, then uses persisted `createdAt` for node/file updates and `attachFileIdToNode(editAt)`.
- `stateApi.ts`: `createFile` appends `createdAt` form field when provided.
- `backend/src/routes/state.ts`: `POST /state/:docId/files` parses optional `createdAt` and stores it as file `created_at` (falls back to now only if invalid/missing).
- `flowSlice.ts`: `attachFileIdToNode` commits attachment through node history snapshot, making attachment visibility reconstructable during playback.

7. Export/duplicate heavy-path safeguards
- `backend/src/routes/state.ts`: `POST /state/:id/duplicate` logs source file count, total file bytes, revision count, and elapsed time.
- `backend/src/routes/state.ts`: `GET /state/:id/export-vi` logs file/revision counts, total file bytes, encoded bytes, and elapsed time.
- `backend/src/routes/state.ts`: optional `VI_EXPORT_MAX_TOTAL_FILE_BYTES` can return `413` early for oversize exports.
- `backend/src/routes/state.ts`: export file hydration uses bounded parallelism (`VI_EXPORT_FILE_FETCH_CONCURRENCY`, default `4`, capped at `16`) while preserving file order.
- `backend/src/routes/state.ts`: duplication uses chunked multi-row inserts for files/revisions to reduce DB round-trips.
- `vitral/nginx.conf`: `/vitral/api/` uses extended proxy timeouts and disables buffering for long-running responses.
- `backend/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`: `NODE_OPTIONS=--max-old-space-size=2048` increases backend heap budget.
- `backend/src/utils/projectVi.ts`: `.vi` gzip level is configurable via `VI_GZIP_LEVEL` (default `1`) to trade smaller CPU time for larger output files when needed.
- `vitral/src/api/stateApi.ts` + `vitral/src/pages/ProjectsPage.tsx`: frontend duplicate flow starts async job and polls status until terminal state.

8. Activity drop rings and canvas drop
- `canvasGeometry.ts`: `getActivityDropTargets` (ring per visible, non-soft-deleted activity; radius derived from the card size so the disc always contains the card), `findActivityDropTarget` (disc hit test, nearest center wins when rings overlap), `resolveConnectedCardPlacement` (angle/distance search for a non-overlapping slot, seeded by the cursor direction).
- `canvasGeometry.ts` also owns `resolveAbsoluteNodePositions`, shared with `ProjectEditorPage.tsx` (parent-relative blueprint children).
- `ActivityDropRings.tsx`: rendered through `ViewportPortal` so rings pan/zoom with the canvas; hover highlight state is local to the overlay on purpose, so pointer movement does not re-render `ProjectEditorPage`.
- `ProjectEditorPage.tsx`: `fileDragActive` is driven by a single capture-phase window `dragover` listener and cleared by capture-phase `dragleave` (only when `relatedTarget === null`, i.e. the drag left the window), `dragend`, `drop`, and Escape.
- `ProjectEditorPage.tsx`: `pendingFocusNodeId` + its effect pan (never re-fit) to a newly created card once the layout has placed it, because the cursor no longer decides where a card lands. Only the first card of a multi-file drop pulls the camera.
- `ProjectEditorPage.tsx`: `activityDropReason` gates rings on `!interactionLocked && viewMode === "explore"`; `activityDropTargets` is only computed while a reason is active.

## Regression Watch-outs

- Keep timeline default logic mirrored between `Timeline.tsx` and `useTimelineChart.ts`; drift between them can cause mismatched needle behavior.
- If you simplify clear-edits logic, do not scope `"after"` to only knowledge nodes, or playback lock can remain stuck due to non-knowledge future edits.
- Do not change duplicate-edge checks to include soft-deleted edges, or reconnect-after-delete will break.
- Any change to attachment writes should preserve `editAt` history snapshots; direct mutation without history can break playback visibility.
- If export/duplicate starts failing with 502 again, check nginx proxy timeout/buffering settings before changing application logic.
- Keep export file fetch concurrency bounded; unbounded parallel S3 reads can cause memory spikes and upstream instability.
- Do not reintroduce an LLM call on the canvas file-drop path; that flow is deliberately fast and label-fixed (`object`).
- Keep the drop-ring hit test on the disc, not the ring outline, or clicking the activity card itself with the card tool will silently create a disconnected root activity instead of a connected card.
- `parseFile`'s `includePreviewText` defaults to `true`; leave it defaulted for every LLM path, or generated cards lose the file contents they are derived from.
- Do not reintroduce a per-view layout branch. Adding a view means choosing its node subset in `viewBaseNodes`; the arrangement must stay shared.
- The uniform activity slot pitch is derived from the widest orbit in the project, which is what guarantees no two orbits collide. Making the pitch per-slot would reintroduce overlap.
- Do not compare canvas/flow coordinates against stored `node.position` for cards — the layout owns rendered positions, so those two spaces no longer agree.
- Orbit spacing is sized from the card **diagonal** as a chord (`CARD_SEPARATION_PX`), for both neighbours on a ring and the gap between rings. Budgeting arc length instead lets cards overlap at almost every count above six; budgeting less than the diagonal lets consecutive rings clip.
- Blueprint roots are gridded in content order (`compareByLabelTitleId`), never by stored position. Creation paths write cursor coordinates into blueprint roots, so ordering or anchoring the block by position makes existing blueprints jump when a new one is added.
- Keep the structural views' `displayedEdges` off `filteredEdges`. That selector's identity churns on asset hover / knowledge highlight, and feeding it into `displayedNodes` makes the non-explore `fitView` effect discard the user's pan and zoom.
