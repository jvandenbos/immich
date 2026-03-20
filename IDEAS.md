# Immich Stability Improvements & Ideas

Honest assessment of what's fragile, ranked by impact. Each item: what's broken, why it matters, what we'd do, what happens if we don't.

Effort key: S = few hours, M = 1 day, L = 2+ days.

---

## TIER 1: "Your server will crash in production"

### 1. ML service calls hang forever — no timeouts or circuit breakers `[L]`

- **Where**: `server/src/services/person.service.ts:319` — `detectFaces()` has no timeout
- **Problem**: If the ML server (chronos, remote GPU box, whatever) hangs, the entire job worker thread blocks indefinitely. Not "slow" — blocked. Forever.
- **Fix**: Add configurable timeout (default 30s), implement circuit breaker pattern. After N consecutive failures, stop sending requests for a cooldown period.
- **Risk of inaction**: One ML hiccup freezes all face detection, CLIP, and OCR processing. The job queue backs up silently. Users see "processing..." for days and file a bug report.

### 2. Single bad asset poisons the job queue `[M]`

- **Where**: `server/src/services/job.service.ts:49-63` — Failed jobs sit in BullMQ's failed queue
- **Problem**: No retry with backoff, no dead-letter queue, no alerting. A corrupt video that crashes ffmpeg gets retried infinitely on restart. Each restart picks up the same poison pill.
- **Fix**: Exponential backoff (3 retries), then move to dead-letter queue with admin notification. Add an admin UI page for dead-letter inspection.
- **Risk of inaction**: Queue fills with failed jobs, new uploads starved for workers. One bad file uploaded in January is still failing in March.

### 3. Silent timeline failures — months disappear without error `[M]`

- **Where**: `web/src/lib/stores/load-support.svelte.ts:28-29` — API failures return silently, month shows empty
- **Problem**: No retry, no error indicator, no "click to reload." If the server hiccups while loading August 2024, that month just... vanishes from the timeline. No indication anything went wrong.
- **Fix**: Show error state per month bucket, retry button, exponential backoff on transient failures.
- **Risk of inaction**: Users think photos are missing when it's just a transient API error. They panic. They restore from backup. They file duplicate bug reports.

### 4. WebSocket disconnect = stale UI with no warning `[M]`

- **Where**: `web/src/lib/stores/websocket.ts:69` — Disconnect just sets a flag, `connect_error` only console.logs
- **Problem**: No reconnection indicator, no "updates paused" banner, no fallback polling. User deletes/favorites/shares thinking changes are syncing, but the WebSocket has been dead for 20 minutes.
- **Fix**: Visible connection status indicator, auto-reconnect with backoff, fallback polling after 30s of disconnect.
- **Risk of inaction**: Data inconsistency between what user sees and server state. User thinks they moved photos to an album — they didn't. User thinks they deleted something — it's still there.

---

## TIER 2: "Your data is at risk"

### 5. Empty import paths marks ALL library assets as deleted `[S]`

- **Where**: `server/src/services/library.service.ts` — Kysely `eb.or([])` evaluates to `1=0`, `NOT (1=0)` = true for all rows
- **Problem**: Already fixed in our patch, but the pattern is the real issue. Any empty-array-to-SQL-predicate elsewhere is the same ticking bomb. The ORM doesn't protect you here.
- **Fix**: Already patched. But audit all uses of `eb.or()` and `eb.and()` with dynamic arrays. Add a lint rule or wrapper that throws on empty arrays.
- **Risk of inaction**: Next developer hits the same pattern in a different service. 50,000 assets marked for deletion because someone passed `[]`.

### 6. Upload creates asset + links + quota in 3 separate writes, no transaction `[S]`

