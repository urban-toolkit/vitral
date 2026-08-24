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
- Attaching a file to an existing **activity** card is a different flow and still runs LLM card generation (`onAttachFile` -> `processFile`). There is **no timestamp prompt**: the file is stamped with the current timeline action timestamp, and an activity's own timestamp is edited on the back of its card (contract 18).
- Dropping **inside an activity's drop ring** is about to create an edge, so it asks the same question the manual connect gesture asks — once, for the whole batch (`pendingFileDropMenu` in `ProjectEditorPage`, rendered through the shared `EdgeConnectMenu`). The answer is threaded to `onAttachFileToCanvas` as `CanvasDropConnection` and applied to every card in the drop, so a batch is never half `generated by` and half something else. **Nothing is uploaded until it is answered**: the `File` handles are held in state (they outlive the drag; the `DataTransfer` does not), so dismissing the menu leaves the canvas exactly as it was. Dropping outside every ring creates no edge and so asks nothing.

15. Activity drop rings (non-activity cards hang off activities)
- Dashed rings are drawn around every visible activity card while a file is dragged over the canvas and while the card tool is armed.
- The valid area is the filled disc, not just the ring outline, so clicking/dropping on the activity card itself counts as inside.
- Dropping or clicking inside a ring creates a card connected to that activity. The card tool uses the `activity|object` relation (`generated by`) straight away — one card, one click, nothing to batch; a **file** drop asks which relation first (contract 14). Where the card lands is decided by the shared layout (contract 16), not by the cursor, so the canvas pans to the new card afterwards.
- Dropping outside every ring still creates the unconnected object card at the cursor; clicking outside every ring with the card tool still creates a root `activity` card (this is how new activities are made).
- Rings are suppressed when `interactionLocked` (review mode / historical playback) or when the canvas is abstracted (`canvasLevel !== 3`), because a glyph has no id in the document to attach anything to.
- Creating a card must never be silently invisible: `resetFiltersForCanvasCreation(ensureVisibleLabel)` re-enables the sidebar label chip for the card being created, in addition to clearing the chat-query filter. It is a no-op when nothing is filtered (every `setState` receives its current value, so the `fitView` effect deps stay reference-identical and the camera does not move).
- Window-level drag/pointer tracking for the rings must stay on the **capture** phase. `AttachFileZone` calls `stopPropagation()` on drag events, so bubble-phase listeners miss the drop that ends a drag and the rings stay stuck on screen.

16. One time-based layout for every view
- There is no Evolution view and no `CanvasViewMode` — both were deleted in `fb4dd46`. What survives of that idea is the `blueprintComponentsVisible` chip and the abstraction levels (contract 19). Every view runs the same layout (`activityOrbitLayout.ts`).
- Views differ only in **which** nodes they show; the arrangement is identical in all of them.
- Activities are the only cards where time matters: laid out left to right, one slot per distinct `createdAt`, **evenly spaced by order** (deliberately not proportional to elapsed time). Activities sharing a timestamp share a slot and are separated vertically.
- Every other card orbits the activity it belongs to, on an **onion of fixed-radius layers** ordered by its graph distance (hop count) from that activity. Ties go to the chronologically earlier activity.
- Layers never widen to fit their cards. A hop starts no closer than its own distance, fills the layer it lands on, and spills into a new layer around the leaves when that one is full — so a crowded hop grows outward instead of pushing its whole ring away from the activity.
- The slot pitch is derived from a **typical** (median) tree, not the widest one. Trees that do not fit that pitch are offset on **Y** until their bounding discs clear, so the graph grows vertically as well as horizontally instead of one big tree stretching every gap in the project. Offsets alternate above and below the time axis and are searched in chronological order, which keeps the result stable as activities are added.
- Cards that reach no activity are laid out in an "unassigned" band below everything, so nothing silently disappears.
- Blueprint groups/components keep their own nested structure and are translated in as a single block; they are never treated as orbiting satellites.
- Node dragging is disabled in every view. Stored node positions no longer drive card rendering — only blueprint structure still reads them (relative to its own roots).
- Because of that, any hit test against canvas coordinates must read `displayedNodes`, never the raw store `nodes` (see `isInsideSystemBlueprintParentBox`).

