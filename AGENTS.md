# Time Tracker — Agent Guidelines

## Overview

Offline-first PWA for time tracking: live timer, manual entries, travel vs. on-site split, mileage, billing reports (printable), CSV import/export, light/dark theme, email/password auth, and optional cloud backup/sync to Cloudflare D1 + KV.

No client frameworks or dependencies — vanilla JS, HTML, CSS. The Worker uses native Web Crypto (PBKDF2, HMAC-SHA256).

## Architecture

| File | Purpose |
|------|---------|
| `public/index.html` | Page structure and modal markup only |
| `public/app.js` | All application logic (IndexedDB, timer, modals, CSV, reports, auth, sync) |
| `public/styles.css` | All styling (`:root`/`.dark` variables, responsive, print styles) |
| `public/sw.js` | Service worker (offline asset caching) |
| `public/manifest.json` | Web app manifest (`manifest.webapp` is a legacy iOS-era copy, not linked from `index.html`) |
| `public/icons/` | Icon assets (PNG, SVG, maskable, Apple touch) |
| `worker.js` | Cloudflare Worker API: auth + offline-first sync |
| `wrangler.toml` | KV/D1 bindings, dev server, `[assets]` → `public/` |
| `migrations/001–007*.sql` | D1 schema history |
| `test/` | Vitest Worker API tests (`@cloudflare/vitest-pool-workers`) |

## Data Model

IndexedDB `TimeTrackerDB` (version 4) has two stores:
- `logs` — `keyPath: id` (autoincrement), with a **unique `byClientId` index** (`logs.clientId`)
- `timerState` — `keyPath: id`, single record `id: "current"`, persisted on every timer change

Each log row:
```js
{
  id,                    // local IndexedDB key — NOT a cross-device identity
  clientId,              // per-log UUID (v4) — the stable cross-device sync identity, immutable
  client,                // client name
  startMs, endMs, arrivalMs,           // epoch ms, source of truth; arrivalMs null if none
  startOffset, arrivalOffset, endOffset, // minutes east of UTC at capture; null when uncaptured
  durationMs, travelDurationMs, onSiteDurationMs,
  notes, parts, billableTime,          // billableTime: "1" (actual), decimal hours, or "sales call"
  startMileage, arrivalMileage, travelMileage,
  isRemote,              // true = remote session (no travel)
  invoiceNumber,         // "" if unset
  updatedAt,             // epoch ms of last local mutation (push trigger)
  lastSyncedUpdatedAt    // epoch ms last confirmed by server; null = never confirmed
}
```

**Time model:** `startMs`/`arrivalMs`/`endMs` are the single source of truth for all arithmetic, filtering, sorting, and sync. Human-readable forms are rendered on demand. The `*Offset` fields (minutes east of UTC) preserve the authored wall-clock so an entry renders identically on any device/timezone — rendering shifts the instant by its offset and formats in UTC, falling back to the browser offset when none was stored. No locale display strings are stored.

The local `id` is only for in-app operations (render/edit/delete/resume). The server keeps its own autoincrement `id`; pulled rows are matched by `clientId` and stored under a fresh local `id`, so ids never collide across devices.

## Key Functions (app.js)

- Time/format: `formatDuration(ms)`, `formatDecimalQuarter(ms)`, `toDecimalHours(ms)`, `formatBillableTime(travelMs, onSiteMs, durationMs)`
- Offset/wall-clock: `offsetMinutesOf(d)`, `wallClockMs(ms, offset)`, `toWallClockDate(ms, offset)`, `formatLogTime`/`formatLogDateTime`/`formatLogDate`/`formatWallClockDateTimeLocal`, `toIsoWithOffset`/`parseOffsetMinutesFromIso`/`deriveOffsetMinutes`
- Epoch accessors: `logStartMs`, `logEndMs`, `logArrivalMs`, `logDurationMs`
- Persistence/sync triggers: `generateUuid()`, `markLogDirty(log)` (bumps `updatedAt`, clears `lastSyncedUpdatedAt`)
- Timer: `saveTimerState`/`restoreTimerState`/`clearTimerState`, `startTimer(type)`, `updateTimerButtons`, `updateLiveDisplay`, `resumeTimer`/`mergeResumeIntoLog`
- Render/report: `renderLogs`, `buildReportTable`, `generateReportForDateRange`, `buildPrintArea`, `exportToCSV`, `parseCsvLines`/`parseCsvRow`, `parseDurationToMs`, `escapeHtml`
- Invoicing: `enterInvoicingMode`/`exitInvoicingMode`, `renderInvoicingMode`, `saveInvoicingCell`, `getBillableDisplay`
- Sync/auth: `isAuthenticated`, `getAuthHeaders`, `getLastSyncTime`/`setLastSyncTime`, `syncToCloud`, `syncFromCloud`, `performSync`, `syncAfterWrite`, `checkConnectivity`/`updateSyncStatus`, `showAuthModal`/`hideAuthModal`
- Theme/SW: dark-mode toggle block (`btnDarkMode`, persists `localStorage.theme`), `showUpdateAvailablePrompt`

## Flows

**Timer:** Start → (optional start-mileage modal) → optional Mark Arrival (optional arrival-mileage modal) → End Timer → Job Complete (notes + billable) → Parts Used → saved by `finalizeAndSaveLog`. The "Remote Work" checkbox hides Mark Arrival and skips mileage. `restoreTimerState` re-prompts for mileage only when "Request Mileage" is currently enabled.

**Manual entry / Edit:** validation before any IndexedDB write — Client/Start/End required, all provided datetimes parse, End after Start, Arrival (if given) between Start and End.

## CSV Import/Export

