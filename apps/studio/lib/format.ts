/** Shared display helpers for the studio panels. */

/** Format a probability as a percentage with a fixed width. */
export function percent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Fixed-width signed real number, for amplitude tables. */
export function signed(value: number, digits = 4): string {
  // -0 renders as 0: a negative zero in an amplitude table is noise, not signal.
  const safe = value === 0 ? 0 : value;
  return safe.toFixed(digits);
}

/** `a + bi`, with an explicit sign on the imaginary part. */
export function complexText(re: number, im: number, digits = 4): string {
  if (re === 0 && im === 0) return '0';
  const sign = im < 0 ? '-' : '+';
  return `${signed(re, digits)} ${sign} ${signed(Math.abs(im), digits)}i`;
}

/** Bytes as KiB/MiB/GiB. */
export function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${value} B`;
}

/** Duration in a unit that reads well at that scale. */
export function duration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} us`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
