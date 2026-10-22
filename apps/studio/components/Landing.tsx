import Link from 'next/link';

/**
 * The public landing page.
 *
 * Its job is to let someone decide, in under a minute, whether this is worth
 * their time — which means saying what the project does *not* do as plainly as
 * what it does. Every number on this page is one the repository can reproduce;
 * none of them are rounded up, and the limitations section is not a footnote.
 *
 * Static by design: no client component, no state, no JavaScript needed to read
 * it. The studio itself is a separate route so that this page loads instantly
 * and the editor's chunks are only fetched by someone who asked for them.
 */

const REPO = 'https://github.com/itsshreyasbhardwaj-design/qforge';

const PROGRAM = `qubit alice;
qubit bob;

bit resultA;
bit resultB;

h alice;
cx alice, bob;

measure alice -> resultA;
measure bob -> resultB;`;

const OUTPUT = `$ qforge run examples/bell.qf --shots 1024 --seed 42
qubits 2  classical bits 2
gates 2  instructions 4  depth 3

shots 1024  seed 42  strategy terminal-sampling

state     count      freq
-----  --------  --------
11          519    0.5068
00          505    0.4932`;

const PIPELINE = [
  { stage: 'source', note: 'text with a grammar' },
  { stage: 'lexer', note: 'total; every byte is a token' },
  { stage: 'parser', note: 'recursive descent + Pratt' },
  { stage: 'analyser', note: 'declare before use, one pass' },
  { stage: 'IR', note: 'flat, source-mapped, predicated' },
  { stage: 'passes', note: 'to a fixpoint' },
  { stage: 'OpenQASM 3 · simulator', note: 'two backends' },
];

const DOES = [
  'A language with a grammar, type rules and span-accurate diagnostics.',
  'A hand-written compiler: lexer, Pratt parser, analyser, flat IR, three optimisation passes.',
  'A statevector simulator with specialised permutation and diagonal kernels.',
  'Real classical control — predicated instructions, so teleportation is expressible and tested.',
  'An OpenQASM 3 backend whose output Qiskit reads back to the same circuit.',
  'A step debugger that shows the state, the amplitudes and each measurement, one instruction at a time.',
  'Four guided walkthroughs that drive the studio rather than describe it.',
];

const DOES_NOT = [
  'No general classical computation: no variables, loops, functions, or arithmetic on measured bits.',
  'No noise model, no density-matrix simulation, no error correction.',
  'No gate synthesis, routing or hardware-aware transpilation. It emits the gates you wrote.',
  'No user-defined gates and no subroutines.',
  'Statevector only, so the ceiling is hard: 14 qubits in the browser, 20 in the CLI, 26 absolute.',
  'The gate set is 17 gates. cy, ch, controlled rotations and u are absent.',
];

const EVIDENCE = [
  {
    figure: '1.241e-16',
    label: 'worst statevector disagreement with Qiskit, across 33 circuits',
  },
  {
    figure: '42 / 42',
    label: 'generated OpenQASM 3 files Qiskit reads back to the same circuit',
  },
  { figure: '700', label: 'unit tests, plus 66 browser tests on desktop and a Pixel 7' },
  { figure: '0', label: 'third-party runtime dependencies in the four core packages' },
];

const DOCS: ReadonlyArray<readonly [string, string, string]> = [
  ['Language specification', 'language-spec.md', 'The grammar, the type rules, every gate.'],
  ['Architecture', 'architecture.md', 'How the four packages fit together, and why.'],
  ['Simulator design', 'simulator-design.md', 'Pair-stepping, kernels, measurement, sampling.'],
  [
    'Classical control design',
    'classical-control-design.md',
    'Predication, and what it costs the optimiser.',
  ],
  [
    'Validation against Qiskit',
    'validation-report.md',
    'Method, per-case results, bugs found.',
  ],
  ['Technical report', 'technical-report.md', 'The whole system, in a research style.'],
  ['Benchmarks', 'benchmarks.md', 'Every number, with the command that produced it.'],
  ['Limitations', 'limitations.md', 'What it cannot do, stated plainly.'],
  ['Claim verification', 'claim-verification.md', 'Each claim, and how to check it yourself.'],
  [
    'Contribution disclosure',
    'technical-mastery.md',
    'Who wrote what, and what is independently validated.',
  ],
];

