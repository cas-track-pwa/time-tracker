import crypto from 'node:crypto';
import db from './db.js';
import { kvGet, kvPut } from './kv.js';

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 32;

function jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
}

// --- Password hashing (PBKDF2-SHA256, same `saltB64:hashB64` format as worker.js) --

export function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, HASH_LENGTH, 'sha256');
    return `${salt.toString('base64')}:${derived.toString('base64')}`;
}

export function verifyPassword(password, storedHash) {
    try {
        const [saltB64, hashB64] = String(storedHash).split(':');
        if (!saltB64 || !hashB64) return false;
        const salt = Buffer.from(saltB64, 'base64');
        const stored = Buffer.from(hashB64, 'base64');
        const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, stored.length, 'sha256');
        return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
    } catch {
        return false;
    }
}

// --- HMAC-signed tokens: base64(payload).base64(signature) -------------------
// Byte-compatible with worker.js so tokens issued before a migration keep working
// when the same JWT_SECRET is reused.

function signData(data) {
    return crypto.createHmac('sha256', jwtSecret()).update(data, 'utf8').digest('base64');
}

export function createToken(userId, email) {
    const payload = { userId, email, exp: Date.now() + TOKEN_EXPIRY_MS };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    return `${payloadB64}.${signData(payloadB64)}`;
}

export function verifyToken(token) {
    try {
        const [payloadB64, signature] = String(token).split('.');
        if (!payloadB64 || !signature) return null;

        if (kvGet(`bl_${token}`)) return null;

        const expected = signData(payloadB64);
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
        if (payload.exp < Date.now()) return null;

        return { userId: payload.userId, email: payload.email };
    } catch {
        return null;
    }
}

export function getUserIdFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const payload = verifyToken(authHeader.slice(7));
    return payload ? payload.userId : null;
}

// --- Allowed users (KV list, then FALLBACK_ALLOWED_USERS) -------------------

export function isUserAllowed(email) {
    try {
        const kvValue = kvGet('allowed_users');
        if (kvValue) {
            try {
                return JSON.parse(kvValue).includes(email.toLowerCase());
            } catch {
                // fall through to env
            }
        }
        if (process.env.FALLBACK_ALLOWED_USERS) {
            return JSON.parse(process.env.FALLBACK_ALLOWED_USERS).includes(email.toLowerCase());
        }
        return false;
    } catch {
        return false;
    }
}

// --- Route handlers (each returns { status?, body }) -----------------------

export function registerUser(body) {
    const { email, password } = body || {};
    if (!email || !password) {
        return { status: 400, body: { error: 'Email and password are required' } };
    }
    if (!isUserAllowed(email)) {
        return { status: 403, body: { error: 'Access denied - email not authorized' } };
    }

    try {
        const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
            .run(email.toLowerCase(), hashPassword(password));
        const userId = Number(info.lastInsertRowid);
        return { body: { success: true, token: createToken(userId, email.toLowerCase()), userId, email } };
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
            return { status: 409, body: { error: 'User already exists' } };
        }
        throw e;
    }
}

export function loginUser(body) {
    const { email, password } = body || {};
    if (!email || !password) {
        return { status: 400, body: { error: 'Email and password are required' } };
    }
    if (!isUserAllowed(email)) {
        return { status: 403, body: { error: 'Access denied - email not authorized' } };
    }

    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
        .get(email.toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
        return { status: 401, body: { error: 'Invalid credentials' } };
    }

    return { body: { success: true, token: createToken(user.id, user.email), userId: user.id, email: user.email } };
}

export function changePassword(userId, body) {
    const { currentPassword, newPassword } = body || {};
    if (!currentPassword || !newPassword) {
        return { status: 400, body: { error: 'Current password and new password are required' } };
    }
    if (newPassword.length < 8) {
        return { status: 400, body: { error: 'New password must be at least 8 characters' } };
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
        return { status: 404, body: { error: 'User not found' } };
    }
    if (!verifyPassword(currentPassword, user.password_hash)) {
        return { status: 401, body: { error: 'Current password is incorrect' } };
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(hashPassword(newPassword), userId);
    return { body: { success: true } };
}

export function logoutUser(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        kvPut(`bl_${authHeader.slice(7)}`, '1', TOKEN_EXPIRY_MS);
    }
    return { body: { success: true } };
}
