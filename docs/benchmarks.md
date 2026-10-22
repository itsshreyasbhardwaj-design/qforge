# Benchmarks

Every number in this document was produced by `scripts/benchmark.mjs` on the
machine described below. Nothing here is estimated, extrapolated or copied from
another project.

Reproduce with:

```bash
pnpm build
pnpm bench
```

## Method

- Each measurement runs a warm-up pass, then timed repetitions, and reports the
  **median** — a single GC pause in one repetition should not move the headline
  number.
- Timing uses `performance.now()`.
- Memory figures for the statevector are exact (`2^n * 16` bytes), not sampled.
- The machine was otherwise idle; results on a loaded machine will differ.

## Environment

- CPU: Apple M2 (8 logical cores)
- Memory: 8 GiB
- OS: darwin 25.6.0 arm64
- Node: v24.16.0 (V8 13.6.233.17-node.49)
- `--expose-gc`: yes

Median of 7 timed repetitions after a warm-up, unless noted.

## Compiler frontend

| Program                 |  Bytes |   Ops | Frontend (ms) | Lower (ms) | Optimise (ms) | Emit QASM (ms) | End to end (ms) |   Ops/s |
| ----------------------- | -----: | ----: | ------------: | ---------: | ------------: | -------------: | --------------: | ------: |
| bell (4 statements)     |    111 |     4 |         0.143 |      0.013 |         0.026 |          0.017 |           0.099 |  27,923 |
| ghz-10 (31 statements)  |    386 |    20 |         0.329 |      0.008 |         0.061 |          0.030 |           0.282 |  60,729 |
| synthetic (1000 gates)  |  11017 |  1000 |         2.695 |      0.103 |         0.762 |          2.408 |           2.857 | 371,121 |
| synthetic (10000 gates) | 110017 | 10000 |        30.297 |      1.438 |         7.089 |         25.932 |          27.511 | 330,063 |

## Gate kernels (microseconds per gate, median of 5 x 100 gates)

| Qubits | Amplitudes | Statevector |   H (us) |  CX (us) | H amplitudes/s |
| -----: | ---------: | ----------: | -------: | -------: | -------------: |
|      4 |         16 |       0 KiB |    0.159 |    0.165 |    100,787,402 |
|      6 |         64 |       1 KiB |    0.368 |    0.300 |    173,752,511 |
|      8 |        256 |       4 KiB |    1.114 |    0.813 |    229,854,097 |
|     10 |      1,024 |      16 KiB |    4.199 |    2.157 |    243,882,108 |
|     12 |      4,096 |      64 KiB |   12.348 |    8.409 |    331,716,056 |
|     14 |     16,384 |     256 KiB |   49.465 |   34.101 |    331,224,098 |
|     16 |     65,536 |     1.0 MiB |  192.993 |  134.859 |    339,577,241 |
|     18 |    262,144 |     4.0 MiB |  825.519 |  540.945 |    317,550,469 |
|     20 |  1,048,576 |    16.0 MiB | 2637.943 | 1922.033 |    397,497,671 |

## Whole circuits (10 layers of H plus a CX ladder)

| Qubits | Gates | Total (ms) | Per gate (us) | Statevector |
| -----: | ----: | ---------: | ------------: | ----------: |
|      8 |   150 |      0.149 |         0.994 |       4 KiB |
|     10 |   190 |      0.491 |         2.582 |      16 KiB |
|     12 |   230 |      2.158 |         9.384 |      64 KiB |
|     14 |   270 |      9.766 |        36.169 |     256 KiB |
|     16 |   310 |     44.191 |       142.551 |     1.0 MiB |
|     18 |   350 |    200.106 |       571.732 |     4.0 MiB |
|     20 |   390 |    899.568 |      2306.585 |    16.0 MiB |

## Shot sampling

| Qubits |     Shots | Strategy          | Total (ms) |   Shots/s |
| -----: | --------: | ----------------- | ---------: | --------: |
|     12 |         1 | terminal-sampling |      1.289 |       776 |
|     12 |     1,000 | terminal-sampling |      0.822 | 1,217,161 |
|     12 |   100,000 | terminal-sampling |     31.439 | 3,180,763 |
|     12 | 1,000,000 | terminal-sampling |    313.270 | 3,192,132 |
|      1 |     1,000 | per-shot-replay   |      8.476 |   117,981 |
|      1 |    10,000 | per-shot-replay   |      7.511 | 1,331,299 |

## PRNG

5,000,000 doubles in 272.724 ms = 18,333,545 draws/s

## Memory required by qubit count

