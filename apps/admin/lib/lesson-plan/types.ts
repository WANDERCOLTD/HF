/**
 * Lesson Plan Model Types
 *
 * Defines pedagogical model structures for lesson plan generation.
 * Teachers choose a model (5E, Spiral, etc.) and the system distributes
 * teaching points across well-structured sessions with per-session phases.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LessonPlanModel =
  | "direct_instruction"
  | "5e"
  | "spiral"
  | "mastery"
  | "project"
  | "comprehension_guided"
  | "discussion_socratic"
  | "coaching_structured";

export interface SessionMediaRef {
  mediaId: string;
  fileName?: string;
  captionText?: string | null;
  figureRef?: string | null;
  mimeType?: string;
}

export interface SessionPhase {
  /** Phase identifier (e.g., "hook", "direct_instruction", "guided_practice") */
  id: string;
  /** Human-readable label (e.g., "Hook — Real-world scenario") */
  label: string;
  /** Suggested duration in minutes */
  durationMins?: number;
  /** Which teachMethods suit this phase (recall_quiz, worked_example, etc.) */
  teachMethods?: string[];
  /** Subset of session LO refs for this phase */
  learningOutcomeRefs?: string[];
  /** AI-generated guidance text for the voice AI */
  guidance?: string;
  /** Materials attached to this specific phase */
  media?: SessionMediaRef[];
}

export interface LessonPlanModelConfig {
  /** Cognitive load cap — max new TPs per session (default 10) */
  maxTpsPerSession?: number;
  /** Insert review session every N modules (default 3) */
  reviewFrequency?: number;
  /** Assessment approach */
  assessmentStyle?: "formal" | "light" | "none";
}

// ---------------------------------------------------------------------------
// Enhanced lesson plan entry (backward compatible — phases + LO refs optional)
// ---------------------------------------------------------------------------

export interface EnhancedLessonPlanEntry {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string;
  estimatedDurationMins?: number;
  assertionCount?: number;
  /** Per-session phases from pedagogical model */
  phases?: SessionPhase[];
  /** Which learning outcomes this session covers (subset of module LOs) */
  learningOutcomeRefs?: string[];
  /** Explicit TP-to-session binding (educator-curated). Overrides learningOutcomeRefs matching at runtime. */
  assertionIds?: string[];
}

// ---------------------------------------------------------------------------
// Model definition shape (used by models.ts registry)
// ---------------------------------------------------------------------------

export interface PhaseTemplate {
  id: string;
  label: string;
  /** Fraction of session duration (0-1) */
  durationFraction: number;
  /** Which teachMethods are a natural fit for this phase */
  suitableTeachMethods: string[];
  /** Default guidance when AI doesn't provide specific guidance */
  defaultGuidance: string;
}

export interface LessonPlanModelDefinition {
  id: LessonPlanModel;
  label: string;
  description: string;
  /** Hint text for educators choosing a model */
  suitableFor: string;
  /** Default config values */
  defaults: Required<LessonPlanModelConfig>;
  /** Session sequencing rules (injected into AI prompt) */
  sessionPatternRules: string;
  /** Default phases per session type */
  phaseTemplates: Record<string, PhaseTemplate[]>;
  /** TP distribution hints for AI prompt */
  tpDistributionHints: string;
}

// ---------------------------------------------------------------------------
// Session viewer types (shared by JourneyRail, course detail, wizard)
// ---------------------------------------------------------------------------

export interface SessionEntry {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string | null;
  estimatedDurationMins?: number | null;
  assertionCount?: number | null;
  phases?: SessionPhase[] | null;
  learningOutcomeRefs?: string[] | null;
  assertionIds?: string[] | null;
  media?: SessionMediaRef[] | null;
  /** Educator sets — learners can skip this stop */
  isOptional?: boolean;
}

export interface StudentProgress {
  callerId: string;
  name: string;
  currentSession: number | null;
}

export interface SessionMediaMap {
  sessions: Array<{
    session: number;
    label: string;
    images: Array<SessionMediaRef & { mimeType: string }>;
  }>;
  unassigned: Array<SessionMediaRef & { mimeType: string }>;
  stats: { total: number; assigned: number; unassigned: number };
}
