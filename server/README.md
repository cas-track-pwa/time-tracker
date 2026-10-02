# Time Tracker — self-hosted sync service

Node + SQLite re-implementation of the Cloudflare Worker API (`worker.js`), for
running the Time Tracker backend on your own server.

It speaks the exact same HTTP contract as the Worker, so the PWA needs only a new
`API_BASE`. Tokens and password hashes are byte-compatible with `worker.js`: reuse
the same `JWT_SECRET` and existing sessions, devices, and passwords keep working.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | allowlist | Create a user, returns `{ token, userId, email }` |
| `POST` | `/api/auth/login` | allowlist | Returns `{ token, userId, email }` |
| `POST` | `/api/auth/logout` | Bearer | Adds the token to the blocklist |
| `PUT` | `/api/auth/password` | Bearer | Change password (`currentPassword`, `newPassword`) |
| `POST` | `/api/sync` | Bearer | Upsert a batch of logs (max 250) |
| `GET` | `/api/sync?since=<epochMs>` | Bearer | Pull rows changed since the cursor |
| `GET` | `/health` | none | Liveness probe |

## Configuration

Copy `.env.example` to `.env` (gitignored) and set:

| Var | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | HMAC secret for auth tokens. Reuse the Worker's to preserve sessions. |
| `DB_PATH` | no | SQLite file, default `./data/tt.sqlite`. Put it on a persistent volume. |
| `PORT` | no | Default `8787`. |
| `FALLBACK_ALLOWED_USERS` | yes* | JSON array of allowed registration/login emails. |
| `ALLOWED_ORIGIN` | no | Leave empty for same-origin. Set only for cross-origin dev. |

\* Or seed the `kv` table with an `allowed_users` key (JSON array), mirroring the
Worker's KV behavior.

## Run

```bash
npm ci --omit=dev
npm run init-db          # creates the schema, prints the DB path
npm start                # listens on $PORT
```

Docker: `docker build -t tt-sync . && docker run -v tt-data:/data --env-file .env -p 8787:8787 tt-sync`

For a production install (systemd unit, reverse proxy, TLS), see
[`docs/debian-13-vps.md`](../docs/debian-13-vps.md).

## Migrating from Cloudflare D1

The D1 schema (users + logs) matches `schema.sql`; only the Worker's KV data
(allowlist, token blocklist, sync markers) is not in D1.

```bash
npm run init-db
npx wrangler d1 export time-tracker --remote --output d1-dump.sql
sqlite3 data/tt.sqlite ".read d1-dump.sql"     # run once, against a fresh DB
```

Then set `FALLBACK_ALLOWED_USERS` (or insert the `allowed_users` row into `kv`)
to match the old KV allowlist. Reusing `JWT_SECRET` avoids a forced re-login.

## Backups

The whole datastore is one file. Snapshot it consistently while running:

```bash
sqlite3 data/tt.sqlite ".backup '/backups/tt-$(date +%F).sqlite'"
```

Ship `/backups` to object storage (restic/rclone to Backblaze B2) on a timer.