18. One file per card, and an editable activity timestamp
- A card holds **at most one** attachment. `attachFileIdToNode` replaces rather than appends, so no path (drop, LLM generation, `.vi` import) can rebuild a multi-file card, and the card front shows a single `FileSlot` — the file's preview, or the drop zone when there is none. There is no carousel.
- Projects saved before that rule can still carry several attachment ids. The card shows the first one it can resolve rather than dropping the rest; detaching reveals the next, so a legacy card converges on one attachment without losing data silently.
- An **activity** card's `createdAt` is editable on the back of the card (`datetime-local`, commit on Enter/blur, cancel on Escape). This is the only place a timestamp is set by hand, and it is what moves the tree along the time axis. Non-activity cards still render their timestamp read-only.
- `datetime-local` carries no timezone, and a date-TIME string without one parses as local time — the same convention `toLocalDateTimeInputValue` writes, so the value round-trips. Minute precision means sub-minute components of an existing timestamp are dropped on edit.

17. Every LLM/conversion request must be able to end
- `POST /api/llm/chat` cancels its upstream inference when the browser goes away, but the disconnect listener must be on **`reply.raw`**, not `request.raw`. Since Node 16 an `IncomingMessage` emits `close` as soon as the request body has been read — which Fastify does before the handler runs — so a `request.raw.on("close")` listener fires on *every* request one tick after it arrives. Combined with the `reply.hijack()` in the abort branch that made every card-generation request hang the browser forever, which is exactly what "attaching a file loads forever" looks like.
- Guard the listener with `reply.raw.writableEnded` so a normally finished reply is not mistaken for a dropped socket.
- Client-side, compose signals with `withDeadline` (`vitral/src/utils/abort.ts`). `signal ?? AbortSignal.timeout(ms)` looks equivalent but drops the deadline for every caller that passes a signal — which is every file-drop path — so nothing bounds the wait.
- Both docling hops (browser -> backend, backend -> docling-serve) carry their own timeout; `node-fetch` has no default one, and it reports an abort as `AbortError`, not the signal's `TimeoutError`.

