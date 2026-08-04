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
- **index.html**: Page structure and modal markup only
- **app.js**: All application logic (IndexedDB access, timer, modals, CSV, reports, dark mode, service worker registration, cloud sync/auth)
- **styles.css**: All styling, including `:root` / `.dark` CSS variable themes and print styles
- **sw.js**: Service worker for offline asset caching
- **manifest.json**: Web app manifest (Android/desktop install metadata)
- **manifest.webapp**: Legacy iOS-era manifest format, kept for compatibility but not linked from `index.html`
- **worker.js**: Cloudflare Worker (API layer) — handles authentication, CRUD for logs, and offline-first sync
- **wrangler.toml**: Wrangler configuration (KV namespaces, D1 database binding, dev server)
- **migrations/001_initial.sql**: D1 database schema (users + logs tables)
- **CLOUDFLARE_MIGRATION.md**: Migration guide for deploying to Cloudflare Workers
- **upload-assets.ps1**: PowerShell script for bulk-uploading static assets to KV
- Uses IndexedDB (`TimeTrackerDB`, currently version 2) as the local client-side store, with optional cloud backup/sync to Cloudflare D1 + KV
- No external dependencies or frameworks on the client side; the Worker uses native Web Crypto APIs (PBKDF2, HMAC-SHA256) for auth

### Data Model

Each log entry in the `logs` store contains:
```javascript
{
  id: number,            // Auto-incremented primary key
  client: string,        // Client name
  start: string,         // Start datetime (locale-formatted display string)
  end: string,           // End datetime (locale-formatted display string)
  startMs: number,       // Start time as raw epoch milliseconds
  endMs: number,         // End time as raw epoch milliseconds
  arrivalMs: number,     // Arrival time as raw epoch milliseconds (null if no arrival)
  duration: string,      // Formatted duration (HH:MM:SS)
  durationMs: number,    // Duration in milliseconds
  decimalHours: string,  // Duration in decimal hours
  notes: string,         // Work notes
  parts: string,         // Parts/materials used
  billableTime: string,  // Billable time override ("1" = use actual duration, decimal hours, or "sales call")
  arrivalTime: string,   // Arrival time display string (HH:MM AM/PM), null if no arrival
  travelDurationMs: number,  // Travel duration in ms (start -> arrival), null if no arrival
  onSiteDurationMs: number,  // On-site duration in ms (arrival -> end), null if no arrival
  startMileage: number,  // Starting odometer reading
  arrivalMileage: number,// Arrival odometer reading
  travelMileage: number  // Calculated travel distance (arrivalMileage - startMileage)
}
```

**Important:** `startMs` / `endMs` / `arrivalMs` are the source of truth for any date arithmetic (report filtering, edit-modal prefill, CSV round-tripping). The `start` / `end` / `arrivalTime` strings are locale-formatted **display-only** values produced by `toLocaleString()` / `toLocaleTimeString()` — re-parsing them with `new Date(...)` is locale/browser-dependent and should be treated as a legacy fallback only, for entries created before the `*Ms` fields existed (see "Known Issues & Fixes").

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
- `renderLogs()`: Renders all logs from IndexedDB into the log history list
- `parseToDate(dateVal)` / `formatDateTimeLocal(d)`: Legacy-string-to-Date helpers used only as a fallback when `*Ms` fields are absent
- `exportToCSV()`: Exports logs to CSV file with UTF-8 BOM (18 columns, see CSV section below)
- `generateReportForDateRange(startDate, endDate)`: Generates the billing report for a date range, using `startMs`/`endMs` for filtering
- `buildPrintArea()`: Builds a paginated, print-only copy of the report table (see Print section)
- `parseDurationToMs(durationStr)`: Converts "HH:MM:SS" string to milliseconds
- `parseCsvLines(csvText)` / `parseCsvRow(row)`: CSV parsing helpers that respect quoted fields and embedded newlines
- `initDarkMode()`: Applies saved/OS-preferred theme and wires the dark mode toggle button

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

Sync strategy: the client pushes all local logs to the server in a single batch (upsert by `id`, delete by `_deleted` flag). The server returns `serverTime` which the client stores as `lastSyncTime`. On the next pull, the server returns all logs with `updated_at >= since` for that user. Local IDs are preserved; new server-generated IDs are returned in the `upserted` array with `localId` mapping.

### Timer Flow

1. User enters client name and clicks "Start Timer"
2. If "Request Mileage" is enabled, start mileage modal appears → user enters odometer reading
3. User clicks "Mark Arrival" when arriving → arrival time recorded; arrival mileage modal appears if mileage is enabled
4. User clicks "End Timer" → notes modal appears
5. User picks billable time and clicks "Next: Parts Used" → parts modal appears
6. User saves or skips parts → log entry created with all timing data (`finalizeAndSaveLog`)

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
- Current header format (18 columns): `ID, Client, Start Time, Arrival Time, End Time, Total Duration, Travel Duration, On-Site Duration, Decimal Hours, Billable Time, Start Mileage, Arrival Mileage, Travel Miles, Notes, Parts Used, Start ISO, End ISO, Arrival ISO`
- The trailing `Start ISO` / `End ISO` / `Arrival ISO` columns hold `toISOString()` values and are what import parsing prefers for populating `startMs`/`endMs`/`arrivalMs` — they're the reliable round-trip path
- Import also accepts the legacy 15-column format (without the ISO columns) for CSVs exported before this change; in that case `startMs`/`endMs`/`arrivalMs` are derived by re-parsing the display strings, which is best-effort only
- Import parses duration strings (HH:MM:SS) to milliseconds via `parseDurationToMs`

