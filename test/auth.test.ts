import { describe, it, expect } from "vitest";
import { api, getToken, login, registerUser } from "./helpers";

describe("POST /api/auth/register", () => {
  it("registers a new allowed user and returns a token", async () => {
    const res = await registerUser();
    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(typeof res.json?.token).toBe("string");
    expect(res.json?.email).toBe("test@example.com");
  });

  it("rejects emails not in the allowlist", async () => {
    const res = await registerUser("stranger@example.com", "password123");
    expect(res.status).toBe(403);
    expect(res.json?.error).toContain("not authorized");
  });

  it("rejects duplicate emails with 409", async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.json?.error).toBe("User already exists");
  });

  it("rejects missing fields", async () => {
    const res = await api("POST", "/api/auth/register", { body: { email: "test@example.com" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    await registerUser();
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(typeof res.json?.token).toBe("string");
  });

  it("rejects a wrong password", async () => {
    await registerUser();
    const res = await login("test@example.com", "wrong-password");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown user", async () => {
    // user2@example.com is allowlisted but never registered
    const res = await login("user2@example.com", "password123");
    expect(res.status).toBe(401);
  });
});

describe("token gating", () => {
  it("rejects API requests without a token", async () => {
    const res = await api("GET", "/api/logs");
    expect(res.status).toBe(401);
  });

  it("rejects API requests with a bogus token", async () => {
    const res = await api("GET", "/api/logs", { token: "not-a-real-token" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("blocks the token after logout", async () => {
    const token = await getToken();
    const out = await api("POST", "/api/auth/logout", { token });
    expect(out.status).toBe(200);

    const res = await api("GET", "/api/logs", { token });
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/auth/password", () => {
  it("requires authentication", async () => {
    const res = await api("PUT", "/api/auth/password", {
      body: { currentPassword: "password123", newPassword: "newpassword123" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a too-short new password", async () => {
    const token = await getToken();
    const res = await api("PUT", "/api/auth/password", {
      token,
      body: { currentPassword: "password123", newPassword: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an incorrect current password", async () => {
    const token = await getToken();
    const res = await api("PUT", "/api/auth/password", {
      token,
      body: { currentPassword: "nope-nope-nope", newPassword: "newpassword123" },
    });
    expect(res.status).toBe(401);
  });

  it("updates the password and allows login with the new one", async () => {
    const token = await getToken();
    const res = await api("PUT", "/api/auth/password", {
      token,
      body: { currentPassword: "password123", newPassword: "newpassword123" },
    });
    expect(res.status).toBe(200);

    const oldLogin = await login("test@example.com", "password123");
    expect(oldLogin.status).toBe(401);

    const newLogin = await login("test@example.com", "newpassword123");
    expect(newLogin.status).toBe(200);
  });
});