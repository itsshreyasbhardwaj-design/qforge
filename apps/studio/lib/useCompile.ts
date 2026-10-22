'use client';

import { useEffect, useMemo, useState } from 'react';
import { BROWSER_LIMITS, type Diagnostic } from '@qforge/language';
import { compile, type CompileResult } from '@qforge/compiler';

export interface CompileState {
  readonly result: CompileResult | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
  /** True while the debounce window is open after a keystroke. */
  readonly pending: boolean;
  /** Thrown message, if compilation itself failed unexpectedly. */
  readonly crash: string | undefined;
}

/**
 * Compile `source` in the browser, debounced.
 *
 * Debouncing matters because this runs on the main thread: at 10,000 gates the
 * frontend takes around 30 ms on an M2 (see docs/benchmarks.md), which is fine
 * once but not on every keystroke. 160 ms is short enough to feel immediate and
 * long enough to coalesce typing.
 *
 * A Web Worker would remove the main-thread cost entirely and is the right next
 * step if the limits are ever raised; at the browser's 14-qubit ceiling it is
 * not yet worth the message-passing complexity.
 */
export function useCompile(source: string, optimize: boolean, delayMs = 160): CompileState {
  const [debounced, setDebounced] = useState(source);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(source), delayMs);
    return () => clearTimeout(timer);
  }, [source, delayMs]);

  // Compile synchronously once the debounced value settles. `useMemo` keeps the
  // result stable so downstream panels do not re-render on unrelated state.
  return useMemo<CompileState>(() => {
    try {
      const result = compile(debounced, { optimize, limits: BROWSER_LIMITS });
      return {
        result,
        diagnostics: result.diagnostics,
        ok: result.ok,
        pending: debounced !== source,
        crash: undefined,
      };
    } catch (error) {
      // A compiler crash is a bug; surface it rather than showing a blank panel.
      return {
        result: undefined,
        diagnostics: [],
        ok: false,
        pending: false,
        crash: error instanceof Error ? error.message : String(error),
      };
    }
  }, [debounced, optimize, source]);
}
