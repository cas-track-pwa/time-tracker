// Cloudflare Workers API endpoints for Time Tracker
// This file will be deployed as a Cloudflare Worker

// CORS configuration — restrict ALLOWED_ORIGIN in production via wrangler secret/vars
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

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

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

async function isAuthenticatedRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const payload = await verifyToken(env, token);
  return payload !== null;
}

// Add CORS headers to a Response
// Note: CORS headers are now added at the fetch handler level via getCORSHeaders()
// for configurable origin support. This function is kept for backward compatibility
// but no longer sets headers (the fetch handler handles it).
function withCORS(response) {
  return response;
}

function showLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time Tracker - Login Required</title>
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #f3f4f6;
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .login-container {
            background: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .input-field {
            width: 100%;
            padding: 0.75rem;
            margin: 0.5rem 0;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            font-size: 1rem;
            box-sizing: border-box;
        }
        .btn-action {
            width: 100%;
            padding: 1rem;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 0.5rem;
            font-size: 1rem;
            cursor: pointer;
            margin-top: 0.5rem;
        }
        .btn-action:hover { background: #1d4ed8; }
        .auth-tabs {
            display: flex;
            margin-bottom: 1rem;
        }
        .auth-tab {
            flex: 1;
            padding: 0.5rem;
            background: #e5e7eb;
            border: none;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.875rem;
        }
        .auth-tab.active {
            background: #2563eb;
            color: white;
        }
        .auth-tab.inactive {
            background: #e5e7eb;
            color: #374151;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>Time Tracker</h1>
        <p>Please enter your credentials to access the application.</p>
        <div class="auth-tabs">
            <button id="tabLogin" class="auth-tab active">Login</button>
            <button id="tabRegister" class="auth-tab">Register</button>
        </div>
        <input type="email" id="authEmail" class="input-field" placeholder="you@example.com">
        <input type="password" id="authPassword" class="input-field" placeholder="Password">
        <button id="authBtn" class="btn-action">Login</button>
        <p id="authError" style="color: #ef4444; display: none;"></p>
    </div>
    <script>
        let isLoginMode = true;

        function switchTab(login) {
            isLoginMode = login;
            document.getElementById('tabLogin').className = 'auth-tab ' + (login ? 'active' : 'inactive');
            document.getElementById('tabRegister').className = 'auth-tab ' + (login ? 'inactive' : 'active');
            document.getElementById('authBtn').textContent = login ? 'Login' : 'Register';
        }

        document.getElementById('tabLogin').addEventListener('click', () => switchTab(true));
        document.getElementById('tabRegister').addEventListener('click', () => switchTab(false));

        document.getElementById('authBtn').addEventListener('click', async () => {
            const email = document.getElementById('authEmail').value;
            const password = document.getElementById('authPassword').value;
            const errorEl = document.getElementById('authError');

            if (!email || !password) {
                errorEl.textContent = 'Please enter both email and password';
                errorEl.style.display = 'block';
                return;
            }

            try {
                const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok && data.token) {
                    localStorage.setItem('authToken', data.token);
                    localStorage.setItem('userId', data.userId);
                    localStorage.setItem('userEmail', data.email);
                    window.location.href = '/';
                } else {
                    errorEl.textContent = data.error || 'Authentication failed';
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                errorEl.textContent = 'Network error';
                errorEl.style.display = 'block';
            }
        });

        document.getElementById('authPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('authBtn').click();
        });
    </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

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

  // Try the Assets binding first (production, auto-uploaded by wrangler deploy)
  if (env.ASSETS) {
    try {
      const response = await env.ASSETS.fetch(new Request(assetFile, request));
      if (response && response.status === 200) {
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'public, max-age=31536000');
        return new Response(response.body, { status: 200, headers });
      }
    } catch (e) {
      // Fall through to fallback
    }
  }

  // For local development, serve a simple HTML page
  return serveFallback(request, assetFile);
}

