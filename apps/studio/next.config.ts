import type { NextConfig } from 'next';

const config: NextConfig = {
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
