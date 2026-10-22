/**
 * Guided walkthroughs.
 *
 * Each step is *data*: prose plus an action the studio performs. The action is
 * the point. A lesson that only told you to "notice the amplitudes are 0.7071"
 * would be a slideshow; these load the program, step the debugger to the right
 * instruction and open the panel that shows the claim, so the thing being
 * described is on screen while you read about it.
 *
 * Everything a lesson asserts is visible in the UI at that moment, computed by
 * the real simulator. Nothing here is a number typed in by hand.
 */

export interface LessonAction {
  /** Load this program and reset execution. */
  readonly source?: string;
  /** Step the debugger to this instruction index; -1 is the initial state. */
  readonly stepTo?: number;
  /** Open this Results tab. */
  readonly resultsTab?: 'gate' | 'state' | 'probabilities' | 'counts' | 'bloch' | 'stats';
  /** Run the circuit with this many shots. */
  readonly run?: number;
}

export interface LessonStep {
  readonly title: string;
  /** Paragraphs. Kept short: this sits beside the thing it describes. */
  readonly body: readonly string[];
  /** What to look at, phrased as something to check rather than to believe. */
  readonly look?: string;
  readonly action?: LessonAction;
}

export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly minutes: number;
  readonly steps: readonly LessonStep[];
}

const SUPERPOSITION = `// Superposition: one qubit, two amplitudes.
qubit q;
bit result;

h q;

measure q -> result;
`;

const INTERFERENCE = `// The same circuit, with a phase flip in the middle.
qubit q;
bit result;

h q;
z q;
h q;

measure q -> result;
`;

const BELL = `// Entanglement: two qubits with no individual states.
qubit alice;
qubit bob;

bit resultA;
bit resultB;

h alice;
cx alice, bob;

measure alice -> resultA;
measure bob -> resultB;
`;

const TELEPORT = `// Teleportation: moving a state with two classical bits.
qubit msg;
qubit alice;
qubit bob;

bit m0;
bit m1;

ry(2 * pi / 5) msg;

h alice;
cx alice, bob;

cx msg, alice;
h msg;

measure msg -> m0;
measure alice -> m1;

if (m1 == 1) x bob;
if (m0 == 1) z bob;
`;