function Section({
  title,
  children,
  lead,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h2>
        {lead ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14.5, lineHeight: 1.6 }}>
            {lead}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Landing() {
  return (
    <main
      style={{
        maxWidth: 940,
        margin: '0 auto',
        padding: '48px 16px 72px',
        display: 'grid',
        gap: 52,
      }}
    >
      <header style={{ display: 'grid', gap: 18 }}>
        <h1
          style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}
        >
          QForge
        </h1>
        <p
          style={{
            fontSize: 19,
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
            maxWidth: 640,
          }}
        >
          Write quantum programs. Understand what they do.
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.7, maxWidth: 680 }}>
          A small programming language for quantum circuits, with a compiler written from
          scratch, an independently implemented statevector simulator, and a step debugger that
          shows you the quantum state one gate at a time. It wraps no quantum SDK, and it runs
          entirely in your browser — nothing you write is uploaded anywhere.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <Link href="/studio" className="qf-button" data-variant="primary">
            Open the studio
          </Link>
          <a className="qf-button" href={REPO} rel="noreferrer">
            Source on GitHub
          </a>
          <a
            className="qf-button"
            href={`${REPO}/blob/main/docs/limitations.md`}
            rel="noreferrer"
          >
            What it cannot do
          </a>
        </div>
      </header>

      <Section
        title="What you write, and what you get"
        lead="A Bell state: two qubits that always agree. Only 00 and 11 appear — never 01, never 10."
      >
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          <pre className="qf-pre" style={{ margin: 0, fontSize: 12.5 }}>
            {PROGRAM}
          </pre>
          <pre className="qf-pre" style={{ margin: 0, fontSize: 12.5 }}>
            {OUTPUT}
          </pre>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
          The studio compiles as you type, draws the circuit, and lets you step through it one
          instruction at a time — watching the amplitudes change, and watching each measurement
          collapse the state.
        </p>
      </Section>

      <Section
        title="How it works"
        lead="A real compiler pipeline, not a circuit builder. Each stage is a package you can read on its own."
      >
        <ol
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            listStyle: 'none',
            padding: 0,
            margin: 0,
            counterReset: 'stage',
          }}
        >
          {PIPELINE.map((step, i) => (
            <li
              key={step.stage}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span
                  className="qf-mono"
                  style={{ color: 'var(--color-text-faint)', fontSize: 11 }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className="qf-mono"
                  style={{ fontSize: 13, color: 'var(--color-accent)' }}
                >
                  {step.stage}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-text-muted)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {step.note}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="How you know it is right"
        lead="A simulator checked only against itself proves nothing. QForge is checked against four references chosen to fail independently, the most important being Qiskit, which is developed with no connection to this project."
      >
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          }}
        >
          {EVIDENCE.map((item) => (
            <div
              key={item.label}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                padding: '12px 14px',
              }}
            >
              <div
                className="qf-mono"
                style={{
                  fontSize: 19,
                  color: 'var(--color-success)',
                  letterSpacing: '-0.01em',
                }}
              >
                {item.figure}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-text-muted)',
                  marginTop: 5,
                  lineHeight: 1.5,
                }}
              >
                {item.label}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          That validation found two bugs worth reporting: a real OpenQASM conformance error in
          QForge, caught by Qiskit, and an error in one of the oracles, caught by its
          disagreement with QForge. Both are written up in{' '}
          <a
            href={`${REPO}/blob/main/docs/validation-report.md`}
            rel="noreferrer"
            style={{ color: 'var(--color-accent)' }}
          >
            the validation report
          </a>
          .
        </p>
      </Section>

      <Section title="What it does, and what it does not">
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '14px 16px',
            }}
          >
            <div className="qf-label" style={{ color: 'var(--color-success)' }}>
              It does
            </div>
            <ul
              style={{
                margin: '10px 0 0',
                paddingLeft: 18,
                display: 'grid',
                gap: 8,
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              {DOES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '14px 16px',
            }}
          >
            <div className="qf-label" style={{ color: 'var(--color-warning)' }}>
              It does not
            </div>
            <ul
              style={{
                margin: '10px 0 0',
                paddingLeft: 18,
                display: 'grid',
                gap: 8,
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              {DOES_NOT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        title="Read the documentation"
        lead="Written to be read without assistance, in the order that makes the system make sense."
      >
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {DOCS.map(([title, file, note]) => (
            <a
              key={file}
              href={`${REPO}/blob/main/docs/${file}`}
              rel="noreferrer"
              style={{
                display: 'block',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                padding: '10px 12px',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-accent)' }}>
                {title}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-text-muted)',
                  marginTop: 3,
                  lineHeight: 1.5,
                }}
              >
                {note}
              </div>
            </a>
          ))}
        </div>
      </Section>

      <footer
        style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: 20,
          display: 'grid',
          gap: 10,
          fontSize: 13,
          color: 'var(--color-text-muted)',
          lineHeight: 1.65,
        }}
      >
        <p>
          <strong style={{ color: 'var(--color-text)' }}>Built with AI assistance.</strong> The
          implementation was written by an AI coding assistant working from written
          specifications. What that leaves — the decisions, and the results validated by tools
          developed independently of this project — is set out in{' '}
          <a
            href={`${REPO}/blob/main/docs/technical-mastery.md`}
            rel="noreferrer"
            style={{ color: 'var(--color-accent)' }}
          >
            the contribution disclosure
          </a>
          , rather than left for you to work out.
        </p>
        <p>
          MIT licensed. No account, no API key, no telemetry, no paid service — clone it and{' '}
          <code className="qf-mono">pnpm test</code> is the whole setup.
        </p>
      </footer>
    </main>
  );
}
