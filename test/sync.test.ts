import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { api, getToken, makeLog } from "./helpers";

describe("POST /api/sync (batch upsert, clientId-keyed)", () => {
  it("requires authentication", async () => {
    const res = await api("POST", "/api/sync", { body: { logs: [makeLog()] } });
    expect(res.status).toBe(401);
  });

  it("creates new rows and acks them by clientId", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId })] },
    });
    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    const created = res.json?.upserted.find((u: any) => u.action === "created");
    expect(created).toBeTruthy();
    expect(created.clientId).toBe(clientId);
    expect(created.updatedAt).toBeTruthy();
  });

  it("updates an existing row in place when the client timestamp is newer", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    const created = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId })] },
    });
    const serverUpdatedAt = created.json!.upserted[0].updatedAt;

    const res = await api("POST", "/api/sync", {
      token,
      body: {
        logs: [
          {
            ...makeLog({ clientId, client: "Updated Corp" }),
            updatedAt: new Date(String(serverUpdatedAt).replace(" ", "T") + "Z").getTime() + 1000,
          },
        ],
      },
    });
    expect(res.json?.upserted[0].action).toBe("updated");
    expect(res.json?.upserted[0].clientId).toBe(clientId);

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(1);
    expect(listed.json![0].client).toBe("Updated Corp");
  });

  it("returns a conflict when pushing an older timestamp for an existing row", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId })] },
    });

    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: 1_000_000 })] },
    });
    expect(res.json?.upserted[0].action).toBe("conflict");
  });

  it("tombstones a row when _deleted is true, then excludes it from listings", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId })] },
    });

    const del = await api("POST", "/api/sync", {
      token,
      body: { logs: [{ clientId, _deleted: true }] },
    });
    expect(del.json?.upserted[0].action).toBe("deleted");
    expect(del.json?.upserted[0].clientId).toBe(clientId);

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(0);
  });

  it("clamps future-skewed client timestamps to the server clock", async () => {
    const token = await getToken();
    const future = Date.now() + 60 * 60 * 1000; // 1 hour ahead
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ updatedAt: future })] },
    });
    expect(res.json?.success).toBe(true);
    const updatedAt = res.json!.upserted[0].updatedAt as string;
    const parsed = new Date(String(updatedAt).replace(" ", "T") + "Z").getTime();
    // Clamped to ~now, not 1 hour in the future
    expect(Math.abs(parsed - Date.now())).toBeLessThan(2 * 60 * 1000);
  });
});

describe("cross-device ID collision regression", () => {
  it("keeps two devices' rows apart even when both use the same local id", async () => {
    const token = await getToken();
    // Two "devices", each with a log whose local IndexedDB id is 1 — the exact
    // scenario that used to silently overwrite one row with the other.
    const deviceA = makeLog({ id: 1, clientId: crypto.randomUUID(), client: "Device A Corp" });
    const deviceB = makeLog({ id: 1, clientId: crypto.randomUUID(), client: "Device B Corp" });

    const resA = await api("POST", "/api/sync", { token, body: { logs: [deviceA] } });
    const resB = await api("POST", "/api/sync", { token, body: { logs: [deviceB] } });
    expect(resA.json?.success).toBe(true);
    expect(resB.json?.success).toBe(true);

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(2);
    const clients = listed.json!.map((l: any) => l.client).sort();
    expect(clients).toEqual(["Device A Corp", "Device B Corp"]);
  });

  it("does not duplicate a row when the same clientId is pushed again", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    await api("POST", "/api/sync", { token, body: { logs: [makeLog({ clientId })] } });
    // Same clientId, same content, updatedAt pushed equal/newer — no-op upsert.
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: Date.now() })] },
    });
    expect(res.json?.upserted[0].action).toBe("updated");

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(1);
  });

  it("lets a legacy client (id only, no clientId) keep updating its pre-migration row", async () => {
    // Pre-migration rows were stored under the client's local autoincrement id
    // with a backfilled client_id of 'legacy-<id>'. A legacy client that still
    // pushes id-only must resolve to that same row (no duplicate).
    const reg = await api("POST", "/api/auth/register", {
      body: { email: "user2@example.com", password: "password123" },
    });
    const token = reg.json!.token as string;
    const userId = reg.json!.userId as number;

    await env.DB.prepare(
      `INSERT INTO logs (id, user_id, client_id, client, startMs, endMs, created_at, updated_at)
       VALUES (5, ?, 'legacy-5', 'Seed Corp', 1000, 2000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(userId).run();

    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ id: 5, clientId: undefined, client: "Legacy Corp Renamed", updatedAt: Date.now() })] },
    });
    expect(res.json?.upserted[0].clientId).toBe("legacy-5");
    expect(res.json?.upserted[0].action).toBe("updated");

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(1);
    expect(listed.json![0].client).toBe("Legacy Corp Renamed");
  });
});

describe("GET /api/sync (incremental pull)", () => {
  it("returns all rows when since=0, including tombstones", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    await api("POST", "/api/sync", { token, body: { logs: [makeLog({ clientId })] } });
    await api("POST", "/api/sync", { token, body: { logs: [{ clientId, _deleted: true }] } });

    const res = await api("GET", "/api/sync?since=0", { token });
    expect(res.json?.logs.length).toBe(1);
    expect(res.json?.logs[0].deleted_at).toBeTruthy();
    expect(res.json?.logs[0].client_id).toBe(clientId);
    expect(res.json?.serverTime).toBeGreaterThan(0);
  });

  it("does not return rows older than the since cursor", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog()] },
    });
    const serverTime = created.json!.serverTime;

    const res = await api("GET", `/api/sync?since=${serverTime + 1000}`, { token });
    expect(res.json?.logs.length).toBe(0);
  });

  it("does not return rows from other users", async () => {
    const tokenA = await getToken("user2@example.com");
    const tokenB = await getToken("test@example.com");
    await api("POST", "/api/sync", { token: tokenA, body: { logs: [makeLog()] } });

    const res = await api("GET", "/api/sync?since=0", { token: tokenB });
    expect(res.json?.logs.length).toBe(0);
  });
});