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
- Dropping **inside an activity's drop ring, or on a card's spawn box** (contract 15) is about to create an edge, so it asks the same question the manual connect gesture asks — once, for the whole batch (`pendingFileDropMenu` in `ProjectEditorPage`, rendered through the shared `EdgeConnectMenu`). The answer is threaded to `onAttachFileToCanvas` as `CanvasDropConnection` and applied to every card in the drop, so a batch is never half `generated by` and half something else. **Nothing is uploaded until it is answered**: the `File` handles are held in state (they outlive the drag; the `DataTransfer` does not), so dismissing the menu leaves the canvas exactly as it was.
- The anchor is a `CanvasDropAnchor` (`{nodeId, direction}`), not an activity id: `onAttachFileToCanvas` reads the anchor's own label and looks the relation up against it, so a file can be dropped on an `object` or `requirement` card as readily as on an activity. `outgoing` puts the anchor on the edge's source, which is what the ring has always produced.
- **Dropping where there is no ring and no box is refused** (contract 24). Nothing is uploaded and nothing is created — the file is still on disk to drop again — and the reason is said out loud through `CanvasNotice`.

15. Creation targets: activity rings and card spawn boxes
- Two overlays, one visual vocabulary, drawn together for the same three triggers — a file dragged over the canvas, the card tool armed, the note tool armed. **Dashed rings** around every visible activity card (`ActivityDropRings`), and **dashed boxes on the input and output handles of every visible non-activity card** (`CardSpawnBoxes`). A ring says which activity a card is about; a box says which *card* it is about. Between them there is always somewhere visible to create the next card, which is what makes contract 24 an offer rather than only a refusal.
- The ring's valid area is the filled disc, not just the outline, so clicking/dropping on the activity card itself counts as inside. A box's is the square, which sits clear of the card border.
- **A box wins over a ring it sits inside.** The box is an offer about one card, the ring an offer about a whole neighbourhood, and the box is what is under the cursor.
- Both overlays are **painted, never clicked**: `pointer-events: none`, and the editor page's handlers hit-test `findActivityDropTarget` / `findCardSpawnTarget` against the gesture's flow position (`resolveCreationTarget`). This is not incidental — the note tool covers the canvas with a full-screen capture layer that would swallow any real click target, and a dragged file never delivers a click at all.
- **The spawned card's type is the ontology's choice, not the user's** (`spawnPartnerFor` in `utils/relationships.ts`): a card that may connect to its own kind extends sideways (`requirement` → `requirement` "details", `concept` → `concept` "composes", `object` → `object` "relevant to"); one that may not takes the most specific partner it has (`insight` → `concept` "part of"). `person` has exactly one legal partner, so its box offers an `activity`. Blueprint nodes get no boxes — `blueprint_component` cannot reach an activity, and `blueprint`/`blueprint_group` have no relation-table entries at all.
- **The box always asks which relation**, through the shared `EdgeConnectMenu` (`pendingCardSpawnMenu`), and **creates nothing until it is answered** — the card and the edge that justifies it are one action, and a card committed before the answer is exactly the unconnected card the boxes exist to prevent. The edge carries `manual: true`. The ring flow is unchanged: the card tool still uses `generated by` straight away, a file drop still asks (contract 14).
- A **file** drag narrows the boxes to the cards an `object` may legally attach to, so a drag never offers a target that would be refused on release. The two tools cannot know their label in advance and get every box; the **note** tool checks its own label against the anchor at submit time and is refused, with the anchor's legal partners listed, when the pair does not exist.
- Clicking outside every ring and box with the card tool still creates a root `activity` card — this is how new activities are made, and an activity is the one card allowed to stand alone. A **note** or a **file** there is refused instead (contract 24).
- Where a created card lands is decided by the shared layout (contract 16), not by the cursor, so the canvas pans to the new card afterwards.
- Both overlays are suppressed when `interactionLocked` (review mode) or when the canvas is abstracted (`canvasLevel !== 3`), because a glyph has no id in the document to attach anything to. A menu left open across either change is dropped with the affordance that raised it.
- Creating a card must never be silently invisible: `resetFiltersForCanvasCreation(ensureVisibleLabel)` re-enables the sidebar label chip for the card being created, in addition to clearing the chat-query filter. It is a no-op when nothing is filtered (every `setState` receives its current value, so the `fitView` effect deps stay reference-identical and the camera does not move).
- Window-level drag/pointer tracking (`useHoveredCanvasTarget`, shared by both overlays) must stay on the **capture** phase. `AttachFileZone` calls `stopPropagation()` on drag events, so bubble-phase listeners miss the drop that ends a drag and the highlight stays stuck on screen.

