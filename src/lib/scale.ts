/** Rounds up to 1, 2 or 5 × 10ⁿ so the top gridline has a clean label. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}
