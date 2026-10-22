/**
 * `@qforge/compiler` — the QForge middle end and backends.
 *
 *   SemanticModel -> lower() -> IrModule -> optimize() -> emitOpenQasm3()
 *
 * The package depends on `@qforge/language` for the validated frontend output
 * and the gate table, and on nothing else. It contains no numerical simulation:
 * executing IR is `@qforge/simulator`'s job.
 */
export * from './ir/index.js';
export * from './passes/index.js';
export * from './backends/index.js';

import {
  checkSource,
  type AnalyzeOptions,
  type Diagnostic,
  type FrontendResult,
} from '@qforge/language';
import { lower } from './ir/lower.js';
import type { IrModule } from './ir/ir.js';
import { optimize, type OptimizationReport, type OptimizeOptions } from './passes/manager.js';

export interface CompileOptions extends AnalyzeOptions {
  /** Run the optimisation pipeline. Default false, to keep IR 1:1 with source. */
  readonly optimize?: boolean;
  readonly optimizer?: OptimizeOptions;
}

export interface CompileResult {
  readonly frontend: FrontendResult;
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
  /** The lowered module before any pass ran. Undefined when the frontend failed. */
  readonly unoptimized?: IrModule;
  /** The module to execute: equals `unoptimized` unless `optimize` was set. */
  readonly module?: IrModule;
  readonly report?: OptimizationReport;
}

/**
 * Compile QForge source end to end.
 *
 * Both the unoptimised and the optimised module are returned when optimisation
 * runs, because the studio shows them side by side: that comparison is the
 * point of the compiler inspector, and it is also how the property tests check
 * that the passes preserve the circuit's operator.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const frontend = checkSource(source, options);
  if (!frontend.ok) {
    return { frontend, diagnostics: frontend.diagnostics, ok: false };
  }

  const unoptimized = lower(frontend.semantics);
  if (!options.optimize) {
    return {
      frontend,
      diagnostics: frontend.diagnostics,
      ok: true,
      unoptimized,
      module: unoptimized,
    };
  }

  const { module, report } = optimize(unoptimized, options.optimizer);
  return {
    frontend,
    diagnostics: frontend.diagnostics,
    ok: true,
    unoptimized,
    module,
    report,
  };
}
