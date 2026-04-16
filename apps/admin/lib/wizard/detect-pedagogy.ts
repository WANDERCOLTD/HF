/**
 * detect-pedagogy.ts
 *
 * Scan the assertions extracted from a COURSE_REFERENCE document for
 * pedagogical intent signals — session cadence, adaptive mode, pedagogical
 * preset. Used by the V5 conversational wizard to populate
 * `setupData.coursePedagogy` so the proposal builder can override its
 * system defaults.
 *
 * This is a deterministic regex scan, not an AI call. The course-reference
 * template (`a-sample-docs/course-reference-template.md`) uses structured
 * markers like "Call duration: 12-15 minutes" and phrases like "decides
 * call-by-call" that make keyword detection reliable for the common cases.
 *
 * Fallback: when nothing is detected, returns null on every field. The
 * wizard then leaves session count and duration unset (open-ended /
 * continuous) unless the user specifies them.
 *
 * Issue #167.
 */

export type LessonPlanMode = "structured" | "continuous";

export type PedagogicalPreset =
  | "balanced"
  | "interleaved"
  | "comprehension"
  | "exam_prep"
  | "revision"
  | "confidence_build";

export interface DetectedPedagogy {
  /** "continuous" when the course reference explicitly describes an adaptive/per-call approach. */
  lessonPlanMode: LessonPlanMode | null;
  /** Minutes per call, e.g. 15. When a range is given like "12-15" we take the upper bound. */
  cadenceMinutesPerCall: number | null;
  /** Soft cap on total call budget, e.g. 10. Null means open-ended. */
  suggestedSessionCount: number | null;
  /** Pedagogical preset if a checkbox or explicit label was detected. */
  pedagogicalPreset: PedagogicalPreset | null;
  /**
   * Raw text snippets that triggered each detection — surfaced to the AI so
   * it can quote the educator's own wording back in the proposal.
   */
  detectedFrom: string[];
}

const CONTINUOUS_PHRASES = [
  "decides call-by-call",
  "decides call by call",
  "does not plan sessions",
  "do not plan sessions in advance",
  "doesn't plan sessions",
  "doesn't pre-plan",
  "does not pre-plan",
  "adaptive per-call",
  "per-call decision",
  "continuous mode",
  "adaptive continuous",
  "scheduler decides per call",
  "no fixed session plan",
  "call-by-call adaptive",
];

const PRESET_PATTERNS: Array<{ preset: PedagogicalPreset; patterns: RegExp[] }> = [
  {
    preset: "balanced",
    patterns: [/\[\s*x\s*\]\s*\*?\*?balanced/i, /pedagogical preset.*balanced/i],
  },
  {
    preset: "interleaved",
    patterns: [/\[\s*x\s*\]\s*\*?\*?interleaved/i, /pedagogical preset.*interleaved/i],
  },
  {
    preset: "comprehension",
    patterns: [/\[\s*x\s*\]\s*\*?\*?comprehension/i, /pedagogical preset.*comprehension/i],
  },
  {
    preset: "exam_prep",
    patterns: [/\[\s*x\s*\]\s*\*?\*?exam[\s-]?prep/i, /pedagogical preset.*exam[\s-]?prep/i],
  },
  {
    preset: "revision",
    patterns: [/\[\s*x\s*\]\s*\*?\*?revision/i, /pedagogical preset.*revision/i],
  },
  {
    preset: "confidence_build",
    patterns: [/\[\s*x\s*\]\s*\*?\*?confidence/i, /pedagogical preset.*confidence/i],
  },
];

/**
 * Scan a body of text (assertions joined together, or raw course-ref markdown)
 * for pedagogy signals. Returns null fields when nothing matches.
 */
export function detectPedagogy(bodyText: string): DetectedPedagogy {
  const result: DetectedPedagogy = {
    lessonPlanMode: null,
    cadenceMinutesPerCall: null,
    suggestedSessionCount: null,
    pedagogicalPreset: null,
    detectedFrom: [],
  };

  const lower = bodyText.toLowerCase();

  // ── Cadence: "12-15 minutes per call", "15 min calls", "Call duration: 15 minutes"
  // Take the upper bound of any range, clamped to [5, 120].
  const cadencePatterns = [
    /(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:min|minute|minutes?)\s*(?:per\s*)?call/gi,
    /call\s*duration\s*[:\-]\s*(\d{1,3})\s*(?:min|minute|minutes?)/gi,
    /(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:min|minute|minutes?)\b/gi,
    /(\d{1,3})\s*(?:min|minute|minutes?)\s*(?:per\s*)?call/gi,
  ];
  for (const pattern of cadencePatterns) {
    const match = pattern.exec(bodyText);
    if (match) {
      // Group 2 = upper bound of range, group 1 = single value or lower bound
      const upper = parseInt(match[2] || match[1], 10);
      if (upper >= 5 && upper <= 120) {
        result.cadenceMinutesPerCall = upper;
        result.detectedFrom.push(`cadence: "${match[0].trim()}"`);
        break;
      }
    }
  }

  // ── Continuous mode intent: phrase match (case-insensitive)
  for (const phrase of CONTINUOUS_PHRASES) {
    if (lower.includes(phrase)) {
      result.lessonPlanMode = "continuous";
      result.detectedFrom.push(`continuous: "${phrase}"`);
      break;
    }
  }

  // If cadence is short (≤20 min) AND no explicit "structured" signal, treat
  // as continuous. Short-call courses are adaptive by nature.
  if (
    result.lessonPlanMode === null &&
    result.cadenceMinutesPerCall !== null &&
    result.cadenceMinutesPerCall <= 20
  ) {
    result.lessonPlanMode = "continuous";
    result.detectedFrom.push(
      `inferred continuous from short cadence (${result.cadenceMinutesPerCall} min)`,
    );
  }

  // ── Total budget / suggested session count
  const budgetPatterns = [
    /total\s*budget[^.]*?(\d{1,3})\s*calls?/i,
    /(\d{1,3})\s*calls?\s*for\s*(?:a\s*)?(?:commercial|course|package)/i,
    /soft\s*cap[^.]*?(\d{1,3})/i,
  ];
  for (const pattern of budgetPatterns) {
    const match = pattern.exec(bodyText);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 100) {
        result.suggestedSessionCount = n;
        result.detectedFrom.push(`budget: "${match[0].trim()}"`);
        break;
      }
    }
  }

  // ── Pedagogical preset (checkboxes or explicit mentions)
  for (const { preset, patterns } of PRESET_PATTERNS) {
    for (const pat of patterns) {
      if (pat.test(bodyText)) {
        result.pedagogicalPreset = preset;
        result.detectedFrom.push(`preset: ${preset}`);
        break;
      }
    }
    if (result.pedagogicalPreset) break;
  }

  return result;
}

/**
 * Return true if at least one pedagogy field was detected.
 * Useful for deciding whether to override wizard defaults.
 */
export function hasPedagogy(p: DetectedPedagogy): boolean {
  return (
    p.lessonPlanMode !== null ||
    p.cadenceMinutesPerCall !== null ||
    p.suggestedSessionCount !== null ||
    p.pedagogicalPreset !== null
  );
}
