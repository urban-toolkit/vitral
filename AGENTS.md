# AGENTS.md

## Purpose
This file captures important project context from prior debugging/fix sessions so future agents can avoid regressions, especially around timeline playback, knowledge-track editing, blueprint edges, and asset behavior.

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

## Regression Watch-outs

- Keep timeline default logic mirrored between `Timeline.tsx` and `useTimelineChart.ts`; drift between them can cause mismatched needle behavior.
- If you simplify clear-edits logic, do not scope `"after"` to only knowledge nodes, or playback lock can remain stuck due to non-knowledge future edits.
- Do not change duplicate-edge checks to include soft-deleted edges, or reconnect-after-delete will break.
- Any change to attachment writes should preserve `editAt` history snapshots; direct mutation without history can break playback visibility.
- If export/duplicate starts failing with 502 again, check nginx proxy timeout/buffering settings before changing application logic.
- Keep export file fetch concurrency bounded; unbounded parallel S3 reads can cause memory spikes and upstream instability.
