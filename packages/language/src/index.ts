/**
 * `@qforge/language` — the QForge language frontend.
 *
 * Pipeline stages owned by this package:
 *
 *   source text -> tokenize() -> parse() -> analyze() -> SemanticModel
 *
 * The package has no dependencies and no numerical code: it answers only
 * "is this a well-formed QForge program, and what does each name refer to?".
 * Lowering to IR lives in `@qforge/compiler`.
 */
export * from './diagnostics/index.js';
export * from './lexer/index.js';
export * from './ast/index.js';
export * from './parser/index.js';
export * from './semantic/index.js';
export * from './format/index.js';

import { parse } from './parser/parser.js';
import { analyze, type AnalyzeOptions, type SemanticModel } from './semantic/analyzer.js';
import type { Diagnostic } from './diagnostics/diagnostic.js';
import type { Program } from './ast/nodes.js';
import type { Token } from './lexer/token.js';

export interface FrontendResult {
  readonly program: Program;
  readonly tokens: readonly Token[];
  readonly allTokens: readonly Token[];
  readonly semantics: SemanticModel;
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
}

/** Run the whole frontend: tokenize, parse and analyse in one call. */
export function checkSource(source: string, options: AnalyzeOptions = {}): FrontendResult {
  const parsed = parse(source);
  const semantics = analyze(parsed.program, options);
  const diagnostics = [...parsed.diagnostics, ...semantics.diagnostics];
  return {
    program: parsed.program,
    tokens: parsed.tokens,
    allTokens: parsed.allTokens,
    semantics,
    diagnostics,
    ok: !diagnostics.some((d) => d.severity === 'error'),
  };
}
