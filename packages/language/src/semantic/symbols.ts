import type { SourceSpan } from '../diagnostics/span.js';

export type SymbolKind = 'qubit' | 'bit' | 'const';

/**
 * One declared name.
 *
 * Qubits and classical bits are assigned contiguous *global indices* in
 * declaration order, with registers occupying `size` consecutive slots. Those
 * indices are the only names the IR, the simulator and the OpenQASM backend
 * use, which is what decouples them from QForge syntax.
 */
export interface SymbolEntry {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly declSpan: SourceSpan;
  /** First global index for a qubit/bit declaration; undefined for constants. */
  readonly baseIndex?: number;
  /** Number of slots: 1 for a scalar, n for `qubit[n]`. Undefined for constants. */
  readonly size?: number;
  /** True when declared as `name[n]`, so `name` alone is not a single operand. */
  readonly isRegister?: boolean;
  /** Evaluated value, for constants only. */
  readonly value?: number;
}

/**
 * Flat single-scope symbol table.
 *
 * QForge has exactly one scope: the program. There are no blocks, functions or
 * shadowing in v0.1, so a single map is the whole implementation. Nested scopes
 * become necessary only when custom gate definitions land (see docs/limitations.md).
 */
export class SymbolTable {
  private readonly entries = new Map<string, SymbolEntry>();

  declare(entry: SymbolEntry): void {
    this.entries.set(entry.name, entry);
  }

  lookup(name: string): SymbolEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  all(): SymbolEntry[] {
    return [...this.entries.values()];
  }

  ofKind(kind: SymbolKind): SymbolEntry[] {
    return this.all().filter((e) => e.kind === kind);
  }

  /** Constant lookup in the shape `evaluateConstExpression` expects. */
  constScope(): { get: (name: string) => number | undefined } {
    return {
      get: (name) => {
        const entry = this.entries.get(name);
        return entry?.kind === 'const' ? entry.value : undefined;
      },
    };
  }
}
