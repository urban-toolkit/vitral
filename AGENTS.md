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

## Known Pitfalls (Observed)

1. Soft-delete vs active checks
- Many operations preserve rows with `deletedAt` for playback.
- Any "already exists" or filtering logic must explicitly exclude deleted entities when checking active state.

2. Timestamp source mismatch
- Using raw `new Date().toISOString()` can conflict with playback semantics.
- Prefer shared action timestamp resolution logic used in `ProjectEditorPage.tsx`.

3. Clear-next partial scope
- If clear-next only trims knowledge entities, future blueprint edits can still force `isHistoricalPlayback`.
- Ensure clear-next trims future edits on the broader canvas graph when intended.

4. Performance sensitivity
- Avoid expensive per-render full-string hashing / deep stringify when possible.
- Avoid `Date.now()` in memo paths that should remain stable across renders in "live" mode.

## Operational Notes

1. Production upload failures
- A prior production issue showed `413 Request Entity Too Large`.
- Local app/backend limits were higher; likely external ingress/proxy cap in production.
- If this reappears, check upstream reverse proxy / ingress body-size settings.

2. Existing projects compatibility
- Fixes were designed to work with existing projects (especially soft-deleted edges), assuming timestamps are parseable ISO strings.

## Quick Regression Checklist

1. Open project with no explicit playback:
- Needle lands on latest knowledge edit.

2. Clear next edits at playhead:
- Future knowledge + blueprint edits are trimmed.
- Editing is immediately possible at current needle position.

3. Delete and reconnect blueprint component edge:
- Reconnect succeeds even if prior edge exists as soft-deleted history.

4. Delete blueprint components inside parent groups:
- Parent boxes shrink in width and height to fit remaining active content.

5. Attach file at historical/current playback:
- Attachment event and visibility align with timeline position.
