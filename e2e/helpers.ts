// @ts-nocheck
import { Page } from '@playwright/test';

export const API = 'https://time-tracker.alexs-cas.workers.dev';

export async function openApp(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db);
  await page.waitForFunction(() => typeof backfillClientIds !== 'undefined');
}

export async function waitForSyncStart(page: Page) {
  await page.waitForTimeout(50);
}

export function seedLogs(page: Page, rows: any[]) {
  return page.evaluate(
    (logs) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('TimeTrackerDB');
        req.onsuccess = () => {
          const tx = req.result.transaction(['logs'], 'readwrite');
          const store = tx.objectStore('logs');
          logs.forEach((row) => store.add(row));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    rows
  );
}

export function readLogs(page: Page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('TimeTrackerDB');
        req.onsuccess = () => {
          const all = req.result.transaction(['logs'], 'readonly').objectStore('logs').getAll();
          all.onsuccess = () => resolve(all.result);
        };
      })
  );
}

export function baseLog(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    clientId: overrides.clientId || crypto.randomUUID(),
    client: 'Seed Co',
    startMs: now - 3600_000,
    endMs: now,
    arrivalMs: null,
    startOffset: 0,
    endOffset: 0,
    arrivalOffset: null,
    durationMs: 3600_000,
    notes: 'seeded',
    parts: '',
    billableTime: '1',
    isRemote: false,
    invoiceNumber: '',
    updatedAt: now,
    lastSyncedUpdatedAt: null,
    wasSynced: false,
    ...overrides
  };
}

export type ApiStubs = {
  onSyncPost?: (body: any) => any;
  onSyncGet?: (since: number) => any;
  onLogin?: (body: any) => any;
};

export async function mockApi(page: Page, stubs: ApiStubs = {}) {
  const posts: any[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const json = (body: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/api/auth/login') || url.includes('/api/auth/register')) {
      const body = JSON.parse(request.postData() || '{}');
      return json(stubs.onLogin ? stubs.onLogin(body) : { token: 'tok', userId: 'u1', email: body.email });
    }
    if (url.includes('/api/auth/logout')) return json({ success: true });

    if (url.includes('/api/sync') && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      posts.push(body);
      return json(
        stubs.onSyncPost
          ? stubs.onSyncPost(body)
          : { success: true, upserted: [], errors: [], serverTombstones: [], serverTime: Date.now() }
      );
    }
    if (url.includes('/api/sync')) {
      const since = Number(new URL(url).searchParams.get('since') || 0);
      return json(stubs.onSyncGet ? stubs.onSyncGet(since) : { logs: [], serverTime: Date.now() });
    }
    return json({});
  });
  return posts;
}
