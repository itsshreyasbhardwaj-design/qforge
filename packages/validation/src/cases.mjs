/**
 * The circuits the Qiskit comparison runs.
 *
 * Grouped by what each one would catch if it failed, rather than by gate, so a
 * failure points at a cause rather than just a symptom.
 */
export const UNITARY_CASES = [
  // --- individual gates, to isolate a wrong matrix ---
  ['gate/id', 'qubit q; id q;'],
  ['gate/h', 'qubit q; h q;'],
  ['gate/x', 'qubit q; x q;'],
  ['gate/y', 'qubit q; y q;'],
  ['gate/z-after-x', 'qubit q; x q; z q;'],
  ['gate/s', 'qubit q; h q; s q;'],
  ['gate/sdg', 'qubit q; h q; sdg q;'],
  ['gate/t', 'qubit q; h q; t q;'],
  ['gate/tdg', 'qubit q; h q; tdg q;'],
  ['gate/p', 'qubit q; h q; p(pi / 7) q;'],

  // --- rotations at angles that expose sign and half-angle errors ---
  ['rotation/rx-pi-3', 'qubit q; rx(pi / 3) q;'],
  ['rotation/ry-2pi-5', 'qubit q; ry(2 * pi / 5) q;'],
  ['rotation/rz-after-h', 'qubit q; h q; rz(pi / 7) q;'],
  ['rotation/rx-negative', 'qubit q; rx(-pi / 4) q;'],
  ['rotation/rx-beyond-2pi', 'qubit q; rx(7 * pi / 3) q;'],
  ['rotation/rx-2pi-is-minus-identity', 'qubit q; h q; rx(2 * pi) q;'],
  ['rotation/rx-4pi-is-identity', 'qubit q; h q; rx(4 * pi) q;'],

  // --- bit order, which a symmetric circuit cannot test ---
  ['order/x-on-qubit-0-of-3', 'qubit[3] q; x q[0];'],
  ['order/x-on-qubit-2-of-3', 'qubit[3] q; x q[2];'],
  ['order/cx-0-to-1', 'qubit[2] q; x q[0]; cx q[0], q[1];'],
  ['order/cx-1-to-0', 'qubit[2] q; x q[0]; cx q[1], q[0];'],
  ['order/ccx-target-middle', 'qubit[3] q; x q[0]; x q[2]; ccx q[0], q[2], q[1];'],

  // --- multi-qubit operations ---
  ['multi/cz', 'qubit[2] q; h q[0]; h q[1]; cz q[0], q[1];'],
  ['multi/swap', 'qubit[3] q; x q[0]; swap q[0], q[2];'],
  ['multi/toffoli', 'qubit[3] q; x q[0]; x q[1]; ccx q[0], q[1], q[2];'],

  // --- entanglement ---
  ['entangle/bell', 'qubit[2] q; h q[0]; cx q[0], q[1];'],
  ['entangle/ghz-3', 'qubit[3] q; h q[0]; cx q[0], q[1]; cx q[0], q[2];'],
  ['entangle/ghz-4', 'qubit[4] q; h q[0]; cx q[0], q[1]; cx q[0], q[2]; cx q[0], q[3];'],

  // --- phase sensitivity: these are the ones a probability-only check misses ---
  ['phase/h-z-h-is-x', 'qubit q; h q; z q; h q;'],
  ['phase/kickback', 'qubit[2] q; x q[1]; h q[1]; h q[0]; cx q[0], q[1]; h q[0];'],
  [
    'phase/deutsch-jozsa-balanced',
    'qubit[3] q; x q[2]; h q[2]; h q[0]; h q[1]; cx q[0], q[2]; cx q[1], q[2]; h q[0]; h q[1];',
  ],

  // --- a wide mixture, to catch anything compositional ---
  [
    'mixed/five-qubit',
    `qubit[5] q;
     h q[0]; rx(0.4) q[1]; h q[2]; ry(-1.1) q[3]; rz(2.2) q[4];
     cx q[0], q[3]; cz q[2], q[4]; swap q[1], q[4];
     ccx q[0], q[1], q[2]; p(0.9) q[3]; cx q[4], q[0];`,
  ],
  ['mixed/deep-single-qubit', 'qubit q; h q; s q; t q; h q; tdg q; sdg q; z q; y q; x q;'],
];

/** Circuits with terminal measurement, compared as exact distributions. */
export const DISTRIBUTION_CASES = [
  [
    'dist/bell',
    'qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; measure q[0] -> c[0]; measure q[1] -> c[1];',
  ],
  [
    'dist/ghz-3',
    'qubit[3] q; bit[3] c; h q[0]; cx q[0], q[1]; cx q[0], q[2]; measure q[0] -> c[0]; measure q[1] -> c[1]; measure q[2] -> c[2];',
  ],
  ['dist/biased-rotation', 'qubit q; bit c; ry(pi / 3) q; measure q -> c;'],
  ['dist/interference', 'qubit q; bit c; h q; z q; h q; measure q -> c;'],
  [
    'dist/anticorrelated',
    'qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; x q[1]; measure q[0] -> c[0]; measure q[1] -> c[1];',
  ],
];

/**
 * Circuits whose evolution depends on sampled outcomes. Compared by sampling
 * many shots on both sides, since neither has a closed-form distribution the
 * other can be checked against instruction by instruction.
 */
export const STOCHASTIC_CASES = [
  [
    'stochastic/reset-after-h',
    'qubit q; bit[2] c; h q; measure q -> c[0]; reset q; h q; measure q -> c[1];',
  ],
  [
    'stochastic/entangled-reset',
    'qubit[2] q; bit[2] c; h q[0]; cx q[0], q[1]; reset q[0]; measure q[0] -> c[0]; measure q[1] -> c[1];',
  ],
  [
    'stochastic/teleportation',
    `qubit msg; qubit alice; qubit bob; bit m0; bit m1;
     ry(2 * pi / 5) msg; h alice; cx alice, bob;
     cx msg, alice; h msg;
     measure msg -> m0; measure alice -> m1;
     if (m1 == 1) x bob; if (m0 == 1) z bob;`,
  ],
  [
    'stochastic/conditional-x',
    'qubit[2] q; bit c; h q[0]; measure q[0] -> c; if (c == 1) x q[1];',
  ],
];
