/**
 * Compute QForge's own answer for every validation case and serialise it,
 * together with enough structure for the Python side to rebuild the same
 * circuit in Qiskit.
 */
import { CLI_LIMITS } from '@qforge/language';
import { compile, emitOpenQasm3, optimize } from '@qforge/compiler';
import {
  Statevector,
  applyInstruction,
  exactRegisterDistribution,
  executeCircuit,
} from '@qforge/simulator';
import { DISTRIBUTION_CASES, STOCHASTIC_CASES, UNITARY_CASES } from './cases.mjs';

/** Compile, failing loudly rather than silently skipping a case. */
function build(source, optimise = false) {
  const result = compile(source, { optimize: optimise, limits: CLI_LIMITS });
  if (!result.ok || !result.module) {
    throw new Error(
      `case failed to compile: ${result.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`,
    );
  }
  return result;
}

/** Serialise an IR module in a form the Python side can rebuild. */
function instructions(module) {
  return module.instructions.map((i) => ({
    opcode: i.opcode,
    qubits: [...i.qubits],
    params: [...i.params],
    ...(i.clbit !== undefined ? { clbit: i.clbit } : {}),
    ...(i.condition
      ? {
          condition: {
            clbits: [...i.condition.clbits],
            value: i.condition.value,
            negate: i.condition.negate,
          },
        }
      : {}),
  }));
}

function statevectorOf(module) {
  const state = Statevector.zeroState(module.qubitCount);
  for (const instruction of module.instructions) applyInstruction(state, instruction);
  return { re: Array.from(state.re), im: Array.from(state.im) };
}

const SHOTS = 200_000;
const SEED = 20261022;

export function exportCases() {
  const payload = { unitary: [], distribution: [], stochastic: [] };

  for (const [name, source] of UNITARY_CASES) {
    const plain = build(source).module;
    const tuned = optimize(plain).module;
    payload.unitary.push({
      name,
      source,
      qubitCount: plain.qubitCount,
      instructions: instructions(plain),
      // The optimised module is sent too: Qiskit then checks *both* against
      // the same reference, which validates the passes against an outside
      // implementation rather than only against QForge's own simulator.
      optimizedInstructions: instructions(tuned),
      statevector: statevectorOf(plain),
      optimizedStatevector: statevectorOf(tuned),
      qasm: emitOpenQasm3(plain).code,
    });
  }

  for (const [name, source] of DISTRIBUTION_CASES) {
    const module = build(source).module;
    payload.distribution.push({
      name,
      source,
      qubitCount: module.qubitCount,
      clbitCount: module.clbitCount,
      instructions: instructions(module),
      // Exact, not sampled: no Monte Carlo error on the QForge side.
      exact: Object.fromEntries(exactRegisterDistribution(module)),
      qasm: emitOpenQasm3(module).code,
    });
  }

  for (const [name, source] of STOCHASTIC_CASES) {
    const module = build(source).module;
    const result = executeCircuit(module, { shots: SHOTS, seed: SEED });
    payload.stochastic.push({
      name,
      source,
      qubitCount: module.qubitCount,
      clbitCount: module.clbitCount,
      instructions: instructions(module),
      shots: SHOTS,
      counts: Object.fromEntries(result.counts),
      strategy: result.strategy,
      qasm: emitOpenQasm3(module).code,
    });
  }

  return payload;
}