16. One time-based layout for every view
- There is no Evolution view and no `CanvasViewMode` — both were deleted in `fb4dd46`. What survives of that idea is the `blueprintComponentsVisible` chip and the abstraction levels (contract 19). Every view runs the same layout (`activityOrbitLayout.ts`).
- Views differ only in **which** nodes they show; the arrangement is identical in all of them.
- **Stacking is derived as well as position.** Nothing writes `zIndex` onto a card, so a card created today has none -- but projects saved by earlier versions carry values on their activity cards, and React Flow feeds `node.zIndex` straight into the wrapper's inline `z-index`. `activityOrbitLayout` strips it from `type === "card"` nodes so an old project stacks like a new one. Blueprint nodes keep theirs: there the nesting order is real. This is not cosmetic -- a stale `3000` on an activity card is what painted an opened source document *behind* the activity it was opened beside, outranking anything the stylesheet lifts on purpose.
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
- **The back of a card is its description, and one row of handles underneath.** The description takes whatever the footer does not (`flex: 1; min-height: 0`), so a long note scrolls inside the card instead of being capped while metadata spells itself out below it. The footer is the timestamp plus icon-only controls; at 200px wide there is room for the note or for labelled controls, not both.
- **The citation is a link icon, not a label.** Its tooltip carries the quote and the source filename together, and clicking it opens the source docked beside the card and scrolls it to the passage, marked. A native `title` rather than a styled popover on purpose: the card faces carry `contain: layout paint style`, so a popover drawn inside one is clipped at 200x260 -- a quote long enough to be worth reading could not be shown there at all. The browser's tooltip escapes the card, wraps, and costs no layout.
- **Assignment is an icon too**, filled when set, and clicking it swaps the footer row for the participant select. The name lives in the tooltip; the icon answers the question the card is actually asked at a glance, which is whether it is assigned at all.
- A source the project can name but cannot open (the file record is gone) still shows the icon, inert and marked `cursor: help`: it says where the card came from, and must not look clickable. The search is in `files/referenceLocation.ts` (pure, tested) with the DOM half in `files/useReferenceHighlight.ts`.
- It matches against the **rendered** text, not the stored source, because that is the only representation the four renderers share -- markdown has been through `react-markdown`, a PDF's text layer breaks lines wherever the page did, a notebook is reflowed. The rendered subtree is flattened into one string with an index back to its text nodes, so a quote spanning six PDF line spans is found exactly like one inside a paragraph.
- Matching is forgiving about **whitespace and case only**, and then degrades by *shortening the needle* rather than loosening it: a prefix of the quote is still the quote, whereas a fuzzy match of the whole quote could land anywhere. `MIN_PREFIX_WORDS` / `MIN_PREFIX_CHARS` stop a prefix getting short enough to hit a coincidence -- scrolling the reader to the wrong place is worse than not scrolling them.
- The mark is painted with the **CSS Custom Highlight API** over a `Range` (`::highlight(vitral-reference)` in `styles/global.css`). The alternative -- wrapping the match in an element -- has to split text nodes inside a subtree React owns and will re-render away. Where the API is missing the passage is still scrolled to, untinted; losing the tint is much smaller than losing the position.
- The retry schedule is load-bearing: a lazily imported renderer and each PDF page's text layer arrive after mount, so the search runs on a short decaying schedule and stops at the first hit.
- `npm run test:reference-location` covers the ways a stored excerpt legitimately differs from what is on screen, and the floor that refuses a coincidence.
- The docked panel's node sits at `z-index: 2000`, which has to stay **above React Flow's own selection band** (`SELECTED_NODE_Z` is 1000 in `@xyflow/system`, with `elevateNodesOnSelect` on by default) **and above any legacy `node.zIndex`** -- see contract 16, which is why the layout now strips those. At the previous 60 the panel cleared idle cards and then vanished behind the next card the user clicked; raising it alone was still not enough while stale 2000/3000 values sat on the activity cards.
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
- **A card a person put there outranks one the model proposed, at equal centrality.** `SALIENCE_WEIGHTS.authored` (0.20) is awarded whenever `data.autoGenerated !== true` — the existing, principled line, since a file dragged onto the canvas is deliberately *not* flagged, so the flag means *machine-proposed* and not *machine-touched*. It sits between `degree` (0.30) and `crossTree` (0.25) on purpose: above a median card's share of degree, so a typed insight is not buried under extracted ones that happen to be wired up, and below `crossTree`, so it can never outrank a card that genuinely ties two threads together. Centrality still decides; this breaks the near-ties in the researcher's favour. The card carries it visibly as an inset ring on both faces -- *inset*, because the faces are `position: absolute; width: 100%` with no `box-sizing: border-box`, so a thicker `border` would push the painted box past the 200x260 that `canvasGeometry` declares and React Flow's ResizeObserver reads. It is one more term in the scalar and **not** a branch in `compareBySalience` — that comparator is a total order over one score, and a special case there would promote stubs. Adding it changes which cards get promoted on existing projects; re-check Threads and Overview on a real canvas after touching it.
- Orbit radii are fixed **per hub**, not globally (`hubOrbitRadius` in `activityOrbitLayout.ts`). An ordinary activity card resolves to exactly `ORBIT_MIN_RADIUS_PX`, so Detail is laid out identically to before; a hub bigger than a card gains what it oversteps, and a summary glyph gains `GLYPH_ORBIT_CLEARANCE_PX` on top. A glyph is a container, and a promoted card sitting at the card pitch reads as part of it — which is the opposite of what promoting it meant.
- The level segments, the follow-zoom toggle, the focus breadcrumb and the assistant button are **one panel** in the bottom-right corner (`CanvasLevelControl`), rendered as a React Flow `bottom-right` `Panel` offset by `RIGHT_SIDEBAR_WIDTH_PX`. It is two short rows on purpose: the canvas tool bar owns the bottom centre, and a single long bar in that corner runs into it on a 1440-wide screen. The minimap sits above it, so `MINIMAP_LEVEL_PANEL_CLEARANCE_PX` / `..._FOCUSED_CLEARANCE_PX` mirror the panel's two heights — change one and change the other.

