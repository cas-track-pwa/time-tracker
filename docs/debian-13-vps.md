# Deploying Time Tracker + ITFlow on a Debian 13 VPS (Tailscale-only)

This guide stands up the whole stack on a fresh Debian 13 ("trixie") VPS that is
reachable **only over Tailscale** — no ports 80/443 exposed to the internet, and
TLS certificates obtained via DNS-01.

Replace the placeholders before running anything:

| Placeholder | Meaning |
|---|---|
| `<tailnet>` | your Tailscale tailnet DNS name, e.g. `yak-bebop.ts.net` |
| `<tracker-host>` | Tailscale machine name for the web app, e.g. `tracker` |
| `<itflow-host>` | Tailscale machine name for ITFlow, e.g. `itflow` |
| `<you@example.com>` | the email allowed to register/login |

## Architecture

```
                    Tailscale tailnet (WireGuard, no public ports)
                                  |
   browser ── HTTPS ──> tracker.<tailnet> ──┐
                                                  │  Caddy (caddy-tailscale, DNS-01 certs)
   browser ── HTTPS ──> itflow.<tailnet> ──┐│
                                                  ││
                    ┌─────────────────────────────┘└───────────────┐
                    │ 127.0.0.1                                     │
        /srv/tracker (static PWA + bridge)            ITFlow (Apache + PHP)
        /api/*  -> Node sync service :8787            http://127.0.0.1:8080
        *.php   -> php-fpm socket
                    │
        sync service -> data/tt.sqlite            ITFlow -> MariaDB
```

Same-origin requirement: the PWA and its bridge (`itflow_create_invoice.php`) are
served from `tracker.<tailnet>`, so the browser never sees a cross-origin
call. The sync API is proxied under the same host (`/api/*`). ITFlow does not need
to be same-origin with the tracker.

---

## 1. Base server setup

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl git ufw unattended-upgrades ca-certificates sqlite3

# Firewall: SSH only. Do NOT open 80/443.
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status

# Time + automatic security updates
sudo timedatectl set-timezone UTC
sudo dpkg-reconfigure -plow unattended-upgrades
```

Create a dedicated unprivileged user for the sync service:

```bash
sudo adduser --system --group --home /opt/time-tracker ttsync
```

## 2. Tailscale + TLS

Install Tailscale and join the tailnet:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

In the Tailscale admin console: enable **MagicDNS** and, under
**DNS → HTTPS Certificates**, **Enable HTTPS**. You do not need to open any public
ports; Tailscale completes the Let's Encrypt **DNS-01** challenge against a
`*.ts.net` TXT record it manages.

### Option A — Caddy with the Tailscale plugin (recommended)

Caddy terminates TLS, obtains/renews certs automatically for your tailnet names,
and reverse-proxies to the local services. Install Caddy, then rebuild it with the
Tailscale plugin via `xcaddy`:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Build a Caddy binary that includes the tailscale module and install it over the
# packaged one (newer Caddy also supports: sudo caddy add-package github.com/tailscale/caddy-tailscale)
sudo apt install -y golang-go
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
sudo "$(go env GOPATH)/bin/xcaddy" build --with github.com/tailscale/caddy-tailscale
sudo install -m 755 ./caddy /usr/bin/caddy
caddy version   # should list the tailscale module
```

### Option B — `tailscale serve` (no Caddy)

`tailscale serve` also terminates TLS and auto-renews, but has simpler routing and
serves the node's own MagicDNS name only:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080   # one backend
```

Use Option A if you need two hostnames and PHP routing.

### Option C — custom domain via DNS-01

If you want `tracker.example.com` instead of `*.ts.net`, issue certs with
`acme.sh`/certbot using your DNS provider's API (e.g. Cloudflare), then point the
name at the node's `100.x` address using Tailscale **split DNS**. Never use
HTTP-01/TLS-ALPN-01 — they require inbound 80/443.

## 3. Sync service (Node + SQLite)

Install Node 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x
```

