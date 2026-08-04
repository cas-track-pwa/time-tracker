// Cloudflare Workers API endpoints for Time Tracker
// This file will be deployed as a Cloudflare Worker

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Check authentication for all routes except login
    const isLoginRoute = pathname === '/api/auth/login';
    const isAuthenticated = isLoginRoute || await isAuthenticatedRequest(request, env);
    
    if (!isAuthenticated) {
      // Return 401 for API routes, redirect for static assets
      if (pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Unauthorized - Please login first' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // For static assets, show login page
      return showLoginPage();
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }

    // Serve static assets
    return serveStaticAsset(request, env, url);
  }
};

async function isAuthenticatedRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const payload = await verifyToken(env, token);
  return payload !== null;
}

function showLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time Tracker - Login Required</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body { 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            background: #f3f4f6;
        }
        .login-container {
            background: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
        }
        .input-field {
            width: 100%;
            padding: 0.75rem;
            margin: 0.5rem 0;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            font-size: 1rem;
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
        }
        .btn-action:hover { background: #1d4ed8; }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>Time Tracker</h1>
        <p>Please enter your email to access the application.</p>
        <input type="email" id="loginEmail" class="input-field" placeholder="you@example.com">
        <button id="loginBtn" class="btn-action">Login</button>
        <p id="loginError" style="color: #ef4444; display: none;"></p>
    </div>
    <script>
        document.getElementById('loginBtn').addEventListener('click', async () => {
            const email = document.getElementById('loginEmail').value;
            const errorEl = document.getElementById('loginError');
            
            if (!email) {
                errorEl.textContent = 'Please enter an email';
                errorEl.style.display = 'block';
                return;
            }
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                
                const data = await response.json();
                
                if (response.ok && data.token) {
                    localStorage.setItem('authToken', data.token);
                    localStorage.setItem('userEmail', data.email);
                    window.location.reload();
                } else {
                    errorEl.textContent = data.error || 'Login failed';
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                errorEl.textContent = 'Network error';
                errorEl.style.display = 'block';
            }
        });
        
        document.getElementById('loginEmail').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('loginBtn').click();
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
  
  // Try KV first (for production)
  if (env.ASSETS) {
    try {
      const asset = await env.ASSETS.get(assetFile, { type: 'text' });
      if (asset) {
        const contentType = getContentType(assetFile);
        return new Response(asset, {
          headers: { 
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000'
          }
        });
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
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="app-container">
        <header>
            <h1>Time Tracker</h1>
        </header>
        <main>
            <p style="text-align: center; padding: 2rem; color: #6b7280;">
                Cloudflare Worker is running!<br><br>
                To serve the full application, please:<br>
                1. Upload your static assets to KV, or<br>
                2. Deploy to production
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
  if (path === '/api/auth/login' && method === 'POST') {
    return emailLoginHandler(request, env);
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

  return new Response('Not Found', { status: 404 });
}

// Email-based login handler
async function emailLoginHandler(request, env) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
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

    // Generate token
    const token = await emailLogin(email);
    
    return new Response(JSON.stringify({ 
      success: true, 
      token,
      email 
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

async function logoutUser(request, env) {
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Logs handlers
async function getLogs(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await env.DB.prepare(
      'SELECT * FROM logs WHERE user_id = ? ORDER BY start DESC'
    ).bind(userId).all();

    return new Response(JSON.stringify(result.results), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function createLog(request, env) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const logData = await request.json();
    
    const result = await env.DB.prepare(
      `INSERT INTO logs (
        user_id, client, start, end, arrival, 
        duration_ms, decimal_hours, notes, parts, 
        billable_time, travel_mileage, start_mileage, arrival_mileage,
        startMs, endMs, arrivalMs, duration, travelDurationMs, onSiteDurationMs, arrivalTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

    return new Response(JSON.stringify({ 
      success: true, 
      id: result.meta.id 
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

async function getLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const logId = url.pathname.split('/').pop();
    
    const result = await env.DB.prepare(
      'SELECT * FROM logs WHERE id = ? AND user_id = ?'
    ).bind(logId, userId).first();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Log not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function updateLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const logId = url.pathname.split('/').pop();
    const logData = await request.json();
    
    const result = await env.DB.prepare(
      `UPDATE logs SET 
        client = ?, start = ?, end = ?, arrival = ?,
        duration_ms = ?, decimal_hours = ?, notes = ?, parts = ?,
        billable_time = ?, travel_mileage = ?, start_mileage = ?, arrival_mileage = ?,
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

async function deleteLog(request, env, url) {
  try {
    const userId = await getUserIdFromToken(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const logId = url.pathname.split('/').pop();
    
    const result = await env.DB.prepare(
      'DELETE FROM logs WHERE id = ? AND user_id = ?'
    ).bind(logId, userId).run();

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
  return payload?.userId;
}

// Check if email is in allowed users list
async function isUserAllowed(email, env) {
  try {
    const allowedUsersStr = await env.TIME_TRACKER_KV.get('allowed_users');
    if (!allowedUsersStr) return false;
    const allowedUsers = JSON.parse(allowedUsersStr);
    return allowedUsers.includes(email.toLowerCase());
  } catch (error) {
    return false;
  }
}

// Email-based login - generates token with email
async function emailLogin(email) {
  return btoa(JSON.stringify({ 
    email, 
    exp: Date.now() + 86400000 // 24 hours
  }));
}

// Verify email-based token
async function verifyToken(env, token) {
  try {
    const payload = JSON.parse(atob(token));
    if (payload.exp < Date.now()) return null;
    
    // Return userId as email for email-based auth
    return { userId: payload.email };
  } catch {
    return null;
  }
}