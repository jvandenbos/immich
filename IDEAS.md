# Immich Stability Improvements

Honest assessment of what's fragile, ranked by impact. Each item: what's broken, why it matters, what we'd do, what happens if we don't.

---

## TIER 1: "Your server will crash in production"

### 1. ML service calls hang forever — no timeouts or circuit breakers

- **Where**: `server/src/services/person.service.ts:319` — `detectFaces()` has no timeout
- **Problem**: If the ML server (chronos, remote GPU box, whatever) hangs, the entire job worker thread blocks indefinitely. Not "slow" — blocked. Forever.
- **Fix**: Add configurable timeout (default 30s), implement circuit breaker pattern. After N consecutive failures, stop sending requests for a cooldown period.
- **Risk of inaction**: One ML hiccup freezes all face detection, CLIP, and OCR processing. The job queue backs up silently. Users see "processing..." for days and file a bug report.

### 2. Single bad asset poisons the job queue

- **Where**: `server/src/services/job.service.ts:49-63` — Failed jobs sit in BullMQ's failed queue
- **Problem**: No retry with backoff, no dead-letter queue, no alerting. A corrupt video that crashes ffmpeg gets retried infinitely on restart. Each restart picks up the same poison pill.
- **Fix**: Exponential backoff (3 retries), then move to dead-letter queue with admin notification. Add an admin UI page for dead-letter inspection.
- **Risk of inaction**: Queue fills with failed jobs, new uploads starved for workers. One bad file uploaded in January is still failing in March.

### 3. Silent timeline failures — months disappear without error

- **Where**: `web/src/lib/stores/load-support.svelte.ts:28-29` — API failures return silently, month shows empty
- **Problem**: No retry, no error indicator, no "click to reload." If the server hiccups while loading August 2024, that month just... vanishes from the timeline. No indication anything went wrong.
- **Fix**: Show error state per month bucket, retry button, exponential backoff on transient failures.
- **Risk of inaction**: Users think photos are missing when it's just a transient API error. They panic. They restore from backup. They file duplicate bug reports.

### 4. WebSocket disconnect = stale UI with no warning

- **Where**: `web/src/lib/stores/websocket.ts:69` — Disconnect just sets a flag, `connect_error` only console.logs
- **Problem**: No reconnection indicator, no "updates paused" banner, no fallback polling. User deletes/favorites/shares thinking changes are syncing, but the WebSocket has been dead for 20 minutes.
- **Fix**: Visible connection status indicator, auto-reconnect with backoff, fallback polling after 30s of disconnect.
- **Risk of inaction**: Data inconsistency between what user sees and server state. User thinks they moved photos to an album — they didn't. User thinks they deleted something — it's still there.

---

## TIER 2: "Your data is at risk"

### 5. Empty import paths marks ALL library assets as deleted

- **Where**: `server/src/services/library.service.ts` — Kysely `eb.or([])` evaluates to `1=0`, `NOT (1=0)` = true for all rows
- **Problem**: Already fixed in our patch, but the pattern is the real issue. Any empty-array-to-SQL-predicate elsewhere is the same ticking bomb. The ORM doesn't protect you here.
- **Fix**: Already patched. But audit all uses of `eb.or()` and `eb.and()` with dynamic arrays. Add a lint rule or wrapper that throws on empty arrays.
- **Risk of inaction**: Next developer hits the same pattern in a different service. 50,000 assets marked for deletion because someone passed `[]`.

### 6. Upload creates asset + links + quota in 3 separate writes, no transaction