function getContentType(path) {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.ico')) return 'image/x-icon';
  if (path.endsWith('.xml')) return 'application/xml';
  return 'text/plain';
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

  // Logs endpoints
  if (path === '/api/logs' && method === 'GET') {
    return getLogs(request, env);
  }
  if (path === '/api/logs' && method === 'POST') {
    return createLog(request, env);
  }
  if (path.startsWith('/api/logs/') && method === 'GET') {
    return getLog(request, env, url);
  }
  if (path.startsWith('/api/logs/') && method === 'PUT') {
    return updateLog(request, env, url);
  }
  if (path.startsWith('/api/logs/') && method === 'DELETE') {
    return deleteLog(request, env, url);
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
      return withCORS(new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Check if email is in allowed users list
    if (!(await isUserAllowed(email, env))) {
      return withCORS(new Response(JSON.stringify({ error: 'Access denied - email not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Hash the password
    const passwordHash = await hashPassword(password);

    // Insert user into D1
    try {
      const result = await env.DB.prepare(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)'
      ).bind(email.toLowerCase(), passwordHash).run();

      const userId = result.meta.id;
      const token = await createToken(env, userId, email.toLowerCase());

      return withCORS(new Response(JSON.stringify({
        success: true,
        token,
        userId,
        email
      }), {
        headers: { 'Content-Type': 'application/json' }
      }));
    } catch (dbError) {
      // Check if it's a unique constraint violation (email already exists)
      if (dbError.message.includes('UNIQUE') || dbError.message.includes('constraint')) {
        return withCORS(new Response(JSON.stringify({ error: 'User already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      throw dbError;
    }
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Login handler - verifies password and issues signed token
async function loginUser(request, env) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return withCORS(new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Check if email is in allowed users list
    if (!(await isUserAllowed(email, env))) {
      return withCORS(new Response(JSON.stringify({ error: 'Access denied - email not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Look up user in D1
    const user = await env.DB.prepare(
      'SELECT id, email, password_hash FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (!user) {
      return withCORS(new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return withCORS(new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Generate signed token
    const token = await createToken(env, user.id, user.email);

    return withCORS(new Response(JSON.stringify({
      success: true,
      token,
      userId: user.id,
      email: user.email
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
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
    return withCORS(new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Logs handlers
async function getLogs(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const result = await env.DB.prepare(
      'SELECT * FROM logs WHERE user_id = ? ORDER BY start DESC'
    ).bind(userId).all();

    return withCORS(new Response(JSON.stringify(result.results), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

async function createLog(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const logData = await request.json();

    const result = await env.DB.prepare(
      `INSERT INTO logs (
        user_id, client, start, end, arrival,
        durationMs, decimalHours, notes, parts,
        billableTime, travelMileage, startMileage, arrivalMileage,
        startMs, endMs, arrivalMs, duration, travelDurationMs, onSiteDurationMs, arrivalTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    ).bind(
      userId,
      logData.client,
      logData.start,
      logData.end,
      logData.arrival || null,
      logData.durationMs,
      logData.decimalHours,
      logData.notes,
      logData.parts,
      logData.billableTime,
      logData.travelMileage,
      logData.startMileage,
      logData.arrivalMileage,
      logData.startMs || null,
      logData.endMs || null,
      logData.arrivalMs || null,
      logData.duration || null,
      logData.travelDurationMs || null,
      logData.onSiteDurationMs || null,
      logData.arrivalTime || null
    ).run();

    return withCORS(new Response(JSON.stringify({
      success: true,
      id: result.meta?.id || result.results?.[0]?.id
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

async function getLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const logId = url.pathname.split('/').pop();

    const result = await env.DB.prepare(
      'SELECT * FROM logs WHERE id = ? AND user_id = ?'
    ).bind(logId, userId).first();

    if (!result) {
      return withCORS(new Response(JSON.stringify({ error: 'Log not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    return withCORS(new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

async function updateLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const logId = url.pathname.split('/').pop();
    const logData = await request.json();

    const result = await env.DB.prepare(
      `UPDATE logs SET
        client = ?, start = ?, end = ?, arrival = ?,
        durationMs = ?, decimalHours = ?, notes = ?, parts = ?,
        billableTime = ?, travelMileage = ?, startMileage = ?, arrivalMileage = ?,
        startMs = ?, endMs = ?, arrivalMs = ?, duration = ?, travelDurationMs = ?, onSiteDurationMs = ?, arrivalTime = ?
      WHERE id = ? AND user_id = ?`
    ).bind(
      logData.client, logData.start, logData.end, logData.arrival || null,
      logData.durationMs, logData.decimalHours, logData.notes, logData.parts,
      logData.billableTime, logData.travelMileage, logData.startMileage, logData.arrivalMileage,
      logData.startMs || null, logData.endMs || null, logData.arrivalMs || null,
      logData.duration || null, logData.travelDurationMs || null, logData.onSiteDurationMs || null,
      logData.arrivalTime || null,
      logId, userId
    ).run();

    return withCORS(new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

async function deleteLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const logId = url.pathname.split('/').pop();

    const result = await env.DB.prepare(
      'DELETE FROM logs WHERE id = ? AND user_id = ?'
    ).bind(logId, userId).run();

    return withCORS(new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
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

async function syncLogs(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      }));
    }

    const body = await request.json();
    const { logs } = body;
    if (!Array.isArray(logs)) {
      return withCORS(new Response(JSON.stringify({ error: 'logs must be an array' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      }));
    }

    const upserted = [];
    const errors = [];

    for (const log of logs) {
      try {
        if (log._deleted) {
          if (log.id) {
            await env.DB.prepare('DELETE FROM logs WHERE id = ? AND user_id = ?').bind(log.id, userId).run();
            upserted.push({ id: log.id, action: 'deleted' });
          }
        } else if (log.id) {
          await env.DB.prepare(
            `INSERT INTO logs (id, user_id, client, start, end, arrival,
              durationMs, decimalHours, notes, parts,
              billableTime, travelMileage, startMileage, arrivalMileage,
              startMs, endMs, arrivalMs, duration, travelDurationMs, onSiteDurationMs, arrivalTime)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
              client=excluded.client, start=excluded.start, end=excluded.end, arrival=excluded.arrival,
              durationMs=excluded.durationMs, decimalHours=excluded.decimalHours, notes=excluded.notes,
              parts=excluded.parts, billableTime=excluded.billableTime, travelMileage=excluded.travelMileage,
              startMileage=excluded.startMileage, arrivalMileage=excluded.arrivalMileage,
              startMs=excluded.startMs, endMs=excluded.endMs, arrivalMs=excluded.arrivalMs,
              duration=excluded.duration, travelDurationMs=excluded.travelDurationMs,
              onSiteDurationMs=excluded.onSiteDurationMs, arrivalTime=excluded.arrivalTime,
              updated_at=CURRENT_TIMESTAMP WHERE user_id=?`
          ).bind(
            log.id, userId, log.client, log.start, log.end, log.arrival || null,
            log.durationMs, log.decimalHours, log.notes, log.parts,
            log.billableTime, log.travelMileage, log.startMileage, log.arrivalMileage,
            log.startMs || null, log.endMs || null, log.arrivalMs || null,
            log.duration || null, log.travelDurationMs || null, log.onSiteDurationMs || null,
            log.arrivalTime || null, userId
          ).run();
          upserted.push({ id: log.id, action: 'updated' });
        } else {
          const result = await env.DB.prepare(
            `INSERT INTO logs (user_id, client, start, end, arrival,
              durationMs, decimalHours, notes, parts,
              billableTime, travelMileage, startMileage, arrivalMileage,
              startMs, endMs, arrivalMs, duration, travelDurationMs, onSiteDurationMs, arrivalTime)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`
          ).bind(
            userId, log.client, log.start, log.end, log.arrival || null,
            log.durationMs, log.decimalHours, log.notes, log.parts,
            log.billableTime, log.travelMileage, log.startMileage, log.arrivalMileage,
            log.startMs || null, log.endMs || null, log.arrivalMs || null,
            log.duration || null, log.travelDurationMs || null, log.onSiteDurationMs || null,
            log.arrivalTime || null
          ).run();
          const newId = result.meta?.id || result.results?.[0]?.id;
          upserted.push({ id: newId, action: 'created', localId: log._localId || null });
        }
      } catch (logError) {
        errors.push({ id: log.id || log._localId, error: logError.message });
      }
    }

    if (env.TIME_TRACKER_KV) {
      await env.TIME_TRACKER_KV.put(`sync_${userId}`, Date.now().toString());
    }

    return withCORS(new Response(JSON.stringify({
      success: true, upserted, errors, serverTime: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Get server-side changes since last sync
async function getSyncChanges(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return withCORS(new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      }));
    }

    const since = url.searchParams.get('since');
    const sinceMs = since ? parseInt(since, 10) : 0;
    const sinceDate = sinceMs > 0 ? new Date(sinceMs).toISOString().replace('T', ' ').replace('Z', '') : '0000-01-01 00:00:00';

    const result = await env.DB.prepare(
      `SELECT * FROM logs WHERE user_id = ? AND updated_at >= ? ORDER BY start DESC`
    ).bind(userId, sinceDate).all();

    return withCORS(new Response(JSON.stringify({
      logs: result.results || [], serverTime: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return withCORS(new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    }));
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
