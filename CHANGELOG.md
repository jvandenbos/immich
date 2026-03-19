# Immich Stability Patches

Patches applied on top of Immich v2.5.6 (upstream `main` at time of fork).

**Image**: `ghcr.io/jvandenbos/immich-server:v2.5.6-patched`

These fixes address crashes and data-loss scenarios encountered during real-world use with a large photo library (~300k files exported from Apple Photos).

---

## Fixes

### 1. Corrupt EXIF dates crash PostgreSQL (server crash loop)

**File**: `server/src/services/metadata.service.ts`

**Problem**: Photos/videos with corrupt EXIF metadata containing dates with years far in the future (e.g., year 35567 or 207490) cause the server to crash. JavaScript's `Date.toISOString()` serializes these as `+035567-02-12T03:27:24.000Z`, which PostgreSQL rejects with `"time zone displacement out of range"`. The microservices worker crashes and restarts in a loop, retrying the same bad asset indefinitely.

**Fix**: Validate that EXIF date years are within PostgreSQL's supported range (1–9999) before inserting into the database. Out-of-range dates are logged as warnings and the server falls back to file creation/modification dates instead of crashing.

---

### 2. Core plugin manifest failure crashes server on boot

**File**: `server/src/services/plugin.service.ts`

**Problem**: If the core plugin's `manifest.json` is missing, malformed, or fails validation, the error propagates uncaught through `onBootstrap()` → `AppBootstrap` → `onModuleInit()`, causing the entire NestJS application to refuse to start. External plugins correctly have try/catch error handling, but the core plugin path does not.

**Fix**: Wrapped core plugin manifest loading in try/catch so the server can start in degraded mode rather than crashing entirely.

---

### 3. Unsafe non-null assertions in WASM plugin host functions

**File**: `server/src/services/plugin-host.functions.ts`

**Problem**: The `handleUpdateAsset` and `handleAddAssetToAlbum` host functions use `cp.read(offs)!.text()` with a non-null assertion. If a buggy WASM plugin passes an invalid offset, this throws `TypeError: Cannot read properties of null`, crashing the workflow worker.

**Fix**: Added null checks before accessing the read result, with error logging instead of crashing.

---

### 4. Malformed plugin filter output crashes workflow execution

**File**: `server/src/services/plugin.service.ts`

**Problem**: `JSON.parse(filterResult.text())` in `executeFilters` is not wrapped in try/catch. If a third-party WASM plugin returns non-JSON output, the `SyntaxError` propagates and kills the entire workflow with a misleading error message.

**Fix**: Wrapped `JSON.parse` in try/catch with a clear error message identifying the problematic filter.

---

### 5. Empty import paths marks all library assets as deleted (data loss)

**File**: `server/src/services/library.service.ts`

**Problem**: When a library has no import paths configured (`importPaths = []`), the `detectOfflineExternalAssets` query produces `NOT (1 = 0)` which evaluates to `true` for every asset, marking the entire library as offline/deleted. This is a valid library state (the schema allows empty import paths), but the sync job has no guard for it.

**Fix**: Skip the offline asset detection when `importPaths` is empty, returning `JobStatus.Skipped` instead of incorrectly marking all assets as deleted.

---

## Upstream Status

These fixes have not yet been submitted as PRs to [immich-app/immich](https://github.com/immich-app/immich). They are independent, minimal patches that can be reviewed and submitted individually.

## Usage

Replace the server image in your `docker-compose.yml`:

```yaml
# Before
image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}

# After
image: ghcr.io/jvandenbos/immich-server:v2.5.6-patched
```

Then `docker compose pull && docker compose up -d`.
