// Pure band-score helpers — no React, fully unit-testable.

export const BAND_MAX = 9;

/**
 * Map an IELTS band to a design-token CSS variable (see app/globals.css).
 * Returns a `var(--…)` string so colours stay in the token system
 * (the eslint hardcoded-hex rule, mirrored from apps/admin, depends on this).
 */
export function bandColorVar(score: number): string {
  if (score >= 7) return "var(--band-high)";
  if (score >= 5.5) return "var(--band-mid)";
  if (score >= 4) return "var(--band-low)";
  return "var(--band-poor)";
}

/**
 * Build an SVG polyline `points` string for a 0–100 viewBox, with half-band
 * padding above and below the data so the line never touches the edges.
 * Abstracted from the prototype's inline MiniChart maths.
 */
export function chartPoints(values: number[]): string {
  if (values.length < 2) return "";
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const range = max - min || 1;
  const step = 100 / (values.length - 1);
  return values
    .map((v, i) => `${i * step},${100 - ((v - min) / range) * 100}`)
    .join(" ");
}
