// GENERATED FILE - DO NOT EDIT.
// Produced by scripts/generate-studio-examples.mjs from examples/*.qf.
// Run `node scripts/generate-studio-examples.mjs` after changing an example.

export interface StudioExample {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly summary: string;
  readonly source: string;
}

export const EXAMPLES: readonly StudioExample[] = [
  {
    id: "declare",
    file: "declare.qf",
    title: "Declarations",
    summary: "the smallest valid QForge program that reserves resources.",
    source: "// Declarations: the smallest valid QForge program that reserves resources.\n//\n// Concept\n//   A `qubit` declaration reserves one two-level quantum system, initialised to\n//   |0>. A `bit` declaration reserves one classical bit, initialised to 0.\n//   Nothing has been done to them yet, so the state is exactly |00>.\n//\n// Expected quantum behaviour\n//   The state stays |00> with probability 1. Declaring a qubit is not an\n//   operation on it.\n//\n// Mathematical interpretation\n//   Two qubits span a 4-dimensional complex vector space. The state is the\n//   basis vector (1, 0, 0, 0): amplitude 1 on |00>, zero elsewhere.\n//\n// @expect qubits=2 clbits=1 gates=0\n// @expect-state |00>=1.0\n// @expect-outcome 0\n\nqubit alice;\nqubit bob;\n\nbit result;\n",
  },
  {
    id: "pauli-x",
    file: "pauli-x.qf",
    title: "Pauli-X",
    summary: "the quantum NOT gate.",
    source: "// Pauli-X: the quantum NOT gate.\n//\n// Concept\n//   X exchanges |0> and |1>. On a basis state it behaves exactly like a\n//   classical bit flip, which makes it the right place to start: not everything\n//   quantum is probabilistic.\n//\n// Expected quantum behaviour\n//   The qubit ends in |1>, so measurement yields 1 every single time. There is\n//   no randomness here at all.\n//\n// Expected measurement results\n//   `result` is 1 in 100% of shots.\n//\n// Mathematical interpretation\n//   X = [[0, 1], [1, 0]], so X|0> = |1>. The outcome probability is\n//   |<1|X|0>|^2 = 1.\n//\n// @expect qubits=1 clbits=1 gates=1\n// @expect-state |1>=1.0\n// @expect-outcome 1\n\nqubit q;\nbit result;\n\nx q;\n\nmeasure q -> result;\n",
  },
  {
    id: "superposition",
    file: "superposition.qf",
    title: "Hadamard",
    summary: "creating a superposition.",
    source: "// Hadamard: creating a superposition.\n//\n// Concept\n//   H maps |0> to an equal superposition of |0> and |1>. The qubit is not\n//   secretly in one of the two states — it is in both, with equal amplitude,\n//   and that distinction is what `interference.qf` makes observable.\n//\n// Expected quantum behaviour\n//   Amplitudes 1/sqrt(2) on each of |0> and |1>.\n//\n// Expected measurement results\n//   0 and 1 each about 50% of shots. Any individual shot is one or the other.\n//\n// Mathematical interpretation\n//   H = (1/sqrt 2) [[1, 1], [1, -1]], so H|0> = (|0> + |1>)/sqrt(2).\n//   The Born rule gives |1/sqrt(2)|^2 = 1/2 for each outcome.\n//\n//   Note the amplitude is 0.7071, not 0.5. Amplitudes are square roots of\n//   probabilities, and they can be negative or complex — which probabilities\n//   cannot.\n//\n// @expect qubits=1 clbits=1 gates=1\n// @expect-state |0>=0.5\n// @expect-state |1>=0.5\n// @expect-support 0,1\n// @expect-frequency 0=0.5\n// @expect-frequency 1=0.5\n\nqubit q;\nbit result;\n\nh q;\n\nmeasure q -> result;\n",
  },
  {
    id: "interference",
    file: "interference.qf",
    title: "Interference",
    summary: "why amplitudes are more fundamental than probabilities.",
    source: "// Interference: why amplitudes are more fundamental than probabilities.\n//\n// Concept\n//   Apply H, then Z, then H. After the first H the qubit is a 50/50\n//   superposition. If it were merely \"randomly 0 or 1\", the second H would\n//   leave it 50/50 as well. It does not: the result is deterministically |1>.\n//\n//   Z flips the *sign* of the |1> amplitude. The second H then has the two\n//   paths cancel on |0> and reinforce on |1>. A classical coin cannot do this,\n//   because probabilities cannot be negative.\n//\n// Expected quantum behaviour\n//   Deterministic |1>, up to a global phase.\n//\n// Expected measurement results\n//   `result` is 1 in 100% of shots. Compare with `superposition.qf`, which is\n//   the same circuit without the Z.\n//\n// Mathematical interpretation\n//   H Z H = X, since Z = H X H and H is its own inverse. Explicitly:\n//   H|0> = (|0> + |1>)/sqrt 2, then Z gives (|0> - |1>)/sqrt 2, then H gives\n//   |1>. The amplitude of |0> is (1/sqrt2)(1/sqrt2) + (-1/sqrt2)(1/sqrt2) = 0.\n//\n// @expect qubits=1 clbits=1 gates=3\n// @expect-state |1>=1.0\n// @expect-outcome 1\n\nqubit q;\nbit result;\n\nh q;\nz q;\nh q;\n\nmeasure q -> result;\n",
  },
  {
    id: "rotations",
    file: "rotations.qf",
    title: "Rotations",
    summary: "continuous control over a qubit, and angle expressions.",
    source: "// Rotations: continuous control over a qubit, and angle expressions.\n//\n// Concept\n//   Where X is a half-turn about the X axis of the Bloch sphere, rx(theta) is a\n//   turn by any angle. This is how a qubit is tuned to an arbitrary\n//   superposition rather than just an equal one.\n//\n//   `const` lets an angle be named once and reused. Angle expressions are\n//   evaluated at compile time, so the IR contains a plain number: run\n//   `qforge inspect examples/rotations.qf --ir` to see that.\n//\n// Expected quantum behaviour\n//   ry(theta)|0> = cos(theta/2)|0> + sin(theta/2)|1>.\n//   With theta = pi/3: cos(pi/6) = sqrt(3)/2 and sin(pi/6) = 1/2, so the\n//   probability of outcome 1 is exactly 1/4.\n//\n// Expected measurement results\n//   `result` is 1 in about 25% of shots and 0 in about 75%.\n//\n// Mathematical interpretation\n//   The half-angle is not a typo: a rotation by 2*pi returns -I, not I, and a\n//   qubit needs a full 4*pi to come back to itself. That factor of two is why\n//   QForge's optimiser only cancels a rotation at multiples of 4*pi — see\n//   docs/compiler-design.md.\n//\n// @expect qubits=1 clbits=1 gates=1\n// @expect-state |0>=0.75\n// @expect-state |1>=0.25\n// @expect-support 0,1\n// @expect-frequency 1=0.25\n\nconst theta = pi / 3;\n\nqubit q;\nbit result;\n\nry(theta) q;\n\nmeasure q -> result;\n",
  },
  {
    id: "bell",
    file: "bell.qf",
    title: "Bell state",
    summary: "entanglement, and measurement correlation.",
    source: "// Bell state: entanglement, and measurement correlation.\n//\n// Concept\n//   H puts `alice` into superposition; CX then flips `bob` exactly when `alice`\n//   is 1. The result cannot be written as \"alice is in some state and bob is in\n//   some state\" — the two qubits only have a joint description. That is\n//   entanglement.\n//\n// Expected quantum behaviour\n//   (|00> + |11>)/sqrt(2). Each qubit on its own is maximally mixed: its\n//   reduced density matrix is I/2, and its Bloch vector has length 0.\n//\n// Expected measurement results\n//   Only 00 and 11 ever appear, roughly 50% each. 01 and 10 never appear. The\n//   two measurements are perfectly correlated no matter which is performed\n//   first, and no matter how far apart the qubits are.\n//\n// Mathematical interpretation\n//   |00> -> H on qubit 0 -> (|00> + |01>)/sqrt 2 (in |q1 q0> labelling)\n//        -> CX(0 -> 1)   -> (|00> + |11>)/sqrt 2\n//\n//   The state has Schmidt rank 2, which is the formal statement that it does\n//   not factorise.\n//\n// @expect qubits=2 clbits=2 gates=2\n// @expect-state |00>=0.5\n// @expect-state |11>=0.5\n// @expect-support 00,11\n// @expect-frequency 00=0.5\n// @expect-frequency 11=0.5\n\nqubit alice;\nqubit bob;\n\nbit resultA;\nbit resultB;\n\nh alice;\ncx alice, bob;\n\nmeasure alice -> resultA;\nmeasure bob -> resultB;\n",
  },
  {
    id: "ghz",
    file: "ghz.qf",
    title: "GHZ state",
    summary: "three-qubit entanglement.",
    source: "// GHZ state: three-qubit entanglement.\n//\n// Concept\n//   The Bell construction extended: one Hadamard and two controlled-NOTs tie\n//   three qubits into a single state where all three measurement outcomes\n//   always agree.\n//\n// Expected quantum behaviour\n//   (|000> + |111>)/sqrt(2).\n//\n// Expected measurement results\n//   Only 000 and 111, roughly 50% each. Measuring any one qubit instantly\n//   determines the other two.\n//\n// Mathematical interpretation\n//   GHZ entanglement is qualitatively different from the three-party W state:\n//   tracing out any one GHZ qubit leaves the other two *unentangled*, whereas\n//   for W it does not. Both have all three qubits individually maximally mixed,\n//   so single-qubit measurements alone cannot tell them apart.\n//\n// @expect qubits=3 clbits=3 gates=3\n// @expect-state |000>=0.5\n// @expect-state |111>=0.5\n// @expect-support 000,111\n// @expect-frequency 000=0.5\n\nqubit[3] q;\nbit[3] c;\n\nh q[0];\ncx q[0], q[1];\ncx q[0], q[2];\n\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];\nmeasure q[2] -> c[2];\n",
  },
  {
    id: "phase-kickback",
    file: "phase-kickback.qf",
    title: "Phase kickback",
    summary: "the mechanism behind most quantum algorithms.",
    source: "// Phase kickback: the mechanism behind most quantum algorithms.\n//\n// Concept\n//   A controlled gate whose target is already an eigenstate of the controlled\n//   operation does not change the target at all. Instead the eigenvalue is fed\n//   back onto the *control* as a phase, where a Hadamard can turn it into a\n//   measurable bit.\n//\n// Expected quantum behaviour\n//   `q[1]` is prepared in |-> = (|0> - |1>)/sqrt(2), which is an eigenstate of\n//   X with eigenvalue -1. (Note: of X, not of Z - the Z eigenstates are the\n//   boring |0> and |1>.) The controlled-X then multiplies the |1> branch of\n//   `q[0]` by -1 while leaving `q[1]` exactly where it was. The final H on\n//   `q[0]` converts that relative phase into a definite outcome.\n//\n// Expected measurement results\n//   `c` is 1 in 100% of shots, and `q[1]` is still in |-> at the end.\n//\n// Mathematical interpretation\n//   Before the CX the state is |+>|-> = (1/sqrt2)(|0> + |1>) tensor |->.\n//   Since X|-> = -|->, the CX sends this to\n//\n//     (1/sqrt2)(|0>|-> - |1>|->) = |-> tensor |->\n//\n//   which is still a *product* state: the qubits are not entangled, the phase\n//   simply moved to the control. H then maps |-> to |1>.\n//\n//   This is exactly the step that makes Deutsch-Jozsa and phase estimation\n//   work; `deutsch-jozsa.qf` is the same idea with a two-bit oracle.\n//\n// @expect qubits=2 clbits=1 gates=5\n// @expect-outcome 1\n\nqubit[2] q;\nbit c;\n\n// Put the target into the X eigenstate |->, whose eigenvalue is -1.\nx q[1];\nh q[1];\n\nh q[0];\ncx q[0], q[1];\nh q[0];\n\nmeasure q[0] -> c;\n",
  },
  {
    id: "deutsch-jozsa",
    file: "deutsch-jozsa.qf",
    title: "Deutsch-Jozsa",
    summary: "a provable quantum advantage, in one query.",
    source: "// Deutsch-Jozsa: a provable quantum advantage, in one query.\n//\n// Concept\n//   You are given a black-box function f on 2-bit inputs, promised to be either\n//   *constant* (same output for every input) or *balanced* (output 0 for half\n//   the inputs and 1 for the other half). Classically, telling which can take\n//   3 queries in the worst case. This circuit does it with 1.\n//\n//   The oracle here implements the balanced function f(x) = x0 XOR x1, built\n//   from two CNOTs onto the output qubit.\n//\n// Expected quantum behaviour\n//   The output qubit is prepared in |->, so the oracle writes (-1)^f(x) as a\n//   phase onto each input branch instead of changing the output bit. The final\n//   Hadamards turn that phase pattern into a definite bit string.\n//\n// Expected measurement results\n//   The input register reads 11 in 100% of shots. A non-zero result proves f is\n//   balanced. Compare `deutsch-jozsa-constant.qf`, which reads 00 every time.\n//\n// Mathematical interpretation\n//   After the Hadamards and the oracle the input register holds\n//   (1/2) * sum over x of (-1)^f(x) |x>. Applying H to each input qubit gives\n//   amplitude (1/4) * sum over x of (-1)^(f(x) + x.z) on |z>.\n//\n//   For f(x) = x.a with a = 11, the sum is 4 when z = a and 0 otherwise, so the\n//   measurement returns the hidden string a with certainty. For constant f the\n//   same sum concentrates entirely on z = 00.\n//\n//   This is the smallest honest example of interference doing computational\n//   work: every branch is computed, and the wrong answers cancel.\n//\n// @expect qubits=3 clbits=2 gates=8\n// @expect-outcome 11\n\nqubit[3] q;\nbit[2] result;\n\n// q[0], q[1] are the function input; q[2] is the oracle's output qubit.\nx q[2];\nh q[2];\n\nh q[0];\nh q[1];\n\n// Oracle for the balanced function f(x) = x0 XOR x1.\ncx q[0], q[2];\ncx q[1], q[2];\n\nh q[0];\nh q[1];\n\nmeasure q[0] -> result[0];\nmeasure q[1] -> result[1];\n",
  },
  {
    id: "deutsch-jozsa-constant",
    file: "deutsch-jozsa-constant.qf",
    title: "Deutsch-Jozsa with a constant oracle.",
    summary: "Deutsch-Jozsa with a constant oracle.",
    source: "// Deutsch-Jozsa with a constant oracle.\n//\n// Concept\n//   The same circuit as `deutsch-jozsa.qf`, but the oracle implements the\n//   constant function f(x) = 1. Reading 00 proves the function is constant;\n//   reading anything else proves it is balanced. One query decides it.\n//\n// Expected quantum behaviour\n//   A constant f contributes the *same* phase to every input branch, which is a\n//   global phase and therefore unobservable. The input register is returned\n//   exactly to |00> by the final Hadamards.\n//\n// Expected measurement results\n//   `result` is 00 in 100% of shots.\n//\n// Mathematical interpretation\n//   f(x) = 1 for all x, so (-1)^f(x) = -1 uniformly. The input register state\n//   is -1 times the equal superposition, and H on each qubit maps the equal\n//   superposition back to |00>. The leading minus sign is a global phase: it\n//   changes no probability.\n//\n// @expect qubits=3 clbits=2 gates=7\n// @expect-outcome 00\n\nqubit[3] q;\nbit[2] result;\n\nx q[2];\nh q[2];\n\nh q[0];\nh q[1];\n\n// Oracle for the constant function f(x) = 1: flip the output regardless of x.\nx q[2];\n\nh q[0];\nh q[1];\n\nmeasure q[0] -> result[0];\nmeasure q[1] -> result[1];\n",
  },
  {
    id: "mid-circuit-measure",
    file: "mid-circuit-measure.qf",
    title: "Mid-circuit measurement",
    summary: "collapse, and what `reset` really does.",
    source: "// Mid-circuit measurement: collapse, and what `reset` really does.\n//\n// Concept\n//   A measurement is not a passive read. It collapses the state, and everything\n//   after it evolves from the collapsed state. This circuit measures, resets,\n//   and measures again, so the two classical bits are *independent* coin flips\n//   rather than correlated ones.\n//\n//   `reset` is a measurement whose result is discarded, followed by a flip if\n//   the result was 1. It is not a projection onto |0>, and the difference\n//   matters for an entangled qubit.\n//\n// Expected quantum behaviour\n//   After the first H and measure, the qubit is definitely 0 or 1. `reset`\n//   returns it to |0> regardless. The second H then produces a fresh 50/50\n//   superposition that knows nothing about the first outcome.\n//\n// Expected measurement results\n//   All four of 00, 01, 10 and 11 occur, each about 25% of shots. Because this\n//   circuit has a mid-circuit measurement, the simulator replays it once per\n//   shot rather than sampling from a single final statevector - `qforge run`\n//   prints which strategy it used.\n//\n// Mathematical interpretation\n//   The joint distribution factorises as P(c0, c1) = P(c0) * P(c1) with each\n//   marginal uniform, precisely because the reset erased the correlation. Drop\n//   the `reset` and the second measurement would instead agree with the first\n//   every time, since measurement is repeatable.\n//\n// @expect qubits=1 clbits=2 gates=2\n// @expect-support 00,01,10,11\n// @expect-frequency 00=0.25\n// @expect-frequency 11=0.25\n\nqubit q;\nbit[2] c;\n\nh q;\nmeasure q -> c[0];\n\nreset q;\n\nh q;\nmeasure q -> c[1];\n",
  },
  {
    id: "optimisable",
    file: "optimisable.qf",
    title: "A circuit written badly on purpose, to show the optimiser working.",
    summary: "A circuit written badly on purpose, to show the optimiser working.",
    source: "// A circuit written badly on purpose, to show the optimiser working.\n//\n// Concept\n//   Each line here is redundant in a way one of QForge's passes can prove.\n//   Compile it twice and compare:\n//\n//     qforge inspect examples/optimisable.qf --ir\n//     qforge inspect examples/optimisable.qf --optimized\n//\n//   The second prints the pass report explaining every removal.\n//\n// What each pass finds\n//   `h q[0]` twice            -> cancel-self-inverse (H H = I)\n//   `s` then `sdg`            -> cancel-inverse-pair (exact inverses)\n//   `rx(0.3)` then `rx(-0.3)` -> merge-rotations, then remove-identity\n//   `id q[1]`                 -> remove-identity\n//   `rz(4 * pi)`              -> remove-identity (a rotation is I at 4*pi)\n//   `rz(2 * pi)`              -> KEPT: at 2*pi a rotation is -I, not I\n//\n//   The barrier is a fence: the two `x q[1]` gates around it are *not*\n//   cancelled, because a barrier tells the optimiser not to reorder across it.\n//\n// Expected quantum behaviour\n//   The surviving circuit is `rz(2 * pi) q[0]; x q[1]; barrier; x q[1];`,\n//   whose net effect on |00> is to multiply by -1 - a global phase. So the\n//   measured distribution is identical to doing nothing at all.\n//\n// Expected measurement results\n//   `c` is 00 in 100% of shots, optimised or not. That equality is the point:\n//   the passes must not change what the program computes.\n//\n// @expect qubits=2 clbits=2 gates=11\n// @expect-outcome 00\n\nqubit[2] q;\nbit[2] c;\n\nh q[0];\nh q[0];\n\ns q[0];\nsdg q[0];\n\nrx(0.3) q[0];\nrx(-0.3) q[0];\n\nrz(4 * pi) q[0];\nrz(2 * pi) q[0];\n\nid q[1];\n\nx q[1];\nbarrier;\nx q[1];\n\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];\n",
  },
];

export const DEFAULT_EXAMPLE_ID = "bell";
