# The mathematics QForge implements

This document fixes every convention the simulator uses and states what is
proved by tests versus what is merely assumed. Nothing here is decorative: each
convention is load-bearing somewhere in the code, and getting one wrong is the
classic way a quantum simulator silently produces plausible nonsense.

---

## 1. State representation

An `n`-qubit pure state is a unit vector in a `2^n`-dimensional complex vector
space:

```
|psi> = sum over k of  a_k |k>        with  sum |a_k|^2 = 1
```

`a_k` are _amplitudes_: complex numbers. They are not probabilities. The Born
rule turns them into probabilities by squaring the modulus:

```
P(k) = |a_k|^2 = Re(a_k)^2 + Im(a_k)^2
```

This is why an equal superposition has amplitude `0.7071`, not `0.5`, and why
amplitudes can be negative or complex while probabilities cannot. That
difference is what makes interference possible, and the `interference.qf`
example exists to make it visible.

### 1.1 Storage

`Statevector` keeps two `Float64Array`s, `re` and `im`, each of length `2^n`,
rather than an array of complex objects. A gate kernel then reads and writes
contiguous doubles and allocates nothing. Memory is `2^n * 16` bytes.

---

## 2. Indexing and bit order

**This is the single most important convention in the project.**

> Amplitude index `k` represents the computational basis state in which qubit
> `j` has value `(k >> j) & 1`. **Qubit 0 is the least significant bit.**

Ket labels are written most significant qubit first, as ordinary binary:

```
|b_{n-1} b_{n-2} ... b_1 b_0>
```

so **qubit 0 appears rightmost**. On two qubits, `x q[0]` produces amplitude
index 1, displayed as `|01>`.

This is the convention Qiskit and OpenQASM use, which is why QForge adopts it:
a user comparing output against another tool should not have to mentally
reverse bitstrings.

It applies without exception to the simulator, the studio, the counts table and
the OpenQASM backend. Classical registers follow the same rule: classical bit 0
is the rightmost character of a counts key.

Because a Bell state is symmetric under reversing the qubits, it cannot detect
a bit-order bug. `statevector.test.ts` therefore pins the convention with
_asymmetric_ circuits (`x` on qubit 0 of 3, `x` on qubit 2 of 3, `cx` in each
direction), and `scripts/numpy-reference.mjs` checks the same cases against
NumPy's own Kronecker products.

---

## 3. Gate matrices

In the basis `{|0>, |1>}`:

```
I  = [[1, 0], [0, 1]]
X  = [[0, 1], [1, 0]]
Y  = [[0, -i], [i, 0]]
Z  = [[1, 0], [0, -1]]
H  = (1/sqrt 2) [[1, 1], [1, -1]]
S  = [[1, 0], [0, i]]        Sdg = [[1, 0], [0, -i]]
T  = [[1, 0], [0, e^{i pi/4}]]   Tdg = [[1, 0], [0, e^{-i pi/4}]]
```

Parameterised gates:

```
rx(t) = [[cos(t/2),   -i sin(t/2)],
         [-i sin(t/2), cos(t/2)  ]]

ry(t) = [[cos(t/2), -sin(t/2)],
         [sin(t/2),  cos(t/2)]]

rz(t) = [[e^{-i t/2}, 0        ],
         [0,          e^{i t/2}]]

p(t)  = [[1, 0], [0, e^{i t}]]
```

Two-qubit gates, as operators rather than matrices (QForge implements them as
permutations, which is both faster and easier to check):

```
cx(c, t)   : |i>  ->  |i XOR 2^t>  when bit c of i is 1, else |i>
ccx(a,b,t) : |i>  ->  |i XOR 2^t>  when bits a and b of i are both 1
swap(a, b) : |i>  ->  |i with bits a and b exchanged>
cz(a, b)   : |i>  ->  -|i>         when bits a and b are both 1
```

Every fixed matrix is asserted unitary (`M M^dagger = I` to 1e-12) in
`complex.test.ts`, and every rotation is checked unitary at a spread of angles.

### 3.1 The half-angle, and why `rx(pi)` is not `X`