export const LESSONS: readonly Lesson[] = [
  {
    id: 'superposition',
    title: 'Superposition',
    summary: 'Why a qubit is not a coin, and why the number is 0.7071 and not 0.5.',
    minutes: 5,
    steps: [
      {
        title: 'Start with nothing',
        body: [
          'A qubit begins in the state written |0>. Nothing has happened to it yet.',
          'The State panel shows one amplitude: 1 on |0>, and nothing anywhere else.',
        ],
        look: 'The probability of |0> is 100%. This part is not yet quantum at all.',
        action: { source: SUPERPOSITION, stepTo: -1, resultsTab: 'state' },
      },
      {
        title: 'Apply a Hadamard',
        body: [
          'The h gate puts the qubit into a superposition of |0> and |1>.',
          'Look at the amplitudes, not the probabilities. Each is 0.7071, not 0.5.',
          'That is because probability is the *square* of the amplitude: 0.7071 squared is 0.5. Amplitudes are the more fundamental object, and the next lesson shows why that matters.',
        ],
        look: 'Amplitude 0.7071 on each of |0> and |1>; probability 50% on each.',
        action: { stepTo: 0, resultsTab: 'gate' },
      },
      {
        title: 'Measure it',
        body: [
          'Measurement does three separate things, and the debugger keeps them apart.',
          'Before it: the probabilities, which are properties of the state. Then: one sampled outcome, which is what happened in this particular run. After: the collapsed state, which is no longer a superposition.',
        ],
        look: 'P(0) = 50.00%, P(1) = 50.00%, and then a single sampled bit. Change the seed and run again: the probabilities do not move, the sampled bit does.',
        action: { stepTo: 1, resultsTab: 'gate' },
      },
      {
        title: 'A thousand shots',
        body: [
          'Run the circuit a thousand times and the frequencies approach the probabilities, without ever equalling them exactly.',
          'The Counts panel shows both the raw count and the frequency so the sampling error stays visible rather than being rounded away.',
        ],
        look: 'Roughly 500 of each, but not exactly 500. That gap is sampling error, not a bug.',
        action: { run: 1024, resultsTab: 'counts' },
      },
    ],
  },
  {
    id: 'interference',
    title: 'Interference',
    summary: 'The experiment that proves a qubit is not secretly already 0 or 1.',
    minutes: 5,
    steps: [
      {
        title: 'The claim to test',
        body: [
          'After a Hadamard the qubit is 50/50. A reasonable guess is that it is "really" 0 or 1 and we simply do not know which.',
          'This circuit tests that guess. It is the superposition circuit with one extra gate: a z between the two Hadamards.',
        ],
        look: 'If the qubit were secretly 0 or 1, a second Hadamard would leave it 50/50 again.',
        action: { source: INTERFERENCE, stepTo: -1, resultsTab: 'state' },
      },
      {
        title: 'Hadamard, then Z',
        body: [
          'The z gate flips the *sign* of the |1> amplitude: +0.7071 becomes -0.7071.',
          'No probability changed. The Gate panel says so directly, because it computed both and compared them.',
        ],
        look: 'The amplitude of |1> is now negative, and both probabilities are still 50%.',
        action: { stepTo: 1, resultsTab: 'gate' },
      },
      {
        title: 'The second Hadamard',
        body: [
          'Now the two paths to |0> cancel exactly, and the two paths to |1> reinforce.',
          'The result is deterministic |1>. A classical coin cannot do this, because probabilities cannot be negative and so cannot cancel.',
        ],
        look: 'One basis state at 100%. The Gate panel reports the cancellation to zero as interference.',
        action: { stepTo: 2, resultsTab: 'gate' },
      },
      {
        title: 'So the guess was wrong',
        body: [
          'A system that was secretly 0 or 1 could not produce a certain answer here.',
          'The negative amplitude was doing real work, which is why QForge shows amplitudes rather than only probabilities, and why its optimiser refuses rewrites that would change them.',
        ],
        look: 'Run it a thousand times: 1 every single time.',
        action: { run: 1024, resultsTab: 'counts' },
      },
    ],
  },
  {
    id: 'entanglement',
    title: 'Entanglement',
    summary: 'Two qubits with perfect correlation and no individual states.',
    minutes: 6,
    steps: [
      {
        title: 'Two separate qubits',
        body: [
          'Both start in |0>. At this point each has a perfectly good state of its own.',
          'The Bloch panel shows both at length 1, which is what "has its own state" means precisely.',
        ],
        look: '|r| = 1 for both qubits: each is pure.',
        action: { source: BELL, stepTo: -1, resultsTab: 'bloch' },
      },
      {
        title: 'Superpose the first',
        body: ['h puts alice into a superposition. bob is untouched and still |0>.'],
        look: 'alice is still pure, just pointing along a different axis.',
        action: { stepTo: 0, resultsTab: 'bloch' },
      },
      {
        title: 'Entangle them',
        body: [
          'cx flips bob exactly when alice is 1. Because alice is in superposition, the result cannot be written as "alice is in some state and bob is in some state".',
          'Both Bloch vectors collapse to length 0. Neither qubit has a state of its own any more; all the information is in the correlation between them.',
        ],
        look: '|r| = 0 for both. That is not a rounding artefact, it is what maximal entanglement looks like.',
        action: { stepTo: 1, resultsTab: 'bloch' },
      },
      {
        title: 'What the correlation does',
        body: [
          'Measuring alice forces bob. Step through both measurements and watch the second one become certain.',
        ],
        look: 'The first measurement is 50/50. The second reports P = 100% for whatever the first gave.',
        action: { stepTo: 3, resultsTab: 'gate' },
      },
      {
        title: 'Only two outcomes, ever',
        body: [
          'Across a thousand shots, 00 and 11 appear and 01 and 10 never do.',
          'This holds no matter which qubit is measured first, and no matter how far apart they are.',
        ],
        look: 'Two rows in the counts table, not four.',
        action: { run: 1024, resultsTab: 'counts' },
      },
    ],
  },
  {
    id: 'teleportation',
    title: 'Teleportation',
    summary: 'Moving an unknown state using entanglement and two classical bits.',
    minutes: 8,
    steps: [
      {
        title: 'The problem',
        body: [
          'Alice holds a qubit in an unknown state and wants Bob to have it. She cannot measure it, because that would destroy it, and she cannot copy it, because the no-cloning theorem forbids that.',
          'What she can do is consume a shared entangled pair and send two classical bits.',
        ],
        look: 'msg is prepared with ry(2*pi/5), an asymmetric state, so a wrong correction would be obvious.',
        action: { source: TELEPORT, stepTo: 0, resultsTab: 'bloch' },
      },
      {
        title: 'Share a Bell pair',
        body: ['alice and bob are entangled first. This is the resource the protocol spends.'],
        look: 'alice and bob are both at |r| = 0; msg still has its own state.',
        action: { stepTo: 2, resultsTab: 'bloch' },
      },
      {
        title: "Alice's Bell measurement",
        body: [
          'cx then h on msg and alice, followed by measuring both. This projects Alice’s two qubits onto one of four outcomes, and destroys the original state in the process.',
          'That destruction is why teleportation does not violate no-cloning: the state exists in one place before and one place after, never two.',
        ],
        look: 'After both measurements, msg has |r| = 1 again but is now a plain computational basis state. The original is gone.',
        action: { stepTo: 6, resultsTab: 'bloch' },
      },
      {
        title: 'The classical channel',
        body: [
          'The two if statements are the classical bits travelling to Bob. Each correction fires only when its bit is 1.',
          'The debugger says, for this run, whether each one actually fired. Change the seed and a different branch is taken.',
        ],
        look: 'Each correction is marked either "held, so it ran" or "did not hold, so it was skipped".',
        action: { stepTo: 8, resultsTab: 'gate' },
      },
      {
        title: 'Bob has the state',
        body: [
          'Whichever branch was taken, bob now holds the state msg started in.',
          'The Bloch panel is the check: bob is pure again, with z = cos(2*pi/5) = 0.3090, which is exactly what ry(2*pi/5) prepares.',
        ],
        look: 'bob: pure, z = 0.3090. Try several seeds; it is the same every time.',
        action: { resultsTab: 'bloch' },
      },
      {
        title: 'What the counts do *not* show',
        body: [
          'Run a thousand shots and all four measurement outcomes appear at about 25% each.',
          'That tells you nothing about whether the protocol worked. Alice’s measurement is unbiased, so deleting both corrections produces an identical counts table. The proof is in bob’s state, which is why QForge tests it that way.',
        ],
        look: 'Four roughly equal rows. Now delete the two if statements and run again: the counts are unchanged, but bob is wrong.',
        action: { run: 1024, resultsTab: 'counts' },
      },
    ],
  },
];
