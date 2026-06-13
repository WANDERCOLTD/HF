/**
 * Tier colour + glyph + label conventions for the Skills Framework + Attainment surfaces.
 *
 * Single source of truth so educators see the SAME visual treatment for a
 * tier name regardless of whether they're looking at:
 *
 *   - Course Detail → Skills Framework → Cohort Heatmap (per-tier learner count)
 *   - Caller Detail → Attainment → Skill Bands section (per-learner current tier)
 *   - Caller Detail → ProgressTab BandChip (per-learner band, legacy)
 *   - CohortLearningAggregate (legacy 3-tier inline map at lines 22-28)
 *
 * Replacing the legacy inline `BAND_COLORS` map in `CohortLearningAggregate`
 * with this central utility is on the Sprint 4 migration list.
 *
 * Design conventions (verified 2026-06-13):
 *
 *   - **Cold → hot, left-to-right.** Lower tiers sit at the cold end (no_evidence
 *     = grey muted), higher tiers approach hot green at the top.
 *   - **Awaiting evidence is its own visual** — distinct from "low tier".
 *     The educator must be able to tell "we don't know yet" from "they're at the
 *     bottom tier" at a glance.
 *   - **Colour is never the only signal.** Each tier has a glyph (▢●◐◑◉) and a
 *     spelled-out label. Colourblind-safe by construction; tooltips spell the name.
 *   - **Use CSS tokens only** — never hardcoded hex. Matches `ui-design-system.md`.
 *
 * Tier schemes supported (matches `KNOWN_TIER_SCHEMES` in
 * `lib/wizard/project-course-reference.ts`):
 *
 *   - 3-tier: `emerging`, `developing`, `secure`
 *   - 4-tier (CTO): `foundation`, `developing`, `practitioner`, `distinction`
 *   - 6-tier (CEFR): `a1` `a2` `b1` `b2` `c1` `c2`
 *   - Unknown tier names fall back to muted grey + the `?` glyph (the
 *     `parseSkillsFramework` parser already warns `SKILL_UNRECOGNISED_TIER_SCHEME`
 *     before we render — this is a defence-in-depth fallback).
 *
 * Plus two special states outside any tier scheme:
 *
 *   - `awaiting_evidence` — measurement hasn't happened yet (`CallerTarget.currentScore` NULL)
 *   - `above_target` — exceeded the educator's target tier (rare; small `↑` chip + brighter green)
 */

/** Lowercase tier name, the canonical form used in `tierScheme` arrays. */
export type TierName = string;

/**
 * Special states outside the tier scheme. Use these literals when calling
 * `tierColor()` etc. to render the "awaiting" + "above target" cells.
 */
export const AWAITING_EVIDENCE = "awaiting_evidence" as const;
export const ABOVE_TARGET = "above_target" as const;

/** Glyph per tier name. Returns "?" for unknown tiers (defence-in-depth). */
export function tierGlyph(tierName: TierName): string {
  switch (tierName) {
    case AWAITING_EVIDENCE:
      return "▢";
    case "emerging":
    case "foundation":
    case "a1":
      return "●"; // cold end of the scale
    case "developing":
    case "a2":
    case "b1":
      return "◐";
    case "secure":
    case "practitioner":
    case "b2":
    case "c1":
      return "◑";
    case "distinction":
    case "c2":
      return "◉"; // hot end of the scale
    case ABOVE_TARGET:
      return "↑";
    default:
      return "?";
  }
}

/**
 * CSS colour token for the given tier name. Always a CSS var or `color-mix()`
 * expression — never a hardcoded hex. Consumers spread this onto
 * `style={{ color: ... }}` or `style={{ background: ... }}` directly.
 *
 * Cold → hot mapping intentionally avoids red at the bottom (educator-facing
 * surfaces — red carries "wrong/error" semantics that's wrong for "lowest tier"):
 *
 *   awaiting_evidence  → muted grey
 *   3-tier:  emerging → muted teal · developing → amber · secure → green
 *   4-tier:  foundation → muted teal · developing → muted amber ·
 *            practitioner → amber · distinction → green
 *   CEFR:    A1→A2→B1 ramp teal · B2 amber · C1 → C2 green
 *   above_target → brighter green (mix of success + accent)
 */
export function tierColor(tierName: TierName): string {
  switch (tierName) {
    case AWAITING_EVIDENCE:
      return "var(--text-muted)";
    // ── 3-tier (Emerging / Developing / Secure)
    case "emerging":
      return "color-mix(in srgb, var(--accent-primary) 45%, transparent)";
    case "developing":
      return "var(--status-warning-text)";
    case "secure":
      return "var(--status-success-text)";
    // ── 4-tier CTO (Foundation / Developing / Practitioner / Distinction)
    case "foundation":
      return "color-mix(in srgb, var(--accent-primary) 35%, transparent)";
    case "practitioner":
      return "color-mix(in srgb, var(--status-success-text) 60%, var(--status-warning-text))";
    case "distinction":
      return "var(--status-success-text)";
    // ── CEFR 6-tier (A1 A2 B1 B2 C1 C2)
    case "a1":
      return "color-mix(in srgb, var(--accent-primary) 30%, transparent)";
    case "a2":
      return "color-mix(in srgb, var(--accent-primary) 50%, transparent)";
    case "b1":
      return "var(--accent-primary)";
    case "b2":
      return "var(--status-warning-text)";
    case "c1":
      return "color-mix(in srgb, var(--status-success-text) 60%, var(--status-warning-text))";
    case "c2":
      return "var(--status-success-text)";
    // ── Special: above the educator's target tier
    case ABOVE_TARGET:
      return "color-mix(in srgb, var(--status-success-text) 85%, var(--accent-primary))";
    default:
      // Unknown tier — defence-in-depth fallback. The parser should have
      // emitted SKILL_UNRECOGNISED_TIER_SCHEME upstream.
      return "var(--text-muted)";
  }
}

/**
 * Title-case display label for a tier name. "emerging" → "Emerging".
 * Used by tooltips + the inline label next to the glyph.
 */
export function tierLabel(tierName: TierName): string {
  switch (tierName) {
    case AWAITING_EVIDENCE:
      return "Awaiting evidence";
    case ABOVE_TARGET:
      return "Above target";
    default:
      if (!tierName) return "Unknown";
      // CEFR codes stay uppercase.
      if (/^[abc][12]$/.test(tierName)) return tierName.toUpperCase();
      return tierName.charAt(0).toUpperCase() + tierName.slice(1);
  }
}

/**
 * Background colour for a heatmap cell — a softer version of `tierColor()`
 * so foreground glyph + label stay legible. Wraps with `color-mix()` to
 * 12% alpha against transparent, matching the existing `CohortLearningAggregate`
 * pattern at line 108.
 */
export function tierBackground(tierName: TierName): string {
  const base = tierColor(tierName);
  return `color-mix(in srgb, ${base} 12%, transparent)`;
}
