import type { SurveyStepConfig } from "@/lib/types/json-fields";

// ---------------------------------------------------------------------------
// Default onboarding survey
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

// ---------------------------------------------------------------------------
// Default offboarding survey
// ---------------------------------------------------------------------------

export const DEFAULT_OFFBOARDING_SURVEY: SurveyStepConfig[] = [
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