Install and configure the service:

```bash
sudo -u ttsync git clone https://github.com/<your-account>/time-tracker.git /opt/time-tracker
cd /opt/time-tracker/server
sudo -u ttsync npm ci --omit=dev
sudo -u ttsync cp .env.example .env
# Generate a secret, then edit .env: JWT_SECRET, FALLBACK_ALLOWED_USERS, DB_PATH
openssl rand -hex 32
sudo -u ttsync nano .env
sudo -u ttsync npm run init-db
```

`/etc/systemd/system/tt-sync.service`:

```ini
[Unit]
Description=Time Tracker sync service
After=network.target

[Service]
Type=simple
User=ttsync
Group=ttsync
WorkingDirectory=/opt/time-tracker/server
EnvironmentFile=/opt/time-tracker/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/time-tracker/server/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tt-sync
curl -s http://127.0.0.1:8787/health     # {"ok":true}
```

## 4. ITFlow

Install ITFlow using its official installer (see the ITFlow docs), or the manual
Apache/PHP/MariaDB route. Requirements:

- Apache (or nginx) + PHP 8.4 + MariaDB. Bind Apache to loopback
  (`Listen 127.0.0.1:8080`) so it is not reachable off the tailnet.
- Create the database and import `migrations/001_initial.sql`, then run the
  in-app database updates to reach the current schema.

Deploy the invoice-create endpoint from the fork's branch. Either build ITFlow
from the fork, or drop the file in:

```bash
sudo install -o www-data -g www-data -m 644 \
  /opt/itflow-fork/api/v1/invoices/create.php \
  /var/www/itflow/api/v1/invoices/create.php
```

Create an API key in ITFlow under **Admin → API** whose linked user has the
**Sales** module at create level and access to the target client.

## 5. Time Tracker PWA + bridge

```bash
sudo mkdir -p /srv/tracker
sudo cp -r /opt/time-tracker/public/. /srv/tracker/
sudo chown -R www-data:www-data /srv/tracker
sudo install -o www-data -g www-data -m 644 /opt/time-tracker/integrations/bridge/itflow_create_invoice.php /srv/tracker/
sudo install -o www-data -g www-data -m 640 /opt/time-tracker/integrations/bridge/config.example.php /srv/tracker/config.php
sudo nano /srv/tracker/config.php
```

`/srv/tracker/config.php`:

```php
return [
    'ITFLOW_BASE'         => 'http://127.0.0.1:8080',
    'ITFLOW_API_KEY'      => 'PASTE_API_KEY',
    'ITFLOW_VERIFY_TLS'   => false,
    'BRIDGE_TOKEN'        => 'PASTE_LONG_RANDOM_SECRET',   // openssl rand -hex 32
    'ALLOWED_ORIGIN'      => '',
    'DEFAULT_CATEGORY_ID' => 0,
    'HTTP_TIMEOUT'        => 30,
];
```

Install php-fpm so Caddy can execute the bridge:

```bash
sudo apt install -y php8.4-fpm
```

## 6. Reverse proxy (Caddyfile)

`/etc/caddy/Caddyfile`:

```
{
    tailscale
}

tracker.<tailnet> {
    root * /srv/tracker
    @api path /api/*
    handle @api {
        reverse_proxy 127.0.0.1:8787
    }
    handle {
        php_fastcgi unix//run/php/php8.4-fpm.sock
        file_server
    }
}

itflow.<tailnet> {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl restart caddy
sudo journalctl -u caddy -n 50 --no-pager
```

Caddy obtains certs for both tailnet names automatically and serves them only on
the tailnet interface.

## 7. Point the PWA at the self-hosted API

In `public/app.js` the API base is hardcoded to the Cloudflare Worker. Change it
to same-origin so requests hit `/api/*` behind Caddy:

```js
const API_BASE = '';
```

