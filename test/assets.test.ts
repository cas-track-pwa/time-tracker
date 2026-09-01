import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("static assets", () => {
  it("serves the app shell and static files via the assets binding", async () => {
    const index = await SELF.fetch("https://example.com/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    const indexText = await index.text();
    expect(indexText).toContain("Time Tracker");

    const js = await SELF.fetch("https://example.com/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  it("does not long-cache sw.js", async () => {
    const sw = await SELF.fetch("https://example.com/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("cache-control")).toBe("no-cache");
  });
});