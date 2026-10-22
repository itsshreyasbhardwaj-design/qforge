#!/usr/bin/env node
/**
 * Validate the QForge simulator against NumPy.
 *
 * ## Why a third reference
 *
 * The test suite already compares the fast statevector kernels against an
 * independently written dense-matrix oracle (`packages/simulator/src/reference`).
 * Both live in this repository and were written by the same author, so a shared
 * misunderstanding - a wrong sign in the Y matrix, say, or an inverted bit order -
 * would be invisible to that comparison.
 *
 * This script closes that gap with a reference *outside* the project: it emits
 * each circuit as a plain gate list, builds the operators from scratch with
 * NumPy's own Kronecker product, and compares amplitudes. If QForge and NumPy
 * agree on the Bell state, the bit-order convention and every gate matrix are
 * corroborated by code that shares nothing with QForge at all.
 *
 * NumPy is used because it is already installed and costs nothing. It is a
 * *development* check, not a dependency: `pnpm test` does not need it, and the
 * script exits 0 with a clear notice when Python or NumPy is unavailable.
 *
 * Usage:  pnpm verify:numpy
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url);

const CIRCUITS = [
  ['x on one qubit', 'qubit q; x q;'],
  ['hadamard', 'qubit q; h q;'],
  ['y gate (checks the imaginary signs)', 'qubit q; y q;'],
  ['z after x', 'qubit q; x q; z q;'],
  ['s and t phases', 'qubit q; h q; s q; t q;'],
  ['inverse phases', 'qubit q; h q; sdg q; tdg q;'],
  ['bell state', 'qubit[2] q; h q[0]; cx q[0], q[1];'],
  ['ghz state', 'qubit[3] q; h q[0]; cx q[0], q[1]; cx q[0], q[2];'],
  ['bit order: x on qubit 0 of 3', 'qubit[3] q; x q[0];'],
  ['bit order: x on qubit 2 of 3', 'qubit[3] q; x q[2];'],
  ['cx direction 0 -> 1', 'qubit[2] q; x q[0]; cx q[0], q[1];'],
  ['cx direction 1 -> 0', 'qubit[2] q; x q[0]; cx q[1], q[0];'],
  ['cz', 'qubit[2] q; h q[0]; h q[1]; cz q[0], q[1];'],
  ['swap', 'qubit[3] q; x q[0]; swap q[0], q[2];'],
  ['toffoli', 'qubit[3] q; x q[0]; x q[1]; ccx q[0], q[1], q[2];'],
  ['rx', 'qubit q; rx(pi / 3) q;'],
  ['ry', 'qubit q; ry(2 * pi / 5) q;'],
  ['rz after h', 'qubit q; h q; rz(pi / 7) q;'],
  ['phase gate', 'qubit q; h q; p(pi / 11) q;'],
  ['negative angle', 'qubit q; rx(-pi / 4) q;'],
  ['large angle', 'qubit q; rx(7 * pi / 3) q;'],
  [
    'five qubit mixture',
    `qubit[5] q;
     h q[0]; rx(0.4) q[1]; h q[2]; ry(-1.1) q[3]; rz(2.2) q[4];
     cx q[0], q[3]; cz q[2], q[4]; swap q[1], q[4];
     ccx q[0], q[1], q[2]; p(0.9) q[3]; cx q[4], q[0];`,
  ],
];

const PYTHON_SOURCE = String.raw`
import json, sys
import numpy as np

# Gate matrices, written from the textbook definitions with no reference to the
# QForge source. These are the numbers the comparison actually tests.
I2 = np.eye(2, dtype=complex)
H = np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
X = np.array([[0, 1], [1, 0]], dtype=complex)
Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
Z = np.array([[1, 0], [0, -1]], dtype=complex)
S = np.array([[1, 0], [0, 1j]], dtype=complex)
SDG = np.array([[1, 0], [0, -1j]], dtype=complex)
T = np.array([[1, 0], [0, np.exp(1j * np.pi / 4)]], dtype=complex)
TDG = np.array([[1, 0], [0, np.exp(-1j * np.pi / 4)]], dtype=complex)

def rx(t): return np.array([[np.cos(t/2), -1j*np.sin(t/2)], [-1j*np.sin(t/2), np.cos(t/2)]], dtype=complex)
def ry(t): return np.array([[np.cos(t/2), -np.sin(t/2)], [np.sin(t/2), np.cos(t/2)]], dtype=complex)
def rz(t): return np.array([[np.exp(-1j*t/2), 0], [0, np.exp(1j*t/2)]], dtype=complex)
def phase(t): return np.array([[1, 0], [0, np.exp(1j*t)]], dtype=complex)

FIXED = {"id": I2, "h": H, "x": X, "y": Y, "z": Z, "s": S, "sdg": SDG, "t": T, "tdg": TDG}
PARAM = {"rx": rx, "ry": ry, "rz": rz, "p": phase}

def embed_single(n, target, u):
    """Full operator for a single-qubit gate, built with Kronecker products.

    QForge's convention: amplitude index k has qubit j equal to (k >> j) & 1,
    so qubit 0 is the LEAST significant bit. Writing basis states most
    significant first, |b_{n-1} ... b_0>, qubit j sits at Kronecker position
    (n - 1 - j) counting from the left.
    """
    factors = [I2] * n
    factors[n - 1 - target] = u
    out = factors[0]
    for f in factors[1:]:
        out = np.kron(out, f)
    return out

def permutation_operator(n, image):
    """Operator sending basis state i to basis state image(i)."""
    m = np.zeros((2 ** n, 2 ** n), dtype=complex)
    for i in range(2 ** n):
        m[image(i), i] = 1
    return m

def operator(n, op):
    name, qubits, params = op["opcode"], op["qubits"], op["params"]
    if name == "barrier":
        return np.eye(2 ** n, dtype=complex)
    if name in FIXED:
        return embed_single(n, qubits[0], FIXED[name])
    if name in PARAM:
        return embed_single(n, qubits[0], PARAM[name](params[0]))
    if name == "cx":
        c, t = qubits
        return permutation_operator(n, lambda i: i ^ (1 << t) if (i >> c) & 1 else i)
    if name == "ccx":
        a, b, t = qubits
        return permutation_operator(n, lambda i: i ^ (1 << t) if ((i >> a) & 1) and ((i >> b) & 1) else i)
    if name == "swap":
        a, b = qubits
        def img(i):
            return i ^ (1 << a) ^ (1 << b) if ((i >> a) & 1) != ((i >> b) & 1) else i
        return permutation_operator(n, img)
    if name == "cz":
        a, b = qubits
        m = np.eye(2 ** n, dtype=complex)
        for i in range(2 ** n):
            if ((i >> a) & 1) and ((i >> b) & 1):
                m[i, i] = -1
        return m
    raise SystemExit("numpy reference has no definition for opcode " + name)

payload = json.load(sys.stdin)
results = []
for case in payload:
    n = case["qubitCount"]
    state = np.zeros(2 ** n, dtype=complex)
    state[0] = 1
    for op in case["instructions"]:
        state = operator(n, op) @ state
    results.append({
        "name": case["name"],
        "re": state.real.tolist(),
        "im": state.imag.tolist(),
        "norm": float(np.vdot(state, state).real),
    })
print(json.dumps(results))
`;

/**
 * Is a usable python3 with NumPy on PATH?
 *
 * `-E` ignores PYTHONPATH and friends. `-I` is deliberately *not* used: it also
 * drops the user site-packages directory, which is where NumPy lives on a
 * stock macOS python3, so `-I` would report NumPy missing on exactly the
 * machines where it is installed.
 */
