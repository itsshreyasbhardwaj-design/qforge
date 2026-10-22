'use client';

import { useState } from 'react';
import { LESSONS, type Lesson, type LessonAction } from '../lib/lessons';

export interface LessonPanelProps {
  /** Perform a lesson step's action against the studio's state. */
  readonly onAction: (action: LessonAction) => void;
  readonly onClose: () => void;
}

/**
 * Guided walkthroughs that drive the studio rather than describing it.
 *
 * Each step loads the program, moves the debugger to the relevant instruction
 * and opens the panel showing the claim, so the thing being described is on
 * screen while it is being read. Every number a lesson mentions is computed by
 * the simulator at that moment, not written into the lesson text.
 */
export function LessonPanel({ onAction, onClose }: LessonPanelProps) {
  const [lesson, setLesson] = useState<Lesson | undefined>(undefined);
  const [index, setIndex] = useState(0);

  const start = (chosen: Lesson) => {
    setLesson(chosen);
    setIndex(0);
    if (chosen.steps[0]?.action) onAction(chosen.steps[0].action);
  };

  const goTo = (next: number) => {
    if (!lesson) return;
    const bounded = Math.max(0, Math.min(lesson.steps.length - 1, next));
    setIndex(bounded);
    const action = lesson.steps[bounded]?.action;
    if (action) onAction(action);
  };

  if (!lesson) {
    return (
      <div style={{ padding: '12px 14px', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Guided walkthroughs</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 3 }}>
            Each one drives the editor and the debugger as you read, so the thing being
            described is on screen. Everything they claim is computed live by the simulator.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {LESSONS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => start(candidate)}
              style={{
                textAlign: 'left',
                font: 'inherit',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 5,
                padding: '10px 12px',
                cursor: 'pointer',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{candidate.title}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                  {candidate.steps.length} steps &middot; ~{candidate.minutes} min
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
                {candidate.summary}
              </div>
            </button>
          ))}
        </div>

        <button type="button" className="qf-button" onClick={onClose}>
          Back to the editor
        </button>
      </div>
    );
  }

  const step = lesson.steps[index]!;
  const last = index === lesson.steps.length - 1;

  return (
    <div style={{ padding: '12px 14px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{lesson.title}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
          step {index + 1} of {lesson.steps.length}
        </span>
      </div>

      {/* Progress is shown as discrete segments, one per step, so the shape of
          the lesson is visible rather than just how far along it is. */}
      <div style={{ display: 'flex', gap: 3 }} aria-hidden="true">
        {lesson.steps.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= index ? 'var(--color-accent)' : 'var(--color-surface-3)',
            }}
          />
        ))}
      </div>

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{step.title}</div>
        {step.body.map((paragraph, i) => (
          <p
            key={i}
            style={{
              margin: '0 0 8px',
              fontSize: 12.5,
              lineHeight: 1.6,
              color: 'var(--color-text-muted)',
            }}
          >
            {paragraph}
          </p>
        ))}
      </div>

      {step.look ? (
        <div
          style={{
            borderLeft: '2px solid var(--color-accent)',
            paddingLeft: 9,
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          <div className="qf-label" style={{ marginBottom: 2 }}>
            Check for yourself
          </div>
          {step.look}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="qf-button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          Back
        </button>
        {last ? (
          <button
            type="button"
            className="qf-button"
            data-variant="primary"
            onClick={() => setLesson(undefined)}
          >
            Finish
          </button>
        ) : (
          <button
            type="button"
            className="qf-button"
            data-variant="primary"
            onClick={() => goTo(index + 1)}
          >
            Next
          </button>
        )}
        <button type="button" className="qf-button" onClick={() => setLesson(undefined)}>
          All walkthroughs
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
        The editor stays live throughout. Change the seed, edit the circuit, or step around
        freely &mdash; the walkthrough is pointing at the real tool, not a recording.
      </div>
    </div>
  );
}
