import { describe, it, expect } from "vitest";
import { api, getToken, makeLog } from "./helpers";

describe("GET/POST /api/logs", () => {
  it("creates a log and lists it for the owner", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });
    expect(created.status).toBe(200);
    expect(created.json?.success).toBe(true);
    expect(created.json?.id).toBeGreaterThan(0);
    expect(created.json?.updatedAt).toBeTruthy();

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.json)).toBe(true);
    expect(listed.json!.length).toBe(1);
    expect(listed.json![0].client).toBe("Acme Corp");
  });

  it("scopes logs to the owning user", async () => {
    const tokenA = await getToken("user2@example.com");
    const tokenB = await getToken("test@example.com");

    await api("POST", "/api/logs", { token: tokenA, body: makeLog() });

    const listedB = await api("GET", "/api/logs", { token: tokenB });
    expect(listedB.json!.length).toBe(0);
  });

  it("returns 401 when creating without a token", async () => {
    const res = await api("POST", "/api/logs", { body: makeLog() });
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/logs/:id", () => {
  it("updates a log owned by the user", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });
    const id = created.json!.id;

    const updated = await api("PUT", `/api/logs/${id}`, {
      token,
      body: { ...makeLog(), client: "Renamed Corp", updatedAt: Date.now() },
    });
    expect(updated.status).toBe(200);

    const listed = await api("GET", `/api/logs/${id}`, { token });
    expect(listed.json!.client).toBe("Renamed Corp");
  });

  it("returns 409 when the client timestamp is older than the server's", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });
    const id = created.json!.id;

    const stale = await api("PUT", `/api/logs/${id}`, {
      token,
      body: { ...makeLog(), client: "Stale", updatedAt: 1_000_000 },
    });
    expect(stale.status).toBe(409);
    expect(stale.json?.conflict).toBe(true);
  });

  it("returns 404 for a log owned by another user", async () => {
    const tokenA = await getToken("user2@example.com");
    const tokenB = await getToken("test@example.com");
    const created = await api("POST", "/api/logs", { token: tokenA, body: makeLog() });

    const res = await api("PUT", `/api/logs/${created.json!.id}`, {
      token: tokenB,
      body: { ...makeLog(), updatedAt: Date.now() },
    });
    expect(res.status).toBe(404);
  });
});

describe("soft delete", () => {
  it("returns 409 when updating a tombstoned row (deleted_at set)", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });
    const id = created.json!.id;

    const del = await api("DELETE", `/api/logs/${id}`, { token });
    expect(del.status).toBe(200);

    const res = await api("PUT", `/api/logs/${id}`, {
      token,
      body: { ...makeLog(), client: "Zombie", updatedAt: Date.now() },
    });
    expect(res.status).toBe(409);
    expect(res.json?.error).toBe("Log has been deleted");
  });

  it("excludes soft-deleted rows from GET /api/logs", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });

    await api("DELETE", `/api/logs/${created.json!.id}`, { token });

    const listed = await api("GET", "/api/logs", { token });
    expect(listed.json!.length).toBe(0);
  });

  it("returns 404 when fetching a tombstoned row by id", async () => {
    const token = await getToken();
    const created = await api("POST", "/api/logs", { token, body: makeLog() });
    const id = created.json!.id;

    await api("DELETE", `/api/logs/${id}`, { token });

    const res = await api("GET", `/api/logs/${id}`, { token });
    expect(res.status).toBe(404);
  });
});