20. Edges meet the card border that faces the other card
- `RelationEdge` ignores the handle geometry React Flow hands it and draws between the two border points on the straight line joining the node centres (`floatingEdgePath.ts`). Cards keep a target handle left and a source handle right, so **every edge would otherwise leave right and arrive left** — an S-curve for a card sitting directly above another, which is exactly what the orbit layout produces.
- The path is a cubic bowed a few percent off the straight run, never a routed one: connections have to read as direct. The bow's sign follows the direction of travel, so `A -> B` and `B -> A` separate instead of overlapping.
- **Direction still matters.** The path keeps its source -> target parameter order, so the source-end arrow (`orient="auto-start-reverse"`, drawn only when both ends are card labels) points where it always did. Do not "simplify" by swapping the endpoints.
- `useInternalNode` is what makes it live: it re-renders the edge when either node moves or is measured, and — unlike `useViewport` — not on pan or zoom. Until both nodes are measured, `getFloatingEdgePath` has no box to aim at and the handle-based bezier is used instead, so edges are never missing on first paint.
- Handles are `opacity: 0` until the node is hovered (`FlowCanvas.module.css`). They are still the grip for dragging a new connection — `opacity: 0` keeps pointer events — but nothing terminates there any more, so they must not advertise an attachment point.

21. Automatic `referenced by` / `iteration of` edges are gated on evidence, not on a raw score
- The pass lives in `autoLinkCards.ts` and is **shared**: the file drop runs it over the cards a model extracted, and the note tool runs it over the card the researcher typed. Both get the same gates. It used to sit inline in the file-drop path, which meant a card only ever gained automatic relations if a model had produced it -- so the researcher's own reading of the study arrived unconnected to everything already on the canvas, which is backwards. A card with neither title nor description is dropped before the request: there is nothing to be similar *about*, and asking spends a round trip to compare an empty string against the project.
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

