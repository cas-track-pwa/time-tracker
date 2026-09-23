import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8788',
    serviceWorkers: 'block',
    acceptDownloads: true
  },
  webServer: {
    command: 'node e2e/static-server.mjs',
    url: 'http://127.0.0.1:8788/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