function haveNumpy() {
  const probe = spawnSync('python3', ['-E', '-c', 'import numpy'], { encoding: 'utf8' });
  return probe.status === 0;
}

async function main() {
  if (!haveNumpy()) {
    console.log(
      'numpy-reference: python3 with numpy is not available, skipping.\n' +
        'This is an optional development cross-check; `pnpm test` does not need it.',
    );
    return 0;
  }

  // Import the built packages, so this validates the published artifacts.
  const compilerUrl = new URL('packages/compiler/dist/index.js', ROOT);
  const simulatorUrl = new URL('packages/simulator/dist/index.js', ROOT);
  let compiler;
  let simulator;
  try {
    compiler = await import(compilerUrl.href);
    simulator = await import(simulatorUrl.href);
  } catch (error) {
    console.error(
      `numpy-reference: cannot import the built packages. Run 'pnpm build' first.\n${String(error)}`,
    );
    return 3;
  }

  const { compile } = compiler;
  const { Statevector, applyInstruction } = simulator;
  const { CLI_LIMITS } = await import(new URL('packages/language/dist/index.js', ROOT).href);

  const cases = [];
  const qforgeStates = [];

  for (const [name, source] of CIRCUITS) {
    const result = compile(source, { limits: CLI_LIMITS });
    if (!result.ok || !result.module) {
      console.error(`numpy-reference: '${name}' failed to compile`);
      for (const d of result.diagnostics) console.error(`  ${d.code}: ${d.message}`);
      return 1;
    }
    const module = result.module;
    const state = Statevector.zeroState(module.qubitCount);
    for (const instruction of module.instructions) applyInstruction(state, instruction);
    qforgeStates.push({ name, state });

    cases.push({
      name,
      qubitCount: module.qubitCount,
      instructions: module.instructions.map((i) => ({
        opcode: i.opcode,
        qubits: [...i.qubits],
        params: [...i.params],
      })),
    });
  }

  // Write the Python to an empty scratch directory of its own and run it by
  // path. Python puts the *script's* directory on sys.path[0], not the current
  // directory, so a stray `json.py` in the repo or cwd cannot shadow a stdlib
  // import. That, plus -E, is the isolation this needs.
  const scratch = mkdtempSync(join(tmpdir(), 'qforge-numpy-'));
  const scriptPath = join(scratch, 'reference.py');
  writeFileSync(scriptPath, PYTHON_SOURCE, 'utf8');

  const python = spawnSync('python3', ['-E', scriptPath], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (python.status !== 0) {
    console.error(`numpy-reference: python failed (exit ${python.status})`);
    console.error(python.stderr);
    return 3;
  }

  const reference = JSON.parse(python.stdout);
  let worst = 0;
  let worstCase = '';
  let failures = 0;
  const tolerance = 1e-12;

  console.log(`numpy-reference: comparing ${reference.length} circuits against NumPy\n`);

  for (let i = 0; i < reference.length; i++) {
    const expected = reference[i];
    const { name, state } = qforgeStates[i];

    let difference = 0;
    for (let k = 0; k < state.size; k++) {
      difference = Math.max(
        difference,
        Math.hypot(state.re[k] - expected.re[k], state.im[k] - expected.im[k]),
      );
    }
    const normError = Math.abs(expected.norm - 1);
    const ok = difference <= tolerance && normError <= tolerance;
    if (!ok) failures++;
    if (difference > worst) {
      worst = difference;
      worstCase = name;
    }
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} max|dA| = ${difference.toExponential(2)}`,
    );
  }

  console.log(
    `\nworst disagreement ${worst.toExponential(3)} (${worstCase}), tolerance ${tolerance.toExponential(0)}`,
  );

  if (failures > 0) {
    console.error(`\nnumpy-reference: ${failures} circuit(s) disagree with NumPy`);
    return 1;
  }
  console.log('numpy-reference: all circuits agree with NumPy');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 3;
    });
}
