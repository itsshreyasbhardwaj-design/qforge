import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for QForge Studio.
 *
 * The suite runs against the production build rather than the dev server, so
 * what CI checks is what a visitor would actually load: a static export with no
 * server component, no API route and no network dependency.
 *
 * `pnpm build` must run first, since the studio imports the workspace packages
 * from their `dist` output.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:3147',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1680, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    /*
     * Firefox and WebKit are opt-in rather than default.
     *
     * They need their own browser downloads, which would make a first
     * `pnpm test:e2e` on a clean machine fetch several hundred megabytes before
     * running anything, and they roughly double CI time for a studio whose
     * engine is plain TypeScript running in a worker. Run them deliberately:
     *
     *   npx playwright install firefox webkit
     *   CROSS_BROWSER=1 npx playwright test --project=firefox --project=webkit
     */
    ...(process.env.CROSS_BROWSER === '1'
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'], viewport: { width: 1680, height: 1000 } },
          },
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'], viewport: { width: 1680, height: 1000 } },
          },
        ]
      : []),
  ],
  webServer: {
    // `next build` with `output: 'export'` writes a static site to `out/`.
    command: 'pnpm --filter @qforge/studio build && npx --yes serve apps/studio/out -l 3147',
    url: 'http://127.0.0.1:3147',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
