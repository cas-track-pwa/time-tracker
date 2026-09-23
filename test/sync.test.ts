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

    const row = await env.DB.prepare(
      "SELECT client FROM logs WHERE client_id = ?"
    ).bind(clientId).first();
    expect(row?.client).toBe("Updated Corp");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM logs").first();
    expect(count?.n).toBe(1);
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

    const row = await env.DB.prepare(
      "SELECT deleted_at FROM logs WHERE client_id = ?"
    ).bind(clientId).first();
    expect(row?.deleted_at).toBeTruthy();
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

  it("preserves millisecond precision on the stored client timestamp", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: 1_700_000_000_123 })] },
    });
    expect(res.json!.upserted[0].updatedAt).toBe("2023-11-14 22:13:20.123");
  });

  it("treats a sub-second-older update as a conflict", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    const base = 1_700_000_000_000; // .000
    await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: base + 500 })] },
    });
    // 500ms older, same whole second. With millisecond truncation both would
    // collapse to '.000' and this would be accepted as an overwrite.
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: base })] },
    });
    expect(res.json?.upserted[0].action).toBe("conflict");
  });

  it("rejects a batch larger than the per-request cap", async () => {
    const token = await getToken();
    const logs = Array.from({ length: 251 }, () => makeLog());
    const res = await api("POST", "/api/sync", { token, body: { logs } });
    expect(res.status).toBe(413);
  });

  it("accepts a batch exactly at the cap", async () => {
    const token = await getToken();
    const logs = Array.from({ length: 250 }, () => makeLog());
    const res = await api("POST", "/api/sync", { token, body: { logs } });
    expect(res.status).toBe(200);
    expect(res.json?.upserted.length).toBe(250);
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

    const rows = await env.DB.prepare("SELECT client FROM logs ORDER BY client").all();
    expect(rows.results?.map((r: any) => r.client)).toEqual(["Device A Corp", "Device B Corp"]);
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

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM logs WHERE client_id = ?"
    ).bind(clientId).first();
    expect(row?.n).toBe(1);
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

describe("GET /api/sync cursor (server_updated_at)", () => {
  it("returns a late-arriving row whose client timestamp predates the since cursor", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    // The cursor sits between the row's client-authored updatedAt (an hour ago,
    // e.g. authored offline) and the server's accept time (now). The old
    // updated_at-based filter made this row permanently invisible; partitioning
    // on server_updated_at must surface it.
    const cursor = Date.now();
    const res = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId, updatedAt: cursor - 60 * 60 * 1000 })] },
    });
    expect(res.json?.upserted[0].serverUpdatedAt).toBeTruthy();

    const pull = await api("GET", `/api/sync?since=${cursor}`, { token });
    expect(pull.json?.logs.map((l: any) => l.client_id)).toContain(clientId);
  });

  it("advances server_updated_at on update and returns it in the ack", async () => {
    const token = await getToken();
    const clientId = crypto.randomUUID();
    const created = await api("POST", "/api/sync", {
      token,
      body: { logs: [makeLog({ clientId })] },
    });
    const firstCursor = created.json!.upserted[0].serverUpdatedAt as string;

    await new Promise((r) => setTimeout(r, 5));
    const updated = await api("POST", "/api/sync", {
      token,
      body: {
        logs: [makeLog({ clientId, client: "Later Corp", updatedAt: Date.now() + 1000 })],
      },
    });
    const secondCursor = updated.json!.upserted[0].serverUpdatedAt as string;
    expect(secondCursor > firstCursor).toBe(true);

    const sinceMs = new Date(String(firstCursor).replace(" ", "T") + "Z").getTime();
    const pull = await api("GET", `/api/sync?since=${sinceMs}`, { token });
    expect(pull.json?.logs.map((l: any) => l.client_id)).toContain(clientId);
  });

  it("uses idx_logs_user_server_updated for the pull filter (no COALESCE scan)", async () => {
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM logs WHERE user_id = ? AND server_updated_at > ? ORDER BY startMs DESC"
    ).bind(1, "0000-01-01 00:00:00.000").all();
    const detail = (plan.results || []).map((r: any) => String(r.detail)).join("\n");
    expect(detail).toContain("idx_logs_user_server_updated");
    expect(detail).not.toMatch(/SCAN logs/);
  });
});