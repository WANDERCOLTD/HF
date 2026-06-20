/**
 * detect-course-config.ts
 *
 * Scan course reference text for the structured "Course Configuration"
 * block added in template v3.0. Extracts machine-readable config fields
 * (teaching approach, emphasis, audience, coverage, course name, subject,
 * learning outcomes) using deterministic regex — zero AI calls.
 *
 * Sibling to detect-pedagogy.ts. Called from the same combinedText pass
 * in ConversationalWizard after course-ref extraction completes.
 *
 * Issue #179.
 */

import {
  type InteractionPattern,
  type TeachingMode,
} from "@/lib/content-trust/resolve-config";
import {
  type AudienceId,
} from "@/lib/prompt/composition/transforms/audience";
import type { SchedulerPresetName } from "@/lib/pipeline/scheduler-presets";
import {
  VALID_INTERACTION_PATTERNS,
  VALID_TEACHING_MODES,
  VALID_AUDIENCE_IDS,
  VALID_PLAN_EMPHASIS,
} from "@/lib/wizard/enum-sets";

// ── Types ──────────────────────────────────────────────────

export interface DetectedCourseConfig {
  courseName: string | null;
  subjectDiscipline: string | null;
  interactionPattern: InteractionPattern | null;
  teachingMode: TeachingMode | null;
  audience: AudienceId | null;
  planEmphasis: "breadth" | "balanced" | "depth" | null;
  pedagogicalPreset: SchedulerPresetName | null;
  learningOutcomes: string[] | null;
  /** Raw text snippets that triggered each detection. */
  detectedFrom: string[];
}

// ── Whitelists ─────────────────────────────────────────────

// VALID_INTERACTION_PATTERNS / VALID_TEACHING_MODES / VALID_AUDIENCE_IDS /
// VALID_PLAN_EMPHASIS now live at `lib/wizard/enum-sets.ts` so the chat
// wizard's create_course / update_setup merge paths can reuse them
// (#1995). Importing keeps this module's behaviour byte-identical while
// sharing the single source of truth.

// ── Checkbox label → enum value mappings ───────────────────

const INTERACTION_LABEL_MAP: Record<string, InteractionPattern> = {
  socratic: "socratic",
  directive: "directive",
  advisory: "advisory",
  coaching: "coaching",
  companion: "companion",
  facilitation: "facilitation",
  reflective: "reflective",
  open: "open",
  "conversational guide": "conversational-guide",
};

const TEACHING_MODE_LABEL_MAP: Record<string, TeachingMode> = {
  recall: "recall",
  comprehension: "comprehension",
  practice: "practice",
  syllabus: "syllabus",
};

const AUDIENCE_LABEL_MAP: Record<string, AudienceId> = {
  primary: "primary",
  secondary: "secondary",
  "sixth form": "sixth-form",
  "higher education": "higher-ed",
  professional: "adult-professional",
  "adult learner": "adult-casual",
  mixed: "mixed",
};

const EMPHASIS_LABEL_MAP: Record<string, "breadth" | "balanced" | "depth"> = {
  breadth: "breadth",
  balanced: "balanced",
  depth: "depth",
};

const PRESET_LABEL_MAP: Record<string, SchedulerPresetName> = {
  balanced: "BALANCED",
  interleaved: "INTERLEAVED",
  comprehension: "COMPREHENSION",
  "exam prep": "EXAM_PREP",
  revision: "REVISION",
  "confidence-building": "CONFIDENCE_BUILD",
};

const VALID_PRESETS = new Set<string>(Object.values(PRESET_LABEL_MAP));

// ── Helpers ────────────────────────────────────────────────

/** Match a checked checkbox: `[x]`, `[X]`, `[ x ]`, `[ X ]` followed by bold label. */
function findCheckedCheckbox(
  bodyText: string,
  labelMap: Record<string, string>,
): { value: string; match: string } | null {
  // Pattern: - [x] **Label** (with flexible spacing)
  const regex = /- \[\s*[xX]\s*\]\s*\*\*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(bodyText)) !== null) {
    const label = m[1].trim().toLowerCase();
    const mapped = labelMap[label];
    if (mapped) {
      return { value: mapped, match: m[0] };
    }
  }
  return null;
}

/** Extract a **Key:** value field. */
function extractField(bodyText: string, key: string): string | null {
  const regex = new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i");
  const m = regex.exec(bodyText);
  if (!m) return null;
  const val = m[1].trim();
  // Skip template placeholders like [Full course name]
  if (/^\[.*\]$/.test(val)) return null;
  return val || null;
}

// ── Main detector ──────────────────────────────────────────

const MAX_LEARNING_OUTCOMES = 30;

