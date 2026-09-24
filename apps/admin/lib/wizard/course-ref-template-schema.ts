/**
 * Course Reference Template — machine-readable schema export
 *
 * #1932 (epic #1931 Template Authority — S0)
 *
 * Hand-curated source-of-truth describing every machine-readable field
 * the Course Reference Template (`a-sample-docs/course-reference-template.md`)
 * declares. Conformance validators (S1+) walk this schema to compare an
 * uploaded course-ref instance against the template.
 *
 * Rationale (epic #1931 locked decision 2):
 *
 *   Generate-from-markdown is brittle — the template carries free-form
 *   prose, HTML comments, table layouts, and example YAML blocks that
 *   parsers can't usefully distinguish from "the contract". Hand-curated
 *   TypeScript is the source-of-truth: when a field changes, the human
 *   updates this file AND the template prose. The fixture↔type coverage
 *   gate (`tests/lib/wizard/fixture-type-coverage.test.ts`) is the
 *   structural backstop ensuring every YAML key in a v2.3+ fixture has
 *   a typed home on `AuthoredModuleSettings`.
 *
 * Mirrors the JOURNEY_SETTINGS pattern: one row per field, every row
 * has `{ name, sinceVersion, shape, required, appliesTo, composeImpact,
 * deprecation? }`.
 *
 * The set of fields is intentionally TYPE-AS-DATA — when adding a new
 * G8 field to `AuthoredModuleSettings`, add the corresponding row here
 * in the same PR. The bidirectional gate test pins the relationship.
 */

import type { CourseShape } from "@/lib/journey/setting-contracts";

// ── Types ─────────────────────────────────────────────────────────────

/** What does THIS field control downstream? */
export interface ComposeImpact {
  /** Composer section keys the field is read from. Empty when no compose impact. */
  sections: string[];
}

/** One field's schema row. */
export interface TemplateFieldSchema {
  /** The canonical name used in YAML AND in the TypeScript type. */
  name: string;
  /** The template version that introduced this field. */
  sinceVersion: string;
  /**
   * One-line TypeScript-flavoured shape declaration. Not a parseable
   * type — a debug breadcrumb so humans can compare the template doc
   * + the `AuthoredModuleSettings` interface at a glance.
   */
  shape: string;
  /**
   * `true` for fields the conformance validator treats as required when
   * the instance declares `hf-template-version`. Most G8 fields are
   * `false` (optional) since the parser tolerates per-module omission.
   */
  required: boolean;
  /**
   * Which course shapes this field applies to. Empty array = applies
   * to all shapes. Mirrors `JourneySettingContract.appliesTo`.
   */
  appliesTo: CourseShape[];
  /** Compose impact — empty `sections` when the field is runtime-only. */
  composeImpact: ComposeImpact;
  /**
   * Optional deprecation marker. When set, the conformance validator
   * emits a warn-only "deprecated field" message rather than a clean
   * pass.
   */
  deprecation?: {
    removedIn: string;
    reason: string;
  };
}

/** Top-level container — fields grouped by where they live in the doc. */
export interface TemplateSchema {
  /** The template's own version. */
  templateVersion: string;
  /**
   * Front-matter keys (e.g. `hf-template-version`, `hf-scoring-mode`).
   * Hand-curated; not exhaustive — only the schema-meaningful keys.
   */
  frontMatter: TemplateFieldSchema[];
  /**
   * Per-module settings block keys (the YAML inside
   * `#### Module N — <Label> — Settings`). Maps 1:1 to
   * `AuthoredModuleSettings` members.
   */
  perModuleSettings: TemplateFieldSchema[];
}

// ── Schema rows ──────────────────────────────────────────────────────

