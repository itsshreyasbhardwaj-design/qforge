"""Compare QForge's results against Qiskit.

Two kinds of check, kept separate on purpose because they establish different
things:

  * **Mathematical** -- rebuild each circuit through Qiskit's own API from the
    opcode list and compare states or distributions. This tests QForge's
    *physics*: gate matrices, bit order, measurement, collapse.

  * **Interoperability** -- hand Qiskit the OpenQASM 3 text QForge *generated*
    and compare what it loads. This tests the *interchange format*, and it can
    fail for reasons that say nothing about QForge's correctness -- an
    OpenQASM 3 construct Qiskit's importer does not yet support, for instance.
    Those are recorded in a compatibility matrix rather than counted as errors.

Reads one JSON document on stdin, writes one on stdout.
"""

import json
import math
import sys

import numpy as np
from qiskit import QuantumCircuit, qasm3
from qiskit.circuit import ClassicalRegister
from qiskit.quantum_info import Statevector

# Tolerances. The statevector tolerance is loose enough to absorb the different
# order of floating-point operations on the two sides and tight enough that any
# real disagreement -- a wrong sign, a transposed matrix, a reversed bit order
# -- is orders of magnitude larger.
AMPLITUDE_TOL = 1e-10
PROBABILITY_TOL = 1e-10

ONE_QUBIT_NO_PARAM = {
    "id": lambda qc, q: qc.id(q),
    "h": lambda qc, q: qc.h(q),
    "x": lambda qc, q: qc.x(q),
    "y": lambda qc, q: qc.y(q),
    "z": lambda qc, q: qc.z(q),
    "s": lambda qc, q: qc.s(q),
    "sdg": lambda qc, q: qc.sdg(q),
    "t": lambda qc, q: qc.t(q),
    "tdg": lambda qc, q: qc.tdg(q),
}
ONE_QUBIT_PARAM = {
    "rx": lambda qc, t, q: qc.rx(t, q),
    "ry": lambda qc, t, q: qc.ry(t, q),
    "rz": lambda qc, t, q: qc.rz(t, q),
    "p": lambda qc, t, q: qc.p(t, q),
}


def build_circuit(case, with_classical=True):
    """Rebuild a QForge IR module as a Qiskit circuit."""
    n = case["qubitCount"]
    m = case.get("clbitCount", 0)
    qc = QuantumCircuit(n, m) if (with_classical and m) else QuantumCircuit(n)

    for instruction in case["instructions"]:
        opcode = instruction["opcode"]
        qubits = instruction["qubits"]
        params = instruction["params"]
        condition = instruction.get("condition")

        def emit():
            if opcode in ONE_QUBIT_NO_PARAM:
                ONE_QUBIT_NO_PARAM[opcode](qc, qubits[0])
            elif opcode in ONE_QUBIT_PARAM:
                ONE_QUBIT_PARAM[opcode](qc, params[0], qubits[0])
            elif opcode == "cx":
                qc.cx(qubits[0], qubits[1])
            elif opcode == "cz":
                qc.cz(qubits[0], qubits[1])
            elif opcode == "swap":
                qc.swap(qubits[0], qubits[1])
            elif opcode == "ccx":
                qc.ccx(qubits[0], qubits[1], qubits[2])
            elif opcode == "measure":
                qc.measure(qubits[0], instruction["clbit"])
            elif opcode == "reset":
                qc.reset(qubits[0])
            elif opcode == "barrier":
                qc.barrier(*qubits) if qubits else qc.barrier()
            else:
                raise ValueError(f"no Qiskit mapping for opcode '{opcode}'")

        if condition is None:
            emit()
            continue

        # Qiskit's if_test compares a classical register or a single bit
        # against an integer. QForge predicates are either a whole register or
        # one bit, which maps directly.
        if condition["negate"]:
            # Qiskit has no "not equal" form; enumerate the complement.
            width = len(condition["clbits"])
            targets = [v for v in range(2 ** width) if v != condition["value"]]
            for value in targets:
                with qc.if_test((_condition_target(qc, condition), value)):
                    emit()
        else:
            with qc.if_test((_condition_target(qc, condition), condition["value"])):
                emit()

    return qc


