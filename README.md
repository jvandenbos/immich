# Immich — Stability Patches

> **This is an unofficial patched fork of [Immich](https://github.com/immich-app/immich).** It is not maintained, supported, or endorsed by the Immich project. For installation, configuration, documentation, and support, go to the official repo.

**Image**: `ghcr.io/jvandenbos/immich-server:v2.5.6-patched`

## What is this?

A minimal set of crash and data-loss fixes applied on top of Immich v2.5.6. These were discovered while importing a large Apple Photos library (~300k files) with corrupt EXIF metadata and edge-case configurations.

The official Immich server would crash-loop or silently lose data in these scenarios. These patches make it handle them gracefully instead.

## What's fixed?

1. **Corrupt EXIF dates crash the server** — Photos with impossible dates (year 35567, 207490, etc.) cause PostgreSQL to reject the insert with "time zone displacement out of range". The server crashes and restarts in a loop, retrying the same bad file forever. **Fix**: validate date years (1–9999) before insert, fall back to file dates.

2. **Core plugin failure crashes server on boot** — If the WASM plugin manifest is missing or corrupt, the server refuses to start entirely. External plugins have error handling, but the core plugin path does not. **Fix**: wrap in try/catch, allow degraded startup.

3. **Buggy WASM plugins crash the worker** — Unsafe non-null assertions in plugin host functions mean a single bad plugin offset crashes the entire workflow worker. **Fix**: null checks with error logging.

4. **Bad plugin filter output kills workflows** — `JSON.parse` on WASM filter results isn't wrapped in try/catch. Non-JSON output from a third-party plugin crashes the workflow silently. **Fix**: catch and log.

5. **Empty import paths deletes all library assets** — A library with no import paths configured causes the offline detection query to match *every* asset, marking the entire library as deleted. **Fix**: skip offline detection when import paths are empty.

## Usage

Replace the server image in your `docker-compose.yml`:

```yaml
# Before
image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}

# After
image: ghcr.io/jvandenbos/immich-server:v2.5.6-patched
```

Then: `docker compose pull && docker compose up -d`

All other containers (postgres, redis, ML) remain unchanged.

## Source & Diff

- [Full diff against upstream](https://github.com/jvandenbos/immich/compare/main...janv/fix-stability-crashes) — 74 lines changed across 6 files
- [Detailed changelog](./CHANGELOG.md)

## Status

**Unmaintained.** This fork exists to fix specific bugs encountered in production. It will not track upstream releases. If these fixes are merged upstream, this fork becomes unnecessary.

If you're looking for the real Immich project: **https://github.com/immich-app/immich**
