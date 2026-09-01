import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("CORS headers", () => {
  it("echoes the request origin when no ALLOWED_ORIGIN is set", async () => {
    const res = await api("GET", "/api/auth/login", { origin: "https://app.example.com" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("allows all origins when no origin header is present", async () => {
    const res = await api("GET", "/api/auth/login");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("responds to OPTIONS preflight with CORS methods", async () => {
    const res = await api("OPTIONS", "/api/logs", { origin: "https://app.example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});