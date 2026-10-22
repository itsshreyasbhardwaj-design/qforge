/**
 * The QForge gate table: the single source of truth for which gate mnemonics
 * exist and what shape their operands take.
 *
 * This table lives in the language package because arity and parameter count
 * are *static* properties checked by the semantic analyser. The corresponding
 * unitary matrices live in `@qforge/simulator`, which keeps the frontend free
 * of numerical code and lets the simulator be tested on its own.
 */
export interface GateSignature {
  /** Lowercase mnemonic as written in source. */
  readonly name: string;
  /** Number of qubit operands the gate takes. */
  readonly qubits: number;
  /** Number of angle parameters the gate takes. */
  readonly params: number;
  /** Human-readable description, surfaced in editor tooltips. */
  readonly description: string;
  /** True when G·G = I exactly, which the cancellation pass relies on. */
  readonly selfInverse: boolean;
  /** Mnemonic of the exact inverse, when another gate in the table is it. */
  readonly inverseOf?: string;
  /** Equivalent OpenQASM 3 `stdgates.inc` name. */
  readonly qasmName: string;
}

const table: readonly GateSignature[] = [
  {
    name: 'id',
    qubits: 1,
    params: 0,
    selfInverse: true,
    qasmName: 'id',
    description: 'Identity: leaves the qubit unchanged.',
  },
  {
    name: 'h',
    qubits: 1,
    params: 0,
    selfInverse: true,
    qasmName: 'h',
    description: 'Hadamard: maps |0> to (|0>+|1>)/sqrt(2), creating an equal superposition.',
  },
  {
    name: 'x',
    qubits: 1,
    params: 0,
    selfInverse: true,
    qasmName: 'x',
    description: 'Pauli-X: bit flip, exchanges |0> and |1>.',
  },
  {
    name: 'y',
    qubits: 1,
    params: 0,
    selfInverse: true,
    qasmName: 'y',
    description: 'Pauli-Y: bit and phase flip.',
  },
  {
    name: 'z',
    qubits: 1,
    params: 0,
    selfInverse: true,
    qasmName: 'z',
    description: 'Pauli-Z: phase flip, negates the amplitude of |1>.',
  },
  {
    name: 's',
    qubits: 1,
    params: 0,
    selfInverse: false,
    inverseOf: 'sdg',
    qasmName: 's',
    description: 'Phase gate: applies i to |1>. Equals p(pi/2).',
  },
  {
    name: 'sdg',
    qubits: 1,
    params: 0,
    selfInverse: false,
    inverseOf: 's',
    qasmName: 'sdg',
    description: 'Inverse phase gate: applies -i to |1>. Equals p(-pi/2).',
  },
  {
    name: 't',
    qubits: 1,
    params: 0,
    selfInverse: false,
    inverseOf: 'tdg',
    qasmName: 't',
    description: 'T gate: applies exp(i*pi/4) to |1>. Equals p(pi/4).',
  },
  {
    name: 'tdg',
    qubits: 1,
    params: 0,
    selfInverse: false,
    inverseOf: 't',
    qasmName: 'tdg',
    description: 'Inverse T gate. Equals p(-pi/4).',
  },
  {
    name: 'p',
    qubits: 1,
    params: 1,
    selfInverse: false,
    qasmName: 'p',
    description: 'Phase shift: applies exp(i*theta) to |1>.',
  },
  {
    name: 'rx',
    qubits: 1,
    params: 1,
    selfInverse: false,
    qasmName: 'rx',
    description: 'Rotation by theta about the X axis.',
  },
  {
    name: 'ry',
    qubits: 1,
    params: 1,
    selfInverse: false,
    qasmName: 'ry',
    description: 'Rotation by theta about the Y axis.',
  },
  {
    name: 'rz',
    qubits: 1,
    params: 1,
    selfInverse: false,
    qasmName: 'rz',
    description: 'Rotation by theta about the Z axis.',
  },
  {
    name: 'cx',
    qubits: 2,
    params: 0,
    selfInverse: true,
    qasmName: 'cx',
    description: 'Controlled-X: flips the target when the control is |1>.',
  },
  {
    name: 'cz',
    qubits: 2,
    params: 0,
    selfInverse: true,
    qasmName: 'cz',
    description: 'Controlled-Z: applies -1 to |11>. Symmetric in its operands.',
  },
  {
    name: 'swap',
    qubits: 2,
    params: 0,
    selfInverse: true,
    qasmName: 'swap',
    description: 'Exchanges the states of two qubits.',
  },
  {
    name: 'ccx',
    qubits: 3,
    params: 0,
    selfInverse: true,
    qasmName: 'ccx',
    description: 'Toffoli: flips the target when both controls are |1>.',
  },
];

export const GATES: ReadonlyMap<string, GateSignature> = new Map(table.map((g) => [g.name, g]));

/** All gate mnemonics, sorted, for editor completion and docs generation. */
export const GATE_NAMES: readonly string[] = table.map((g) => g.name).sort();

export function lookupGate(name: string): GateSignature | undefined {
  return GATES.get(name);
}

/** Levenshtein distance capped at `max`; used for "did you mean" hints. */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Closest known gate name within edit distance 2, for diagnostics. */
export function suggestGate(name: string): string | undefined {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of GATE_NAMES) {
    const d = editDistance(lower, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

/** Closest match from an arbitrary candidate list, for unknown-identifier hints. */
export function suggestFrom(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}