const FRONT_MATTER_FIELDS: TemplateFieldSchema[] = [
  {
    name: "hf-template-version",
    sinceVersion: "5.1",
    shape: 'string (dot-separated digits, e.g. "5.1")',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
  {
    name: "hf-document-type",
    sinceVersion: "3.0",
    shape:
      '"COURSE_REFERENCE" | "COURSE_REFERENCE_CANONICAL" | "COURSE_REFERENCE_ASSESSOR_RUBRIC" | "COURSE_REFERENCE_TUTOR_BRIEFING"',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
  {
    name: "hf-default-category",
    sinceVersion: "3.0",
    shape: '"teaching_rule" | <other InstructionCategory>',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
  {
    name: "hf-audience",
    sinceVersion: "3.0",
    shape: '"learner" | "tutor-only" | "assessor-only"',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
  {
    name: "hf-lo-system-role",
    sinceVersion: "3.0",
    shape:
      '"NONE" | "ASSESSOR_RUBRIC" | "ITEM_GENERATOR_SPEC" | "SCORE_EXPLAINER" | "TEACHING_INSTRUCTION"',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
  {
    name: "hf-scoring-mode",
    sinceVersion: "3.0",
    shape: '"evidence-first"',
    required: false,
    appliesTo: [],
    composeImpact: { sections: [] },
  },
];

const PER_MODULE_SETTINGS_FIELDS: TemplateFieldSchema[] = [
  {
    name: "minSpeakingSec",
    sinceVersion: "5.1",
    shape: "number",
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: [] }, // runtime-only — endSession gate
  },
  {
    name: "questionTarget",
    sinceVersion: "5.1",
    shape: "{ min: number; target: number }",
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: ["instructions"] },
  },
  {
    name: "cueCardPool",
    sinceVersion: "5.1",
    shape: "Array<{ topic: string; bullets: string[] }>",
    required: false,
    appliesTo: ["exam"],
    composeImpact: { sections: ["instructions"] },
  },
  {
    name: "topicPool",
    sinceVersion: "5.1",
    shape: "Array<{ topic: string; questions: string[] }>",
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: ["instructions"] },
  },
  {
    name: "closingLine",
    sinceVersion: "5.1",
    shape: "string",
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: ["offboarding"] },
  },
  {
    name: "firstTimeOrientationLine",
    sinceVersion: "5.1",
    shape: "string",
    required: false,
    appliesTo: ["exam"],
    composeImpact: { sections: ["onboarding"] },
  },
  {
    name: "scheduledCues",
    sinceVersion: "5.1",
    shape: "Array<{ at: number; text: string; phase?: string }>",
    required: false,
    appliesTo: ["exam"],
    composeImpact: { sections: [] }, // runtime — cue scheduler reads
  },
  {
    name: "scaffoldPool",
    sinceVersion: "5.1",
    shape: "string[]",
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: [] }, // runtime — client-side stall detector
  },
  {
    name: "profileFieldsToCapture",
    sinceVersion: "5.1",
    shape:
      'Array<{ key: string; prompt: string; type: "text" | "number" | "band" }>',
    required: false,
    appliesTo: ["structured", "exam"],
    composeImpact: { sections: ["instructions"] },
  },
];

// ── Public export ────────────────────────────────────────────────────

/**
 * The canonical machine-readable schema for the Course Reference
 * Template at version 5.1.
 *
 * S0 (this PR): exported; conformance validator (S1) consumes it.
 * S1+: conformance verdict shape `{ unknownFields, missingRequired,
 * deprecated, drift, templateAhead }` walks both arrays.
 */
export const TEMPLATE_V5_SCHEMA: TemplateSchema = {
  templateVersion: "5.1",
  frontMatter: FRONT_MATTER_FIELDS,
  perModuleSettings: PER_MODULE_SETTINGS_FIELDS,
};

/** Convenience map keyed by field name (per-module side only). */
export const TEMPLATE_V5_PER_MODULE_BY_NAME: Readonly<
  Record<string, TemplateFieldSchema>
> = Object.freeze(
  Object.fromEntries(PER_MODULE_SETTINGS_FIELDS.map((f) => [f.name, f])),
);

/** Convenience map keyed by field name (front-matter side). */
export const TEMPLATE_V5_FRONT_MATTER_BY_NAME: Readonly<
  Record<string, TemplateFieldSchema>
> = Object.freeze(
  Object.fromEntries(FRONT_MATTER_FIELDS.map((f) => [f.name, f])),
);
