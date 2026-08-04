// Cloudflare Workers API endpoints for Time Tracker
// This file will be deployed as a Cloudflare Worker

import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith('/api/')) {
      return handleAPI(request, env);
    }

    // Serve static assets
    try {
      return await getAssetFromKV({ request, waitUntil: ctx.waitUntil.bind(ctx) });
    } catch (e) {
      // Fall back to index.html for SPA routes
      return await getAssetFromKV({
        request: new Request(url.origin + '/index.html', request),
        waitUntil: ctx.waitUntil.bind(ctx)
      });
    }
  }
};

async function handleAPI(request, env) {
  const url = new URL(request.url);
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
    return getLog(request, env);
  }
  if (path.startsWith('/api/logs/') && method === 'PUT') {
    return updateLog(request, env);
  }
  if (path.startsWith('/api/logs/') && method === 'DELETE') {
    return deleteLog(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

// Authentication handlers
async function registerUser(request, env) {
  try {
    const { email, password } = await request.json();
    
    // Validate input
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash password (using bcrypt or similar)
    const hashedPassword = await hashPassword(password);
    
    // Store user in D1
    const result = await env.DB.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id'
    ).bind(email, hashedPassword).run();

    if (!result.success) {
      if (result.error?.message?.includes('UNIQUE constraint')) {
        return new Response(JSON.stringify({ error: 'Email already registered' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: 'Registration failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate JWT token
    const token = await generateToken(env, result.meta.id);
    
    return new Response(JSON.stringify({ 
      success: true, 
      userId: result.meta.id,
      token 
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

async function loginUser(request, env) {
  try {
    const { email, password } = await request.json();
    
    // Get user from D1
    const result = await env.DB.prepare(
      'SELECT id, password_hash FROM users WHERE email = ?'
    ).bind(email).first();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify password
    if (!(await verifyPassword(password, result.password_hash))) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate JWT token
    const token = await generateToken(env, result.id);
    
    return new Response(JSON.stringify({ 
      success: true, 
      userId: result.id,
      token 
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
  // Token invalidation would happen via KV or JWT expiration
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
        billable_time, travel_mileage, start_mileage, arrival_mileage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      userId,
      logData.client,
      logData.start,
      logData.end,
      logData.arrival,
      logData.durationMs,
      logData.decimalHours,
      logData.notes,
      logData.parts,
      logData.billableTime,
      logData.travelMileage,
      logData.startMileage,
      logData.arrivalMileage
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

async function getLog(request, env) {
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

async function updateLog(request, env) {
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
        billable_time = ?, travel_mileage = ?, start_mileage = ?, arrival_mileage = ?
      WHERE id = ? AND user_id = ?`
    ).bind(
      logData.client, logData.start, logData.end, logData.arrival,
      logData.durationMs, logData.decimalHours, logData.notes, logData.parts,
      logData.billableTime, logData.travelMileage, logData.startMileage, logData.arrivalMileage,
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

async function deleteLog(request, env) {
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

async function hashPassword(password) {
  // Use bcrypt or similar in production
  // This is a placeholder - use a proper password hashing library
  return btoa(password); // NOT SECURE - use proper hashing in production
}

async function verifyPassword(password, hash) {
  // Use bcrypt comparison in production
  return btoa(password) === hash; // NOT SECURE - use proper comparison in production
}

async function generateToken(env, userId) {
  // Generate JWT token
  // This is a placeholder - use proper JWT library
  return btoa(JSON.stringify({ userId, exp: Date.now() + 86400000 }));
}

async function verifyToken(env, token) {
  // Verify JWT token
  // This is a placeholder - use proper JWT verification in production
  try {
    const payload = JSON.parse(atob(token));
    if (payload.exp < Date.now()) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}