import { env } from "cloudflare:workers";
import { SELF, reset } from "cloudflare:test";
import { beforeEach, afterEach } from "vitest";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT,
    client TEXT NOT NULL,
    startMs INTEGER,
    endMs INTEGER,
    arrivalMs INTEGER,
    startOffset INTEGER,
    arrivalOffset INTEGER,
    endOffset INTEGER,
    durationMs INTEGER,
    notes TEXT,
    parts TEXT,
    billableTime TEXT,
    travelDurationMs INTEGER,
    onSiteDurationMs INTEGER,
    startMileage REAL,
    arrivalMileage REAL,
    travelMileage REAL,
    isRemote INTEGER DEFAULT 0,
    invoice_number TEXT DEFAULT NULL,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    server_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_logs_deleted_at ON logs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_logs_user_server_updated ON logs(user_id, server_updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_user_client ON logs(user_id, client_id);
`;

beforeEach(async () => {
  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});

afterEach(async () => {
  await reset();
});

export type ApiResult = {
  status: number;
  json: Record<string, any> | null;
  headers: Headers;
};

export async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; origin?: string } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.origin) headers["Origin"] = options.origin;
  const res = await SELF.fetch(`https://example.com${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  return { status: res.status, json, headers: res.headers };
}

export async function registerUser(
  email = "test@example.com",
  password = "password123"
): Promise<ApiResult> {
  return api("POST", "/api/auth/register", { body: { email, password } });
}

export async function login(
  email = "test@example.com",
  password = "password123"
): Promise<ApiResult> {
  return api("POST", "/api/auth/login", { body: { email, password } });
}

export async function getToken(email = "test@example.com", password = "password123"): Promise<string> {
  const res = await registerUser(email, password);
  if (res.status !== 200 || !res.json?.token) {
    throw new Error(`Failed to register ${email}: ${JSON.stringify(res.json)}`);
  }
  return res.json.token as string;
}

export function makeLog(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    clientId: crypto.randomUUID(),
    client: "Acme Corp",
    startMs: now - 3600_000,
    endMs: now,
    arrivalMs: null,
    startOffset: 0,
    arrivalOffset: null,
    endOffset: 0,
    durationMs: 3600_000,
    notes: "Worked on the widget.",
    parts: "",
    billableTime: "1",
    travelDurationMs: null,
    onSiteDurationMs: null,
    startMileage: null,
    arrivalMileage: null,
    travelMileage: null,
    isRemote: false,
    invoiceNumber: "",
    updatedAt: now,
    ...overrides,
  };
}