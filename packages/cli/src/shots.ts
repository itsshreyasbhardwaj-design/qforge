import type { SamplingStrategy } from '@qforge/simulator';

export { executeCircuit, exactRegisterDistribution } from '@qforge/simulator';

/**
 * One line explaining which sampling strategy ran.
 *
 * Worth printing rather than hiding: the two strategies have very different
 * costs, and a user wondering why a circuit with a mid-circuit measurement is
 * a thousand times slower deserves to be told why rather than left guessing.
 */
export function MAX_SHOTS_NOTE(strategy: SamplingStrategy): string {
  return strategy === 'terminal-sampling'
    ? 'note: all measurements are terminal, so every shot was sampled from one exact final statevector'
    : 'note: this circuit has a mid-circuit measurement or reset, so it was replayed once per shot';
}
