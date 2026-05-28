/**
 * Number-style helpers for caller insights surfaces (Overview, Uplift v2, Progress v2).
 *
 * Returns "—" for null / undefined / NaN — never "NaN%" or "0.NaN".
 * Single source of truth for the visible number style across the three tabs.
 */

const EMPTY = "—";

function isMissing(v: number | null | undefined): v is null | undefined {
  return v == null || Number.isNaN(v);
}

/** Ratio 0–1 → integer percent string. `pct(0.852) === "85%"`. */
export function pct(value: number | null | undefined): string {
  if (isMissing(value)) return EMPTY;
  return `${Math.round(value * 100)}%`;
}

/** Fractional reading on a custom scale. `fraction(4.2, 5) === "4.2/5"`. */
export function fraction(
  value: number | null | undefined,
  scale: number,
  decimals = 1,
): string {
  if (isMissing(value)) return EMPTY;
  return `${value.toFixed(decimals)}/${scale}`;
}

/** Raw count with a unit suffix. `count(12, "calls") === "12 calls"`. */
export function count(
  value: number | null | undefined,
  unit?: string,
): string {
  if (isMissing(value)) return EMPTY;
  const rounded = Math.round(value);
  return unit ? `${rounded} ${unit}` : String(rounded);
}

export type DeltaKind = "pp" | "abs" | "count";

/**
 * Signed delta string. Kind determines suffix.
 *  - `pp`: percentage-points (`+12pp`)
 *  - `abs`: two-decimal absolute (`+0.35`)
 *  - `count`: integer with optional unit (`+3 calls`)
 */
export function delta(
  value: number | null | undefined,
  kind: DeltaKind = "abs",
  unit?: string,
): string {
  if (isMissing(value)) return EMPTY;
  const sign = value > 0 ? "+" : "";
  switch (kind) {
    case "pp":
      return `${sign}${Math.round(value * 100)}pp`;
    case "count": {
      const rounded = Math.round(value);
      return unit ? `${sign}${rounded} ${unit}` : `${sign}${rounded}`;
    }
    case "abs":
    default:
      return `${sign}${value.toFixed(2)}`;
  }
}
