/**
 * Wizard Schema — valid options, field definitions, and slider configs
 * for the AI-guided Get Started V2 wizard.
 *
 * The AI references these when deciding what options to present.
 * The OptionPanel renders them as radio buttons / checklists.
 *
 * Pure data — no React, no side effects.
 */

// ── Option definitions ──────────────────────────────────

export interface WizardOption {
  value: string;
  label: string;
  description: string;
}

export interface SliderDef {
  key: string;
  label: string;
  low: string;
  high: string;
}

// ── Teaching approach ───────────────────────────────────

export const APPROACH_OPTIONS: WizardOption[] = [
  {
    value: "socratic",
    label: "Socratic",
    description: "Asks questions to guide learners to discover answers themselves.",
  },
  {
    value: "directive",
    label: "Directive",
    description: "Provides clear, structured instruction with explicit explanations.",
  },
  {
    value: "advisory",
    label: "Advisory",
    description: "Supportive coaching style — suggests rather than tells.",
  },
  {
    value: "coaching",
    label: "Coaching",
    description: "Builds self-awareness and goal-setting through reflective dialogue.",
  },
];

// ── Teaching emphasis ───────────────────────────────────

export const EMPHASIS_OPTIONS: WizardOption[] = [
  {
    value: "recall",
    label: "Recall",
    description: "Focus on remembering key facts, definitions, and terms.",
  },
  {
    value: "comprehension",
    label: "Comprehension",
    description: "Build understanding through explanation and worked examples.",
  },
  {
    value: "practice",
    label: "Practice",
    description: "Emphasise exercises, questions, and application of knowledge.",
  },
  {
    value: "syllabus",
    label: "Syllabus",
    description: "Strictly follow learning outcomes and assessment criteria.",
  },
];

// ── Session count ───────────────────────────────────────

export const SESSION_COUNT_OPTIONS: WizardOption[] = [
  { value: "3", label: "3 sessions", description: "Quick introduction or taster course." },
  { value: "5", label: "5 sessions", description: "Short course — one topic in depth." },
  { value: "8", label: "8 sessions", description: "Standard course — balanced coverage." },
  { value: "12", label: "12 sessions", description: "Full course — comprehensive coverage." },
];

// ── Duration ────────────────────────────────────────────

export const DURATION_OPTIONS: WizardOption[] = [
  { value: "15", label: "15 minutes", description: "Quick check-in or revision session." },
  { value: "30", label: "30 minutes", description: "Standard session — good for most topics." },
  { value: "45", label: "45 minutes", description: "Extended session — complex topics." },
  { value: "60", label: "60 minutes", description: "Full lesson — deep exploration." },
];

// ── Plan emphasis ───────────────────────────────────────

export const PLAN_EMPHASIS_OPTIONS: WizardOption[] = [
  {
    value: "breadth",
    label: "Breadth",
    description: "Cover all topics at a lighter level — good for revision or survey courses.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Mix of breadth and depth — AI decides per module based on learner progress.",
  },
  {
    value: "depth",
    label: "Depth",
    description: "Go deep on fewer topics — good for mastery-focused courses.",
  },
];

// ── Lesson plan model ───────────────────────────────────

export const LESSON_MODEL_OPTIONS: WizardOption[] = [
  {
    value: "direct",
    label: "Direct Instruction",
    description: "Structured, teacher-led. Explain → model → guided practice → independent practice.",
  },
  {
    value: "5e",
    label: "5E",
    description: "Engage → Explore → Explain → Elaborate → Evaluate. Great for science.",
  },
  {
    value: "spiral",
    label: "Spiral",
    description: "Revisit topics repeatedly with increasing complexity over time.",
  },
  {
    value: "mastery",
    label: "Mastery",
    description: "Must demonstrate mastery of each topic before advancing to the next.",
  },
  {
    value: "project",
    label: "Project-Based",
    description: "Learn through real-world projects. Good for applied/vocational courses.",
  },
];