def _condition_target(qc, condition):
    """A single bit, or the whole classical register when the predicate spans it."""
    bits = condition["clbits"]
    if len(bits) == 1:
        return qc.clbits[bits[0]]
    creg = qc.cregs[0]
    if len(bits) == len(creg) and list(bits) == list(range(len(creg))):
        return creg
    raise ValueError("predicate spans a bit range Qiskit cannot express directly")


def compare_statevector(qforge, qiskit_state):
    """Max amplitude difference, and the phase-insensitive overlap."""
    a = np.asarray(qforge["re"], dtype=float) + 1j * np.asarray(qforge["im"], dtype=float)
    b = np.asarray(qiskit_state.data)
    if a.shape != b.shape:
        return {"ok": False, "reason": f"shape {a.shape} vs {b.shape}"}
    max_diff = float(np.max(np.abs(a - b))) if a.size else 0.0
    overlap = float(abs(np.vdot(a, b)))
    return {
        "maxAmplitudeDifference": max_diff,
        "overlapMagnitude": overlap,
        # Agreement including global phase is the strong claim; overlap alone
        # would pass for states differing by an unobservable phase factor.
        "ok": max_diff <= AMPLITUDE_TOL,
        "agreesUpToGlobalPhase": abs(overlap - 1.0) <= AMPLITUDE_TOL,
    }


def qiskit_distribution(qc, clbit_count):
    """Exact measurement distribution from Qiskit, keyed like QForge's."""
    probs = Statevector(qc.remove_final_measurements(inplace=False)).probabilities_dict()
    # Map basis states to classical register values using the circuit's own
    # measure instructions, so the key convention matches QForge's.
    mapping = []
    for instruction in qc.data:
        if instruction.operation.name == "measure":
            q = qc.find_bit(instruction.qubits[0]).index
            c = qc.find_bit(instruction.clbits[0]).index
            mapping.append((q, c))

    out = {}
    for basis, p in probs.items():
        # Qiskit's dict keys are bitstrings with qubit 0 rightmost.
        bits = basis[::-1]
        register = ["0"] * clbit_count
        for q, c in mapping:
            register[c] = bits[q]
        key = "".join(reversed(register))
        out[key] = out.get(key, 0.0) + float(p)
    return out


def compare_distributions(expected, actual):
    keys = set(expected) | set(actual)
    worst = 0.0
    worst_key = None
    for key in keys:
        diff = abs(expected.get(key, 0.0) - actual.get(key, 0.0))
        if diff > worst:
            worst, worst_key = diff, key
    return {
        "maxProbabilityDifference": worst,
        "worstOutcome": worst_key,
        "ok": worst <= PROBABILITY_TOL,
        "support": sorted(k for k, v in actual.items() if v > 1e-12),
    }


def total_variation(a, b):
    keys = set(a) | set(b)
    return 0.5 * sum(abs(a.get(k, 0.0) - b.get(k, 0.0)) for k in keys)


