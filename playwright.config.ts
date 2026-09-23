import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite runs against a real dev server backed by the shared
 * valtaris-nucleus-2 Supabase project's `dualpay` schema (see .env),
 * signed in as the ui-preview@valtaris.local account via the same
 * VITE_DEV_AUTO_LOGIN_* mechanism used for local UI preview
 * (src/hooks/use-auth.tsx). VITE_DEMO_MODE=true seeds that account's
 * org with a real 28-claim dataset on first run (see
 * src/data/repository.ts's seedIfEmpty()) so there's real data to
 * click through — this is not mocked or stubbed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // --host overrides vite.config.ts's "::" (IPv6 any) with IPv4 loopback;
    // some sandboxed/CI environments don't support IPv6 listen sockets.
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This sandbox's Playwright browser cache pins an older Chromium
        // revision than @playwright/test 1.63.0 expects; point directly
        // at the pre-installed binary instead of downloading a new one.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
      },
    },
  ],
});
