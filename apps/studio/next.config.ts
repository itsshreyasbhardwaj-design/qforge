import type { NextConfig } from 'next';

/*
 * Where the site will be served from.
 *
 * Empty by default, which is what local development, the Playwright suite and
 * any root-hosted deployment need. GitHub Pages serves a project repository
 * under `/<repo>/`, so its workflow sets QFORGE_BASE_PATH=/qforge and every
 * asset URL, route and bundler-rewritten worker URL picks the prefix up from
 * here rather than from a hardcoded string somewhere in the components.
 */
const basePath = process.env.QFORGE_BASE_PATH ?? '';

const config: NextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  reactStrictMode: true,
  // The QForge packages are workspace ESM builds; Next needs to transpile them
  // rather than treat them as prebuilt external CommonJS. Run `pnpm build` at
  // the repo root before building the studio so their `dist` output exists.
  transpilePackages: ['@qforge/language', '@qforge/compiler', '@qforge/simulator'],
  // The studio is a static client-side app: everything it does -- lexing,
  // parsing, optimisation, simulation -- runs in the user's browser. There is
  // no server component, no API route and no telemetry, so a user's quantum
  // program never leaves their machine.
  output: 'export',
  images: { unoptimized: true },
  // Type errors must fail the build: a studio that compiles with broken types
  // would be the one part of this project not held to the same standard.
  typescript: { ignoreBuildErrors: false },
};

export default config;
