import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Three environments with genuinely different globals: library and test code
 * runs under Node with ES modules, the `scripts/` helpers are Node scripts, and
 * the studio runs in a browser. Rather than loosen `no-undef` everywhere, each
 * gets the globals it actually has.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      // The studio's static export: thousands of bundled vendor files.
      'apps/studio/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
      // Produced by scripts/generate-studio-examples.mjs.
      'apps/studio/lib/examples.generated.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },

  {
    files: ['apps/studio/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  {
    // Playwright specs and the studio benchmark run in Node but evaluate code
    // inside the page, so they legitimately reference browser globals.
    files: ['tests/e2e/**/*.ts', 'scripts/benchmark-studio.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
  },
);
