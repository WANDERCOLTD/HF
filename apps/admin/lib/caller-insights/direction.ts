/**
 * Direction sign for deltas, sparkline strokes, card stripes.
 *
 * Replaces the inline `trendDirection()` in `caller-detail/uplifttab.tsx` so
 * the same green / red / neutral convention applies across Overview, Uplift v2,
 * and Progress v2.
 *
 * Delta exactly 0 (or within `threshold`) returns "neutral" — no `+0` noise in
 * delta pills.
 */

export type Direction = "up" | "down" | "neutral";

/**
 * `directionOf(delta)` — classifies a single delta value.
 * `directionOf(scores, "trend")` — classifies a time series by the second-half
 * vs first-half average (matches the existing `trendDirection` semantics).
 */
export function directionOf(delta: number | null | undefined, threshold?: number): Direction;
export function directionOf(
  scores: Array<{ score: number }>,
  mode: "trend",
  threshold?: number,
): Direction;
export function directionOf(
  input: number | null | undefined | Array<{ score: number }>,
  modeOrThreshold?: "trend" | number,
  thresholdArg = 0.05,
): Direction {
  if (Array.isArray(input)) {
    const scores = input;
    const t = typeof modeOrThreshold === "number" ? modeOrThreshold : thresholdArg;
    if (scores.length < 3) return "neutral";
    const half = Math.floor(scores.length / 2);
    const firstHalf = scores.slice(0, half);
    const secondHalf = scores.slice(half);
    const avgFirst = firstHalf.reduce((s, v) => s + v.score, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v.score, 0) / secondHalf.length;
    const d = avgSecond - avgFirst;
    if (d > t) return "up";
    if (d < -t) return "down";
    return "neutral";
  }

  if (input == null || Number.isNaN(input)) return "neutral";
  const t = typeof modeOrThreshold === "number" ? modeOrThreshold : 0;
  if (input > t) return "up";
  if (input < -t) return "down";
  return "neutral";
}

/**
 * CSS variable for the direction colour. Wired into the design system —
 * caller surfaces never hardcode green/red/grey hex.
 */
export function colorVarForDirection(direction: Direction): string {
  switch (direction) {
    case "up":
      return "var(--status-success-text)";
    case "down":
      return "var(--status-error-text)";
    case "neutral":
    default:
      return "var(--text-muted)";
  }
}

/** Class-name suffix for direction-tinted backgrounds, borders, pills. */
export function classForDirection(direction: Direction): string {
  return `hf-direction-${direction}`;
}
