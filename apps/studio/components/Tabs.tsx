'use client';

import { useId, useRef } from 'react';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  /** Small count or status shown next to the label. */
  readonly badge?: string | number;
}

export interface TabsProps {
  readonly tabs: readonly TabDefinition[];
  readonly active: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel: string;
}

/**
 * A tablist implementing the WAI-ARIA keyboard pattern: arrow keys move
 * between tabs, Home and End jump to the ends, and focus follows selection.
 * Written out rather than pulled in as a dependency because it is thirty lines
 * and the studio has no other use for a component library.
 */
export function Tabs({ tabs, active, onChange, ariaLabel }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const move = (delta: number) => {
    const index = tabs.findIndex((t) => t.id === active);
    if (index < 0) return;
    const next = tabs[(index + delta + tabs.length) % tabs.length]!;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  const jump = (to: 'first' | 'last') => {
    const target = to === 'first' ? tabs[0] : tabs[tabs.length - 1];
    if (!target) return;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        overflowX: 'auto',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface-2)',
        flex: 'none',
      }}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowRight':
            event.preventDefault();
            move(1);
            break;
          case 'ArrowLeft':
            event.preventDefault();
            move(-1);
            break;
          case 'Home':
            event.preventDefault();
            jump('first');
            break;
          case 'End':
            event.preventDefault();
            jump('last');
            break;
          default:
            break;
        }
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(node) => {
            if (node) refs.current.set(tab.id, node);
            else refs.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          id={`${baseId}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${baseId}-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          className="qf-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== 0 ? (
            <span
              style={{
                marginLeft: 6,
                padding: '1px 5px',
                borderRadius: 8,
                fontSize: 10,
                background: 'var(--color-surface-3)',
                color: 'var(--color-text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface TabPanelProps {
  readonly id: string;
  readonly active: string;
  readonly children: React.ReactNode;
}

export function TabPanel({ id, active, children }: TabPanelProps) {
  if (id !== active) return null;
  return (
    <div
      role="tabpanel"
      tabIndex={0}
      style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', outline: 'none' }}
    >
      {children}
    </div>
  );
}
