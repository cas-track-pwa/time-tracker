import http from 'node:http';
import { URL } from 'node:url';
import db from './db.js';
import {
    registerUser,
    loginUser,
    changePassword,
    logoutUser,
    getUserIdFromToken,
} from './auth.js';
import { syncLogs, getSyncChanges } from './sync.js';

const PORT = parseInt(process.env.PORT || '8787', 10);
const MAX_BODY_BYTES = 1024 * 1024;

function corsHeaders(origin) {
    const allowed = process.env.ALLOWED_ORIGIN || origin || '*';
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function send(res, status, payload, origin) {
    const body = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
    });
    res.end(body);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                const err = new Error('Payload too large');
                err.status = 413;
                reject(err);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) return resolve(null);
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                const err = new Error('Invalid JSON');
                err.status = 400;
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function requireUser(req) {
    const userId = getUserIdFromToken(req);
    if (!userId) {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
    }
    return userId;
}

async function routeApi(req, pathname, url, body) {
    const method = req.method;

    if (pathname === '/api/auth/register' && method === 'POST') return registerUser(body);
    if (pathname === '/api/auth/login' && method === 'POST') return loginUser(body);
    if (pathname === '/api/auth/logout' && method === 'POST') return logoutUser(req);
    if (pathname === '/api/auth/password' && method === 'PUT') {
        return changePassword(requireUser(req), body);
    }

    if (pathname === '/api/sync' && method === 'POST') {
        return { body: syncLogs(requireUser(req), body) };
    }
    if (pathname === '/api/sync' && method === 'GET') {
        return { body: getSyncChanges(requireUser(req), url.searchParams.get('since')) };
    }

    return { status: 404, body: { error: 'Not Found' } };
}

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(origin));
        res.end();
        return;
    }

    try {
        if (url.pathname === '/health') {
            return send(res, 200, { ok: true }, origin);
        }

        if (url.pathname.startsWith('/api/')) {
            const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : null;
            const result = await routeApi(req, url.pathname, url, body);
            return send(res, result.status || 200, result.body, origin);
        }

        return send(res, 404, { error: 'Not Found' }, origin);
    } catch (e) {
        return send(res, e.status || 500, { error: e.message }, origin);
    }
});

server.listen(PORT, () => {
    console.log(`time-tracker sync service listening on :${PORT} (db: ${db.name})`);
});