23. Notes are captured deterministically, and the researcher's sentence is never rewritten
- The note tool (`cursorMode === "text"`, `FreeInputZone`) turns one typed sentence into **one card**. `classifyNote` in `noteClassification.ts` guesses the label from a weighted keyword table; the note itself becomes `description` byte for byte, and only `title` is derived, by clipping to the first clause. A title is always a prefix of the note — it can say less, never more.
- **No LLM.** This replaced a `CardsFromTextInput` round trip. Note capture is a reading-path affordance and the reading path never calls a model; a round trip also put a spinner between having a thought and seeing it on the canvas, which is the cost the tool exists to avoid. `CardsFromTextInput.txt` is left in place but is no longer reached at runtime. The old path could emit several cards from one sentence; one-in-one-out is a deliberate simplification.
- **The guess is shown before it is committed**, as the card-type select's current value and nothing more -- the classifier does not narrate itself. The label stays overridable in place. A classifier this cheap is only defensible because the researcher sees what it decided — if it ever commits silently it becomes a liability. Correction stays free afterwards through the label `<select>` on the card front.
- The margin gate refuses ambiguity rather than resolving it: a note that reads equally as two labels falls back to `insight` with `confidence: "weak"` instead of being committed to one. **`person` is never minted from a role word** — it needs an exact match against `TimelineState.participants[].name`. Person cards are context-not-content everywhere (contract 19, 21), so one filed wrongly drops out of the abstraction instead of surfacing where it would get corrected.
- Placement mirrors the card tool: inside an activity's drop ring the card is wired to that activity with the pair's canonical relation — **no new entries in `ALLOWED_RELATION_LABEL_BY_PAIR` were needed**, every label already has an `activity|...` pair — and on a card's spawn box it is wired to that card instead, after the relation question (contract 15). `resetFiltersForCanvasCreation(label)` is called with the **guessed** label, or a card whose label sits behind a switched-off chip is created invisible (contract 15). Creation is level-3 only, like every other creation path.
- On empty canvas the note is **refused** unless it classified as an `activity` (contract 24), and `onFreeInputSubmit` returns `false` — which is why it returns a boolean at all. `FreeInputZone` keeps the input open with its text intact on a `false`, so a refusal costs the researcher a re-aim and never the sentence they just wrote. The same happens when the guessed label cannot legally connect to the card whose box the note landed on; the message names the labels that can, and the card-type `<select>` is right there to change it.
- A note card is offered to `autoLinkNewCards` exactly as an extracted one is (contract 21), so a thought the researcher types lands connected to whatever the canvas already says about the same thing.
- `npm run test:note-classification` pins the properties the tool depends on — the sentence survives, ambiguity falls back, a role word alone is not a person, and the same input always classifies the same way — not which label any one sentence gets. The cue table is expected to grow.