// ── Personality sliders ─────────────────────────────────

export const PERSONALITY_SLIDERS: SliderDef[] = [
  { key: "warmth", label: "Warmth", low: "Professional", high: "Warm & friendly" },
  { key: "directiveness", label: "Directiveness", low: "Guided discovery", high: "Direct instruction" },
  { key: "pace", label: "Pace", low: "Slower, thorough", high: "Faster, efficient" },
  { key: "encouragement", label: "Encouragement", low: "Measured", high: "Highly encouraging" },
];

// ── Audience ──────────────────────────────────────────

export const AUDIENCE_OPTIONS: WizardOption[] = [
  { value: "primary", label: "Primary (KS1-2)", description: "Age 5-11. Simple, warm, encouraging. One idea at a time." },
  { value: "secondary", label: "Secondary (KS3-4)", description: "Age 11-16. Clear, accessible, relatable. No condescension." },
  { value: "sixth-form", label: "Sixth Form (KS5)", description: "Age 16-19. Academic vocabulary, intellectual challenge." },
  { value: "higher-ed", label: "Higher Education", description: "Age 18-25. Full academic register, self-directed." },
  { value: "adult-professional", label: "Professional / Corporate", description: "Working adults. Professional, efficient, outcome-focused." },
  { value: "adult-casual", label: "Adult Learner", description: "Age 18+. Conversational, warm, no jargon." },
];

// ── Institution types ───────────────────────────────────

export const INSTITUTION_TYPE_OPTIONS: WizardOption[] = [
  { value: "school", label: "School", description: "Primary, secondary, or sixth form." },
  { value: "healthcare", label: "Healthcare", description: "Hospital, clinic, or health service." },
  { value: "community", label: "Community", description: "Charity, foundation, or community group." },
  { value: "coaching", label: "Coaching", description: "Gym, fitness, sport, or personal training." },
  { value: "training", label: "Training", description: "Training provider or workshop organiser." },
  { value: "corporate", label: "Corporate", description: "Company, consulting, or professional services." },
];

// ── Field metadata ──────────────────────────────────────

export interface WizardFieldDef {
  key: string;
  label: string;
  required: boolean;
  group: "institution" | "course" | "content" | "welcome" | "tune";
  /** Skip for community kind */
  skipForCommunity?: boolean;
}

export const WIZARD_FIELDS: WizardFieldDef[] = [
  // Institution
  { key: "institutionName", label: "Organisation name", required: true, group: "institution" },
  { key: "typeSlug", label: "Organisation type", required: false, group: "institution" },
  { key: "websiteUrl", label: "Website URL", required: false, group: "institution" },
  // Course
  { key: "courseName", label: "Course name", required: true, group: "course" },
  { key: "subjectDiscipline", label: "Subject area", required: false, group: "course" },
  { key: "interactionPattern", label: "Teaching approach", required: true, group: "course" },
  { key: "audience", label: "Student audience", required: false, group: "course" },
  { key: "teachingMode", label: "Teaching emphasis", required: false, group: "course", skipForCommunity: true },
  // Welcome
  { key: "welcomeMessage", label: "Welcome message", required: false, group: "welcome" },
  { key: "sessionCount", label: "Number of sessions", required: false, group: "welcome", skipForCommunity: true },
  { key: "durationMins", label: "Session duration", required: false, group: "welcome" },
  { key: "planEmphasis", label: "Breadth vs depth", required: false, group: "welcome", skipForCommunity: true },
  // Tune
  { key: "behaviorTargets", label: "Personality", required: false, group: "tune" },
  { key: "lessonPlanModel", label: "Lesson plan model", required: false, group: "tune", skipForCommunity: true },
  { key: "physicalMaterials", label: "Physical materials", required: false, group: "course", skipForCommunity: true },
];

// ── Scaffold panel step mapping ─────────────────────────