### Printing Reports
- `buildPrintArea()` copies the on-screen report table into `#printArea`, splitting it into multiple `<table>` chunks (`ROWS_PER_PAGE = 10`) so iOS Safari's print engine — which does not reliably repeat `<thead>` via `display: table-header-group` and mishandles content that ever lived inside a `position: fixed` / flex ancestor — renders every page correctly
- If you change the report table's column structure, `buildPrintArea()` doesn't need updating (it copies whatever is in `#reportContent`), but double-check the print CSS column widths still make sense

## File Structure
```
time-tracker/
├── index.html                        # Page structure and modal markup
├── app.js                            # All application logic
├── styles.css                        # All styling (light/dark themes, print styles)
├── sw.js                             # Service worker (offline asset caching)
├── manifest.json                     # Standard web app manifest (Android/desktop)
├── manifest.webapp                   # Legacy iOS-era manifest (unreferenced, kept for compatibility)
├── AGENTS.md                         # This file
├── worker.js                         # Cloudflare Worker (API layer: auth, CRUD, sync)
├── wrangler.toml                     # Wrangler configuration (KV, D1, dev server)
├── CLOUDFLARE_MIGRATION.md           # Migration guide for Cloudflare deployment
├── upload-assets.ps1                 # PowerShell script for bulk-uploading static assets to KV
├── migrations/
│   └── 001_initial.sql               # D1 database schema (users + logs tables)
├── icons/
│   ├── icon.svg                      # SVG app icon
│   ├── icon-16.png                   # 16x16 favicon
│   ├── icon-24.png                   # 24x24 favicon
│   ├── icon-32.png                   # 32x32 favicon
│   ├── icon-48.png                   # 48x48 Android icon
│   ├── icon-72.png                   # 72x72 Android icon
│   ├── icon-96.png                   # 96x96 Android icon
│   ├── icon-128.png                  # 128x128 Android icon
│   ├── icon-144.png                  # 144x144 Android icon
│   ├── icon-150.png                  # 150x150 Windows tile
│   ├── icon-152.png                  # 152x152 iOS icon
│   ├── icon-167.png                  # 167x167 iOS icon (iPad)
│   ├── icon-180.png                  # 180x180 Apple touch icon
│   ├── icon-192.png                  # 192x192 Android icon
│   ├── icon-256.png                  # 256x256 Android icon
│   ├── icon-384.png                  # 384x384 Android icon
│   ├── icon-512.png                  # 512x512 Android icon
│   ├── icon-maskable-192.png         # 192x192 maskable (Android adaptive)
│   ├── icon-maskable-512.png         # 512x512 maskable (Android adaptive)
│   ├── apple-touch-icon.png          # Apple touch icon
│   ├── browserconfig.xml             # IE11 tile config
│   ├── mstile-150x150.png            # Windows tile
│   ├── safari-pinned-tab.svg         # Safari pinned tab
│   └── site.webmanifest              # Alternative manifest
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
| `ASSETS` | Assets Binding | Static asset serving (auto-uploaded by `wrangler deploy` via `[assets]` config) |

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

### Deployment

```bash
# Set the JWT secret in production
npx wrangler secret put JWT_SECRET

# Set the CORS allowed origin (your production domain)
npx wrangler secret put ALLOWED_ORIGIN

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

## Open Items (Not Yet Fixed)

- **Login page is served by the Worker** (`showLoginPage()` in `worker.js`) — unauthenticated requests to `/` return an inline HTML login/register page. The client-side `app.js` does not currently render its own auth UI; it relies on the Worker to gate access. Consider adding an in-app auth modal for a smoother UX.
- **`API_BASE` in `app.js` is a placeholder** (`https://time-tracker.your-worker-subdomain.workers.dev`) — must be updated to the actual Worker URL before deployment.

## Previously Open Items (Now Fixed)

- **Service worker precache list was missing `app.js` and `styles.css`** — both files are now included in `urlsToCache` in `sw.js`.
- **Service worker precache paths were root-relative** — all paths in `sw.js` are now relative (`./`, `index.html`, `icons/...`).
- **Dark mode flash on load** — an inline script in `<head>` of `index.html` now applies the `dark` class before first paint, eliminating the flash.
- **No update available UX** — added a reload prompt banner in `app.js` that appears when a new service worker is waiting to activate.
- **`manifest.json` theme/background color was hardcoded dark** — updated to light theme values (`#f3f4f6` / `#2563eb`) to match the default light theme.
- **CORS was configured with `Access-Control-Allow-Origin: *`** — now uses a configurable `ALLOWED_ORIGIN` env var (set via `wrangler secret put ALLOWED_ORIGIN`), falling back to echoing the request origin for local dev, and `*` only when no origin is present.
- **Static asset deployment was manual** — replaced the KV namespace `ASSETS` binding with the `[assets]` configuration in `wrangler.toml`, so `wrangler deploy` automatically uploads all static assets. The `upload-assets.ps1` script is now optional for manual uploads only.
