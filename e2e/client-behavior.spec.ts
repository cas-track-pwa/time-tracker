// @ts-nocheck
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp, seedLogs, readLogs, baseLog, mockApi } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

test('backfills clientId on legacy rows that lack one', async ({ page }) => {
  await openApp(page);
  // Simulate a row created before the cross-device identity existed.
  await seedLogs(page, [{ client: 'Legacy Co', startMs: Date.now() - 1000, endMs: Date.now(), updatedAt: Date.now(), lastSyncedUpdatedAt: null }]);
  await page.reload();
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('TimeTrackerDB');
        req.onsuccess = () => {
          const all = req.result.transaction(['logs'], 'readonly').objectStore('logs').getAll();
          all.onsuccess = () => resolve(!!(all.result[0] && all.result[0].clientId));
        };
      })
  );
  const logs = await readLogs(page);
  expect(logs[0].clientId).toMatch(/^[0-9a-f-]{36}$/);
});

test('purges local logs when a different account signs in', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('activeUserId', 'user-a');
    localStorage.setItem('userEmail', 'a@example.com');
  });
  const posts = await mockApi(page, {
    onLogin: () => ({ token: 'tok-b', userId: 'user-b', email: 'b@example.com' })
  });
  await openApp(page);
  await seedLogs(page, [baseLog({ clientId: 'a-log-1', client: 'A Co' })]);

  await page.evaluate(() => showAuthModal());
  await page.fill('#authEmail', 'b@example.com');
  await page.fill('#authPassword', 'password123');
  await page.click('#authBtn');

  await expect.poll(async () => (await readLogs(page)).length).toBe(0);
  expect(posts.every((p) => (p.logs || []).every((l) => l.clientId !== 'a-log-1'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('activeUserId'))).toBe('user-b');
});

test('hard-deletes a local row when the server reports it tombstoned', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('userId', 'u1');
    localStorage.setItem('activeUserId', 'u1');
    localStorage.setItem('syncProtocolVersion', '2');
  });
  await mockApi(page, {
    onSyncGet: () => ({
      logs: [
        {
          client_id: 'gone-1',
          client: 'Dead Co',
          startMs: 1,
          endMs: 2,
          isRemote: 0,
          updated_at: '2026-09-23 00:00:00.000',
          server_updated_at: '2026-09-23 00:00:00.000',
          deleted_at: '2026-09-23 00:00:00.000'
        }
      ],
      serverTime: Date.now()
    })
  });
  await openApp(page);
  await seedLogs(page, [baseLog({ clientId: 'gone-1', client: 'Dead Co', updatedAt: 123, lastSyncedUpdatedAt: 123, wasSynced: true })]);

  await page.evaluate(() => performSync());
  await expect.poll(async () => (await readLogs(page)).filter((l) => l.clientId === 'gone-1').length).toBe(0);
});

test('hard-deletes never-synced rows but tombstones synced rows', async ({ page }) => {
  await mockApi(page);
  await openApp(page);
  await seedLogs(page, [
    baseLog({ clientId: 'unsynced-1', client: 'New Co', wasSynced: false }),
    baseLog({ clientId: 'synced-1', client: 'Old Co', lastSyncedUpdatedAt: Date.now(), wasSynced: true })
  ]);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.log-card').length === 2);
  // The app auto-opens the auth modal for unauthenticated users; dismiss it so
  // the delete-confirm buttons are not covered.
  await page.evaluate(() => hideAuthModal());

  const ids = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('TimeTrackerDB');
        req.onsuccess = () => {
          const all = req.result.transaction(['logs'], 'readonly').objectStore('logs').getAll();
          all.onsuccess = () => resolve(Object.fromEntries(all.result.map((l) => [l.client, l.id])));
        };
      })
  );

  await page.evaluate((id) => deleteLog(id), ids['New Co']);
  await page.click('#btnConfirmDelete');
  await page.evaluate((id) => deleteLog(id), ids['Old Co']);
  await page.click('#btnConfirmDelete');

  await expect.poll(async () => (await readLogs(page)).length).toBe(1);
  const remaining = await readLogs(page);
  expect(remaining[0].client).toBe('Old Co');
  expect(remaining[0]._deleted).toBe(true);
});

test('exports Client ID and reuses it on import, then syncs', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('userId', 'u1');
    localStorage.setItem('activeUserId', 'u1');
    localStorage.setItem('syncProtocolVersion', '2');
  });
  const posts = await mockApi(page, {
    onSyncPost: (body) => ({
      success: true,
      upserted: (body.logs || []).map((l) => ({
        clientId: l.clientId,
        action: 'created',
        updatedAt: '2026-09-15 18:00:00.123'
      })),
      errors: [],
      serverTombstones: [],
      serverTime: Date.now()
    })
  });
  await openApp(page);
  await seedLogs(page, [baseLog({ clientId: 'csv-export-1', client: 'Export Co', updatedAt: Date.now() })]);

  await page.click('#btnCsv');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnCsvExport')]);
  const csvPath = await download.path();
  const csv = readFileSync(csvPath, 'utf8');
  expect(csv.split(/\r?\n/)[0]).toContain('Client ID');
  expect(csv).toContain('csv-export-1');

  const headers = 'ID,Client,Start Time,Arrival Time,End Time,Total Duration,Travel Duration,On-Site Duration,Decimal Hours,Billable Time,Start Mileage,Arrival Mileage,Travel Miles,Remote,Notes,Parts Used,Start ISO,End ISO,Arrival ISO,Invoice Number,Updated At,Client ID';
  const row = '1,CSV Co,,,,01:00:00,,,1,1,,,,false,notes,,2026-09-15T09:00:00.000-04:00,2026-09-15T10:00:00.000-04:00,,INV-1,2026-09-15T14:00:00.000Z,csv-import-1';
  const dir = mkdtempSync(join(tmpdir(), 'tt-csv-'));
  const importPath = join(dir, 'import.csv');
  writeFileSync(importPath, headers + '\r\n' + row + '\r\n');

  await page.setInputFiles('#btnImportCsv', importPath);
  await expect.poll(async () => (await readLogs(page)).some((l) => l.clientId === 'csv-import-1')).toBe(true);
  await expect.poll(() => posts.some((p) => (p.logs || []).some((l) => l.clientId === 'csv-import-1'))).toBe(true);
});

test('chunks large pushes to the server batch cap', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('userId', 'u1');
    localStorage.setItem('activeUserId', 'u1');
    localStorage.setItem('syncProtocolVersion', '2');
  });
  const posts = await mockApi(page);
  await openApp(page);
  await seedLogs(
    page,
    Array.from({ length: 300 }, (_, i) => baseLog({ clientId: `bulk-${i}`, client: `Bulk ${i}`, updatedAt: Date.now() + i }))
  );

  await page.evaluate(() => syncToCloud());
  const sizes = posts.map((p) => (p.logs || []).length).sort((a, b) => a - b);
  expect(sizes).toEqual([50, 250]);
});

test('collapses a burst of writes into a single push', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'tok');
    localStorage.setItem('userId', 'u1');
    localStorage.setItem('activeUserId', 'u1');
    localStorage.setItem('syncProtocolVersion', '2');
  });
  const posts = await mockApi(page);
  await openApp(page);
  await page.waitForTimeout(150);
  await seedLogs(page, [baseLog({ clientId: 'debounce-1' })]);

  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) syncAfterWrite();
  });
  await page.waitForTimeout(1600);
  expect(posts.filter((p) => (p.logs || []).some((l) => l.clientId === 'debounce-1')).length).toBe(1);
});