24. Only activity cards may stand alone
- Every live card whose label is one of `person` / `requirement` / `concept` / `insight` / `object` must keep **at least one active edge**. An `activity` is exempt: it is where a study starts and the only card that means anything on its own. Blueprint nodes are outside the rule entirely — `blueprint_component` cannot legally reach an activity, and `blueprint`/`blueprint_group` have no relation-table entries, so a connection requirement is one they could never satisfy; they are excluded by node **type**, not by a label list. The predicate is `requiresConnection` in `pages/projectEditor/graphInvariants.ts`; nothing should re-derive it inline.
- The label is read through `cardLabelOf` — `normalizeArtifactEntity`, not a `KNOWN_CARD_LABELS` membership test. The extraction path stores the model's own entity string verbatim on the node and clamps it only when building the edge, so a card labelled `finding` exists, draws as an `object`, and has to inherit both the rule and the spawn boxes. A set test would let it through as neither.
- **A self-edge is not a connection.** React Flow will let a card's source handle be dragged onto its own target handle and every self pair in the relation table accepts it, so `handleConnect` refuses `source === target` outright and `planEdgeRemovals` never counts one. Counting it would break the rule in both directions at once: the card would look connected while reaching nothing, and the loop itself would become undeletable.
- **Enforced on both sides.** Creation: every path that makes a non-activity card attaches it in the same action (contract 15), and a gesture with nowhere to attach is refused rather than dropped loose. Deletion: an edge that is a card's last one cannot be removed.
- The deletion guard lives in **`onBeforeDelete`** (`handleBeforeDelete`), React Flow's own veto, not in `handleEdgesChange`. That is the only point that sees the whole gesture: `deleteElements` hands over the selected edges *together with* the selected nodes and every edge those nodes drag with them, and it fires the edge changes **before** the node changes — so a handler watching edges alone cannot tell "the user cut this card loose" from "this card is going away and its edges with it", and would refuse the second. Do not move it.
- `planEdgeRemovals` decides **one candidate at a time against the ones already approved**, not each against the graph as it stands. A card's last two edges can be selected together and arrive as one batch; checked independently both would see a degree of two and both would pass. It also keeps the useful case working — three of a card's four edges still delete, and only the fourth is refused.
- The degree is counted over the **store** `nodes`/`edges`, never over `displayedNodes`/`displayedEdges`. `filteredEdges` drops any edge whose endpoint is filtered out, so a card can look unconnected on screen while holding active edges in the document.
- **A card that is already loose is never made worse.** Only the step from one edge to none is blocked, so projects imported or saved before this rule keep working and the orbit layout's "unassigned" band still has a job. Orphan (degree 0) and unassigned (reaches no activity) remain different questions: a two-card island has degree 1 at both ends and is still unassigned.
- **Deleting a card is deliberately not guarded.** It is a different gesture with a different expectation, and refusing to delete an activity because its whole tree hangs off it would be unusable — so `softDeleteNode`'s cascade can still leave neighbours loose.
- **Relabelling a card is not guarded either.** `onDataPropertyChange` writes a new `label` with no check, so changing a loose `activity` into an `insight` produces exactly the card this contract forbids, and relabelling one end of a pair can leave an edge whose pair is not in the relation table at all. Guarding it would block a correction the researcher is entitled to make. These two are the known ways the invariant is broken from inside the app; both are deliberate, and neither is a reason to weaken the guards that are in place.
- Every refusal says why, through `CanvasNotice` — a neutral, self-clearing line, not an error banner. A rule that can only be enforced by *not* doing something reads as a broken canvas if it stays silent. That includes the drag-connect refusals (`handleConnect`), which used to return silently.
- The notice sits **below** `EdgeConnectMenu` and is `pointer-events: none` apart from its dismiss button. Every message it carries tells the user to retry the gesture that raises that menu, or leaves the note input open underneath it — a notice that painted over either and swallowed its clicks would take back the advice it just gave. Its live region is mounted for the life of the canvas and only its text is swapped, because a region inserted already populated is the case assistive tech commonly does not announce, and here it is the *only* feedback there is.
- **Cancelling creates nothing, and costs nothing.** Clicking away is how the menus are dismissed and `pointerdown` precedes `click`, so the dismissing gesture sets `canvasClickSuppressedRef` and `onCanvasClick` swallows the click that follows — otherwise a cancel with the card tool armed creates the card that was just declined. A note waiting on the relation question keeps its input open (`onFreeInputSubmit` returns `false`, and only `noteCommittedCount` closes it), because the note tool holds the only copy of the researcher's sentence until the card exists.
- `npm run test:connection-rule` pins the properties: the exempt label, the batch decision, the already-loose case, the node-deletion exemption, and that every spawn box offers a pair the relation table actually allows.

