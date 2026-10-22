import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Tests run against package *sources* (not dist) so `pnpm test` never needs a
 * prior build. The published entry points are exercised separately by the
 * `tests/integration/cli.test.ts` suite, which shells out to the built CLI.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@qforge/language': pkg('language'),
      '@qforge/compiler': pkg('compiler'),
      '@qforge/simulator': pkg('simulator'),
      '@qforge/testing': fileURLToPath(new URL('./tests/helpers/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/cli/src/bin.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});
