/**
 * enum-sets.ts
 *
 * Canonical enum sets for every wizard / chat-tool input field that
 * carries a bounded value drawn from a registered union type. Extracted
 * from `lib/wizard/detect-course-config.ts` (which previously inlined
 * `VALID_INTERACTION_PATTERNS` / `VALID_TEACHING_MODES` / `VALID_AUDIENCE_IDS`
 * / `VALID_PLAN_EMPHASIS`) so the chat-wizard's `create_course` /
 * `update_setup` / `update_playbook_config` merge paths can reuse them.
 *
 * Story #1995 (live IELTS Speaking Practice incident, 2026-06-18):
 * `Playbook.config.teachingMode = "directive"` shipped to production —
 * a value from the `interactionPattern` union assigned to `teachingMode`
 * — crashing every ComposedPrompt build for new learners on the
 * playbook. PR #1993 added read-side defensive fallback; this module is
 * the write-side reuse fix that closes the gap on the chat-tool merge
 * path that bypassed `detect-course-config.ts`'s whitelist.
 *
 * The constants are the single source of truth: `detect-course-config.ts`
 * imports them and the chat-tool merge helpers + type guards in
 * `lib/content-trust/resolve-config.ts` import them so a future enum
 * extension only needs to land in ONE place.
 *
 * Lattice: this module is the producer side of the Wizard Config Write
 * Invariant (CHAIN-CONTRACTS.md §3 Link 3 sub-contract — Wizard Config
 * Write Invariant). The consumer is the COMPOSE-stage reader (every
 * transform that reads `PlaybookConfig.teachingMode` /
 * `interactionPattern` etc.).
 *
 * See `.claude/rules/wizard-enum-coverage.md`.
 */

// Type-only imports — these have zero runtime impact, so they don't
// participate in the module-evaluation order problem that bit #1995's
// first attempt (importing the runtime arrays from resolve-config
// reached an undefined value via the deeper composition / transform
// import graph). Runtime SETs are built from inline literals; the test
// file `tests/lib/chat/wizard-enum-validation.test.ts` pins
// `INTERACTION_PATTERN_ORDER` and `TEACHING_MODE_ORDER` equality
// against the resolve-config source so the two cannot diverge.
import type {
  InteractionPattern,
  TeachingMode,
  PlanEmphasis as ResolveConfigPlanEmphasis,
  LessonPlanModel as ResolveConfigLessonPlanModel,
  FirstCallMode as ResolveConfigFirstCallMode,
  ProgressionMode as ResolveConfigProgressionMode,
} from "@/lib/content-trust/resolve-config";
import {
  AUDIENCE_OPTIONS,
  type AudienceId,
} from "@/lib/prompt/composition/transforms/audience";

// ── Canonical sets (literals — kept in sync with the union sources by
//    the ratchet vitest at `tests/lib/chat/wizard-enum-validation.test.ts`) ─

/** WHAT the session does — the communication style. */
export const INTERACTION_PATTERN_ORDER: readonly InteractionPattern[] = [
  "socratic",
  "directive",
  "advisory",
  "coaching",
  "companion",
  "facilitation",
  "reflective",
  "open",
  "conversational-guide",
] as const;
export const VALID_INTERACTION_PATTERNS: ReadonlySet<string> = new Set<string>(
  INTERACTION_PATTERN_ORDER,
);

/** WHAT to emphasise — recall / comprehension / practice / syllabus. */
export const TEACHING_MODE_ORDER: readonly TeachingMode[] = [
  "recall",
  "comprehension",
  "practice",
  "syllabus",
] as const;
export const VALID_TEACHING_MODES: ReadonlySet<string> = new Set<string>(
  TEACHING_MODE_ORDER,
);

/** Audience id — `primary` / `secondary` / `sixth-form` / … */
export const VALID_AUDIENCE_IDS: ReadonlySet<string> = new Set<string>(
  AUDIENCE_OPTIONS.map((a) => a.id),
);

/** Plan emphasis — coverage shape (curriculum breadth vs depth). */
export type PlanEmphasis = ResolveConfigPlanEmphasis;
export const PLAN_EMPHASIS_ORDER: readonly PlanEmphasis[] = [
  "breadth",
  "balanced",
  "depth",
] as const;
export const VALID_PLAN_EMPHASIS: ReadonlySet<string> = new Set<string>(
  PLAN_EMPHASIS_ORDER,
);

/**
 * Lesson plan model — pedagogical structure. The union is shipped here
 * to give the chat-tool layer something to validate against; the
 * `PlaybookConfig.lessonPlanModel` field is currently typed `string`
 * because of historical free-form inputs from the file-upload extractor.
 * Tightening the type is tracked as a follow-on (see #1995 PR body).
 */
export type LessonPlanModel = ResolveConfigLessonPlanModel;
export const LESSON_PLAN_MODEL_ORDER: readonly LessonPlanModel[] = [
  "direct_instruction",
  "socratic",
  "5e",
  "spiral",
  "mastery",
  "project",
] as const;
export const VALID_LESSON_PLAN_MODELS: ReadonlySet<string> = new Set<string>(
  LESSON_PLAN_MODEL_ORDER,
);

/**
 * First-call mode — how the AI behaves on the learner's first session.
 * Mirrored from `PlaybookConfig.firstCallMode` (`lib/types/json-fields.ts`
 * #790).
 */
export type FirstCallMode = ResolveConfigFirstCallMode;
export const FIRST_CALL_MODE_ORDER: readonly FirstCallMode[] = [
  "onboarding",
  "teach_immediately",
  "baseline_assessment",
] as const;
export const VALID_FIRST_CALL_MODES: ReadonlySet<string> = new Set<string>(
  FIRST_CALL_MODE_ORDER,
);

/**
 * Progression mode — wizard-side choice between AI-led scheduling and
 * learner-picks-from-modules. Maps to `PlaybookConfig.modulesAuthored`
 * boolean (per `_reuse-config-merge.ts` #253). Tracked here so the
 * chat-tool schema can enum-validate the input even though the
 * persisted field is the boolean mirror.
 */
export type ProgressionMode = ResolveConfigProgressionMode;
export const PROGRESSION_MODE_ORDER: readonly ProgressionMode[] = [
  "learner-picks",
  "ai-led",
] as const;
export const VALID_PROGRESSION_MODES: ReadonlySet<string> = new Set<string>(
  PROGRESSION_MODE_ORDER,
);

// ── Type guards ───────────────────────────────────────────────

/**
 * The corresponding type guards live alongside the union types in
 * `lib/content-trust/resolve-config.ts` (`isTeachingMode`,
 * `isInteractionPattern`, …) for proximity to the union definitions —
 * importing the type and the guard from the same module is the project
 * convention. This file owns the SET data; that file owns the type
 * guards that read it.
 */

// Re-export the canonical types for consumers that prefer one import:
export type { InteractionPattern, TeachingMode, AudienceId };
