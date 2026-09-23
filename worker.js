// Cloudflare Workers API endpoints for Time Tracker
// This file will be deployed as a Cloudflare Worker

// CORS configuration â€” restrict ALLOWED_ORIGIN in production via wrangler secret/vars
// For local dev, defaults to '*' (all origins)
const getCORSHeaders = (origin, env) => {
  // In production, use the ALLOWED_ORIGIN env var if set; otherwise echo the request origin
  // For local dev, default to '*' (all origins)
  let allowedOrigin;
  if (env && env.ALLOWED_ORIGIN) {
    allowedOrigin = env.ALLOWED_ORIGIN;
  } else if (origin) {
    allowedOrigin = origin;
  } else {
    allowedOrigin = '*';
  }
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
};

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCORSHeaders(request.headers.get('origin'), env) });
    }

    let response;

    // API routes
    if (pathname.startsWith('/api/')) {
      response = await handleAPI(request, env, url);
    } else {
      // Serve static assets without requiring auth header.
      // The client-side app.js handles authentication by reading the token
      // from localStorage and including it in API requests.
      // Unauthenticated users see the app UI but cannot access API endpoints.
      response = await serveStaticAsset(request, env, url);
    }

    // Add configurable CORS headers to all responses
    const headers = new Headers(response.headers);
    const corsHeaders = getCORSHeaders(request.headers.get('origin'), env);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
};

async function serveStaticAsset(request, env, url) {
  const pathname = url.pathname;

  const assetMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/styles.css': 'styles.css',
    '/manifest.json': 'manifest.json',
    '/sw.js': 'sw.js',
    '/icons/icon.svg': 'icons/icon.svg',
    '/icons/icon-16.png': 'icons/icon-16.png',
    '/icons/icon-32.png': 'icons/icon-32.png',
    '/icons/icon-48.png': 'icons/icon-48.png',
    '/icons/icon-72.png': 'icons/icon-72.png',
    '/icons/icon-96.png': 'icons/icon-96.png',
    '/icons/icon-128.png': 'icons/icon-128.png',
    '/icons/icon-144.png': 'icons/icon-144.png',
    '/icons/icon-150.png': 'icons/icon-150.png',
    '/icons/icon-152.png': 'icons/icon-152.png',
    '/icons/icon-167.png': 'icons/icon-167.png',
    '/icons/icon-180.png': 'icons/icon-180.png',
    '/icons/icon-192.png': 'icons/icon-192.png',
    '/icons/icon-256.png': 'icons/icon-256.png',
    '/icons/icon-384.png': 'icons/icon-384.png',
    '/icons/icon-512.png': 'icons/icon-512.png',
    '/icons/icon-maskable-192.png': 'icons/icon-maskable-192.png',
    '/icons/icon-maskable-512.png': 'icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png': 'icons/apple-touch-icon.png',
  };

  const assetFile = assetMap[pathname];

  if (!assetFile) {
    return new Response('Not Found', { status: 404 });
  }

  // Try the Assets binding first (production + local dev, auto-uploaded by wrangler deploy/dev).
  // The fetch must use an absolute URL: `new Request(assetFile, request)` throws
  // `TypeError: Invalid URL` for a relative assetFile, which the old try/catch
  // swallowed, making this branch dead code and always serving the fallback page.
  // assetFile values in the map are relative (e.g. 'index.html'), so resolve them
  // against the request origin before constructing the fetch.
  if (env.ASSETS) {
    try {
      const assetUrl = new URL(assetFile, new URL(request.url).origin);
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (response.status === 200) {
        const headers = new Headers(response.headers);
        // Never long-cache sw.js â€” the service worker must pick up updates, and
        // an immutable 1-year cache on it would defeat the update banner.
        headers.set('Cache-Control', pathname === '/sw.js' ? 'no-cache' : 'public, max-age=31536000');
        return new Response(response.body, { status: 200, headers });
      }
    } catch (e) {
      // Fall through to the fallback page below
    }
  }

  // For local development, serve a simple HTML page
  return serveFallback(request, assetFile);
}