export const SCAFFOLD_STEPS = [
  "institution",
  "course",
  "content",
  "welcome",
  "tune",
] as const;

// ── Phase definitions (conversational form scaffold) ────

export interface WizardPhase {
  id: string;
  label: string;
  /** Field keys that belong to this phase (empty = special step like content/launch) */
  fields: string[];
}

export const WIZARD_PHASES: WizardPhase[] = [
  { id: "institution", label: "Organisation", fields: ["institutionName", "typeSlug", "websiteUrl"] },
  { id: "subject", label: "Subject", fields: ["subjectDiscipline"] },
  { id: "course", label: "Course", fields: ["courseName", "interactionPattern", "audience", "teachingMode", "physicalMaterials"] },
  { id: "content", label: "Content", fields: [] },
  { id: "welcome", label: "Welcome", fields: ["welcomeMessage", "sessionCount", "durationMins", "planEmphasis"] },
  { id: "tune", label: "Fine-Tune", fields: ["behaviorTargets", "lessonPlanModel"] },
  { id: "launch", label: "Launch", fields: [] },
];

/**
 * Compute the current wizard phase based on collected data.
 *
 * Phase advancement rules:
 * - Phases WITH required fields: advance once all required fields are filled
 *   (optional fields are listed but don't block)
 * - Phases with ONLY optional fields: advance once at least one field is collected
 *   (i.e., the user has visited the phase)
 * - Content phase: advance if content uploaded OR explicitly skipped (contentSkipped flag)
 */
export function computeCurrentPhase(
  setupData: Record<string, unknown>,
  isCommunity: boolean,
): { phase: WizardPhase; phaseIndex: number; phaseFields: string[] } {
  const skipFields = isCommunity
    ? WIZARD_FIELDS.filter((f) => f.skipForCommunity).map((f) => f.key)
    : [];

  const hasValue = (v: unknown) => v !== undefined && v !== null && v !== "";

  for (let i = 0; i < WIZARD_PHASES.length; i++) {
    const phase = WIZARD_PHASES[i];
    const fields = phase.fields.filter((f) => !skipFields.includes(f));

    // Content phase: check for packSubjectIds, sourceId, or explicit skip
    if (phase.id === "content") {
      if (isCommunity) continue;
      const hasContent = !!(
        (setupData.packSubjectIds as string[] | undefined)?.length ||
        setupData.sourceId ||
        setupData.contentSkipped
      );
      if (!hasContent) return { phase, phaseIndex: i, phaseFields: fields };
      continue;
    }

    // Launch phase: we've reached the end
    if (phase.id === "launch") {
      return { phase, phaseIndex: i, phaseFields: [] };
    }

    const requiredFields = fields.filter((f) => {
      const def = WIZARD_FIELDS.find((wf) => wf.key === f);
      return def?.required;
    });
    const uncollectedRequired = requiredFields.filter((f) => !hasValue(setupData[f]));
    const collectedAny = fields.some((f) => hasValue(setupData[f]));

    // All-optional phases can be explicitly skipped (e.g. user says "Skip for now" for every field)
    const phaseSkipKey = `${phase.id}Skipped`;
    const phaseSkipped = !!setupData[phaseSkipKey];

    // Phase blocks if:
    // (a) it has uncollected required fields, OR
    // (b) it has NO required fields and NO fields collected yet AND not explicitly skipped
    const shouldBlock = uncollectedRequired.length > 0
      || (requiredFields.length === 0 && !collectedAny && !phaseSkipped);

    if (shouldBlock) {
      const allUncollected = fields.filter((f) => !hasValue(setupData[f]));
      return { phase, phaseIndex: i, phaseFields: allUncollected };
    }
  }

  return { phase: WIZARD_PHASES[WIZARD_PHASES.length - 1], phaseIndex: WIZARD_PHASES.length - 1, phaseFields: [] };
}
