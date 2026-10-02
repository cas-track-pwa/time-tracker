import { randomUUID } from 'node:crypto';
import db from './db.js';
import { kvPut } from './kv.js';

const MAX_CLIENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SYNC_BATCH_SIZE = 250;

function toSqlTimestamp(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

function serverTimestamp() {
    return toSqlTimestamp(new Date());
}

// Parse a stored 'YYYY-MM-DD HH:MM:SS.SSS' (UTC) back to epoch ms. The space
// form is not ISO, and `new Date(str)` would read it as LOCAL time - so make it
// ISO and pin it to UTC before parsing.
function sqlToMs(sqlTs) {
    return Date.parse(String(sqlTs).replace(' ', 'T') + 'Z');
}

const selectExisting = db.prepare(
    'SELECT deleted_at, updated_at FROM logs WHERE user_id = ? AND client_id = ?'
);

const tombstoneRow = db.prepare(
    'UPDATE logs SET deleted_at = ?, updated_at = ?, server_updated_at = ? ' +
    'WHERE user_id = ? AND client_id = ? RETURNING updated_at, server_updated_at'
);

const upsertRow = db.prepare(
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
     WHERE logs.deleted_at IS NULL AND logs.user_id = ?
     RETURNING updated_at, server_updated_at`
);

export function syncLogs(userId, body) {
    const logs = body && body.logs;
    if (!Array.isArray(logs)) {
        const err = new Error('logs must be an array');
        err.status = 400;
        throw err;
    }
    if (logs.length > MAX_SYNC_BATCH_SIZE) {
        const err = new Error(`Batch too large; max ${MAX_SYNC_BATCH_SIZE} logs per request`);
        err.status = 413;
        throw err;
    }

    const upserted = [];
    const errors = [];
    const serverTombstones = [];

    for (const log of logs) {
        try {
            let clientId = log.clientId;
            if (!clientId) clientId = randomUUID();

            if (log._deleted) {
                const now = serverTimestamp();
                const row = tombstoneRow.get(now, now, now, userId, clientId);
                upserted.push({
                    clientId,
                    action: 'deleted',
                    updatedAt: row ? row.updated_at : null,
                    serverUpdatedAt: row ? row.server_updated_at : null,
                });
                continue;
            }

            const existing = selectExisting.get(userId, clientId);

            if (existing && existing.deleted_at) {
                // Deletion wins: never resurrect a tombstoned row.
                serverTombstones.push({ clientId, action: 'deleted' });
                continue;
            }

            const clientMs = log.updatedAt == null
                ? null
                : (typeof log.updatedAt === 'number' ? log.updatedAt : Date.parse(log.updatedAt));
            const existingMs = existing ? sqlToMs(existing.updated_at) : null;

            if (!existing || clientMs === null || clientMs >= existingMs) {
                // Accept the write on the client's raw timestamp, but never store
                // one far in the future (a fast client clock would otherwise sit
                // permanently ahead of every incremental pull cursor).
                let storedMs = clientMs === null ? Date.now() : clientMs;
                if (storedMs > Date.now() + MAX_CLIENT_CLOCK_SKEW_MS) storedMs = Date.now();
                const storedUpdatedAt = toSqlTimestamp(new Date(storedMs));
                const storedServerUpdatedAt = serverTimestamp();
                const action = existing ? 'updated' : 'created';

                const row = upsertRow.get(
                    clientId, userId, log.client ?? null,
                    log.durationMs ?? null, log.notes ?? null, log.parts ?? null,
                    log.billableTime ?? null, log.travelMileage ?? null, log.startMileage ?? null, log.arrivalMileage ?? null,
                    log.startMs ?? null, log.endMs ?? null, log.arrivalMs ?? null,
                    log.travelDurationMs ?? null, log.onSiteDurationMs ?? null, log.isRemote ? 1 : 0,
                    log.startOffset ?? null, log.arrivalOffset ?? null, log.endOffset ?? null,
                    log.invoiceNumber ?? null,
                    storedUpdatedAt, storedServerUpdatedAt, userId
                );

                upserted.push({
                    clientId,
                    action,
                    updatedAt: row ? row.updated_at : storedUpdatedAt,
                    serverUpdatedAt: row ? row.server_updated_at : storedServerUpdatedAt,
                });
            } else {
                upserted.push({ clientId, action: 'conflict', serverUpdatedAt: existing.updated_at });
            }
        } catch (logError) {
            errors.push({ clientId: log.clientId, error: logError.message });
        }
    }

    kvPut(`sync_${userId}`, String(Date.now()));

    return { success: true, upserted, serverTombstones, errors, serverTime: Date.now() };
}

export function getSyncChanges(userId, sinceParam) {
    const sinceMs = sinceParam ? parseInt(sinceParam, 10) : 0;
    const serverTime = Date.now();
    const sinceDate = sinceMs > 0
        ? toSqlTimestamp(new Date(sinceMs))
        : '0000-01-01 00:00:00.000';

    const logs = db.prepare(
        'SELECT * FROM logs WHERE user_id = ? AND server_updated_at > ? ORDER BY startMs DESC'
    ).all(userId, sinceDate);

    return { logs, serverTime };
}