Then redeploy `public/` to `/srv/tracker` and **bump `CACHE_NAME` in
`public/sw.js`** so clients pick up the new asset. Log in with an allowed email;
the user must exist (register) or be migrated from D1 (section 8).

## 8. Migrating existing data from Cloudflare D1

Run the export from a machine where `wrangler` is authenticated against your
Cloudflare account (usually your dev machine), then copy the dump to the VPS:

```bash
# On the machine with wrangler auth:
npx wrangler d1 export time-tracker --remote --output d1-dump.sql
scp d1-dump.sql <you>@<vps>:/tmp/d1-dump.sql

# On the VPS, against a FRESH database:
cd /opt/time-tracker/server
sudo -u ttsync sh -c 'sqlite3 data/tt.sqlite ".read /tmp/d1-dump.sql"'
```

Run this once, against a fresh database, and reuse the original `JWT_SECRET` so
existing tokens/devices keep working. The `allowed_users` list lived in Cloudflare
KV, not D1 — set it via `FALLBACK_ALLOWED_USERS` (or insert a `kv` row with key
`allowed_users`). Verify the count:

```bash
sqlite3 data/tt.sqlite "SELECT COUNT(*) FROM logs;"
```

## 9. Backups to Backblaze B2 (outline)

Three things to back up, all on the VPS:

- `/opt/time-tracker/server/data/tt.sqlite` — snapshot with
  `sqlite3 data/tt.sqlite ".backup /backups/tt.sqlite"` (never copy a live DB file).
- MariaDB — `mariadb-dump --single-transaction <db>`.
- `/var/www/itflow/uploads` (and ITFlow's `config.php`).

Push `/backups` with restic or rclone to a B2 bucket on a systemd timer, and test
a restore once. (Deferred — set up later.)

## 10. Updating

- **Sync service:** `git -C /opt/time-tracker pull && npm ci --omit=dev && sudo systemctl restart tt-sync`.
- **PWA:** copy `public/` to `/srv/tracker`, bump `CACHE_NAME` in `sw.js`.
- **ITFlow:** in the fork, `git fetch upstream && git merge upstream/master`, tag,
  and deploy the new tree; keep `api/v1/invoices/create.php` in place.

## 11. Verification checklist

```bash
# Locally on the VPS
curl -s http://127.0.0.1:8787/health                 # {"ok":true}
curl -s http://127.0.0.1:8080/ | head                # ITFlow login page

# From another tailnet machine (accept the cert once)
curl -s https://tracker.<tailnet>/ | head            # PWA index.html
curl -s https://itflow.<tailnet>/ | head             # ITFlow
```

In the browser at `https://tracker.<tailnet>/`:

1. Register/login with an allowed email.
2. Add a time entry; confirm sync status goes idle (the Node `/api/sync` returns 200).
3. **User → ITFlow Settings**: set the Bridge URL to
   `https://tracker.<tailnet>/itflow_create_invoice.php` and the `BRIDGE_TOKEN`.
4. Generate a report and click **Push to ITFlow**; confirm a Draft invoice with
   line items appears in ITFlow.

## Troubleshooting

- **Caddy has no certs:** confirm MagicDNS + HTTPS are enabled in the tailnet admin,
  the machine name matches `<tracker-host>`/`<itflow-host>`, and `tailscale status`
  is up. Check `journalctl -u caddy`.
- **Bridge 502:** `ITFLOW_BASE` must be reachable from the bridge host and
  `ITFLOW_API_KEY` valid; the bridge returns ITFlow's status in the JSON.
- **Bridge 401:** the `BRIDGE_TOKEN` in the app's ITFlow Settings must match
  `config.php`.
- **Sync 401:** token expired (30 days) or `JWT_SECRET` changed after migration —
  log in again.
- **No billable hours pushed:** entries with `billableTime` of `0` or `sales call`
  produce zero hours and are skipped by the bridge.