Rotations use the standard definition `R_sigma(t) = exp(-i t sigma / 2)`. The
factor of one half is not a convention QForge is free to drop: it is what makes
a rotation by `2*pi` equal `-I` and a rotation by `4*pi` equal `I`. A qubit
needs a full `4*pi` to return to itself.

So `rx(pi) = -i X`, which differs from `X` by the global phase `-i`. QForge
keeps the textbook definition rather than quietly normalising the phase away,
because the debugger shows raw amplitudes and silently rewriting them would
teach the wrong thing.

This has a direct consequence for the optimiser, in
[compiler-design.md](compiler-design.md): `remove-identity` drops a rotation
only at multiples of `4*pi`, never `2*pi`.

---

## 4. Gate application

### 4.1 Single-qubit gates

To apply a 2x2 matrix `U` to qubit `t`, pair each amplitude index with bit `t`
clear against the index with it set:

```
i0 = index with bit t = 0
i1 = i0 + 2^t

[a_{i0}]  <-  U [a_{i0}]
[a_{i1}]      [a_{i1}]
```

Those two amplitudes are the qubit's |0> and |1> components with every other
qubit held fixed, so `U` acts on them directly. The implementation walks blocks
of `2^(t+1)` so the inner loop does no index arithmetic.

Cost: `2^(n-1)` pair updates, O(2^n) time, O(1) extra space.

### 4.2 Controlled and permutation gates

`cx`, `ccx` and `swap` are permutations of basis states, so they are
implemented as amplitude swaps with no arithmetic at all. `cz` is diagonal, so
it is a sign flip on the quarter of amplitudes where both control bits are set.
A general controlled gate uses the 2x2 kernel restricted to indices where the
controls are 1.

### 4.3 Cost of a circuit

Applying `g` gates to `n` qubits is `O(g * 2^n)` time and `O(2^n)` space. The
exponential is in the state, not the circuit: this is why 20 qubits is the
practical ceiling for a laptop and 26 is the hard one. Measured numbers are in
[benchmarks.md](benchmarks.md).

---

## 5. Measurement

Five things must be kept distinct. Conflating any two of them is the usual way
a quantum simulator becomes misleading, so QForge reports them separately and
the studio shows them side by side.

1. **The state before measurement**, a superposition.
2. **The exact probabilities**, computed from the amplitudes by the Born rule:
   `P(qubit j = 1) = sum of |a_k|^2 over all k with bit j of k set`.
3. **One sampled outcome**, drawn from that distribution. A single shot gives a
   bit, not a distribution.
4. **The post-measurement state**: project onto the observed outcome and
   renormalise.

   ```
   |psi'> = P_b |psi> / sqrt(<psi| P_b |psi>)
   ```

5. **Frequency estimates** over many shots, which approach (2) but are not
   equal to it. The counts table shows both the count and the frequency so the
   sampling error is visible rather than rounded away.

### 5.1 Collapse

Projection zeroes every amplitude inconsistent with the outcome and rescales
the rest by `1 / sqrt(p)`. Collapsing onto a zero-probability outcome is
refused with an error rather than producing a zero vector.

### 5.2 Repeatability and correlation

Measuring the same qubit twice with nothing in between gives the same answer
both times, because the first measurement already collapsed the state. For a
Bell pair, measuring either qubit forces the other, in either order — tested
both ways round in `measure.test.ts`.

### 5.3 Reset

`reset q` is a measurement whose outcome is discarded, followed by `X` if the
outcome was 1. It is **not** a projection onto |0>. For an entangled qubit the
difference is observable: resetting one half of a Bell pair must leave the other
half definite and correlated with the outcome that occurred. Implementing reset
as "zero the |1> amplitudes" would quietly destroy that correlation.

---

## 6. Sampling strategies

QForge uses two, chooses automatically, and reports which it used.

### 6.1 Terminal sampling

When every measurement is at the end of the circuit, all shots can be drawn
from a single final statevector. Sample a basis state `k` with probability
`|a_k|^2` and read off the measured qubits' bits.

This is exact, not an approximation. The joint distribution of the measured
qubits is the marginal of `|a_k|^2`, correlations included, and unmeasured
qubits are correctly traced out by ignoring their bits. Measuring one qubit
twice is also handled correctly: both reads see the same bit of `k`.

