# Independent validation against Qiskit

QForge's simulator and OpenQASM backend, cross-checked against Qiskit.

Everything in this document is an observation from a run of
`packages/validation`, not an estimate. Reproduce with:

```bash
pnpm build
pnpm --filter @qforge/validation setup      # once: creates an isolated .venv
pnpm --filter @qforge/validation validate
```

---

## 1. Why Qiskit, and what it does and does not establish

Before this package existed, every reference QForge was checked against lived
inside this repository: a dense-matrix oracle, a minimal OpenQASM reader, and a
NumPy script. The first two were written by the same author as the code they
check, so a shared misunderstanding — a wrong convention rather than a wrong
line — could have passed all of them. The NumPy script addressed that for gate
matrices, but only for matrices.

Qiskit is a widely used quantum SDK developed independently of this project. It
makes its own choices about bit order, gate definitions and measurement
semantics, and if QForge disagreed with it, at least one of them would be wrong.

**What this establishes:** that QForge's gate matrices, bit-order convention,
measurement semantics, collapse behaviour, reset, classical feed-forward, and
optimisation passes agree with an independent implementation on the 42 circuits
below.

**What it does not:** correctness for all circuits; anything above 5 qubits;
numerical behaviour for adversarial circuits; or conformance to the OpenQASM 3
specification in general — only that Qiskit's importer accepts what QForge
emits and reads it back to the same circuit.

---

## 2. Environment

|                     |                                          |
| ------------------- | ---------------------------------------- |
| Qiskit              | 2.2.3                                    |
| qiskit-qasm3-import | 0.6.0                                    |
| NumPy               | 2.5.4                                    |
| Python              | 3.12.13 (isolated venv, created by `uv`) |
| Node                | 24.16.0                                  |
| Host                | Apple M2, macOS 15 (darwin 25.6.0 arm64) |

Versions are pinned in `packages/validation/requirements.txt`. Qiskit is a
development-time oracle, **not a dependency of QForge**: nothing in the
compiler, simulator, CLI or studio imports it, and `pnpm test` passes without
it.

---

## 3. Two kinds of check, kept separate

The brief for this work asked that mathematical validation be distinguished
from interface-specific interoperability validation, and the distinction turned
out to matter.

**Mathematical.** Each circuit is rebuilt through Qiskit's own Python API from
QForge's opcode list, and the resulting state or distribution is compared. This
tests QForge's _physics_.

**Interoperability.** Qiskit is handed the OpenQASM 3 text QForge _generated_,
via `qiskit.qasm3.loads`. This tests the _interchange format_. A failure here
can mean QForge emitted something non-conformant, or that Qiskit's importer does
not support a construct — very different conclusions, and counting them together
would make the signal useless.

A run fails on any mathematical disagreement. Interoperability results are
reported as a compatibility matrix.

---

## 4. Results

### 4.1 Unitary evolution — 33 circuits

Full statevectors compared **including global phase**, not merely up to it.

|                            |               |
| -------------------------- | ------------- |
| Circuits                   | 33            |
| Worst amplitude difference | **1.241e-16** |
| Tolerance                  | 1e-10         |
| Failures                   | 0             |

Most cases agree to exactly 0.0; the largest disagreements are single-ulp
rounding in `t`, `tdg` and a deep single-qubit chain, which is the expected
consequence of the two implementations ordering their floating-point operations
differently.

Coverage: every gate individually; rotations at seven angles including negative,
beyond 2*pi, and the `2*pi` / `4*pi` pair that distinguishes `-I` from `I`;
bit-order cases that a symmetric circuit cannot test (`x` on qubit 0 vs qubit 2
of 3, `cx` in both directions, `ccx` with the target in the middle); Bell, GHZ-3
and GHZ-4; three phase-sensitive circuits including phase kickback and
Deutsch-Jozsa; and a five-qubit mixture.

### 4.2 Optimisation preservation — 33 circuits

Each circuit's **optimised** form was also checked against Qiskit's result for
the **unoptimised** circuit. This validates QForge's optimisation passes against
an outside implementation rather than only against QForge's own simulator.

|                            |               |
| -------------------------- | ------------- |
| Worst amplitude difference | **1.732e-16** |
| Failures                   | 0             |

This is the stricter of the two obvious contracts: the passes preserve the
operator _including global phase_, so `rx(4*pi)` is removed while `rx(2*pi)`
(which equals `-I`) is not. Both cases are in the set, and Qiskit agrees with
both decisions.

### 4.3 Exact measurement distributions — 5 circuits

Compared as exact probability distributions, with no sampling on either side.

| Circuit                    | Max probability difference | Support  |
| -------------------------- | -------------------------: | -------- |
| Bell                       |                          0 | 00, 11   |
| GHZ-3                      |                          0 | 000, 111 |
| Biased rotation `ry(pi/3)` |                          0 | 0, 1     |
| Interference `h z h`       |                          0 | 1        |
| Anticorrelated pair        |                          0 | 01, 10   |

Exact agreement, to the last bit of a double.

### 4.4 Circuits whose evolution depends on measurement — 4 circuits

These have no single final statevector, so QForge was sampled at 200,000 shots
and compared against an **exact** reference distribution computed by enumerating
measurement branches on the Qiskit side. Putting the sampling error on one side
only means any disagreement is QForge's rather than Monte Carlo noise on both.