- **Where**: `server/src/services/asset-media.service.ts:130-164` — Create asset, link to shared album, update quota sequentially
- **Problem**: If step 2 fails: orphaned asset with no album link. If step 3 fails: quota count diverges from reality. These are separate database calls with no transaction wrapping them.
- **Fix**: Wrap the entire upload flow in a database transaction. If any step fails, everything rolls back.
- **Risk of inaction**: Over time, quota counts drift. Users hit their quota with fewer files than expected (or don't hit it when they should). Orphaned assets accumulate, invisible to the user but consuming disk.

### 7. Optimistic deletes without rollback `[S]`

- **Where**: `web/src/lib/components/asset-viewer/actions/delete-action.svelte:40-42` — `preAction` removes from timeline BEFORE API call
- **Problem**: The asset vanishes from the UI instantly (optimistic update), then the API call fires. If the API fails, the asset is gone from the UI but still on the server. No rollback logic.
- **Fix**: Either pessimistic update (remove after API success) or implement proper rollback — re-insert the asset on error.
- **Risk of inaction**: Users think they deleted something, it's still there (confusing). Or worse — they see it's "gone," assume it's safe elsewhere, and delete the original source file.

### 8. Promise.all in bulk operations — one failure kills everything `[S]`

- **Where**: `server/src/services/database-backup.service.ts:290`, `server/src/services/person.service.ts:257`
- **Problem**: If ANY single file stat or unlink fails, the entire `Promise.all` rejects. 99 successful operations thrown away because file #47 was deleted between list and stat.
- **Fix**: Use `Promise.allSettled()`, handle partial failures, report which items failed vs succeeded.
- **Risk of inaction**: Backup listing fails because one file was deleted mid-operation. Face merge fails because one person was deleted concurrently. Entire operations fail for one bad item.

---

## TIER 3: "Performance degrades silently at scale"

### 9. No validation of ML response array bounds `[S]`

- **Where**: `server/src/services/ocr.service.ts:66-87` — Iterates `text.length` but indexes into `box` array at `i*8` without bounds check
- **Problem**: If the ML model returns mismatched array lengths (text has 5 items, box has 3), it writes `undefined` values to the database. No error, no warning, just corrupt data.
- **Fix**: Validate array lengths match before processing. Skip or log malformed results.
- **Risk of inaction**: Corrupt OCR bounding box data in the database. Search results point to wrong regions. Queries crash on undefined coordinates.

### 10. Exiftool process pool not bounded on startup `[S]`

- **Where**: `server/src/repositories/metadata.repository.ts:80-127` — `setMaxConcurrency()` only called after config changes
- **Problem**: With 200k assets queued for metadata extraction, there's no initial concurrency limit at construction time. Could spawn excessive exiftool processes before the config system loads.
- **Fix**: Set a sensible initial concurrency limit in the constructor, then allow config to adjust.
- **Risk of inaction**: Process exhaustion during large initial imports. NAS becomes unresponsive. OOM killer starts picking victims.

### 11. Race condition in concurrent face detection `[M]`

- **Where**: `server/src/services/person.service.ts:343+` — Read asset, detect faces, write faces — no locking
- **Problem**: Two concurrent jobs processing the same asset can both read "0 faces," both detect faces, and both write their results. Last write wins, first write's faces are lost.
- **Fix**: Use database-level advisory locks per asset, or optimistic concurrency control (version column).
- **Risk of inaction**: Lost face detections, inconsistent person assignments. "Why does it keep forgetting this face?" — because another job overwrote it.

### 12. Auto-detect and regenerate missing thumbnails on startup `[M]`

- **Where**: Currently no startup health check for thumbnail integrity
- **Problem**: If thumbnails are deleted (disk issue, manual cleanup, migration gone wrong) but DB records still exist, every affected asset shows "Error loading image" forever. No self-healing.
- **Fix**: Startup health check that compares `asset_files` records against disk, queues `GenerateThumbnails` for assets with missing files.
- **Risk of inaction**: After any disk issue or cleanup, manual admin intervention required. Users see broken images and don't know why or how to fix it.

---

## TIER 4: "Nice to have, but not urgent"

### 13. Database backup/restore lacks validation `[S]`

- **Where**: Restore has rollback logic, but if the rollback itself fails, the database is in a partial state
- **Problem**: No checksum verification of backup files before restore begins. You find out the backup is corrupt halfway through, after dropping tables.
- **Fix**: Verify backup integrity (pg_restore --list) before starting, add post-restore validation query to confirm data consistency.

### 14. File watcher queues duplicate jobs on rapid file changes `[S]`

- **Where**: `server/src/services/library.service.ts:101-119` — No deduplication of queued jobs for same file
- **Problem**: Editor saves trigger multiple file change events. Each one queues a separate job. Same file processed 3-4 times in a row.
- **Fix**: Use BullMQ's `jobId` parameter keyed by file path to deduplicate. Only the last event for a given path gets processed.

### 15. Thumbnail component has no retry mechanism `[S]`

- **Where**: `web/src/lib/components/assets/thumbnail/image-thumbnail.svelte:44-55` — Shows BrokenAsset on failure, stuck forever
- **Problem**: Transient network error → broken thumbnail icon → stays broken until full page reload. No way to retry.
- **Fix**: Add "click to retry" on broken thumbnails, or auto-retry once with backoff before showing the broken state.

---

## FEATURE: External editing — the elephant in the room

### 16. Immich has no real photo editor and no way to hand off to one `[XL]`

- **Problem**: Immich's built-in editor is crop/rotate only. No exposure, curves, local adjustments, HSL, noise reduction — nothing a photographer actually needs. And there's no way to open a photo in Lightroom/Darktable/GIMP from the web UI either.
- **Why this is hard**: Every product that solved "open in desktop editor" ships a desktop companion. There is no web standard that lets a browser launch a native app with a file path. We researched this thoroughly:

#### What other products do

| Product | Solution |
|---------|----------|
| Google Photos | No external editor integration at all. Download manually. |
| iCloud Photos | Native macOS/iOS app has the originals. Windows: iCloud for Windows syncs to a local folder. |
| Synology Photos | Synology Drive Client syncs `/photo` locally. Edit there, changes sync back. |
| Nextcloud | Desktop client registers `nc://` protocol. Web UI fires `nc://open/<path>`, client opens the file in the OS default app. |

#### What web standards offer (not much)

- **File System Access API** — Chromium-only. No Firefox, no Safari, no mobile.
- **File Handling API** — Only routes files INTO your PWA, can't launch Lightroom.
- **`registerProtocolHandler`** — Only `web+something` schemes pointing to web URLs, not native apps.

#### The real options

1. **Build an Immich Desktop companion** (Tauri — small, cross-platform, Rust) that authenticates with Immich, caches originals on demand, registers `immich://` protocol handler. Web UI's "Open in editor" fires `immich://open/asset/{id}`, desktop app opens the file with the OS default app for that type. This is the Nextcloud model and the only proven consumer-grade approach. **Effort: XL** — this is a separate project.

2. **Expose the library via WebDAV** (server-side only, no client install). User mounts it in Finder/Explorer, browses files, right-click → Open with Lightroom. Power-user mode — works but requires OS-level mount setup. **Effort: L.**

3. **Build a real in-browser editor** using something like [filerobot-image-editor](https://github.com/scaleflex/filerobot-image-editor) or a custom solution. Exposure, curves, HSL, local adjustments — all in the browser. Non-destructive edits stored as a sidecar. This sidesteps the "launch desktop app" problem entirely by making the web UI good enough. **Effort: XL** — but it's the only approach that works without any install for 100% of users.

#### Recommendation

Option 3 (in-browser editor) is the only path that's truly consumer-grade with zero install. Option 1 (desktop companion) is the right long-term play for power users. Option 2 (WebDAV) is a quick win for NAS users who already know how to mount network drives.

None of these are small. Parking this as a strategic gap, not a quick fix.

---

## Effort summary

| #  | Item | Tier | Effort |
|----|------|------|--------|
| 1  | ML timeouts + circuit breaker | T1 | L |
| 2  | Dead-letter queue + backoff | T1 | M |
| 3  | Timeline error states | T1 | M |
| 4  | WebSocket reconnect indicator | T1 | M |
| 5  | Audit `eb.or([])` patterns | T2 | S |
| 6  | Upload transaction wrapping | T2 | S |
| 7  | Optimistic delete rollback | T2 | S |
| 8  | `Promise.allSettled` swap | T2 | S |
| 9  | ML response validation | T3 | S |
| 10 | Exiftool initial concurrency | T3 | S |
| 11 | Face detection advisory locks | T3 | M |
| 12 | Thumbnail health check | T3 | M |
| 13 | Backup validation | T4 | S |
| 14 | File watcher dedup | T4 | S |
| 15 | Thumbnail retry | T4 | S |
| 16 | External editing (desktop companion or in-browser editor) | Feature | XL |

**Total**: ~10-12 days focused work for everything. Tier 2 items 5-8 are the sweet spot — all `[S]`, all eliminate real data risks.

---

## How to use this document

This isn't a roadmap — it's a risk register. Pick items based on what's actually biting you:

- **Running Immich on a NAS with limited RAM?** Prioritize #2 (queue poisoning) and #10 (process exhaustion).
- **Using remote ML server?** Prioritize #1 (ML timeouts) immediately.
- **Large library (100k+ assets)?** Prioritize #11 (race conditions) and #12 (thumbnail health).
- **Multiple users sharing albums?** Prioritize #6 (transactions) and #7 (optimistic deletes).
- **Photographer who needs real editing?** #16 is the strategic gap — no quick fix exists today.

PRs for Tier 1 items should be submitted first. Each one is a standalone fix that doesn't depend on the others.