Cost: one circuit execution plus `O(2^n + shots * n)` for sampling.

### 6.2 Per-shot replay

Required when later evolution depends on a sampled outcome:

- any `reset`, which is a measurement in disguise, or
- any gate acting on a qubit that has already been measured.

The whole circuit is re-executed once per shot. Cost: `O(shots * g * 2^n)` —
three orders of magnitude slower, which is why the CLI prints which strategy it
chose.

Choosing terminal sampling when replay was required would silently produce wrong
statistics, so `execute.test.ts` checks a mid-circuit circuit against brute-force
replay, and `exactRegisterDistribution` provides a sampling-free distribution to
compare against.

### 6.3 Randomness

Measurement uses xoshiro128\*\*, seeded through splitmix32. Given the same
circuit, shots and seed, QForge produces identical results on every machine.
When no seed is supplied one is chosen and reported, so an interesting run stays
reproducible after the fact.

---

## 7. Reduced density matrices and the Bloch sphere

For one qubit `t`, the partial trace over the others is

```
rho_ab = sum over the other qubits of  psi_{a,rest} * conj(psi_{b,rest})
```

Writing `rho = (I + x X + y Y + z Z) / 2` gives `rho_01 = (x - i y)/2` and
`z = rho_00 - rho_11`, hence

```
x = 2 Re(rho_01)       y = -2 Im(rho_01)       z = rho_00 - rho_11
```

The vector's length satisfies `|r|^2 = 2 tr(rho^2) - 1`:

- `|r| = 1` exactly when the qubit has a pure state of its own
- `|r| < 1` when it is mixed
- `|r| = 0` when it is maximally mixed

**A qubit entangled with others does not have a Bloch sphere state.** Both
halves of a Bell pair come out at `|r| = 0` — the centre of the sphere. The
studio reports the length and says "maximally mixed (entangled)" rather than
drawing a unit arrow that would imply a pure state the qubit does not have.

---

## 8. Numerical accuracy

All arithmetic is IEEE-754 double precision, about 16 significant decimal
digits.

**What is checked.** Every gate is unitary to within 1e-12. Across 150 random
circuits of up to 6 qubits and 30 gates, the production kernels agree with an
independently written dense-matrix oracle to better than 1e-12, and the norm
stays within 1e-12 of 1 over 200-gate circuits. Against NumPy, 22 circuits agree
to at most 5.6e-17 — most of them bit-for-bit.

**What is not claimed.** Error grows roughly as the square root of the gate
count for random phases, and adversarial circuits can do worse. QForge does not
renormalise between gates; `Statevector.normalize()` exists but is not called
automatically, because silently hiding drift would also hide a genuine bug.
`norm()` is displayed in the studio so drift is visible.

### 8.1 Global phase

Two states differing by an overall factor `exp(i alpha)` are the same physical
state and give identical measurement statistics. Comparisons against independent
implementations therefore use `|<psi|phi>|`, which is phase-insensitive, rather
than amplitude-wise equality.

QForge's own optimisation passes hold themselves to the stricter standard: they
preserve the operator _including_ global phase, so the debugger's amplitudes are
identical optimised or not.

---

## 9. What correctness evidence exists

| Claim                               | How it is checked                                     |
| ----------------------------------- | ----------------------------------------------------- |
| Gate matrices are unitary           | `M M^dagger = I` asserted for every gate              |
| Known states are right              | X, H, Bell, GHZ, H-Z-H, rotation identities           |
| Bit order is right                  | asymmetric circuits; NumPy cross-check                |
| Kernels have no indexing bug        | 150 random circuits vs an independent dense oracle    |
| Gate matrices match the literature  | 22 circuits vs NumPy, built from textbook definitions |
| Measurement probabilities are right | sampled frequencies vs exact distribution, 5 sigma    |
| Collapse is right                   | repeatability, Bell correlation in both orders        |
| Reset is right                      | entangled partner stays correlated                    |
| Sampling strategies agree           | mid-circuit circuit vs brute-force replay             |
| Optimisation preserves the operator | full statevector comparison on random circuits        |

What none of this establishes is correctness for _all_ circuits. It is evidence
from a few hundred cases up to 6 qubits, plus analytic checks on the standard
textbook examples.