| Circuit                              | Total variation distance | Within 0.01 |
| ------------------------------------ | -----------------------: | ----------- |
| `reset` after `h`                    |                  0.00246 | yes         |
| Entangled `reset` (half a Bell pair) |                  0.00096 | yes         |
| **Quantum teleportation**            |                  0.00203 | yes         |
| Conditional `x` on a measured bit    |                  0.00035 | yes         |

At 200,000 shots, five standard deviations on a probability near 0.5 is about
0.006, so these are all comfortably within sampling error.

The teleportation row is the one this phase existed for: QForge's classical
feed-forward produces the same measurement distribution as Qiskit's `if_test`.

### 4.5 Interoperability — 42 files

|                                                 |        |
| ----------------------------------------------- | ------ |
| Generated files offered to `qiskit.qasm3.loads` | 42     |
| Loaded successfully                             | **42** |
| Loaded but disagreed on the circuit             | 0      |

Every OpenQASM 3 file QForge generates — including the teleportation circuit
with its conditional corrections — loads into Qiskit and reconstructs to the
same statevector or distribution.

---

## 5. What this run found

### 5.1 A real conformance bug in QForge's OpenQASM output

QForge emitted `if (c == 1) { x q; }` for a predicate on a single classical bit.
Qiskit's importer rejected it:

```
QASM3ImporterError: conditions must be 'bit == const bool'
or 'bitarray == const int', not 'bit == const int'
```

This is correct of Qiskit. OpenQASM 3 types a single `bit` as a bit, not an
integer, so comparing it to `1` is a type error. A whole bit _array_ does
compare against an integer, which is why `if (c == 3)` on a `bit[2]` was fine.

Fixed: a single-bit predicate now emits `c == true` / `c == false`, while a
whole-register predicate keeps `c == 3`. The in-repo OpenQASM reader was taught
the boolean form too, and conformance tests pin both.

**This is the clearest justification for the phase.** The in-repo reader had
been written against QForge's own output and so accepted it happily; only an
implementation with no knowledge of QForge caught the type error.

### 5.2 A bug in the validation harness, not in QForge

The first run reported a total variation distance of 0.499 on the entangled
`reset` case — a near-total disagreement.

It was the reference that was wrong. The branch-enumerating walker applied
Qiskit's multi-qubit gate matrices with the operand axes moved in the wrong
order, so `cx(0, 1)` was being applied as `cx(1, 0)`. QForge's answer was the
physically correct one: resetting one half of a Bell pair leaves the other half
correlated with the discarded outcome, so the second bit is 50/50.

Worth recording for two reasons. First, a disagreement between two
implementations says only that they differ, and deciding which is wrong needs
an argument from physics rather than from authority. Second, the entangled reset
is one of the few cases in the set where operand order changes the measured
_distribution_ rather than only the state — which is exactly why it was the case
that caught it.

---

## 6. Compatibility matrix

What Qiskit's OpenQASM 3 importer accepts from QForge, as of qiskit 2.2.3 with
qiskit-qasm3-import 0.6.0.

| Construct                            | QForge emits  | Qiskit loads | Note                                  |
| ------------------------------------ | ------------- | ------------ | ------------------------------------- |
| `OPENQASM 3.0;` header               | yes           | yes          |                                       |
| `include "stdgates.inc";`            | yes           | yes          |                                       |
| Scalar `qubit q;` / `bit c;`         | yes           | yes          |                                       |
| Sized `qubit[n] q;` / `bit[n] c;`    | yes           | yes          |                                       |
| All 17 QForge gates                  | yes           | yes          | all are `stdgates.inc` names          |
| Angle expressions `pi/2`, `3*pi/4`   | yes           | yes          |                                       |
| Exact decimal angles                 | yes           | yes          |                                       |
| `measure q -> c` as `c = measure q;` | yes           | yes          |                                       |
| `reset q;`                           | yes           | yes          |                                       |
| `barrier q, r;`                      | yes           | yes          |                                       |
| `if (bit == true) { ... }`           | yes           | yes          | after the fix in 5.1                  |
| `if (bitarray == int) { ... }`       | yes           | yes          |                                       |
| `if (bit == int) { ... }`            | **no longer** | no           | rejected as a type error; was the bug |
| `else`                               | n/a           | n/a          | QForge has no `else`                  |
| `gate` / `def` definitions           | n/a           | n/a          | QForge cannot express them            |
| Loops, timing, pulse constructs      | n/a           | n/a          | QForge cannot express them            |

---

## 7. Limits of this validation

- **42 circuits, up to 5 qubits.** Nothing here speaks to larger systems or to
  circuits chosen adversarially.
- **One Qiskit version.** Importer behaviour changes between releases; the
  compatibility matrix is dated by the versions in section 2.
- **Qiskit Aer is not used.** Branch enumeration gives an exact reference with
  no sampling error, which is better for this purpose, but it means Aer's own
  simulator is not part of the comparison.
- **Not a specification conformance test.** That QForge's output loads into
  Qiskit is evidence about Qiskit's importer, not proof of OpenQASM 3
  conformance. Section 5.1 shows the two are not the same thing.
- **Qiskit is itself software.** Agreement is strong evidence, not proof. Where
  the two disagreed, deciding which was right took an argument from physics.
- **Not run in CI by default.** It needs a Python toolchain and about 90 MB of
  wheels. `.github/workflows/ci.yml` runs it on demand and before a release.