- **Where**: `server/src/services/asset-media.service.ts:130-164` — Create asset, link to shared album, update quota sequentially
- **Problem**: If step 2 fails: orphaned asset with no album link. If step 3 fails: quota count diverges from reality. These are separate database calls with no transaction wrapping them.
- **Fix**: Wrap the entire upload flow in a database transaction. If any step fails, everything rolls back.
- **Risk of inaction**: Over time, quota counts drift. Users hit their quota with fewer files than expected (or don't hit it when they should). Orphaned assets accumulate, invisible to the user but consuming disk.

### 7. Optimistic deletes without rollback

- **Where**: `web/src/lib/components/asset-viewer/actions/delete-action.svelte:40-42` — `preAction` removes from timeline BEFORE API call
- **Problem**: The asset vanishes from the UI instantly (optimistic update), then the API call fires. If the API fails, the asset is gone from the UI but still on the server. No rollback logic.
- **Fix**: Either pessimistic update (remove after API success) or implement proper rollback — re-insert the asset on error.
- **Risk of inaction**: Users think they deleted something, it's still there (confusing). Or worse — they see it's "gone," assume it's safe elsewhere, and delete the original source file.

### 8. Promise.all in bulk operations — one failure kills everything

- **Where**: `server/src/services/database-backup.service.ts:290`, `server/src/services/person.service.ts:257`
- **Problem**: If ANY single file stat or unlink fails, the entire `Promise.all` rejects. 99 successful operations thrown away because file #47 was deleted between list and stat.
- **Fix**: Use `Promise.allSettled()`, handle partial failures, report which items failed vs succeeded.
- **Risk of inaction**: Backup listing fails because one file was deleted mid-operation. Face merge fails because one person was deleted concurrently. Entire operations fail for one bad item.

---

## TIER 3: "Performance degrades silently at scale"

### 9. No validation of ML response array bounds

- **Where**: `server/src/services/ocr.service.ts:66-87` — Iterates `text.length` but indexes into `box` array at `i*8` without bounds check
- **Problem**: If the ML model returns mismatched array lengths (text has 5 items, box has 3), it writes `undefined` values to the database. No error, no warning, just corrupt data.
- **Fix**: Validate array lengths match before processing. Skip or log malformed results.
- **Risk of inaction**: Corrupt OCR bounding box data in the database. Search results point to wrong regions. Queries crash on undefined coordinates.

### 10. Exiftool process pool not bounded on startup

- **Where**: `server/src/repositories/metadata.repository.ts:80-127` — `setMaxConcurrency()` only called after config changes
- **Problem**: With 200k assets queued for metadata extraction, there's no initial concurrency limit at construction time. Could spawn excessive exiftool processes before the config system loads.
- **Fix**: Set a sensible initial concurrency limit in the constructor, then allow config to adjust.
- **Risk of inaction**: Process exhaustion during large initial imports. NAS becomes unresponsive. OOM killer starts picking victims.

### 11. Race condition in concurrent face detection

- **Where**: `server/src/services/person.service.ts:343+` — Read asset, detect faces, write faces — no locking
- **Problem**: Two concurrent jobs processing the same asset can both read "0 faces," both detect faces, and both write their results. Last write wins, first write's faces are lost.
- **Fix**: Use database-level advisory locks per asset, or optimistic concurrency control (version column).
- **Risk of inaction**: Lost face detections, inconsistent person assignments. "Why does it keep forgetting this face?" — because another job overwrote it.

### 12. Auto-detect and regenerate missing thumbnails on startup

- **Where**: Currently no startup health check for thumbnail integrity
- **Problem**: If thumbnails are deleted (disk issue, manual cleanup, migration gone wrong) but DB records still exist, every affected asset shows "Error loading image" forever. No self-healing.
- **Fix**: Startup health check that compares `asset_files` records against disk, queues `GenerateThumbnails` for assets with missing files.
- **Risk of inaction**: After any disk issue or cleanup, manual admin intervention required. Users see broken images and don't know why or how to fix it.

---

## TIER 4: "Nice to have, but not urgent"

### 13. Database backup/restore lacks validation

- **Where**: Restore has rollback logic, but if the rollback itself fails, the database is in a partial state
- **Problem**: No checksum verification of backup files before restore begins. You find out the backup is corrupt halfway through, after dropping tables.
- **Fix**: Verify backup integrity (pg_restore --list) before starting, add post-restore validation query to confirm data consistency.

### 14. File watcher queues duplicate jobs on rapid file changes

- **Where**: `server/src/services/library.service.ts:101-119` — No deduplication of queued jobs for same file
- **Problem**: Editor saves trigger multiple file change events. Each one queues a separate job. Same file processed 3-4 times in a row.
- **Fix**: Use BullMQ's `jobId` parameter keyed by file path to deduplicate. Only the last event for a given path gets processed.

### 15. Thumbnail component has no retry mechanism

- **Where**: `web/src/lib/components/assets/thumbnail/image-thumbnail.svelte:44-55` — Shows BrokenAsset on failure, stuck forever
- **Problem**: Transient network error → broken thumbnail icon → stays broken until full page reload. No way to retry.
- **Fix**: Add "click to retry" on broken thumbnails, or auto-retry once with backoff before showing the broken state.

---

## How to use this document

This isn't a roadmap — it's a risk register. Pick items based on what's actually biting you:

- **Running Immich on a NAS with limited RAM?** Prioritize #2 (queue poisoning) and #10 (process exhaustion).
- **Using remote ML server?** Prioritize #1 (ML timeouts) immediately.
- **Large library (100k+ assets)?** Prioritize #11 (race conditions) and #12 (thumbnail health).
- **Multiple users sharing albums?** Prioritize #6 (transactions) and #7 (optimistic deletes).

PRs for Tier 1 items should be submitted first. Each one is a standalone fix that doesn't depend on the others.
