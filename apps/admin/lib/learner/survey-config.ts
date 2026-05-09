import type { PlaybookConfig, SurveyStepConfig } from "@/lib/types/json-fields";
import { config } from "@/lib/config";
import { ContractRegistry } from "@/lib/contracts/registry";

// ---------------------------------------------------------------------------
// Pre-survey enabled — derived from welcome flow toggles
// ---------------------------------------------------------------------------

/**
 * True iff at least one Welcome-flow / Intake phase is enabled.
 *
 * Read precedence (matches resolveSessionFlow().intake):
 *   1. `playbook.config.sessionFlow.intake.*` — canonical shape (#221)
 *   2. `playbook.config.welcome.*`             — legacy mirror (Course Design tab + wizard)
 *   3. DEFAULT_INTAKE_CONFIG                   — empty playbook config
 *
 * `aiIntroCall` is intentionally excluded — it gates a separate intro call,
 * not the in-call discovery / pre-survey scaffolding.
 */
export function isPreSurveyEnabled(pbConfig: PlaybookConfig | null | undefined): boolean {
  const intake = pbConfig?.sessionFlow?.intake;
  if (intake) {
    return intake.goals.enabled
        || intake.aboutYou.enabled
        || intake.knowledgeCheck.enabled;
  }
  const w = pbConfig?.welcome;
  return (w?.goals?.enabled ?? true)
      || (w?.aboutYou?.enabled ?? true)
      || (w?.knowledgeCheck?.enabled ?? false);
}

// ---------------------------------------------------------------------------
// Survey end action — what happens after a survey is submitted
// ---------------------------------------------------------------------------

export type SurveyEndAction =
  | { type: "next_stop" }
  | { type: "redirect"; path: string }
  | { type: "summary"; variant: "form_echo"; thenAction?: "next_stop" | "redirect"; thenPath?: string };

// ---------------------------------------------------------------------------
// Contract-backed survey template loader
// ---------------------------------------------------------------------------

export interface SurveyTemplate {
  label: string;
  description: string;
  defaultPosition: "before_first" | "halfway" | "after_last";
  defaultEnabled: boolean;
  scope: string;
  questions: SurveyStepConfig[];
  endAction?: SurveyEndAction;
}

export interface SurveyTemplateConfig {
  templates: {
    pre_survey: SurveyTemplate;
    post_survey: SurveyTemplate;
  };
}

let _cached: SurveyTemplateConfig | null = null;

/** Load survey templates from SURVEY_TEMPLATES_V1 contract. Falls back to hardcoded defaults. */
export async function getSurveyTemplateConfig(): Promise<SurveyTemplateConfig> {
  if (_cached) return _cached;

  try {
    const contract = await ContractRegistry.getContract(config.specs.surveyTemplates);
    if (contract?.config?.templates) {
      _cached = contract.config as SurveyTemplateConfig;
      return _cached;
    }
  } catch {
    // Fall through to fallback
  }

  _cached = FALLBACK_SURVEY_TEMPLATES;
  return _cached;
}

/** Get default questions for a specific survey type. */
export async function getDefaultSurveyQuestions(
  type: "pre_survey" | "post_survey",
): Promise<SurveyStepConfig[]> {
  const cfg = await getSurveyTemplateConfig();
  return cfg.templates[type]?.questions ?? [];
}

// ---------------------------------------------------------------------------
// Hardcoded fallback (backward compat)
// ---------------------------------------------------------------------------

export const DEFAULT_ONBOARDING_SURVEY: SurveyStepConfig[] = [
  {
    id: "confidence",
    type: "stars",
    prompt: "How confident are you in {subject} right now?",
  },
  {
    id: "prior_knowledge",
    type: "options",
    prompt: "How much do you already know about it?",
    options: [
      { value: "never", label: "Never studied it" },
      { value: "little", label: "Know a little" },
      { value: "basics", label: "Know the basics" },
      { value: "well", label: "Know it well" },
    ],
  },
  {
    id: "goal_text",
    type: "text",
    prompt: "What's your main goal for this course?",
    placeholder: "e.g. Pass my exam, understand the fundamentals...",
    maxLength: 200,
  },
  {
    id: "concern_text",
    type: "text",
    prompt: "What worries you about learning this?",
    placeholder: "e.g. I struggle with the maths side...",
    maxLength: 200,
    optional: true,
  },
];

/** @deprecated Mid-survey removed from journey rail. Kept for backward compat with existing data. */
export const DEFAULT_MID_SURVEY: SurveyStepConfig[] = [
  {
    id: "progress_feeling",
    type: "options",
    prompt: "How are you feeling about the course so far?",
    options: [
      { value: "struggling", label: "Struggling" },
      { value: "ok", label: "Getting there" },
      { value: "good", label: "Feeling good" },
      { value: "great", label: "Loving it" },
    ],
  },
  {
    id: "mid_satisfaction",
    type: "stars",
    prompt: "How would you rate your experience so far?",
  },
  {
    id: "help_needed",
    type: "text",
    prompt: "Anything you'd like more help with?",
    placeholder: "e.g. More practice questions, slower pace...",
    maxLength: 200,
    optional: true,
  },
];

export const DEFAULT_OFFBOARDING_SURVEY: SurveyStepConfig[] = [
  {
    id: "confidence",
    type: "stars",
    prompt: "How confident are you in {subject} now?",
  },
  {
    id: "confidence_lift",
    type: "options",
    prompt: "Compared to when you started, how much more confident do you feel?",
    options: [
      { value: "1", label: "About the same" },
      { value: "2", label: "A little more" },
      { value: "3", label: "Somewhat more" },
      { value: "4", label: "Much more" },
      { value: "5", label: "Completely different!" },
    ],
  },
  {
    id: "satisfaction",
    type: "stars",
    prompt: "How would you rate your experience practising with me?",
  },
  {
    id: "nps",
    type: "nps",
    prompt: "Would you recommend this to a friend? 0 = definitely not, 10 = absolutely.",
  },
  {
    id: "feedback_text",
    type: "text",
    prompt: "Anything else you'd like to share?",
    placeholder: "Your thoughts...",
    maxLength: 500,
    optional: true,
  },
];

export const DEFAULT_OFFBOARDING_TRIGGER = 5;

export const DEFAULT_OFFBOARDING_BANNER =
  "You've completed {n} practice sessions! Tell us how it went — it takes 30 seconds.";

// ---------------------------------------------------------------------------
// Fallback config (built from hardcoded defaults above)
// ---------------------------------------------------------------------------

const FALLBACK_SURVEY_TEMPLATES: SurveyTemplateConfig = {
  templates: {
    pre_survey: {
      label: "Pre-Survey",
      description: "Capture learner baseline before first session",
      defaultPosition: "before_first",
      defaultEnabled: true,
      scope: "PRE_SURVEY",
      questions: DEFAULT_ONBOARDING_SURVEY,
      endAction: { type: "summary", variant: "form_echo", thenAction: "next_stop" },
    },
    post_survey: {
      label: "Post-Survey",
      description: "Gather feedback at end of course",
      defaultPosition: "after_last",
      defaultEnabled: true,
      scope: "POST_SURVEY",
      questions: DEFAULT_OFFBOARDING_SURVEY,
      endAction: { type: "summary", variant: "form_echo", thenAction: "redirect", thenPath: "/x/student/progress" },
    },
  },
};