def main():
    payload = json.load(sys.stdin)
    report = {
        "versions": {
            "qiskit": __import__("qiskit").__version__,
            "numpy": np.__version__,
            "python": sys.version.split()[0],
        },
        "tolerances": {"amplitude": AMPLITUDE_TOL, "probability": PROBABILITY_TOL},
        "unitary": [],
        "distribution": [],
        "stochastic": [],
        "interop": [],
    }

    # ---------------- mathematical: unitary evolution ----------------
    for case in payload["unitary"]:
        entry = {"name": case["name"]}
        try:
            qc = build_circuit(case, with_classical=False)
            reference = Statevector(qc)
            entry["direct"] = compare_statevector(case["statevector"], reference)

            optimised = dict(case)
            optimised["instructions"] = case["optimizedInstructions"]
            qc_opt = build_circuit(optimised, with_classical=False)
            entry["optimised"] = compare_statevector(
                case["optimizedStatevector"], Statevector(qc_opt)
            )
            # The optimiser's own promise: same operator, global phase included.
            entry["optimiserPreservesOperator"] = compare_statevector(
                case["statevector"], Statevector(qc_opt)
            )
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"{type(exc).__name__}: {exc}"
        report["unitary"].append(entry)

    # ---------------- mathematical: exact distributions ----------------
    for case in payload["distribution"]:
        entry = {"name": case["name"]}
        try:
            qc = build_circuit(case)
            actual = qiskit_distribution(qc, case["clbitCount"])
            entry["comparison"] = compare_distributions(case["exact"], actual)
            entry["qiskit"] = actual
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"{type(exc).__name__}: {exc}"
        report["distribution"].append(entry)

    # ---------------- stochastic: sampled comparison ----------------
    for case in payload["stochastic"]:
        entry = {"name": case["name"], "shots": case["shots"]}
        try:
            # Qiskit Aer is deliberately not used. Enumerating branches from the
            # exact statevector gives a reference distribution with *no*
            # sampling error at all, so any disagreement is QForge's, not
            # Monte Carlo noise on both sides.
            qc = build_circuit(case)
            entry["qiskitSupported"] = True
            probs = _branch_distribution(qc, case["clbitCount"])
            qforge = {k: v / case["shots"] for k, v in case["counts"].items()}
            entry["totalVariationDistance"] = total_variation(probs, qforge)
            entry["qiskit"] = probs
            entry["qforge"] = qforge
            # 200k shots: 5 sigma on a probability near 0.5 is about 0.006.
            entry["ok"] = entry["totalVariationDistance"] <= 0.01
        except Exception as exc:  # noqa: BLE001
            entry["qiskitSupported"] = False
            entry["error"] = f"{type(exc).__name__}: {exc}"
        report["stochastic"].append(entry)

    # ---------------- interoperability: generated OpenQASM 3 ----------------
    for group in ("unitary", "distribution", "stochastic"):
        for case in payload[group]:
            entry = {"name": case["name"], "group": group}
            try:
                loaded = qasm3.loads(case["qasm"])
                entry["loads"] = True
                if group == "unitary":
                    entry["comparison"] = compare_statevector(
                        case["statevector"], Statevector(loaded)
                    )
                elif group == "distribution":
                    actual = qiskit_distribution(loaded, case["clbitCount"])
                    entry["comparison"] = compare_distributions(case["exact"], actual)
                else:
                    # Stochastic circuits are compared only for loadability
                    # here; their physics is covered above.
                    entry["comparison"] = {"ok": True, "note": "load-only"}
            except Exception as exc:  # noqa: BLE001
                entry["loads"] = False
                entry["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            report["interop"].append(entry)

    json.dump(report, sys.stdout)


def _branch_distribution(qc, clbit_count):
    """Exact classical-register distribution, enumerating measurement branches.

    Maintains a list of (statevector, register, weight) branches, splitting at
    each measurement and reset, and recursing into conditional blocks for the
    branches whose register satisfies the condition. Exponential in the number
    of measurements, which is fine at this size and avoids any sampling error
    on the reference side.
    """
    n = qc.num_qubits
    initial = np.zeros(2 ** n, dtype=complex)
    initial[0] = 1.0
    branches = [(initial, [0] * clbit_count, 1.0)]
    branches = _walk(qc, qc, branches, n, clbit_count)

    out = {}
    for _vec, reg, weight in branches:
        if weight <= 1e-15:
            continue
        key = "".join(str(b) for b in reversed(reg))
        out[key] = out.get(key, 0.0) + weight
    return out


def _walk(root, block, branches, n, clbit_count, qubit_map=None, clbit_map=None):
    """Apply every instruction in `block` to every branch.

    `root` is the outermost circuit, which owns the canonical bit indices;
    `block` may be a conditional body whose bits are a subset, so the maps
    translate block-local positions back to global ones.
    """
    for item in block.data:
        name = item.operation.name
        if name in ("barrier", "delay"):
            continue

        if qubit_map is None:
            qubits = [root.find_bit(b).index for b in item.qubits]
        else:
            qubits = [qubit_map[block.find_bit(b).index] for b in item.qubits]

        if name == "if_else":
            branches = _apply_conditional(root, item, block, branches, n, clbit_count,
                                          qubit_map, clbit_map)
            continue

        if name == "measure":
            if clbit_map is None:
                clbit = root.find_bit(item.clbits[0]).index
            else:
                clbit = clbit_map[block.find_bit(item.clbits[0]).index]
            branches = _split(branches, qubits[0], n, clbit)
            continue

        if name == "reset":
            branches = _split(branches, qubits[0], n, None, reset=True)
            continue

        matrix = np.asarray(item.operation.to_matrix())
        branches = [(_apply(vec, matrix, qubits, n), reg, w) for vec, reg, w in branches]

    return branches


def _apply_conditional(root, item, block, branches, n, clbit_count, qubit_map, clbit_map):
    """Recurse into a conditional body for the branches whose register matches."""
    operation = item.operation
    condition = getattr(operation, "condition", None)
    if condition is None:
        raise ValueError("if_else without a condition")
    target, expected = condition

    # Which global classical bits does the condition read, least significant
    # first? A single Clbit reads one; a ClassicalRegister reads all of its.
    if isinstance(target, ClassicalRegister):
        indices = [root.find_bit(b).index for b in target]
    else:
        indices = [root.find_bit(target).index]

    body = operation.blocks[0]
    inner_qubits = [
        (qubit_map[block.find_bit(b).index] if qubit_map else root.find_bit(b).index)
        for b in item.qubits
    ]
    inner_clbits = [
        (clbit_map[block.find_bit(b).index] if clbit_map else root.find_bit(b).index)
        for b in item.clbits
    ]

    taken, skipped = [], []
    for vec, reg, weight in branches:
        actual = 0
        for position, index in enumerate(indices):
            if reg[index]:
                actual |= 1 << position
        (taken if actual == expected else skipped).append((vec, reg, weight))

    if taken:
        taken = _walk(root, body, taken, n, clbit_count, inner_qubits, inner_clbits)
    return taken + skipped


def _apply(vec, matrix, qubits, n):
    """Apply a dense operator to the listed qubits of an n-qubit statevector.

    Qiskit writes a k-qubit gate matrix with the instruction's *first* qubit as
    the least significant index, so the axes are moved in reverse order. The
    first version of this function moved them forwards, which silently applied
    `cx(0, 1)` as `cx(1, 0)`; the entangled-reset case caught it, because it is
    one of the few here where operand order changes the measured distribution
    rather than only the state.
    """
    k = len(qubits)
    tensor = vec.reshape([2] * n)
    # Axis 0 of a little-endian reshape is the most significant qubit.
    axes = [n - 1 - q for q in reversed(qubits)]
    tensor = np.moveaxis(tensor, axes, range(k))
    shape = tensor.shape
    tensor = tensor.reshape(2 ** k, -1)
    tensor = matrix @ tensor
    tensor = tensor.reshape(shape)
    tensor = np.moveaxis(tensor, range(k), axes)
    return tensor.reshape(-1)


def _split(branches, qubit, n, clbit, reset=False):
    """Split every branch on measuring `qubit`."""
    out = []
    bit = 1 << qubit
    for vec, reg, weight in branches:
        for outcome in (0, 1):
            mask = np.array([((i & bit) != 0) == bool(outcome) for i in range(len(vec))])
            projected = np.where(mask, vec, 0.0)
            p = float(np.vdot(projected, projected).real)
            if p <= 1e-15:
                continue
            projected = projected / math.sqrt(p)
            if reset and outcome == 1:
                flipped = np.zeros_like(projected)
                for i in range(len(projected)):
                    flipped[i ^ bit] = projected[i]
                projected = flipped
            new_reg = list(reg)
            if clbit is not None:
                new_reg[clbit] = outcome
            out.append((projected, new_reg, weight * p))
    return out


if __name__ == "__main__":
    main()