- Export: UTF-8 BOM; 21 columns: `ID, Client, Start Time, Arrival Time, End Time, Total Duration, Travel Duration, On-Site Duration, Decimal Hours, Billable Time, Start Mileage, Arrival Mileage, Travel Miles, Remote, Notes, Parts Used, Start ISO, End ISO, Arrival ISO, Invoice Number, Updated At`
- Human-readable columns are rendered on export (not stored). The trailing ISO columns are offset-bearing (`2026-09-15T09:00:00.000-04:00`) so both the instant and wall-clock round-trip; import uses them for `*Ms`/`*Offset`.
- Import accepts 19 (no invoice), 20 (invoice), or 21 (invoice + updatedAt) columns. `invoiceNumber` defaults to `""` when absent. Durations are parsed from `HH:MM:SS`.

## Reports & Printing

`generateReportForDateRange` filters by `startMs`/`endMs` and builds the on-screen report. `buildPrintArea` copies it into the off-screen `#printArea`, split into per-page `<table>` chunks (`ROWS_PER_PAGE_ONSITE=12`, `ROWS_PER_PAGE_REMOTE=16`) so iOS Safari paginates correctly. `#printArea` is hidden on screen and shown only in `@media print`.

## Cloud Sync (offline-first)

`localStorage`: `authToken`, `userId`, `userEmail`, `lastSyncTime`, `theme`, `invoicingMode`, `requestMileage`.

- `syncToCloud()` — pushes local rows whose `updatedAt > lastSyncedUpdatedAt` (plus `_deleted` tombstones) to `POST /api/sync`; records the server's confirmed `updatedAt` as `lastSyncedUpdatedAt`, guarded against concurrent local edits.
- `syncFromCloud()` — GETs `/api/sync?since=<lastSyncTime>`; upserts by `clientId` (never the server `id`), applies tombstones, and seals the cursor past `max(serverTime, newest received row)`.
- `performSync()` — push then pull (push-first avoids racing the debounced `syncAfterWrite`); guarded by a `syncInFlight` lock. Called on load when authenticated.
- `syncAfterWrite()` — debounced 1s background push after any local write.

Rows are upserted server-side by `(user_id, client_id)`. Soft-deletes tombstone `deleted_at`. Pull returns rows with `updated_at > since` (strict) plus tombstones.

## Worker API

Routes: `POST /api/auth/register|login|logout`, `PUT /api/auth/password`, `POST /api/sync`, `GET /api/sync?since=`.

Bindings (wrangler.toml): `DB` (D1), `TIME_TRACKER_KV` (token blocklist `bl_<token>`, sync marker `sync_<userId>`), `JWT_SECRET`, `FALLBACK_ALLOWED_USERS`, `ALLOWED_ORIGIN`, `ASSETS`.

- Tokens: HMAC-SHA256 `base64(payload).base64(sig)`, payload `{ userId, email, exp }`, 30-day expiry. Logout adds the token to the KV blocklist.
- Passwords: PBKDF2 (100k iterations, SHA-256, 16-byte salt).
- Allowlist: `isUserAllowed()` reads KV `allowed_users`, falling back to `FALLBACK_ALLOWED_USERS`.
- `sanitizeClientTimestamp()` clamps client `updated_at` values >5 min ahead of the server clock so future timestamps can't poison the pull cursor.
- CORS is applied at the fetch handler from `ALLOWED_ORIGIN` (echoes request origin in dev, `*` when absent).

## PWA / Offline / Theme

- `sw.js` precaches app assets (cache-first static, network-first-with-cache-fallback navigation) and `skipWaiting()`/`clients.claim()`. **Bump `CACHE_NAME` whenever cached assets change.**
- Root-relative precache paths assume root deployment; use relative paths if deploying under a subpath.
- Theme preference in `localStorage.theme`; an inline `<head>` script applies `.dark` before first paint to avoid a flash.

## Conventions

- All modals use `.modal-overlay.hidden`; every `<label class="label-title">` has a matching `for=`; radio groups use `.billable-options` with `role="radiogroup"`.
- Always attach both a success/complete handler and an `onerror` that surfaces an `alert()` on IndexedDB transactions; disable the relevant Save button during async writes.
- Validate user input before opening a transaction.
- Use epoch-ms fields for all comparison/arithmetic; use `toLocale*` only for display.
- **Never add comments unless asked.**

## Common Tasks

**Add a manual-entry field:** add input + `<label for>` in `#addEntryModal`, add the `const` ref in `app.js`, read/validate it in the `btnSaveAdd` handler, include it in the new-log object, then update `exportToCSV` and CSV import.

**Change the data model:** update `finalizeAndSaveLog`, the `btnSaveAdd` and `btnSaveEdit` handlers, `renderLogs`, CSV export/import, and `generateReportForDateRange` as applicable.

## Testing & Verification

```bash
npm run types      # generate worker-configuration.d.ts (required for typecheck; gitignored)
npm test           # Vitest Worker API suite (runs in workerd)
npm run test:watch
npm run typecheck  # tsc --noEmit (checkJs)
```

Tests use the `SELF` fetcher with isolated D1/KV per file. `test/helpers.ts` defines the test schema — the repo migrations are not all replayable on a fresh DB (`002_add_is_remote.sql` is a documentation-only no-op), so tests keep their own schema. `.dev.vars` must define `JWT_SECRET` and `FALLBACK_ALLOWED_USERS`.

## Deployment

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put ALLOWED_ORIGIN
npx wrangler d1 execute time-tracker --remote --file migrations/001_initial.sql   # once
npm run deploy     # static assets auto-uploaded via [assets]
```

Local dev: `npm install`, `npm run dev`, apply schema with `npx wrangler d1 execute time-tracker --local --file migrations/001_initial.sql`, and create `.dev.vars`.