async function serveFallback(request, assetFile) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time Tracker - Cloudflare Worker</title>
</head>
<body>
    <div class="app-container">
        <header>
            <h1>Time Tracker</h1>
        </header>
        <main>
            <p style="text-align: center; padding: 2rem; color: #6b7280;">
                Cloudflare Worker is running!<br><br>
                To serve the full application, please deploy to production with \`wrangler deploy\`.
            </p>
        </main>
    </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleAPI(request, env, url) {
  const method = request.method;
  const path = url.pathname;

  // Authentication endpoints
  if (path === '/api/auth/register' && method === 'POST') {
    return registerUser(request, env);
  }
  if (path === '/api/auth/login' && method === 'POST') {
    return loginUser(request, env);
  }
   if (path === '/api/auth/logout' && method === 'POST') {
     return logoutUser(request, env);
   }
   if (path === '/api/auth/password' && method === 'PUT') {
     return changePassword(request, env);
   }

  // Sync endpoints (offline-first backup)
  if (path === '/api/sync' && method === 'POST') {
    return syncLogs(request, env);
  }
  if (path === '/api/sync' && method === 'GET') {
    return getSyncChanges(request, env, url);
  }

  return new Response('Not Found', { status: 404 });
}

// Register a new user
async function registerUser(request, env) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if email is in allowed users list
    if (!(await isUserAllowed(email, env))) {
      return new Response(JSON.stringify({ error: 'Access denied - email not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash the password
    const passwordHash = await hashPassword(password);

    // Insert user into D1
    try {
      const result = await env.DB.prepare(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)'
      ).bind(email.toLowerCase(), passwordHash).run();

      const userId = result.meta?.last_row_id ?? result.results?.[0]?.id;
      const token = await createToken(env, userId, email.toLowerCase());

      return new Response(JSON.stringify({
        success: true,
        token,
        userId,
        email
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (dbError) {
      // Check if it's a unique constraint violation (email already exists)
      if (dbError.message.includes('UNIQUE') || dbError.message.includes('constraint')) {
        return new Response(JSON.stringify({ error: 'User already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw dbError;
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Login handler - verifies password and issues signed token
async function loginUser(request, env) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if email is in allowed users list
    if (!(await isUserAllowed(email, env))) {
      return new Response(JSON.stringify({ error: 'Access denied - email not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Look up user in D1
    const user = await env.DB.prepare(
      'SELECT id, email, password_hash FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate signed token
    const token = await createToken(env, user.id, user.email);

    return new Response(JSON.stringify({
      success: true,
      token,
      userId: user.id,
      email: user.email
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function changePassword(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return new Response(JSON.stringify({ error: 'Current password and new password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (newPassword.length < 8) {
      return new Response(JSON.stringify({ error: 'New password must be at least 8 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get user's current password hash
    const user = await env.DB.prepare(
      'SELECT password_hash FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify current password
    const passwordValid = await verifyPassword(currentPassword, user.password_hash);
    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash and update the new password
    const newPasswordHash = await hashPassword(newPassword);
    await env.DB.prepare(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(newPasswordHash, userId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}


async function logoutUser(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      // Add token to blocklist in KV
      if (env.TIME_TRACKER_KV) {
        const expiry = Date.now() + TOKEN_EXPIRY_MS;
        await env.TIME_TRACKER_KV.put(`bl_${token}`, '1', {
          expirationTtl: Math.ceil(TOKEN_EXPIRY_MS / 1000)
        });
      }
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper functions
async function getUserIdFromToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = await verifyToken(env, token);
  return payload?.userId || null;
}

// Check if email is in allowed users list
async function isUserAllowed(email, env) {
  try {
    // Try KV first
    if (env.TIME_TRACKER_KV) {
      const allowedUsersStr = await env.TIME_TRACKER_KV.get('allowed_users');
      if (allowedUsersStr) {
        try {
          const allowedUsers = JSON.parse(allowedUsersStr);
          return allowedUsers.includes(email.toLowerCase());
        } catch (parseError) {
          // KV value is corrupted, fall through to FALLBACK_ALLOWED_USERS
          console.log('Corrupted allowed_users in KV, falling back to vars:', parseError.message);
        }
      }
    }

    // Fallback to vars for local development
    if (env.FALLBACK_ALLOWED_USERS) {
      const allowedUsers = JSON.parse(env.FALLBACK_ALLOWED_USERS);
      return allowedUsers.includes(email.toLowerCase());
    }

    return false;
  } catch (error) {
    console.log('Error checking allowed users:', error.message);
    return false;
  }
}

// --- Sync (Offline-First Backup) ---

// Tolerable client-clock drift for timestamps the client authorizes.
// Genuine NTP skew between a browser and Cloudflare is seconds, never hours.
const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

// Maximum logs accepted in a single POST /api/sync batch. The client splits
// larger pushes into batches of this size.
const MAX_SYNC_BATCH_SIZE = 250;

// Clamp client-provided updated_at timestamps that are unreasonably far in the
// future (a fast client clock). Without this, an edited row can carry an
// updated_at that is permanently ahead of every incremental pull cursor (which
// tracks real time), so the server's `updated_at > since` filter re-serves that
// row on every sync forever.
function sanitizeClientTimestamp(clientIso) {
  if (!clientIso) return clientIso;
  const clientMs = new Date(clientIso).getTime();
  if (Number.isNaN(clientMs)) return clientIso;
  if (clientMs > Date.now() + MAX_CLIENT_CLOCK_SKEW_MS) {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
  }
  return clientIso;
}

// Server-assigned clock stamp for the incremental pull cursor. Unlike the
// client-authored updated_at, this is monotonic with respect to the order in
// which the server accepted writes, so a row that lands late (offline-authored,
// slow clock) can never fall behind a cursor that already moved past it.
// Stored as 'YYYY-MM-DD HH:MM:SS.SSS' (UTC) to match D1's DATETIME format and
// preserve millisecond precision used by the cursor.
function serverTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

async function syncLogs(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { logs } = body;
    if (!Array.isArray(logs)) {
      return new Response(JSON.stringify({ error: 'logs must be an array' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    // Bound the per-request work so a bulk initial push or import can't blow the
    // Worker CPU budget. The client chunks its pushes to this same size.
    if (logs.length > MAX_SYNC_BATCH_SIZE) {
      return new Response(JSON.stringify({ error: `Batch too large; max ${MAX_SYNC_BATCH_SIZE} logs per request` }), {
        status: 413, headers: { 'Content-Type': 'application/json' }
      });
    }

    const upserted = [];
    const errors = [];
    // Tombstones the server knows about that the client needs to apply locally
    const serverTombstones = [];

    for (const log of logs) {
      try {
        // Resolve the stable cross-device identity. Every log is addressed by its
        // clientId (a per-log UUID generated on the creating device). This is what
        // fixes the cross-device collision: two devices that both started at local
        // id=1 no longer overwrite each other, because the sync key is a
        // globally-unique clientId, not the local autoincrement id. (A log arriving
        // without one gets a server-generated UUID.)
        let clientId = log.clientId;
        if (!clientId) clientId = crypto.randomUUID();

        if (log._deleted) {
          // Soft-delete: set tombstone timestamp instead of hard-deleting.
          // This allows other devices to learn about the deletion via getSyncChanges.
          const now = serverTimestamp();
          const result = await env.DB.prepare(
            'UPDATE logs SET deleted_at = ?, updated_at = ?, server_updated_at = ? WHERE user_id = ? AND client_id = ? RETURNING updated_at, server_updated_at'
          ).bind(now, now, now, userId, clientId).run();
          const serverUpdatedAt = result.results?.[0]?.updated_at || null;
          const serverCursor = result.results?.[0]?.server_updated_at || null;
          upserted.push({ clientId, action: 'deleted', updatedAt: serverUpdatedAt, serverUpdatedAt: serverCursor });
        } else {
          // Check if this row has already been tombstoned on the server.
          // If so, do NOT overwrite the deletion â€” "deletion wins".
          const existing = await env.DB.prepare(
            'SELECT deleted_at, updated_at FROM logs WHERE user_id = ? AND client_id = ?'
          ).bind(userId, clientId).first();

          if (existing && existing.deleted_at) {
            // Row is tombstoned server-side. Return it so the client can delete locally.
            serverTombstones.push({ clientId, action: 'deleted' });
          } else {
            // Conflict resolution: only update if client's updatedAt is newer than server's updated_at
            // Convert client's updatedAt (Unix epoch ms) to ISO string for comparison
            const clientUpdatedAt = log.updatedAt ? new Date(log.updatedAt).toISOString().replace('T', ' ').replace('Z', '') : null;
            const serverUpdatedAt = existing?.updated_at || '0000-01-01 00:00:00';

            // Only proceed with upsert if the row is new, the client didn't send a
            // timestamp, or the client's updatedAt is at least as new as the server's.
            // The client uses per-row lastSyncedUpdatedAt to suppress no-op re-pushes,
            // so an equal-timestamp upsert only reaches the server when both sides
            // genuinely share the same updatedAt. Accepting it is a no-op on D1 and
            // lets the client record the server's confirmed updated_at for subsequent
            // syncs.
            if (!existing || !clientUpdatedAt || clientUpdatedAt >= serverUpdatedAt) {
              // Accept the write based on the client's raw timestamp (a future-skewed
              // edit legitimately represents a newer version), but store a sanitized
              // timestamp so D1 updated_at can never drift hours ahead of real time.
              // server_updated_at is the server's own clock: it is what the pull
              // cursor partitions on, so late-arriving edits cannot be skipped.
              const storedUpdatedAt = sanitizeClientTimestamp(clientUpdatedAt || new Date().toISOString().replace('T', ' ').replace('Z', ''));
              const storedServerUpdatedAt = serverTimestamp();
              const action = existing ? 'updated' : 'created';
              const upsertResult = await env.DB.prepare(
                `INSERT INTO logs (client_id, user_id, client,
                   durationMs, notes, parts,
                   billableTime, travelMileage, startMileage, arrivalMileage,
                   startMs, endMs, arrivalMs, travelDurationMs, onSiteDurationMs, isRemote,
                   startOffset, arrivalOffset, endOffset,
                   invoice_number, updated_at, server_updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, client_id) DO UPDATE SET
                   client=excluded.client,
                   durationMs=excluded.durationMs, notes=excluded.notes,
                   parts=excluded.parts, billableTime=excluded.billableTime, travelMileage=excluded.travelMileage,
                   startMileage=excluded.startMileage, arrivalMileage=excluded.arrivalMileage,
                   startMs=excluded.startMs, endMs=excluded.endMs, arrivalMs=excluded.arrivalMs,
                   travelDurationMs=excluded.travelDurationMs,
                   onSiteDurationMs=excluded.onSiteDurationMs,
                   startOffset=excluded.startOffset, arrivalOffset=excluded.arrivalOffset, endOffset=excluded.endOffset,
                   isRemote=excluded.isRemote,
                   invoice_number=excluded.invoice_number,
                   updated_at=excluded.updated_at,
                   server_updated_at=excluded.server_updated_at
                  WHERE logs.deleted_at IS NULL AND logs.user_id=?
                  RETURNING updated_at, server_updated_at`
              ).bind(
                clientId, userId, log.client,
                log.durationMs ?? null, log.notes ?? null, log.parts ?? null,
                log.billableTime ?? null, log.travelMileage ?? null, log.startMileage ?? null, log.arrivalMileage ?? null,
                log.startMs ?? null, log.endMs ?? null, log.arrivalMs ?? null,
                log.travelDurationMs ?? null, log.onSiteDurationMs ?? null, log.isRemote ? 1 : 0,
                log.startOffset ?? null, log.arrivalOffset ?? null, log.endOffset ?? null,
                log.invoiceNumber ?? null,
                storedUpdatedAt, storedServerUpdatedAt, userId
              ).run();
              // RETURNING gives the server's authoritative updated_at /
              // server_updated_at in the same round-trip, so no follow-up SELECT
              // is needed per log.
              const confirmedUpdatedAt = upsertResult.results?.[0]?.updated_at || storedUpdatedAt;
              const confirmedServerUpdatedAt = upsertResult.results?.[0]?.server_updated_at || storedServerUpdatedAt;
              upserted.push({ clientId, action, updatedAt: confirmedUpdatedAt, serverUpdatedAt: confirmedServerUpdatedAt });
            } else {
              // Client's version is older - don't overwrite, but return server's current updated_at
              upserted.push({ clientId, action: 'conflict', serverUpdatedAt: serverUpdatedAt });
            }
          }
        }
      } catch (logError) {
        errors.push({ clientId: log.clientId, error: logError.message });
      }
    }

    if (env.TIME_TRACKER_KV) {
      await env.TIME_TRACKER_KV.put(`sync_${userId}`, Date.now().toString());
    }

    return new Response(JSON.stringify({
      success: true,
      upserted,
      // Tombstones the client needs to apply locally (entries deleted on another device)
      serverTombstones,
      errors,
      serverTime: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Get server-side changes since last sync.
// Includes tombstoned rows (deleted_at IS NOT NULL) so clients can learn about
// deletions that happened on other devices and apply them locally.
async function getSyncChanges(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const since = url.searchParams.get('since');
    const sinceMs = since ? parseInt(since, 10) : 0;
    // Capture the server clock BEFORE the query. The client seals its pull cursor
    // to this value, so any row accepted after this snapshot carries a
    // server_updated_at greater than it and is returned by the next pull rather
    // than skipped.
    const serverTime = Date.now();
    // Format the cursor as 'YYYY-MM-DD HH:MM:SS.SSS' to match server_updated_at.
    // Preserve milliseconds: truncating to whole seconds would let a row accepted
    // in the same second as the cursor be skipped by the strict `>` filter.
    const sinceDate = sinceMs > 0
      ? new Date(sinceMs).toISOString().replace('T', ' ').replace('Z', '')
      : '0000-01-01 00:00:00.000';

    // Return ALL rows accepted since last sync â€” including tombstoned ones.
    // The client inspects deleted_at to decide whether to upsert or delete locally.
    // Partition on server_updated_at (server-assigned, monotonic with accept order)
    // rather than the client-authored updated_at, which can land late and fall
    // permanently behind an already-advanced cursor. Filtering the bare column
    // (not COALESCE(...)) lets SQLite use idx_logs_user_server_updated; migration
    // 008 backfilled the column and every accepted write stamps it, so no row is
    // unreachable. Strict > (not >=) so rows whose server_updated_at equals since
    // are not re-included on the next pull.
    const result = await env.DB.prepare(
      `SELECT * FROM logs WHERE user_id = ? AND server_updated_at > ? ORDER BY startMs DESC`
    ).bind(userId, sinceDate).all();

    return new Response(JSON.stringify({
      logs: result.results || [], serverTime
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

// --- Token Management (HMAC-signed) ---

// Create a signed token: base64(payload).base64(signature)
async function createToken(env, userId, email) {
  const payload = {
    userId,
    email,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const payloadB64 = btoa(JSON.stringify(payload));
  const signature = await signData(env, payloadB64);
  return `${payloadB64}.${signature}`;
}

// Verify a signed token; returns payload if valid, null otherwise
async function verifyToken(env, token) {
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    // Check blocklist (logout)
    if (env.TIME_TRACKER_KV) {
      const blocked = await env.TIME_TRACKER_KV.get(`bl_${token}`);
      if (blocked) return null;
    }

    // Verify signature
    const expectedSignature = await signData(env, payloadB64);
    if (signature !== expectedSignature) return null;

    // Decode and check expiry
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Date.now()) return null;

    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

// Sign data using HMAC-SHA256 with JWT_SECRET
async function signData(env, data) {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// --- Password Hashing (PBKDF2 via deriveBits) ---

const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH_BITS = 256;

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_LENGTH_BITS
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
  return `${saltB64}:${hashB64}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [saltB64, hashB64] = storedHash.split(':');
    if (!saltB64 || !hashB64) return false;

    const encoder = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const storedKeyBytes = Uint8Array.from(atob(hashB64), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      key,
      HASH_LENGTH_BITS
    );
    const derivedBytes = new Uint8Array(derivedBits);

    // Constant-time comparison
    if (derivedBytes.length !== storedKeyBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < derivedBytes.length; i++) {
      diff |= derivedBytes[i] ^ storedKeyBytes[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}
