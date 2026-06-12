// ── Name-based type inference ───────────────────────────

const TYPE_PATTERNS: Array<{ pattern: RegExp; typeSlug: string }> = [
  { pattern: /\b(academy|school|college|sixth\s*form|primary|secondary|grammar|prep|nursery|kindergarten)\b/i, typeSlug: "school" },
  { pattern: /\b(hospital|clinic|nhs|health\s*(service|centre|center)|medical|surgery|dental)\b/i, typeSlug: "healthcare" },
  { pattern: /\b(gym|fitness|sport|athletic|martial\s*arts|swimming|tennis|yoga)\b/i, typeSlug: "coaching" },
  { pattern: /\b(foundation|charity|community|trust|volunteer|youth|church|mosque|synagogue|temple)\b/i, typeSlug: "community" },
  { pattern: /\b(training|workshop|bootcamp|course\s*provider|learning\s*centre)\b/i, typeSlug: "training" },
  { pattern: /\b(ltd|limited|inc|corp|plc|consulting|solutions|partners|agency|group)\b/i, typeSlug: "corporate" },
];

/**
 * Infer institution type from name patterns.
 * Returns the slug if a strong signal is found, null otherwise.
 */
export function inferTypeFromName(name: string): string | null {
  for (const { pattern, typeSlug } of TYPE_PATTERNS) {
    if (pattern.test(name)) return typeSlug;
  }
  return null;
}