19. Focus + context: three canvas abstraction levels
- `canvasLevel` is `1` Overview, `2` Threads, `3` Detail. Detail is today's bare graph.
- The whole feature is one pure function, `buildAbstractedGraph` (`canvasAbstraction.ts`), inserted between `filteredEdges` and the layout in `ProjectEditorPage`. **At level 3 it returns its input arrays by reference.** That identity path is the no-regression guarantee — keep it as the first statement in the function.
- Glyphs present as `data.label === "activity"` with an explicit size, so `activityOrbitLayout.ts` places them with no knowledge of the feature. The size must be set as top-level `width`/`height` **and** in `style`: React Flow reads only the former when deciding a node has dimensions, and keeps a node `visibility: hidden` (with its edges unrendered) until it does. `nodeSizeOf` reads the latter.
- An activity glyph keeps the **real activity node id**, so switching Threads to Detail leaves it mounted and only its satellites change. Phase glyphs use `vz:c:<earliest member id>`; collapsed edges use `vz:e:<pair>`. `isSyntheticCanvasId` gates `handleNodesChange`, `handleEdgesChange` and `manualNodePositions` — a synthetic id must never reach the store.
- Focus is a path (`{ clusterId, activityId }`) and nesting falls out of `effectiveLevelForActivity`, which is checked deepest-first. There is no separate state machine, and no focus stack.
- Card creation, file drops and the activity drop rings are live **only** at level 3 (`canvasIsEditable`).
- **No LLM, ever.** Cluster labels are borrowed: a timeline stage name when exactly one phase falls inside that stage, else the highest-salience activity's own title, else an ordinal. Semantic similarity comes from `referenced_by` / `iteration_of` edges, which already froze thresholded cosine similarity into the graph at card-creation time; `document_node_embeddings` is deliberately untouched.
- Zoom mode reads the viewport through `onMove`, never `useViewport()`/`useStore` in `ProjectEditorPage` — that callback fires every animation frame and re-rendering a 4000-line component at 60Hz is ruinous. It early-returns off refs unless the level band actually changed.
- **Both zoom ladders are symmetric — no hysteresis, in either direction.** `levelForZoom` (`canvasAbstraction.ts`) and `lodForZoom` (`canvasLod.ts`) used to carry multiplicative dead bands; a 1.35x band meant Detail was left at 0.556 and only regained at 1.013, which reads as the threshold moving on its own rather than as stability. A gesture that crosses a boundary and comes straight back now lands exactly where it started. Do not reintroduce a Schmitt trigger without a measured flicker problem; the early return in `handleViewportMove` and the `fitView` rule below are what keep a crossing from feeding itself.
- The two ladders are deliberately **ordered, not interleaved**: every card-detail boundary (0.550, 0.180) is below the Detail boundary (0.850). With follow-zoom on, a card is therefore never simplified in place — it is replaced by a glyph while still fully drawn, and the abstraction is the only simplification on that path. The card tiers are tuned for follow-zoom **off**, where the user pins Detail and zooms out over the bare graph. Retuning either set means re-checking this ordering, and `minZoom` in `FlowCanvas.tsx` has to stay below 0.420 or Overview is unreachable.
- Never `fitView` on a level change while `levelFollowsZoom` is on: writing the viewport there can bounce the zoom back across the threshold and fights the user's gesture.
- Glyph counts describe the **filtered** canvas, not the whole project. That is deliberate — a glyph must not promise more than expanding it would reveal.
- **`person` cards are context, not content, and no summary treats them as cards.** They are excluded from `countLabels` (so they never colour a glyph's accent or fill its composition strip), from `pickTop` (so they are never promoted out to orbit a glyph), and therefore from `topTitles`; the folded ones are collected into `CanvasGlyphData.participants` and drawn as a `Participants:` footnote instead. Left as ordinary cards they distorted every summary at once: everyone is attached to their activity, so they win promotions on degree, and a glyph would name itself after whoever attended.
- Orbit radii are fixed **per hub**, not globally (`hubOrbitRadius` in `activityOrbitLayout.ts`). An ordinary activity card resolves to exactly `ORBIT_MIN_RADIUS_PX`, so Detail is laid out identically to before; a hub bigger than a card gains what it oversteps, and a summary glyph gains `GLYPH_ORBIT_CLEARANCE_PX` on top. A glyph is a container, and a promoted card sitting at the card pitch reads as part of it — which is the opposite of what promoting it meant.
- The level segments, the follow-zoom toggle, the focus breadcrumb and the assistant button are **one panel** in the bottom-right corner (`CanvasLevelControl`), rendered as a React Flow `bottom-right` `Panel` offset by `RIGHT_SIDEBAR_WIDTH_PX`. It is two short rows on purpose: the canvas tool bar owns the bottom centre, and a single long bar in that corner runs into it on a 1440-wide screen. The minimap sits above it, so `MINIMAP_LEVEL_PANEL_CLEARANCE_PX` / `..._FOCUSED_CLEARANCE_PX` mirror the panel's two heights — change one and change the other.

20. Edges meet the card border that faces the other card
- `RelationEdge` ignores the handle geometry React Flow hands it and draws between the two border points on the straight line joining the node centres (`floatingEdgePath.ts`). Cards keep a target handle left and a source handle right, so **every edge would otherwise leave right and arrive left** — an S-curve for a card sitting directly above another, which is exactly what the orbit layout produces.
- The path is a cubic bowed a few percent off the straight run, never a routed one: connections have to read as direct. The bow's sign follows the direction of travel, so `A -> B` and `B -> A` separate instead of overlapping.
- **Direction still matters.** The path keeps its source -> target parameter order, so the source-end arrow (`orient="auto-start-reverse"`, drawn only when both ends are card labels) points where it always did. Do not "simplify" by swapping the endpoints.
- `useInternalNode` is what makes it live: it re-renders the edge when either node moves or is measured, and — unlike `useViewport` — not on pan or zoom. Until both nodes are measured, `getFloatingEdgePath` has no box to aim at and the handle-based bezier is used instead, so edges are never missing on first paint.
- Handles are `opacity: 0` until the node is hovered (`FlowCanvas.module.css`). They are still the grip for dragging a new connection — `opacity: 0` keeps pointer events — but nothing terminates there any more, so they must not advertise an attachment point.

21. Automatic `referenced by` / `iteration of` edges are gated on evidence, not on a raw score
- These are the only edges the app creates without being asked, and they feed everything downstream: salience weights degree and cross-tree links, phase clustering reads them as affinity, so a wrong edge does not merely clutter the canvas -- it changes which cards get promoted and what a phase is called.
- **The embedded text is title + description only** (`serializeNodeForEmbedding`). It used to carry `Card label:/Card title:/Card description:` scaffolding, identical in every card, which put a large constant component in every vector -- lifting all cosines into a narrow band near the top and squeezing the gap between a real match and an unrelated one. Removing it is what made an absolute threshold mean anything. Changing this text again **must** bump `EMBEDDING_TEXT_VERSION`; stored vectors are keyed by `model@vN` and a stale signature is treated as missing.
- The label is a **filter**, never content. It belongs in the SQL `WHERE`, not in the embedded string.
- The decision lives client-side in `similarityDecision.ts` because it needs the live graph (chronology, existing automatic degree), which the saved snapshot may lag. The backend only retrieves and calibrates.
- Gates, in the order they do work: **level** (absolute floor), **separation** (clear of the best rejected candidate, or of the cohort median when nothing was rejected), **degree** (a card already carrying `MAX_AUTO_DEGREE` automatic edges takes no more). Separation is what kills a hub: a card that everything is similar to always has its runner-up right behind it.
- A **robust z-score against the cohort is deliberately not a gate.** It was tried, and measured: on real probes the linked and rejected populations *overlap* on z (linked 1.93-4.93, rejected 1.50-2.73) because its denominator depends on how topically central the query card is. It is still computed and stored on the edge as evidence. Do not promote it back to a gate without new measurements.
- `iteration of` claims one card *supersedes* another, so it needs a second independent signal, not just a higher cosine: the target must be **chronologically older** and the two titles must share `ITERATION_TITLE_OVERLAP` by Jaccard. It is deliberately **not** restricted to one activity tree -- a later activity revising an earlier activity's requirement is the most meaningful case there is.
- Every automatic edge records `similarity`, `similarityZ`, `similarityMargin` and `autoLinked` in `edge.data`, so a questionable relation can be explained after the fact and thresholds retuned against real projects.
- Thresholds are empirical. `npm run test:similarity` pins them against probes taken from a real canvas; change a threshold, the text, or the model and that check has to be re-run and its numbers updated.
- **`person` cards are never auto-linked, at either end** (`AUTO_LINK_EXCLUDED_LABELS` in `graphSemantics.ts`). A name embeds into whatever surrounds it, so two people who took part in the same kind of session score as similar for reasons that have nothing to do with either of them, and a participant who appears in every study becomes exactly the hub the gates above exist to prevent. The only edge a person gets is the explicit one to its activity. A new person card is dropped before the retrieval call (nothing to be similar *about*, so the round trip is pure waste); a person **candidate** is filtered before `decideSimilarityEdges` runs, never after — left in the ranking it would still consume one of the two edges a new card may take and still set the separation floor the real matches have to clear.

22. Similarity retrieval is a database search, not a scan
- `POST /state/:id/cards/similarity` takes **only the new cards**. The server already holds the canvas; shipping every existing card's text on every file drop bought nothing but a payload that grew with the project and a silent `slice(0, 500)` truncation in arbitrary order at the far end.
- Candidates come from one indexed query per new card that scores, ranks and computes the cohort's median and MAD **in Postgres** (`percentile_cont` over a CTE). The old path pulled every vector out as `embedding::text` -- roughly 11 MB and ~768k `Number()` calls at 500 cards -- and did the cosine in JS. Do not reintroduce that.
- The route is **self-healing**: it embeds and stores any card in the document that the index is missing at the current signature, capped at `SIMILARITY_HEAL_LIMIT` per pass. That one mechanism covers the queue's debounce window, edited text, projects duplicated before the `label` column existed, and every card in every project the first time it is seen after an `EMBEDDING_TEXT_VERSION` bump.
- Embedding calls are chunked (`SIMILARITY_EMBED_CHUNK`). A failure returns `status: "degraded"`, never an empty match list -- "the lookup broke" and "nothing is similar" have to stay distinguishable, and the client logs rather than silently adding no edges.
- Project duplication copies `label` and `model` along with the vectors; without them a duplicate looks entirely unembedded.

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

- Automatic similarity edges (`referenced by` / `iteration of`):
  - `vitral/src/pages/projectEditor/similarityDecision.ts` (the gates, and why each one is there)
  - `vitral/src/pages/projectEditor/similarityDecision.test.ts` (`npm run test:similarity`)
  - `vitral/src/pages/projectEditor/useFileAttachmentProcessing.ts` (where they are created)
  - `vitral/src/utils/textTokens.ts` (the lexical second opinion, shared with phase clustering)
  - `backend/src/routes/state.ts` (`/cards/similarity`: retrieval, calibration, backfill)
  - `backend/src/services/nodeEmbeddings.ts` (embedding text, version signature)
  - `backend/db/migrations/014_embedding_label_and_hnsw.sql`

- Edge routing between cards:
  - `vitral/src/components/edges/floatingEdgePath.ts`
  - `vitral/src/components/edges/RelationEdge.tsx`
  - `vitral/src/pages/projectEditor/FlowCanvas.module.css` (handle visibility)

- Canvas corner controls (levels + follow zoom + focus breadcrumb + assistant):
  - `vitral/src/pages/projectEditor/CanvasLevelControl.tsx`
  - `vitral/src/pages/projectEditor/FlowCanvas.tsx` (`levelControl`, `levelControlRightOffsetPx`)
  - `vitral/src/pages/ProjectEditorPage.tsx` (minimap clearance constants)

- Project setup / settings screen:
  - `vitral/src/pages/ProjectSetupPage.tsx`
  - `vitral/src/pages/ProjectSetupPage.module.css`
  - `vitral/src/styles/tokens.css` (the tokens that screen is built from)

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
- The activity slot pitch is uniform (the time axis is evenly spaced by order) but sized from the median tree. What keeps trees from colliding is the vertical offset search in `resolveTreeCenterY`, not the pitch — removing it while keeping the median pitch would let orbits overlap. Making the pitch per-slot would break the even time spacing.
- Do not compare canvas/flow coordinates against stored `node.position` for cards — the layout owns rendered positions, so those two spaces no longer agree.
- Orbit spacing is sized from the card **diagonal** as a chord (`CARD_SEPARATION_PX`), for both neighbours on a layer and the gap between layers. `layerCapacity` inverts the same chord relation to decide how many cards a layer holds. Budgeting arc length instead lets cards overlap at almost every count above six; budgeting less than the diagonal lets consecutive layers clip.
- Blueprint roots are gridded in content order (`compareByLabelTitleId`), never by stored position. Creation paths write cursor coordinates into blueprint roots, so ordering or anchoring the block by position makes existing blueprints jump when a new one is added.
- Keep the structural views' `displayedEdges` off `filteredEdges`. That selector's identity churns on asset hover / knowledge highlight, and feeding it into `displayedNodes` makes the non-explore `fitView` effect discard the user's pan and zoom.
- Both zoom ladders (`levelForZoom`, `lodForZoom`) are symmetric. Do not add hysteresis back to either without a measured flicker problem, and keep every card-detail boundary below the Detail level boundary — the ordering in contract 19 is what makes zooming out replace a card with a glyph rather than simplify it first.
- Keep `hubOrbitRadius` resolving to exactly `ORBIT_MIN_RADIUS_PX` for an ordinary activity card. Making the extra clearance unconditional would relayout the whole bare graph, which is the one thing Detail is not supposed to do.
- Do not let a `person` card into `countLabels`, `pickTop` or the automatic-similarity candidate list. Each of those is a separate leak of the same rule (contracts 19 and 21), and the failure is quiet: a glyph that names itself after whoever attended, or a participant that becomes the most connected card in the project.
- Do not turn the drop-ring relation menu into a post-hoc rewire (create the cards, then change the edge). Holding the `File` handles until it is answered is what makes dismissing it a true no-op.
