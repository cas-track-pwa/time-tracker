# Time Tracker - Agent Guidelines

## Project Overview

A progressive web app (PWA) for time tracking that allows users to:
- Track work time with a live timer
- Log manual time entries
- Track travel time and on-site duration separately
- Record mileage for travel
- Generate billing reports (with print support)
- Export/import data to/from CSV
- Work offline (service worker) and use light/dark theme
- Authenticate via email/password (Cloudflare Workers)
- Back up and sync data across devices (Cloudflare D1 + KV)

## Architecture

### Multi-File Application
- **public/index.html**: Page structure and modal markup only
- **public/app.js**: All application logic (IndexedDB access, timer, modals, CSV, reports, dark mode, service worker registration, cloud sync/auth)
- **public/styles.css**: All styling, including `:root` / `.dark` CSS variable themes and print styles
- **public/sw.js**: Service worker for offline asset caching
- **public/manifest.json**: Web app manifest (Android/desktop install metadata)
- **public/manifest.webapp**: Legacy iOS-era manifest format, kept for compatibility but not linked from `index.html`
- **public/icons/**: All icon assets (PNG, SVG, maskable, Apple touch icons)
- **worker.js**: Cloudflare Worker (API layer) — handles authentication, CRUD for logs, and offline-first sync
- **wrangler.toml**: Wrangler configuration (KV namespaces, D1 database binding, dev server, `[assets]` config pointing to `public/`)
- **migrations/001_initial.sql**: D1 database schema (users + logs tables)
- **CLOUDFLARE_MIGRATION.md**: Migration guide for deploying to Cloudflare Workers
- **upload-assets.ps1**: PowerShell script for bulk-uploading static assets to KV (optional, manual use only)
 - Uses IndexedDB (`TimeTrackerDB`, currently version 4) as the local client-side store, with optional cloud backup/sync to Cloudflare D1 + KV
- No external dependencies or frameworks on the client side; the Worker uses native Web Crypto APIs (PBKDF2, HMAC-SHA256) for auth

### Data Model

Each log entry in the `logs` store contains:
```javascript
{
  id: number,            // Auto-incremented primary key
  client: string,        // Client name
  startMs: number,       // Start instant, epoch ms (source of truth)
  endMs: number,         // End instant, epoch ms (source of truth)
  arrivalMs: number,     // Arrival instant, epoch ms (null if no arrival)
  startOffset: number,   // Minutes east of UTC at capture (wall-clock preservation); null for legacy rows
  arrivalOffset: number, // Same, for arrival; null if no arrival
  endOffset: number,     // Same, for end
  durationMs: number,    // Duration in milliseconds (endMs - startMs)
  notes: string,         // Work notes
  parts: string,         // Parts/materials used
  billableTime: string,  // Billable time override ("1" = use actual duration, decimal hours, or "sales call")
  travelDurationMs: number,  // Travel duration in ms (start -> arrival), null if no arrival
  onSiteDurationMs: number,  // On-site duration in ms (arrival -> end), null if no arrival
  startMileage: number,  // Starting odometer reading
  arrivalMileage: number,// Arrival odometer reading
   travelMileage: number,  // Calculated travel distance (arrivalMileage - startMileage)
   isRemote: boolean,      // True if this was a remote work session (no travel)
   invoiceNumber: string,  // Optional invoice number (editable in Invoicing Mode, empty string if unset)
   clientId: string,       // Globally-unique per-log UUID (v4) — the stable cross-device sync identity. Generated once at entry creation; immutable thereafter. The server addresses rows by (user_id, client_id), NOT by the per-device autoincrement id, so two devices both starting at id=1 no longer collide.
   updatedAt: number,      // Unix epoch ms of the last local mutation (push trigger)
   lastSyncedUpdatedAt: number | null,  // Unix epoch ms the server last confirmed via push ack; null = never confirmed
}
```

**Important:** `startMs` / `arrivalMs` / `endMs` are the single source of truth for all date arithmetic, filtering, sorting, and sync. Time/date information is stored **only** as epoch ms plus a per-timestamp UTC offset (`startOffset` / `arrivalOffset` / `endOffset`, minutes east of UTC); all human-readable forms are rendered on demand (`formatLogDateTime(ms, offset)`, `formatLogTime(ms, offset)`, `formatLogDate(ms, offset)`, `toDecimalHours(ms)`, `formatDuration(durationMs)`). The offset preserves the **wall-clock the user actually saw** — an absolute instant alone cannot — so an entry renders the same time on any device/timezone; rendering shifts the instant by its offset and formats in UTC, falling back to the browser's offset when none was stored. The legacy locale display strings (`start` / `end` / `arrivalTime`) and formatted duplicates (`duration` / `decimalHours`) were removed in phase 2 and are no longer read at all (see "Time/Date Consolidation" below).

The local autoincrement `id` is only the IndexedDB key used by in-app operations (render, edit, delete, resume). It is **not** a cross-device identity. The server maintains its own independent autoincrement `id`; rows pulled from another device are stored locally under a fresh autoincrement id decoupled from the server's id. The `byClientId` unique index (`logs.clientId`) is created at IndexedDB version 4.

### Time/Date Consolidation

Epoch ms is the canonical representation; the display strings are derived. Rollout is phased so already-installed clients keep working:

- **Client:** `consolidateStoredLogDateTimes()` runs once on load (guarded by `localStorage.dateTimeConsolidationVersion`, version `DATE_TIME_CONSOLIDATION_VERSION`) over every row: it derives missing `*Ms`/`*Offset`/`durationMs` values, drops the legacy string fields, and — for rows that carried legacy fields — `markLogDirty()`s them so the new offsets are pushed. `normalizeConsolidatedTimestamps(row)` / `stripLegacyDateTimeFields(row)` are shared by this pass and by `syncFromCloud`, so pulled rows are normalized identically. `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` is `5`, forcing a one-time full pull after the upgrade.
- **Server (phase 1, additive):** D1 gained `startOffset` / `arrivalOffset` / `endOffset` and `start` / `end` were made nullable (table rebuilt in `006_add_time_offsets.sql`, since SQLite cannot drop a `NOT NULL` in place). The Worker no longer writes `start` / `end` / `arrival` / `duration` / `decimalHours` / `arrivalTime`; ordering moved from `ORDER BY start` to `ORDER BY startMs`. The legacy columns were **kept temporarily** so old clients could still round-trip them.
- **Server (phase 2, complete):** once no old client was in play, `007_drop_legacy_datetime_columns.sql` dropped `start`, `end`, `arrival`, `duration`, `decimalHours`, `arrivalTime` and `idx_logs_start`. The client no longer reads the legacy strings at all; `normalizeConsolidatedTimestamps` / `stripLegacyDateTimeFields` remain solely to upgrade a local row that was never consolidated (e.g. a device that skipped phase 1), after which the legacy keys are gone.


### Modal Components

| Modal | ID | Purpose |
|-------|-----|---------|
| Job Complete | `notesModal` | Capture notes and billable time when a live timer ends |
| Parts Used | `partsModal` | Optional parts/materials entry, shown right after Job Complete |
| Start Mileage | `startMileageModal` | Enter starting odometer reading |
| Arrival Mileage | `arrivalMileageModal` | Enter arrival odometer reading |
| Add Manual Entry | `addEntryModal` | Create manual time entries |
| Edit Log | `editModal` | Edit existing log entries |
| Clear Confirm | `clearConfirmModal` | Confirm clearing all data |
| Delete Confirm | `deleteConfirmModal` | Confirm deleting a single log entry (replaces native `confirm()`) |
| Billing Summary | `reportModal` | View billing report |
| Report Range | `reportRangeModal` | Select date range for reports |

### Key Functions (app.js)

- `formatDuration(ms)`: Converts milliseconds to HH:MM:SS format
- `formatDecimalQuarter(ms)`: Converts ms to quarter-hour increments
- `formatBillableTime(travelMs, onSiteMs, durationMs)`: Calculates billable time from durations when no manual override is set
- `offsetMinutesOf(d)` / `wallClockMs(ms, offset)` / `toWallClockDate(ms, offset)`: Offset + wall-clock helpers underlying all time rendering
- `formatLogDateTime(ms, offset)` / `formatLogTime(ms, offset)` / `formatLogDate(ms, offset, options)` / `formatWallClockDateTimeLocal(ms, offset)`: Render an instant at its authored offset (UTC-formatted after shifting); `toDecimalHours(ms)` derives decimal hours
- `logStartMs(log)` / `logEndMs(log)` / `logArrivalMs(log)` / `logDurationMs(log)`: Resolve a log's stored epoch-ms fields (epoch ms is the only representation after phase 2)
- `normalizeConsolidatedTimestamps(row)` / `stripLegacyDateTimeFields(row)` / `consolidateStoredLogDateTimes()`: The time/date consolidation machinery (see "Time/Date Consolidation")
- `toIsoWithOffset(ms, offset)` / `parseOffsetMinutesFromIso(iso)` / `deriveOffsetMinutes(iso, ms)`: CSV round-trip helpers for offset-bearing ISO 8601
- `renderLogs()`: Renders all logs from IndexedDB into the log history list
- `parseToDate(dateVal)`: Legacy-string-to-Date fallback used only when `*Ms` fields are absent
 - `exportToCSV()`: Exports logs to CSV file with UTF-8 BOM (21 columns, see CSV section below)
 - `generateReportForDateRange(startDate, endDate)`: Generates the billing report for a date range, using `startMs`/`endMs` for filtering
 - `buildPrintArea()`: Builds a paginated, print-only copy of the report table (see Print section)
 - `parseDurationToMs(durationStr)`: Converts "HH:MM:SS" string to milliseconds
 - `parseCsvLines(csvText)` / `parseCsvRow(row)`: CSV parsing helpers that respect quoted fields and embedded newlines
 - `initDarkMode()`: Applies saved/OS-preferred theme and wires the dark mode toggle button
 - `renderInvoicingMode()`: Renders all logs as a spreadsheet-style table (Client, Billable Hours, Notes, Invoice #) with contenteditable cells for desktop-only invoicing; columns are sortable by clicking headers
 - `enterInvoicingMode()` / `exitInvoicingMode()`: Toggle between the normal log list and invoicing mode; persists preference in `localStorage` under `invoicingMode`
 - `saveInvoicingCell(cell)`: Saves an inline-edited cell (Invoice Number or Billable Hours) to IndexedDB and triggers `syncAfterWrite()`
 - `getBillableDisplay(log)`: Returns the effective billable hours for display — uses `log.billableTime` if overridden, otherwise calculates via `formatBillableTime()`
- `resumeTimer(id)` / `mergeResumeIntoLog()`: Start a new remote timer against an existing log entry; on End Timer the new session's duration is merged into the existing entry's `endMs` / `durationMs` (and the new session's notes are appended to the existing notes) instead of creating a separate log. Only available on remote entries; the Resume button is disabled while a timer is already running

### Cloud Sync (Offline-First Backup)

The app uses an offline-first sync model: all data is stored locally in IndexedDB and optionally backed up to / synced from Cloudflare D1 via the Worker. Auth tokens are stored in `localStorage` under `authToken`; user metadata (`userId`, `userEmail`) is also stored there.

- `API_BASE`: Base URL of the Cloudflare Worker (currently `https://time-tracker.your-worker-subdomain.workers.dev` — replace with your actual Worker URL)
- `isAuthenticated()`: Returns `true` if an `authToken` exists in `localStorage`
- `getAuthHeaders()`: Returns `{ 'Content-Type': 'application/json', 'Authorization': 'Bearer <token>' }`
- `getLastSyncTime()` / `setLastSyncTime(ts)`: Read/write the last successful sync timestamp to `localStorage` under `lastSyncTime`
- `syncToCloud()`: Reads all logs from the local `logs` store and POSTs them to `POST /api/sync` (upserts + soft-deletes via `_deleted` flag)
- `syncFromCloud()`: GETs `GET /api/sync?since=<lastSyncTime>` and writes returned server logs into the local `logs` store
- `performSync()`: Orchestrates upload-then-download; called on page load if authenticated
- `syncAfterWrite()`: Debounced background sync triggered after any local write (1s delay)
- `checkConnectivity()` / `updateSyncStatus(status)`: Updates the `#syncStatus` badge (online / syncing / offline / idle)

Sync strategy: the client pushes local logs to the server in a single batch. Rows are upserted by `(user_id, clientId)` — the per-log UUID — not by the local autoincrement `id`, which is what fixes cross-device id collisions. Soft-deletes use the `_deleted` flag; the server tombstones the row by `client_id`. Pushes only include rows whose `updatedAt` is strictly newer than `lastSyncedUpdatedAt`, so no-op re-pushes are filtered out. The server returns `serverTime` and per-row confirmed `updatedAt` values, which the client records as `lastSyncedUpdatedAt` so subsequent syncs skip those rows. On the next pull, the server returns all logs with `updated_at > since` (strictly greater, so rows already received are not re-included) for that user. Pulled rows are matched locally by `clientId` via the IndexedDB `byClientId` index: an update lands on the existing local row (keeping its local `id`), and a brand-new row is added with a fresh local `id` — the server's `id` is never used as the local key.

### Timer Flow

1. User enters client name and clicks "Start Timer"
2. If "Request Mileage" is enabled, start mileage modal appears → user enters odometer reading
3. User clicks "Mark Arrival" when arriving → arrival time recorded; arrival mileage modal appears if mileage is enabled
4. User clicks "End Timer" → notes modal appears
5. User picks billable time and clicks "Next: Parts Used" → parts modal appears
6. User saves or skips parts → log entry created with all timing data (`finalizeAndSaveLog`)

The "Remote Work" checkbox in the timer card (below "Request Mileage") marks the session as remote. When checked, the "Mark Arrival" button is hidden and mileage prompts are skipped, since remote work doesn't involve travel.

Timer state is persisted to the `timerState` IndexedDB store on every relevant change, so an in-progress timer survives a reload (`saveTimerState` / `restoreTimerState`). Restoring only re-prompts for mileage if "Request Mileage" is currently enabled — it does not force the mileage modal just because a value happens to be unset.

### Manual Entry Flow

1. User clicks "Add Entry" button (fields default to the current date/time)
2. User fills in: Client, Start Time, Arrival Time (optional), End Time, Notes, Parts, Billable Time, Travel Miles
3. On save, the app validates: Client/Start/End are present, all provided datetimes parse, End is after Start, and Arrival (if given) falls between Start and End
4. On success → log entry created

### Edit Flow

Same validation rules as Manual Entry apply to `editModal` before any IndexedDB write happens — required fields, valid dates, End after Start, Arrival between Start and End. The modal is pre-filled from `startMs`/`endMs`/`arrivalMs` when present, falling back to parsing the legacy display strings for older entries.

## Coding Conventions

### HTML Structure
- All modals use `.modal-overlay.hidden` pattern for visibility
- Form fields use `.form-group` wrapper with `.label-title` labels; every `<label class="label-title">` has a matching `for="<input id>"` for accessibility
- Radio button groups (Billable Time, Report Type) use `.billable-options` with `role="radiogroup"` and `aria-labelledby` pointing at the group's label
- Buttons use `.flex-row-gap` container for action buttons

### JavaScript Patterns
- Use `const` for element references
- Use `addEventListener` for event handling
- Use IndexedDB transactions for data operations, and always attach both a success/complete handler **and** an `onerror` handler that surfaces a user-facing `alert()` — silent DB failures should not happen
- Disable the relevant "Save" button for the duration of an async IndexedDB write to prevent double-submission, and re-enable it in both the success and error paths
- Format times using `toLocaleTimeString()` with 2-digit options for **display only**; use the `*Ms` epoch fields for any comparison or arithmetic
- Validate user-entered dates/required fields before opening a transaction, not after

### Styling
- CSS variables defined in `:root` (light theme) and re-defined under `.dark` (dark theme); `initDarkMode()` toggles the `dark` class on `<body>`
- Mobile-first responsive design
- Print styles render from a dedicated `#printArea` element outside the normal app shell (see below), not from the on-screen modal

## PWA Configuration

### Android Support
- Manifest linked via `manifest.json` (relative paths, portable to any deployment path)
- Icons: 192x192, 512x512, and maskable variants
- Theme color meta tag for Android Chrome (`theme-color` is currently fixed to the dark value and does not follow the in-app light/dark toggle)
- Standalone display mode

### iOS Support
- Apple touch icons (180x180)
- Apple mobile web app meta tags
- Standalone display mode
- `manifest.webapp` kept in the repo for legacy iOS tooling but not referenced by `index.html`

### Offline Support (Service Worker)
- `sw.js` precaches core assets on install and serves cache-first for static assets, network-first-with-cache-fallback for navigations
- **`urlsToCache` currently does not include `app.js` or `styles.css`** — they still get cached opportunistically on first fetch via the runtime `fetch` handler, but are not guaranteed available offline until after a full successful first load. Add them to the precache list when touching `sw.js`.
- Precache paths in `sw.js` are root-relative (`/index.html`, `/icons/...`), which assumes the app is deployed at the domain root. If deploying under a subpath, convert these to relative paths.
- Bump `CACHE_NAME` in `sw.js` whenever cached assets change, so `activate` clears the stale cache
- The worker calls `skipWaiting()` + `clients.claim()`, so it takes over open tabs immediately without a reload prompt — be aware an open tab's in-memory `app.js` can end up out of sync with a just-activated new service worker

### Dark Mode
- Theme preference is stored in `localStorage` under `theme` ("dark"/"light"); falls back to `prefers-color-scheme` when unset
- Applied via `initDarkMode()` in `app.js`, which runs after the page has already painted — there can be a brief flash of the wrong theme on load for users with a dark preference. If this becomes noticeable, move the theme-class logic into an inline `<script>` in `<head>`.

## Common Tasks

### Adding a New Field to Manual Entry Modal
1. Add `<input>` element (with an associated `<label for="...">`) in `#addEntryModal` in `index.html`
2. Add a `const` element reference near the top of `app.js`
3. Update the `btnSaveAdd` handler in `app.js` to read and validate the value
4. Include the value in the `newLog` object
5. Update CSV export headers and row data in `exportToCSV()`
6. Update CSV import parsing if the field should round-trip

### Modifying Data Model
1. Update the object structure in `finalizeAndSaveLog()` (timer-based save)
2. Update the object structure in the `btnSaveAdd` handler (manual entry)
3. Update the object structure in the `btnSaveEdit` handler (edit)
4. Update `renderLogs()` if displaying the new field
5. Update CSV export headers/row data and CSV import parsing
6. Update `generateReportForDateRange()` if the report should reflect it

### CSV Import/Export
- Export includes a UTF-8 BOM for Excel compatibility
- Current header format (21 columns): `ID, Client, Start Time, Arrival Time, End Time, Total Duration, Travel Duration, On-Site Duration, Decimal Hours, Billable Time, Start Mileage, Arrival Mileage, Travel Miles, Remote, Notes, Parts Used, Start ISO, End ISO, Arrival ISO, Invoice Number, Updated At`
- The human-readable columns are rendered on export from the epoch fields (wall-clock), not stored
- The trailing `Start ISO` / `End ISO` / `Arrival ISO` columns hold offset-bearing ISO 8601 (`2026-09-15T09:00:00.000-04:00`) via `toIsoWithOffset(ms, offset)`, so both the absolute instant and the authored wall-clock survive a round-trip. Import parsing prefers these for populating `startMs`/`endMs`/`arrivalMs` and the offsets (`parseOffsetMinutesFromIso`); a legacy `Z` suffix yields no offset and the browser offset is used instead
- Import accepts four formats: legacy 15-column (no ISO columns), 19-column (with ISO columns), 20-column (with ISO + Invoice Number), and 21-column (with ISO + Invoice Number + Updated At). The `invoiceNumber` field defaults to empty string when not present in the imported CSV.
- Import parses duration strings (HH:MM:SS) to milliseconds via `parseDurationToMs` (used only when the ISO columns are absent)

### Printing Reports
- `buildPrintArea()` copies the on-screen report table into `#printArea`, splitting it into multiple `<table>` chunks (`ROWS_PER_PAGE = 10`) so iOS Safari's print engine — which does not reliably repeat `<thead>` via `display: table-header-group` and mishandles content that ever lived inside a `position: fixed` / flex ancestor — renders every page correctly
- If you change the report table's column structure, `buildPrintArea()` doesn't need updating (it copies whatever is in `#reportContent`), but double-check the print CSS column widths still make sense

## File Structure
```
time-tracker/
├── public/                           # Static assets (uploaded by wrangler deploy)
│   ├── index.html                    # Page structure and modal markup
│   ├── app.js                        # All application logic
│   ├── styles.css                    # All styling (light/dark themes, print styles)
│   ├── sw.js                         # Service worker (offline asset caching)
│   ├── manifest.json                 # Standard web app manifest (Android/desktop)
│   ├── manifest.webapp               # Legacy iOS-era manifest (unreferenced, kept for compatibility)
│   ├── icons/
│   │   ├── icon.svg                  # SVG app icon
│   │   ├── icon-16.png               # 16x16 favicon
│   │   ├── icon-24.png               # 24x24 favicon
│   │   ├── icon-32.png               # 32x32 favicon
│   │   ├── icon-48.png               # 48x48 Android icon
│   │   ├── icon-72.png               # 72x72 Android icon
│   │   ├── icon-96.png               # 96x96 Android icon
│   │   ├── icon-128.png              # 128x128 Android icon
│   │   ├── icon-144.png              # 144x144 Android icon
│   │   ├── icon-150.png              # 150x150 Windows tile
│   │   ├── icon-152.png              # 152x152 iOS icon
│   │   ├── icon-167.png              # 167x167 iOS icon (iPad)
│   │   ├── icon-180.png              # 180x180 Apple touch icon
│   │   ├── icon-192.png              # 192x192 Android icon
│   │   ├── icon-256.png              # 256x256 Android icon
│   │   ├── icon-384.png              # 384x384 Android icon
│   │   ├── icon-512.png              # 512x512 Android icon
│   │   ├── icon-maskable-192.png     # 192x192 maskable (Android adaptive)
│   │   ├── icon-maskable-512.png     # 512x512 maskable (Android adaptive)
│   │   ├── apple-touch-icon.png      # Apple touch icon
│   │   ├── browserconfig.xml         # IE11 tile config
│   │   ├── mstile-150x150.png        # Windows tile
│   │   ├── safari-pinned-tab.svg     # Safari pinned tab
│   │   └── site.webmanifest          # Alternative manifest
├── AGENTS.md                         # This file
├── worker.js                         # Cloudflare Worker (API layer: auth, CRUD, sync)
├── wrangler.toml                     # Wrangler configuration (KV, D1, dev server, assets)
├── CLOUDFLARE_MIGRATION.md           # Migration guide for Cloudflare deployment
├── upload-assets.ps1                 # PowerShell script for bulk-uploading static assets to KV (optional)
├── package.json                      # npm scripts (deploy, dev)
├── migrations/
│   ├── 001_initial.sql               # D1 database schema (users + logs tables)
│   ├── 002_add_is_remote.sql         # Adds isRemote column
│   ├── 003_soft_delete.sql           # Adds deleted_at tombstone column
│   ├── 004_add_invoice_number.sql    # Adds invoice_number column
│   ├── 005_add_client_id.sql         # Adds client_id UUID + (user_id, client_id) unique index (cross-device sync identity)
│   ├── 006_add_time_offsets.sql      # Adds startOffset/arrivalOffset/endOffset, makes start/end nullable (table rebuild)
│   └── 007_drop_legacy_datetime_columns.sql  # Phase 2: drops start/end/arrival/duration/decimalHours/arrivalTime + idx_logs_start
```

## Cloudflare Worker (API Layer)

The Worker (`worker.js`) is deployed on Cloudflare Workers and provides the authentication and cloud sync API. It is configured via `wrangler.toml` and uses two Cloudflare services:

### Services & Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 Database | Stores `users` and `logs` tables (see `migrations/001_initial.sql`) |
| `TIME_TRACKER_KV` | KV Namespace | Stores session token blocklist (`bl_<token>`) and last-sync timestamps (`sync_<userId>`) |
| `JWT_SECRET` | Secret | HMAC-SHA256 signing key for auth tokens (set via `wrangler secret put JWT_SECRET`) |
| `FALLBACK_ALLOWED_USERS` | Var | Comma-separated JSON array of allowed emails for local dev / allowlist gating |
| `ALLOWED_ORIGIN` | Secret | CORS allowed origin for production (set via `wrangler secret put ALLOWED_ORIGIN`) |
| `ASSETS` | Assets Binding | Static asset serving (auto-uploaded by `wrangler deploy` from `public/` directory via `[assets]` config) |

### Authentication

- Tokens are HMAC-SHA256 signed (`base64(payload).base64(signature)`), not JWTs — the payload is a base64-encoded JSON object containing `{ userId, email, exp }`.
- Token expiry: 24 hours (`TOKEN_EXPIRY_MS`).
- Logout adds the token to a KV blocklist so it can't be reused.
- Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256, 16-byte random salt) — no external crypto libraries needed.
- Registration and login are gated by an allowlist (`isUserAllowed()`): in production this reads from the `ALLOWED_USERS` KV key; in local dev it falls back to `FALLBACK_ALLOWED_USERS` var.

### API Endpoints

#### Authentication
- `POST /api/auth/register` — Register a new user (email, password). Returns `{ success, token, userId, email }`.
- `POST /api/auth/login` — Login existing user. Returns `{ success, token, userId, email }`.
- `POST /api/auth/logout` — Revoke the current token (adds to KV blocklist).

#### Logs (CRUD)
- `GET /api/logs` — Get all logs for the authenticated user, ordered by `start DESC`.
- `POST /api/logs` — Create a new log entry.
- `GET /api/logs/:id` — Get a specific log by ID (scoped to the user).
- `PUT /api/logs/:id` — Update a log entry.
- `DELETE /api/logs/:id` — Delete a log entry.

#### Sync (Offline-First Backup)
- `POST /api/sync` — Batch upsert of all local logs. Accepts `{ logs: [...] }` where each log may have `_deleted: true` (soft-delete), `id` (update existing), or no `id` (create new). Returns `{ success, upserted, errors, serverTime }`.
- `GET /api/sync?since=<timestamp>` — Fetch server-side changes since the last sync timestamp. Returns `{ logs: [...], serverTime }`.

All API endpoints require a `Bearer <token>` Authorization header (except register/login). CORS is configurable via the `ALLOWED_ORIGIN` env var (set via `wrangler secret put ALLOWED_ORIGIN`); for local dev it falls back to echoing the request origin, and `*` only when no origin is present.

### Local Development

```bash
# Install dependencies
npm install

# Start the local dev server (serves worker.js + static assets)
npm run dev  # or: npx wrangler dev

# Apply D1 schema locally
npx wrangler d1 execute time-tracker --local < migrations/001_initial.sql

# Set local secrets (create .dev.vars file)
echo 'JWT_SECRET="your-dev-secret-here"' > .dev.vars
# Optionally set ALLOWED_ORIGIN for local dev (defaults to echoing request origin if unset)
# echo 'ALLOWED_ORIGIN="http://localhost:8787"' >> .dev.vars
```

### Testing & Verification

```bash
# Generate worker-configuration.d.ts from wrangler.toml + .dev.vars (required for typecheck; gitignored)
npm run types  # or: npx wrangler types

# Run the Worker API test suite (Vitest + @cloudflare/vitest-pool-workers, runs in workerd)
npm test  # or: npx vitest run

# Watch mode
npm run test:watch

# Type-check worker.js + test files (checkJs)
npm run typecheck
```

- Tests live in `test/` and exercise the real Worker via the `SELF` fetcher with isolated D1/KV per test file. The test schema is applied in `test/helpers.ts` (note: the repo migrations 001–004 are **not** all replayable on a fresh DB — 002's `ALTER TABLE` duplicates `isRemote`, which already exists in 001 — so tests use their own schema definition; fix the migrations before wiring up `wrangler d1 migrations apply`).
- `.dev.vars` must exist with `JWT_SECRET` and `FALLBACK_ALLOWED_USERS` for both `wrangler dev` and the test suite.
- `worker-configuration.d.ts` is generated and gitignored — regenerate with `npm run types` after changing bindings.
- The Playwright MCP is configured in `opencode.jsonc` (`npx @playwright/mcp@latest`); browser automation against `wrangler dev` requires `npx playwright install chromium` once.

### Deployment

```bash
# Set the JWT secret in production
npx wrangler secret put JWT_SECRET

# Set the CORS allowed origin (your production domain)
npx wrangler secret put ALLOWED_ORIGIN

# Apply D1 schema to the remote database (only needed once)
npx wrangler d1 execute time-tracker --remote < migrations/001_initial.sql

# Set allowed users (comma-separated JSON array of emails)
# Option 1: Update FALLBACK_ALLOWED_USERS in wrangler.toml
# Option 2: Set the allowed_users KV key:
echo '["your-email@example.com"]' | npx wrangler kv key put allowed_users --binding=TIME_TRACKER_KV

# Deploy (static assets are uploaded automatically)
npm run deploy  # or: npx wrangler deploy
```

See `CLOUDFLARE_MIGRATION.md` for the full migration guide. Static assets are now auto-uploaded during deploy via the `[assets]` binding in `wrangler.toml` — the `upload-assets.ps1` script is optional for manual KV uploads only. The `[assets]` config includes an `exclude` list to prevent `node_modules`, config files, and other non-asset files from being uploaded.

## Known Issues & Fixes

### Entries Not Showing in Main Display *(fixed)*
- **Cause**: `renderLogs()` was checking `log.travelDuration` and `log.onSiteDuration` but the data model stores `log.travelDurationMs` and `log.onSiteDurationMs`
- **Fix**: Updated to check `log.travelDurationMs` and `log.onSiteDurationMs`, then format using `formatDuration()`

### Report Button Not Working *(fixed)*
- **Cause**: Same field name mismatch as above
- **Fix**: Updated `renderLogs()` to use correct field names

### CSV Import Billable Time Incorrect *(fixed)*
- **Cause**: `parseDurationToMs()` was defined after it was used, and duration strings weren't being parsed correctly
- **Fix**: Moved function definition earlier, added proper duration string parsing

### Print Report Cutoff *(fixed)*
- **Cause**: Missing page-break CSS for table elements, and iOS Safari's print engine failing to paginate content that lived inside fixed/flex ancestors
- **Fix**: Added `page-break-inside: avoid` to table rows, and introduced a dedicated static `#printArea` (see "Printing Reports" above) with per-page `<table>` chunking

### Edit Modal Could Save Invalid Durations *(fixed)*
- **Cause**: `btnSaveEdit` recalculated durations from `editStartTime.value` / `editEndTime.value` without checking they were non-empty or chronologically valid, so a cleared or reversed field silently saved `NaN` durations
- **Fix**: Added upfront validation (required fields, valid dates, End after Start, Arrival between Start and End) before any database write, mirroring the Add Entry validation

### Date Arithmetic Relied on Re-Parsed Display Strings *(fixed)*
- **Cause**: `start`/`end`/`arrivalTime` were stored only as `toLocaleString()`/`toLocaleTimeString()` output; report filtering and edit-modal prefill re-parsed those strings with `new Date(...)`, which is locale/browser-dependent
- **Fix**: Added `startMs`/`endMs`/`arrivalMs` epoch fields as the source of truth for all date arithmetic, with string-parsing kept only as a fallback for entries created before this change

### Mileage Restore Ignored the "Request Mileage" Toggle *(fixed)*
- **Cause**: `restoreTimerState()` re-showed the start/arrival mileage modal whenever a value was `null`, regardless of whether mileage tracking was currently enabled
- **Fix**: Restore now only prompts for mileage when `requestMileage` is true

### Zero-Mileage Entries Displayed/Exported as Blank *(fixed)*
- **Cause**: Falsy checks like `log.travelMileage || ""` and `log.travelMileage && log.travelMileage > 0` treated a genuine `0` the same as "not set"
- **Fix**: Switched to explicit `!= null` / `!== null && !== undefined` checks throughout rendering, export, and reporting

### Native `confirm()` Used for Delete *(fixed)*
- **Cause**: Deleting a log entry used the browser's native `confirm()`, inconsistent with the custom "Clear All" modal
- **Fix**: Added `deleteConfirmModal` following the same pattern as `clearConfirmModal`

### Invoicing-Mode Edits Silently Dropped by Last-Write-Wins *(fixed)*
- **Cause**: `saveInvoicingCell()` updated `notes` / `billableTime` / `invoiceNumber` but never bumped `log.updatedAt`. When a device pushed those edits, the Worker's `syncLogs` compared `clientUpdatedAt > server_updated_at` using the *original* creation timestamp and treated the push as a conflict, silently skipping the upsert. Other edit paths (`btnSaveEdit`, `btnSaveAdd`, `finalizeAndSaveLog`) all set `updatedAt` correctly — only Invoicing Mode was broken
- **Fix**: `saveInvoicingCell()` now sets `log.updatedAt = Date.now()` before `store.put`, matching every other write path. Also hardened `syncFromCloud()` to normalize the server's `updated_at` string into a Unix epoch ms number on the local copy and drop the redundant `updated_at` field, so subsequent pushes don't round-trip a UTC string through a local-time parse

### "Server Had Newer Data" Logged on Every No-Op Sync *(fixed)*
- **Cause**: `performSync` always does pull-then-push. The pull overwrites the local `updatedAt` with the server's `updated_at`, and the subsequent push re-sends that same value. The server's strict `>` conflict check rejects the push and reports it as a conflict, even though nothing actually changed. The push is a complete no-op on D1, but the log line masks real conflicts and wastes bandwidth
- **Fix**: Each log now tracks `lastSyncedUpdatedAt` — the server's confirmed `updated_at` from the most recent successful push ack (or pull, if the row was never locally edited). `syncToCloud` filters out rows where `updatedAt <= lastSyncedUpdatedAt` so the payload only contains genuine local changes. The server's delete branch (`worker.js:712-720`) now `RETURN`s `updated_at` and includes it in the `upserted` response, so tombstones go through the same ack path. `syncFromCloud` also sets `lastSyncedUpdatedAt` from the server's `updated_at` so a freshly-pulled row is treated as already in sync. Race protection: `syncToCloud` snapshots each row's `updatedAt` at read time, and only updates `lastSyncedUpdatedAt` on the ack if the local value is still what was pushed — so a concurrent local edit during the round-trip is never silently marked as synced. The server's upsert (`worker.js:739`) and single-row update (`worker.js:568`) conflict checks were also loosened from `>` to `>=` (and `<=` to `<`) so that equal-timestamp pushes from legacy rows (which never had a `lastSyncedUpdatedAt`) are accepted as no-op upserts and let the client record the server's `updated_at` for future sync cycles
- **Migration**: On the first sync after this schema change, a `localStorage` flag (`lastSyncedUpdatedAtSchemaVersion`) forces a full pull (`since=0`) so every server row gets a chance to populate `lastSyncedUpdatedAt`. Without this, legacy rows whose server-side `updated_at` is older than the current `lastSyncTime` would never come back in the incremental pull, leaving `lastSyncedUpdatedAt=null` and causing every push to be reported as a conflict. Bump `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` in `app.js` whenever another schema change requires re-running the migration

### Same Logs Re-Received on Every Sync (Pull Cursor Never Catches Up) *(fixed)*
- **Cause**: Rows can carry `updated_at` values in D1 that are hours ahead of the server's real clock (a fast client machine clock, or the earlier future-`lastSyncedUpdatedAt` contamination baked into D1 by the `lastSyncedUpdatedAt + 1000` monotonic bump). The incremental pull cursor (`lastSyncTime`) is derived from real-time values (`serverTime`, `Date.now()`), which can never exceed those future row timestamps, so the server's strict `updated_at > since` filter re-returns the same rows on every sync forever — the client even overwrites its cursor with real `serverTime` at the end of each pull, undoing any advance
- **Fix** (two layers):
  1. **Client** (`app.js` `syncFromCloud`): seal the pull cursor to `max(lastSyncTime, serverTime, newest received row's updated_at)`. The cursor now consumes whatever timestamp a returned row carries, so `updated_at > since` excludes it on the next pull—even if the timestamp is in the future.
  2. **Server** (`worker.js` `syncLogs`/`createLog`/`updateLog` + `sanitizeClientTimestamp()`): still *accept* a write based on the raw client timestamp (future-authored = newer), but *store* a sanitized `updated_at` clamped to `Date.now()` when it exceeds the server clock by more than `MAX_CLIENT_CLOCK_SKEW_MS` (5 min). This prevents new future timestamps from ever landing in D1 and heals an already-contaminated row on its next edit. Genuine NTP skew (seconds) is preserved; only hours-ahead values are clamped.
- **Known trade-off**: sealing the cursor can advance it ahead of real time, so a row edited by *another device* with a correct clock in that window won't be re-pulled until it's locally edited too. Acceptable for the offline-first single-device model; without the seal the loop never converges.

## Open Items (Not Yet Fixed)

- None at this time.

## Previously Open Items (Now Fixed)

- **Time/date stored twice (epoch ms + locale strings) and a dead `arrival` column** *(fixed, phases 1 & 2)* — entries stored both epoch-ms fields and locale display strings (`start`/`end`/`arrivalTime`) plus formatted duplicates (`duration`/`decimalHours`), and D1's `logs` table had an `arrival` DATETIME column that was never written or read by the client. Re-parsing the locale strings with `new Date()` was locale/browser-dependent and had caused several bugs. **Fix**: epoch ms is now the single source of truth, with per-timestamp UTC offsets (`startOffset`/`arrivalOffset`/`endOffset`, minutes east of UTC) preserving the authored wall-clock so an entry renders the same on any device/timezone; all display forms are rendered on demand. **Phase 1**: the Worker stopped writing `start`/`end`/`arrival`/`duration`/`decimalHours`/`arrivalTime` and ordered by `startMs`; `migrations/006_add_time_offsets.sql` added the offset columns and rebuilt `logs` to make `start`/`end` nullable (legacy columns temporarily kept for old clients). The client consolidated existing rows once on load (`consolidateStoredLogDateTimes`, `DATE_TIME_CONSOLIDATION_VERSION`) and `syncFromCloud` normalized pulled rows; `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` was bumped to **5** to force a full pull, and CSV export writes offset-bearing ISO 8601 so the wall-clock round-trips. **Phase 2 (complete)**: once production clients were updated, `migrations/007_drop_legacy_datetime_columns.sql` dropped the six legacy columns and `idx_logs_start`, and the client's epoch accessors (`logStartMs` etc.) no longer fall back to parsing the legacy strings. Verified end-to-end in a browser: legacy rows consolidated with correct EST/EDT offsets, add/edit/CSV-import produce the consolidated shape, report/render show the authored wall-clock, and sync push/pull persisted the offsets to D1.
- **`GET /api/logs/:id` returned tombstoned rows** *(fixed)* — the single-row lookup (`getLog`) had no `deleted_at IS NULL` filter, unlike `GET /api/logs`, so deleting a row and fetching it by id returned the soft-deleted row instead of 404. **Fix**: added `AND deleted_at IS NULL` to the lookup (covered by a test in `test/logs.test.ts`).
- **`serveStaticAsset` always fell through to the placeholder page** *(fixed)* — `new Request(assetFile, request)` with a relative `assetFile` (e.g. `'index.html'`) threw `TypeError: Invalid URL`, which the try/catch swallowed, so the asset-map branch was dead code and the "Cloudflare Worker is running!" fallback was always served (even in production with the `[assets]` binding mounted). **Fix**: resolve `assetFile` against the request origin (`new URL(assetFile, new URL(request.url).origin)`) before fetching the Assets binding. `sw.js` now also gets `Cache-Control: no-cache` instead of the immutable 1-year cache, so service-worker updates propagate. Covered by `test/assets.test.ts` (which confirms the binding serves real files in the test env).
- **CSV export dropped genuine 0 durations** *(fixed)* — `exportToCSV()` used truthiness (`log.travelDurationMs ? formatDuration(...) : ""`), so a legitimate 0 exported blank — the same class of bug already fixed for mileage. **Fix**: explicit `!== null && !== undefined` checks in export, and applied the same treatment to the travel/on-site duration display in `renderLogs()` and the billing report so a genuine `00:00:00` shows instead of disappearing. Verified in-browser: a manual entry with arrival==start exports `"00:00:00"` and renders "🚗 Travel: 00:00:00".
- **Mid-timer reload lost arrival/mileage state** *(fixed)* — `saveTimerState()` was only called from `startTimer()`; `btnMarkArrival`, `btnSaveStartMileage`, and `btnSaveArrivalMileage` never persisted their values, and `travelMileage` was missing from the saved state object. A reload after "Mark Arrival" reverted the timer to `travel-need-arrival` and dropped mileage. **Fix**: `saveTimerState()` now stores `travelMileage`, `restoreTimerState()` restores it (falling back to computing `arrivalMileage - startMileage` for states saved before this fix), and all three handlers persist after mutating. Restore logic is unchanged: mileage modals are only re-prompted when `requestMileage` is currently enabled and the value is genuinely unset. Verified in-browser: start travel → enter start mileage → mark arrival → enter arrival mileage → reload → timer restored to "arrived" state with arrival badge, and the finished log entry carried `startMileage`/`arrivalMileage`/`travelMileage` intact.

- **Cross-device sync ID collision (data loss risk)** *(fixed)* — `syncLogs` in `worker.js` used the client's IndexedDB autoincrement `id` directly as the server primary key (`ON CONFLICT(id) DO UPDATE`), so two devices that both started at `id=1` could silently overwrite each other's rows. **Fix**: every log now carries a globally-unique `clientId` UUID (generated client-side at creation; IndexedDB v4 `byClientId` unique index; `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` bumped to 4). The server stores `client_id` (migration `005_add_client_id.sql`, backfilled `'legacy-' || id` for existing rows) and sync upserts are keyed by `(user_id, client_id)` with its own independent autoincrement `id`. Pushes from legacy clients (id-only) still resolve via the old id mapping. The client pull matches rows by `clientId` (never by the server's `id`) and stores brand-new pulled rows under a fresh local `id`, so ids no longer collide across devices. During the schema-upgrade full pull, legacy rows adopt the server's `client_id` (matched by the old id); never-synced rows get a fresh UUID. Also fixed: an empty push no longer advances the pull cursor to `Date.now()` (which could skip another device's newly-created rows), and `syncLogs`/`createLog` bind all nullable fields with `?? null` so entries that omit mileage fields (e.g. manual entries) no longer fail with `D1_TYPE_ERROR: Type 'undefined' not supported` and don't round-trip a genuine `0` to `null`. Covered by three new regression tests in `test/sync.test.ts`.
- **Repo migrations 001–004 are not replayable on a fresh DB** *(fixed)* — `002_add_is_remote.sql` ran `ALTER TABLE logs ADD COLUMN isRemote` but `001_initial.sql` already creates `isRemote`, so `wrangler d1 migrations apply` failed at 002 before 005 could ever run. **Fix**: 002 is now a documentation-only no-op (the column ships in 001), so 001–005 apply cleanly on a fresh DB. Verified end-to-end in a browser: create → sync → edit → re-sync → delete → tombstone → pull-back of another device's row all round-trip with `clientId` intact.

- **CSV import XSS via unescaped log fields** *(fixed)* — `renderLogs()` rendered `log.start`, `log.duration`, and `log.decimalHours` without `escapeHtml()`, and those fields are populated directly from CSV file content on import, so a crafted CSV could inject HTML/script into the page (escalating to a `localStorage` auth-token steal). **Fix**: wrapped all three in `escapeHtml()` and hardened `escapeHtml()` to coerce null/undefined to `''` instead of throwing.
- **`updateLog` deleted-row check was dead code** *(fixed)* — `updateLog` selected only `id, updated_at` but then checked `existing.deleted_at`, which was always `undefined`, so the intended 409 for tombstoned rows was never returned. **Fix**: included `deleted_at` in the SELECT (covered by a test in `test/logs.test.ts`).
- **Registered users got an unusable token (no `userId`)** *(fixed)* — `registerUser` read `result.meta.id` after the INSERT, but D1 exposes the autoincrement id as `meta.last_row_id`. The issued token therefore had no `userId`, so `getUserIdFromToken` returned `null` and **every** post-register API call returned 401 (login worked because it reads `user.id` from the SELECT). **Fix**: `userId = result.meta?.last_row_id ?? result.results?.[0]?.id`. Surfaces immediately in `test/auth.test.ts`.

- **Edit still not pushed after schema upgrade; corrupted `lastSyncedUpdatedAt` persists** *(fixed)* — Even after bumping `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` to 2 and the `+Z` UTC-parse fix, the user's row still had `lastSyncedUpdatedAt` in the future (5+ hours ahead). The schema-upgrade full pull (`syncFromCloud(0)`) was running and parsing the server's `updated_at` correctly, but the local-preservation check `local.lastSyncedUpdatedAt > log.updatedAt` still evaluated to true (corrupted future value > correct server value), so the pull skipped overwriting the corrupted value. **Fix**: added an `isSchemaUpgradePull` flag (true when `performSync` runs with `sinceOverride === 0`) that bypasses both the `local.updatedAt > log.updatedAt` early-return and the `local.lastSyncedUpdatedAt > log.updatedAt` preservation branch during a full pull, so schema-upgrade pulls ALWAYS adopt the server's `updated_at`-derived values. Bumped `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` to 3 to force another full pull.

- **Edits not pushed; pull overwrites a just-saved local entry** *(fixed)* — `performSync` did pull-then-push, which races with the 1s-delayed `syncAfterWrite` push. If the user saved an edit and clicked the sync status badge within 1s, the user-triggered pull would run first with the pre-edit `lastSyncTime`, return the un-edited server row, and overwrite the local edit before the push got a chance to upload it. The follow-up push would then see `updatedAt === lastSyncedUpdatedAt` (the just-overwritten values) and filter the row out as a no-op, silently losing the edit. **Fix**: in `performSync`, do push-first in the normal path (the schema-upgrade path still pulls first so legacy rows can populate `lastSyncedUpdatedAt` before being pushed). Also added a `syncInFlight` lock so rapid clicks on the sync badge don't trigger overlapping sync runs. Bumped `CACHE_NAME` in `sw.js` to `v30` so the new `app.js` is precached on next activation.

- **Edits not pushed; sync reverts to D1 data** *(fixed)* — `syncFromCloud` and `syncToCloud` parsed the server's `updated_at` string with `new Date(log.updated_at).getTime()`. The D1 column stores UTC (the worker writes it via `toISOString()`), but a `YYYY-MM-DD HH:MM:SS.SSS` string without a `Z` is parsed by `new Date()` as **local time**, producing an epoch ms offset by the user's timezone (e.g. +5h for UTC-5). That bogus value got written to `lastSyncedUpdatedAt`, so the next `syncToCloud` filter `updatedAt > lastSyncedUpdatedAt` always evaluated to false — edits were silently dropped as no-ops. On the next pull, the just-edited row was returned and the local edit was overwritten with the stale D1 version. **Fix**: append `Z` (after converting the space to `T`) so the string parses as UTC at both parse sites (`app.js:1974` push-ack and `app.js:2091` pull). Bumped `LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION` to 2 to force a one-time full pull on the next sync so any existing rows with corrupted `lastSyncedUpdatedAt` get repopulated from the server's actual `updated_at`.

- **Login page was served by the Worker** (`showLoginPage()` in `worker.js`) — unauthenticated requests to `/` returned an inline HTML login/register page. Replaced with an in-app auth modal (`#authModal`) in `index.html` and `app.js` that appears when the user is not authenticated, allowing login/register without a full page redirect. The Worker now serves static assets for all non-API routes without auth gating; the client-side app.js handles auth state and API token management.
- **`API_BASE` in `app.js` was a placeholder** — updated to `https://time-tracker.alexs-cas.workers.dev` (the actual deployed Worker URL).
- **Service worker precache list was missing `app.js` and `styles.css`** — both files are now included in `urlsToCache` in `sw.js`.
- **Service worker precache paths were root-relative** — all paths in `sw.js` are now relative (`./`, `index.html`, `icons/...`).
- **Dark mode flash on load** — an inline script in `<head>` of `index.html` now applies the `dark` class before first paint, eliminating the flash.
- **No update available UX** — added a reload prompt banner in `app.js` that appears when a new service worker is waiting to activate.
- **`manifest.json` theme/background color was hardcoded dark** — updated to light theme values (`#f3f4f6` / `#2563eb`) to match the default light theme.
- **CORS was configured with `Access-Control-Allow-Origin: *`** — now uses a configurable `ALLOWED_ORIGIN` env var (set via `wrangler secret put ALLOWED_ORIGIN`), falling back to echoing the request origin for local dev, and `*` only when no origin is present.
- **Static asset deployment was manual** — replaced the KV namespace `ASSETS` binding with the `[assets]` configuration in `wrangler.toml`, so `wrangler deploy` automatically uploads all static assets. The `upload-assets.ps1` script is now optional for manual uploads only.
- **Report button had an inline `style` overriding dark mode** — removed the inline `background-color` style from `#btnOpenReport` in `index.html` so it inherits `.btn-export` styling and responds to `.dark` theme changes.
- **Print report remained visible on screen after closing print dialog** — added `display: none` for `#printArea` in screen CSS (it's only shown inside `@media print`), so the report content is hidden on screen and only appears in the print preview/output.
- **Sync status badge showed "offline" for unauthenticated users** — `checkConnectivity()` now shows "idle" and hides the badge when not authenticated, and shows "syncing" during sync operations. The badge is hidden by default and only shown when the user is authenticated.
- **Service worker tried to cache POST requests** — the Cache API doesn't support POST methods, causing `TypeError: Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported`. Added a `event.request.method === 'GET'` check before caching responses in `sw.js`.
