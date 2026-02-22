/**
 * Terminology Types & Helpers — Client-safe (no Prisma dependency)
 *
 * The unified 11-key TermMap is the canonical terminology type.
 * Resolution is now DB-driven via InstitutionType.terminology (see lib/terminology.ts).
 *
 * This file provides:
 * - TermKey / TermMap types (canonical, shared between server and client)
 * - String helpers: pluralize(), lc()
 * - Legacy types kept for backwards compatibility (deprecated)
 */

// ── Canonical Types (unified system) ────────────────────────

/** The 11 canonical term keys used across the app */
export type TermKey =
  | "domain"
  | "playbook"
  | "spec"
  | "caller"
  | "cohort"
  | "instructor"
  | "session"
  | "persona"
  | "supervisor"
  | "teach_action"
  | "learning_noun";

/** A complete terminology map — all 11 keys present, all strings */
export type TermMap = Record<TermKey, string>;

/** All 11 term keys in canonical order */
export const TERM_KEYS: TermKey[] = [
  "domain",
  "playbook",
  "spec",
  "caller",
  "cohort",
  "instructor",
  "session",
  "persona",
  "supervisor",
  "teach_action",
  "learning_noun",
];

/** Human-readable labels for term keys (used in admin UI) */
export const TERM_KEY_LABELS: Record<TermKey, string> = {
  domain: "Organization / Institution",
  playbook: "Curriculum / Plan",
  spec: "Content / Material",
  caller: "Learner / Participant",
  cohort: "Group / Class",
  instructor: "Teacher / Facilitator",
  session: "Call / Session",
  persona: "Agent Style / Role",
  supervisor: "Supervisor / Guide",
  teach_action: "Teaching Verb",
  learning_noun: "Learning Concept",
};

/**
 * Technical terms — neutral defaults. Only hardcoded fallback.
 * Shown to ADMIN/SUPERADMIN/SUPER_TESTER.
 */
export const TECHNICAL_TERMS: TermMap = {
  domain: "Institution",
  playbook: "Subject",
  spec: "Spec",
  caller: "Caller",
  cohort: "Cohort",
  instructor: "Instructor",
  session: "Session",
  persona: "Persona",
  supervisor: "Supervisor",
  teach_action: "Teach",
  learning_noun: "Learning",
};

// ── String helpers ──────────────────────────────────────────

/**
 * Simple English pluralization for terminology terms.
 * Handles common cases: Student→Students, Facility→Facilities, Coach→Coaches.
 */
export function pluralize(term: string): string {
  if (term.endsWith("y") && !/[aeiou]y$/i.test(term)) {
    return term.slice(0, -1) + "ies";
  }
  if (
    term.endsWith("s") ||
    term.endsWith("x") ||
    term.endsWith("ch") ||
    term.endsWith("sh")
  ) {
    return term + "es";
  }
  return term + "s";
}

/** Lowercase the first character (for mid-sentence use). */
export function lc(term: string): string {
  return term.charAt(0).toLowerCase() + term.slice(1);
}

// ── Legacy Types (deprecated — kept for backwards compatibility) ────

/**
 * @deprecated Use TermKey from the unified system instead.
 * Old System 1 keys: institution → domain, learner → caller
 */
export type LegacyTermKey =
  | "institution"
  | "cohort"
  | "learner"
  | "instructor"
  | "supervisor"
  | "session"
  | "persona";

/** @deprecated Use TermMap instead */
export type TerminologyProfile = Record<LegacyTermKey, string>;

/** @deprecated Presets are now DB-driven via InstitutionType table */
export type TerminologyPresetId =
  | "school"
  | "corporate"
  | "coaching"
  | "healthcare";

/** @deprecated Overrides are now DB-driven */
export type TerminologyOverrides = Partial<TerminologyProfile>;

/** @deprecated Config is now DB-driven */
export interface TerminologyConfig {
  preset: TerminologyPresetId;
  overrides?: TerminologyOverrides;
}

/** @deprecated Presets are now DB-driven via InstitutionType table */
export const TERMINOLOGY_PRESETS: Record<TerminologyPresetId, TerminologyProfile> = {
  school: {
    institution: "School",
    cohort: "Classroom",
    learner: "Student",
    instructor: "Teacher",
    supervisor: "My Teacher",
    session: "Lesson",
    persona: "Teaching Style",
  },
  corporate: {
    institution: "Organization",
    cohort: "Team",
    learner: "Employee",
    instructor: "Trainer",
    supervisor: "My Manager",
    session: "Training Session",
    persona: "Agent Style",
  },
  coaching: {
    institution: "Practice",
    cohort: "Group",
    learner: "Client",
    instructor: "Coach",
    supervisor: "My Coach",
    session: "Coaching Session",
    persona: "Coaching Style",
  },
  healthcare: {
    institution: "Facility",
    cohort: "Team",
    learner: "Patient",
    instructor: "Provider",
    supervisor: "My Provider",
    session: "Patient Session",
    persona: "Care Style",
  },
};

/** @deprecated Use TECHNICAL_TERMS as fallback */
export const DEFAULT_PRESET: TerminologyPresetId = "corporate";
export const DEFAULT_TERMINOLOGY: TerminologyProfile =
  TERMINOLOGY_PRESETS[DEFAULT_PRESET];

/**
 * @deprecated Use resolveTerminology() from lib/terminology.ts instead.
 * Kept for backwards compatibility during migration.
 */
export function resolveTerminology(
  config: TerminologyConfig | null | undefined
): TerminologyProfile {
  if (!config) return DEFAULT_TERMINOLOGY;
  const base = TERMINOLOGY_PRESETS[config.preset] ?? DEFAULT_TERMINOLOGY;
  if (!config.overrides) return base;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(config.overrides).filter(
        ([, v]) => v != null && v.trim() !== ""
      )
    ),
  } as TerminologyProfile;
}

/** @deprecated Presets are now DB-driven */
export const PRESET_OPTIONS: {
  id: TerminologyPresetId;
  label: string;
  description: string;
}[] = [
  { id: "school", label: "School", description: "School, Classroom, Student, Teacher" },
  { id: "corporate", label: "Corporate", description: "Organization, Team, Employee, Trainer" },
  { id: "coaching", label: "Coaching", description: "Practice, Group, Client, Coach" },
  { id: "healthcare", label: "Healthcare", description: "Facility, Team, Patient, Provider" },
];