export function detectCourseConfig(bodyText: string): DetectedCourseConfig {
  const result: DetectedCourseConfig = {
    courseName: null,
    subjectDiscipline: null,
    interactionPattern: null,
    teachingMode: null,
    audience: null,
    planEmphasis: null,
    pedagogicalPreset: null,
    learningOutcomes: null,
    detectedFrom: [],
  };

  // ── Course name: explicit field first, then H1 title fallback
  const nameField = extractField(bodyText, "Course name");
  if (nameField) {
    result.courseName = nameField;
    result.detectedFrom.push(`courseName: "${nameField}"`);
  } else {
    const h1Match = bodyText.match(/^#\s+(.+?)\s*[—–-]\s*Course Reference/m);
    if (h1Match) {
      const title = h1Match[1].trim();
      if (title && !title.startsWith("[")) {
        result.courseName = title;
        result.detectedFrom.push(`courseName (H1): "${title}"`);
      }
    }
  }

  // ── Subject / qualification
  const subjectField =
    extractField(bodyText, "Subject / qualification") ||
    extractField(bodyText, "Subject");
  if (subjectField) {
    result.subjectDiscipline = subjectField;
    result.detectedFrom.push(`subject: "${subjectField}"`);
  }

  // ── Interaction pattern (teaching approach checkbox)
  const ipResult = findCheckedCheckbox(bodyText, INTERACTION_LABEL_MAP);
  if (ipResult) {
    if (VALID_INTERACTION_PATTERNS.has(ipResult.value)) {
      result.interactionPattern = ipResult.value as InteractionPattern;
      result.detectedFrom.push(`interactionPattern: "${ipResult.value}"`);
    } else {
      result.detectedFrom.push(
        `interactionPattern REJECTED (invalid): "${ipResult.value}"`,
      );
    }
  }

  // ── Teaching mode (teaching emphasis checkbox)
  const tmResult = findCheckedCheckbox(bodyText, TEACHING_MODE_LABEL_MAP);
  if (tmResult) {
    if (VALID_TEACHING_MODES.has(tmResult.value)) {
      result.teachingMode = tmResult.value as TeachingMode;
      result.detectedFrom.push(`teachingMode: "${tmResult.value}"`);
    } else {
      result.detectedFrom.push(
        `teachingMode REJECTED (invalid): "${tmResult.value}"`,
      );
    }
  }

  // ── Audience (student audience checkbox)
  const audResult = findCheckedCheckbox(bodyText, AUDIENCE_LABEL_MAP);
  if (audResult) {
    if (VALID_AUDIENCE_IDS.has(audResult.value)) {
      result.audience = audResult.value as AudienceId;
      result.detectedFrom.push(`audience: "${audResult.value}"`);
    } else {
      result.detectedFrom.push(
        `audience REJECTED (invalid): "${audResult.value}"`,
      );
    }
  }

  // ── Plan emphasis (coverage emphasis checkbox)
  const empResult = findCheckedCheckbox(bodyText, EMPHASIS_LABEL_MAP);
  if (empResult) {
    if (VALID_PLAN_EMPHASIS.has(empResult.value)) {
      result.planEmphasis = empResult.value as "breadth" | "balanced" | "depth";
      result.detectedFrom.push(`planEmphasis: "${empResult.value}"`);
    } else {
      result.detectedFrom.push(
        `planEmphasis REJECTED (invalid): "${empResult.value}"`,
      );
    }
  }

  // ── Pedagogical preset (scoped to "## Pedagogical Preset" section to avoid
  //    "Balanced" collision with the Coverage emphasis section above)
  const presetHeadingIdx = bodyText.search(/^##\s+Pedagogical Preset/m);
  if (presetHeadingIdx !== -1) {
    // Slice from heading to next ## or end-of-document
    const nextHeading = bodyText.indexOf("\n## ", presetHeadingIdx + 1);
    const presetSection = nextHeading !== -1
      ? bodyText.slice(presetHeadingIdx, nextHeading)
      : bodyText.slice(presetHeadingIdx);

    const presetResult = findCheckedCheckbox(presetSection, PRESET_LABEL_MAP);
    if (presetResult) {
      if (VALID_PRESETS.has(presetResult.value)) {
        result.pedagogicalPreset = presetResult.value as SchedulerPresetName;
        result.detectedFrom.push(`pedagogicalPreset: "${presetResult.value}"`);
      } else {
        result.detectedFrom.push(
          `pedagogicalPreset REJECTED (invalid): "${presetResult.value}"`,
        );
      }
    }
  }

  // ── Learning outcomes: OUT-XX lines with "The learner can:" statements
  const outcomeRegex =
    /\*\*OUT-\d+:\s*(.+?)\*\*[\s\S]*?\*The learner can:\*\s*(.+)/g;
  const outcomes: string[] = [];
  let om: RegExpExecArray | null;
  while ((om = outcomeRegex.exec(bodyText)) !== null) {
    if (outcomes.length >= MAX_LEARNING_OUTCOMES) break;
    const statement = om[2].trim();
    // Skip template placeholders
    if (statement.startsWith("[") && statement.endsWith("]")) continue;
    if (statement) outcomes.push(statement);
  }
  if (outcomes.length > 0) {
    result.learningOutcomes = outcomes;
    result.detectedFrom.push(`learningOutcomes: ${outcomes.length} found`);
  }

  return result;
}

/**
 * Return true if at least one config field was detected.
 */
export function hasCourseConfig(c: DetectedCourseConfig): boolean {
  return (
    c.courseName !== null ||
    c.subjectDiscipline !== null ||
    c.interactionPattern !== null ||
    c.teachingMode !== null ||
    c.audience !== null ||
    c.planEmphasis !== null ||
    c.pedagogicalPreset !== null ||
    c.learningOutcomes !== null
  );
}