25. Accounts, sessions and guests
- An account is a **username and a password**; email is optional and stored as `NULL` when not given. `app_users` (not `users` — `prov_user` in migration 012 is a canvas-provenance node table, and the two must not be read as the same thing). `username_lower` carries the UNIQUE index, so names are case-insensitive for both collision and login.
- Passwords are **scrypt via `node:crypto`** (`backend/src/utils/passwords.ts`), parameters encoded in the stored string so they can be raised without invalidating existing accounts. Deliberately not bcrypt/argon2: both are native addons and the backend image is `node:25-alpine` with no build toolchain, so adding one means adding musl build deps for something Node already ships.
- Sessions are **server-side and opaque** (`backend/src/plugins/auth.ts`): the cookie holds 32 random bytes, `user_sessions` holds only their SHA-256. A leaked table cannot be replayed as a login, and logging out is a `DELETE` that actually ends the session rather than a client-side promise to forget a token. The cookie is httpOnly, `sameSite: lax`, `secure` from the existing `COOKIE_SECURE` env, matching the GitHub OAuth cookies already set in `routes/github.ts`.
- `app.currentUser(request)` memoises per request on `request.sessionUser` — `undefined` means "not looked up", `null` means "looked up, nobody". Several routes ask twice; it must not cost two queries.
- **Login answers with 200 and `{user: null}`**, never 401, at `GET /api/auth/session`. The frontend calls it on every load to choose a screen, and "nobody is signed in" is an answer rather than an error.
- A failed login says **"Wrong username or password"** for both a missing account and a bad password, and burns a scrypt verification against a dummy hash in the missing-account case. Answering instantly for an unknown name while a real one costs ~100ms is the same enumeration oracle as a distinct message, by timing.
- **`credentials: "include"` is not optional.** The session is a cookie, so every call in `api/stateApi.ts` goes through the `apiFetch` wrapper. Before this feature only 3 of 23 set it by hand; a call that forgets is silently anonymous, which means the ownerless legacy projects and a 403 on every write.
- **Three session states, and `guest` is a real one.** `anonymous` is the only one `RequireSession` redirects; a guest has answered the login screen and gets the whole app. The guest flag lives in `localStorage` (`vitral.guest`) because it has to survive a reload, and reading it is wrapped in try/catch — a private window throws on access rather than returning null.