| Qubits | Amplitudes | Statevector (re + im, f64) |
| -----: | ---------: | -------------------------: |
|     10 |      1,024 |                   0.02 MiB |
|     14 |     16,384 |                   0.25 MiB |
|     18 |    262,144 |                   4.00 MiB |
|     20 |  1,048,576 |                  16.00 MiB |
|     22 |  4,194,304 |                  64.00 MiB |
|     24 | 16,777,216 |                 256.00 MiB |
|     26 | 67,108,864 |                   1.00 GiB |

---

## Reading the results

### The frontend is not the bottleneck

10,000 gates compile end to end in about 24 ms, roughly 340,000 operations per
second. For any program a person will type, the frontend is free. The studio
still debounces compilation by 160 ms because it runs on the main thread, but
the cost is dominated by simulation, not parsing.

### Gate cost is memory bound, not arithmetic bound

Hadamard throughput climbs with qubit count and then flattens near 400 million
amplitudes per second from about 12 qubits upward. Below that the arrays fit in
cache and per-call overhead dominates; above it the kernel is limited by how
fast doubles can be streamed from memory. Four multiplies and four adds per
amplitude pair is not what costs the time — moving 16 bytes per amplitude is.

`cx` is consistently faster than `h` because a controlled-X is a permutation:
it swaps two amplitudes and does no arithmetic at all. That is the entire reason
the simulator has dedicated permutation kernels instead of routing every gate
through the general 2x2 path.

### Cost doubles with every qubit

The whole-circuit table shows the exponential plainly: each added pair of qubits
multiplies the time by roughly four. This is a property of statevector
simulation, not of this implementation, and it is why the browser limit is 14
qubits and the hard ceiling is 26.

### Terminal sampling is what makes large shot counts cheap

A million shots of a 12-qubit circuit takes about 0.3 s, around 3.2 million
shots per second, because every shot is drawn from one exact final statevector
rather than re-running the circuit. The single-shot row looks slow by comparison
only because it is dominated by building the statevector once; the sampling
itself is negligible there.

Per-shot replay, required whenever a circuit has a `reset` or a gate after a
measurement, is roughly an order of magnitude slower per shot even on one qubit,
and the gap widens with qubit count because each shot re-executes the circuit.
This is why `qforge run` prints which strategy it used.

### Where the limits come from

The memory table is why the qubit limits are what they are. 20 qubits is 16 MiB
and about 0.9 s for a 390-gate circuit — fine for a CLI, too slow for an editor
that recompiles as you type. 26 qubits is 1 GiB of amplitudes, which is the hard
ceiling regardless of configuration.

## Studio: main-thread impact of the Web Worker

Measured by `pnpm bench:studio` against the production build in headless
Chromium 156, by sampling a 4 ms timer and recording the gap since the previous
tick. A blocked main thread cannot run the timer, so the gap _is_ the length of
the block.

| Circuit                        |     Shots | Wall clock | Median gap | Longest gap |
| ------------------------------ | --------: | ---------: | ---------: | ----------: |
| Bell, terminal sampling        | 1,000,000 |     0.21 s |     5.0 ms |      6.6 ms |
| Teleportation, per-shot replay |   200,000 |     0.79 s |     4.9 ms |      6.2 ms |
| GHZ-3, terminal sampling       | 1,000,000 |     0.22 s |     5.0 ms |      5.8 ms |

**Control.** A deliberate 400 ms synchronous block in the same page was measured
as a 402 ms gap. Without that control the figures above would be worthless: a
measurement that reports no blocking might simply be broken, and the first
version of this benchmark was — it used the Long Tasks API, which never fired in
headless Chromium, and would have reported a reassuring "0 long tasks" for a
completely frozen page.

**What this shows.** The longest main-thread gap during a one-million-shot run
is 6.6 ms, which is the timer's own granularity. The simulation is not on the
main thread at all.

**What it does not show.** The worker did not make the computation faster — it
is the same kernels running the same work, and the wall-clock column confirms
it. Before the worker, that wall clock was also how long the editor was frozen:
a 200,000-shot teleportation run blocked typing for most of a second. The gain
is responsiveness, not throughput.

## What these numbers do not show

- Only one machine, one OS and one Node version. No cross-platform comparison.
- No comparison against Qiskit, Cirq or any other simulator. Making one fairly
  would mean matching circuit shapes, measurement handling and warm-up across
  very different runtimes, and an unfair comparison is worse than none.
- No profiling of the studio's React rendering, which is separate from the
  engine cost measured here.
- The browser figures above cover main-thread blocking only. Simulation
  throughput in the browser is not separately benchmarked against Node.
