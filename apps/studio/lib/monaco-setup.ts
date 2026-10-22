'use client';

import * as monaco from 'monaco-editor/editor/editor.api';
import { loader } from '@monaco-editor/react';

/**
 * Bundle Monaco locally instead of loading it from a CDN.
 *
 * `@monaco-editor/react` defaults to fetching Monaco from jsDelivr at runtime.
 * That is wrong for this project twice over: the studio claims to run entirely
 * on the user's machine with no network dependency, and a blocked or slow CDN
 * leaves the editor stuck on its loading message with no error to diagnose.
 *
 * The specifier is `monaco-editor/editor/editor.api`, not the `esm/vs/...` path
 * it lives at on disk: the package's `exports` map rewrites `monaco-editor/x`
 * to `./esm/vs/x.js`, so spelling out `esm/vs` would resolve to a path that does
 * not exist.
 *
 * Importing `editor.api` rather than the whole `monaco-editor` package brings in
 * the editor core without any of the bundled language services. QForge registers
 * its own Monarch grammar, so TypeScript, JSON, CSS and HTML support would be
 * dead weight.
 *
 * The worker is still needed for Monaco's own editor services (word
 * navigation, basic completions), and is loaded from the bundle through
 * `new Worker(new URL(...))`, which the bundler rewrites to a local asset.
 */
if (typeof window !== 'undefined') {
  (self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(): Worker {
      return new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
        type: 'module',
      });
    },
  };
  loader.config({ monaco });
  // Monaco conventionally publishes itself as `window.monaco`, which the CDN
  // loader does automatically and the bundled path does not. Keeping that
  // convention means the editor stays scriptable from devtools and from the
  // browser tests, which drive the real editor rather than a stand-in.
  const globals = window as unknown as { monaco?: typeof monaco };
  globals.monaco ??= monaco;
}

export { monaco };