26. A guest's work never leaves the browser
- "Continue as a guest" is a promise, and `api/localProjectStore.ts` is the only place that keeps it: IndexedDB (localforage) for the document, its revisions and its file blobs. Nothing in that module calls the API.
- **Routing is by id, not by asking who is signed in.** Guest projects carry a `local-` prefix and every function in `stateApi.ts` dispatches on `isLocalProjectId`, so a request cannot leak to the server because some caller forgot to check. Creation is the one call with no id yet, so `createDocument(..., { local })` takes it explicitly — from `ProjectSetupPage`, the only place that decision is made.
- What a guest gives up, and why: **publishing** (no account to publish under), **import `.vi`** and **the canvas assistant / node search** (server-side), **automatic `referenced by` / `iteration of` edges** (embeddings live in Postgres — `compareCardsSimilarity` returns `status: "degraded"`, never an empty match list, so contract 22's distinction survives), and **knowledge provenance** (derived server-side as revisions land; returns empty so the timeline renders nothing rather than erroring). LLM card extraction still works: `/api/llm/chat` is stateless.
- Guest revisions are capped at `MAX_LOCAL_REVISIONS`. A browser cannot hold what Postgres does, and the oldest snapshots are the ones the timeline can afford to lose — the cap is what stops a long session from filling the storage quota and failing the *next* save, which would lose live work rather than history.
- Guest attachments have no URL, so `resolveRawFileUrl` mints `blob:` object URLs from a cache and `ensureLocalFileUrl` warms it. They are deliberately never revoked: the same file is re-rendered on every canvas redraw and a revoked URL would blank an image still on screen.
- A guest project exports as **JSON, not `.vi`** — the archive is assembled server-side and the browser carries no zip writer. Different format, different extension, so nobody feeds it to the importer.

27. Ownership and publishing replace "Make review only"
- `documents.owner_id` is **nullable, and NULL means "created before accounts existed"**. Those stay visible and editable to everyone, so switching login on does not take an in-flight study's projects away. `ON DELETE SET NULL`, never CASCADE: deleting an account must not destroy research data.
- **Publishing is visibility, and it is reversible. `review_only` is a permanent edit lock, and it is not.** They are different columns because they are different facts. Publishing puts a project in `GET /api/state/public` **for everyone, guests included** — read-only for all of them and still fully editable by its owner. The old permanent conversion is gone from the UI; its route and column stay because projects already converted with it must keep behaving the way they were converted to.
- `GET /api/state/public` **needs no session**: publishing is about being readable and a guest is a reader. Its `is_owner` deliberately does **not** grant the `owner_id === null` allowance that `isDocumentOwner` grants elsewhere — that rule exists so pre-accounts projects stay editable by whoever finds them, and applied here it would tell a signed-out viewer they own a published project and offer them an Unpublish the server refuses. A viewer with no account owns nothing.
- A guest sees Open and nothing else on a public card, and no Publish control anywhere. Duplicating creates a copy **on the server**, which has to belong to somebody, so it is an account action; the editor's publish toggle is gated on an actual account rather than on `is_owner`, for the same reason.
- The three access rules live in one place in `routes/state.ts` — `isDocumentOwner` / `canReadDocument` / `canWriteDocument` — and nothing should re-derive them inline. Readable = published or mine (or ownerless). Writable = readable, not `review_only`, **and** mine.
- **An unreadable document answers 404, not 403.** A 403 confirms the id names somebody's real, private project, which turns `GET /state/:id` into a way of enumerating other people's work.
- `PUT /api/state/:id` is an upsert, so a missing document there is the *insert* branch and the caller becomes its owner — not a refusal. The `ON CONFLICT` branch deliberately leaves `owner_id` alone, so saving a legacy ownerless project does not quietly claim it. Publishing one **does** claim it: the public list has to be able to say who put it there.
- `can_edit` is computed **per request** and returned by `GET /state/:id`, because `!review_only` stopped being the whole answer once a project could be somebody else's. `useDocumentSync` reports it, `interactionLocked = !canEdit`, and autosave follows it — a session that may not write must not write. The banner distinguishes the two reasons ("review mode" vs "published by X, duplicate it to make changes") because they leave the reader with different things to do.
- Duplicating a published project you do not own is **allowed and is the intended way to build on one**: the copy is owned by whoever asked for it and is never published, whatever the original was. Duplication is gated on **read** access, not existence — checking only that the id existed made a guessed uuid enough to copy a private project wholesale.
- Every path that creates a document sets `owner_id`: create, the `PUT` upsert's insert branch, duplicate, and `.vi` import. A path that forgets drops the project into the ownerless legacy pool, where every account can see and edit it.
- The Publish toggle is on the **project screen** (`ProjectEditorPage`) and mirrored on the project card. Publishing needs no confirmation — the way back is the same button; **unpublishing does**, because it takes something away from people who may already be reading it.

## Key Areas and Files

- Timeline defaults / playhead / context menu cutoff:
  - `vitral/src/components/timeline/Timeline.tsx`
  - `vitral/src/components/timeline/useTimelineChart.ts`
  - `vitral/src/components/timeline/useParsedTimelineData.ts`

- Playback lock, clear edits, connect/delete behavior:
  - `vitral/src/pages/ProjectEditorPage.tsx`

- Accounts, sessions, ownership and publishing (contracts 25-27):
  - `backend/db/migrations/015_add_accounts_and_publishing.sql` (schema)
  - `backend/src/plugins/auth.ts` (sessions, `currentUser`/`requireUser`), `backend/src/routes/auth.ts`
  - `backend/src/utils/passwords.ts` (scrypt hashing + credential rules)
  - `backend/src/routes/state.ts` (`canReadDocument`/`canWriteDocument`/`ensureDocumentWritable`, `/state/public`, `/state/:id/publish`)
  - `vitral/src/auth/` (session context, provider, route guard), `vitral/src/pages/LoginPage.tsx`
  - `vitral/src/api/authApi.ts`, `vitral/src/api/localProjectStore.ts` (guest storage)

- The connection rule (contract 24) and the creation targets that serve it (contract 15):
  - `vitral/src/pages/projectEditor/graphInvariants.ts` (who must stay connected, and which deletions are refused)
  - `vitral/src/pages/projectEditor/canvasGeometry.ts` (`getActivityDropTargets`, `getCardSpawnTargets`)
  - `vitral/src/utils/relationships.ts` (the relation table, its per-label partner view, and the spawn choice)
  - `vitral/src/pages/projectEditor/ActivityDropRings.tsx`, `CardSpawnBoxes.tsx`, `useHoveredCanvasTarget.ts`
  - `vitral/src/pages/projectEditor/CanvasNotice.tsx` (the only place a refusal is explained)

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
