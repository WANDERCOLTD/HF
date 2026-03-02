/**
 * Conversation Script — declarative question definitions for the Get Started wizard.
 *
 * Each question maps to a chat exchange: AI asks (left bubble), user answers (right bubble).
 * Questions are grouped by stepId for StepFlowContext/ScaffoldPanel integration.
 *
 * Pure data — no React, no side effects.
 */

import type { ChipSelectOption } from "@/components/shared/ChipSelect";

// ── Types ────────────────────────────────────────────────

export type DataGetter = <T = unknown>(key: string) => T | undefined;
export type DataSetter = (key: string, value: unknown) => void;

/** Community-kind types skip course/content wizard steps */
const isCommunityKind = (g: DataGetter) => g<string>("defaultDomainKind") === "COMMUNITY";

export interface SliderDef {
  key: string;
  label: string;
  low: string;
  high: string;
}

export interface ActionDef {
  label: string;
  icon?: string; // lucide icon name
  variant: "primary" | "secondary";
}

export type QuestionControl =
  | { type: "text"; placeholder: string; dataKey: string }
  | { type: "textarea"; placeholder: string; dataKey: string; rows?: number; defaultValue?: string | ((getData: DataGetter) => string); suggestions?: { label: string; value: string | ((getData: DataGetter) => string) }[] }
  | { type: "url"; placeholder: string; dataKey: string }
  | {
      type: "chips";
      options: ChipSelectOption[];
      dataKey: string;
      hints?: Record<string, string>;
    }
  | { type: "typeahead"; dataKey: string }
  | { type: "type-picker"; dataKey: string; typeIdKey: string }
  | { type: "sliders"; sliders: SliderDef[]; dataKey: string }
  | { type: "file-upload" }
  | { type: "actions"; primary: ActionDef; secondary: ActionDef }
  | { type: "review" }
  | { type: "none" };

export interface ConversationQuestion {
  id: string;
  stepId: string;
  message: string | ((getData: DataGetter) => string);
  subMessage?: string | ((getData: DataGetter) => string);
  control: QuestionControl;
  showWhen?: (getData: DataGetter) => boolean;
  onAnswer?: (
    value: unknown,
    setData: DataSetter,
    getData: DataGetter,
  ) => void | Promise<void>;
  hintKey?: string;
  autoAdvance?: boolean;
  groupLabel?: string;
}

// ── Chip option sets ─────────────────────────────────────

const APPROACH_OPTIONS: ChipSelectOption[] = [
  { value: "socratic", label: "Socratic" },
  { value: "directive", label: "Directive" },
  { value: "advisory", label: "Advisory" },
  { value: "coaching", label: "Coaching" },
];

const APPROACH_HINTS: Record<string, string> = {
  socratic:
    "Asks questions to guide the learner to discover answers themselves.",
  directive:
    "Provides clear, structured instruction with explicit explanations.",
  advisory: "Supportive coaching style \u2014 suggests rather than tells.",
  coaching:
    "Builds self-awareness and goal-setting through reflective dialogue.",
};

const EMPHASIS_OPTIONS: ChipSelectOption[] = [
  { value: "recall", label: "Recall" },
  { value: "comprehension", label: "Comprehension" },
  { value: "practice", label: "Practice" },
  { value: "syllabus", label: "Syllabus" },
];

const EMPHASIS_HINTS: Record<string, string> = {
  recall: "Focus on remembering key facts, definitions, and terms.",
  comprehension:
    "Build understanding through explanation and worked examples.",
  practice: "Emphasise exercises, questions, and application of knowledge.",
  syllabus: "Strictly follow learning outcomes and assessment criteria.",
};

const SESSION_COUNT_OPTIONS: ChipSelectOption[] = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "8", label: "8" },
  { value: "12", label: "12" },
];

const DURATION_OPTIONS: ChipSelectOption[] = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
];

const PLAN_EMPHASIS_OPTIONS: ChipSelectOption[] = [
  { value: "breadth", label: "Breadth" },
  { value: "balanced", label: "Balanced" },
  { value: "depth", label: "Depth" },
];

const PLAN_EMPHASIS_HINTS: Record<string, string> = {
  breadth:
    "Cover all topics at a lighter level \u2014 good for revision or survey courses.",
  balanced:
    "Mix of breadth and depth \u2014 AI decides per module based on learner progress.",
  depth: "Go deep on fewer topics \u2014 good for mastery-focused courses.",
};

const MODEL_OPTIONS: ChipSelectOption[] = [
  { value: "direct", label: "Direct Instruction" },
  { value: "5e", label: "5E" },
  { value: "spiral", label: "Spiral" },
  { value: "mastery", label: "Mastery" },
  { value: "project", label: "Project-Based" },
];

const MODEL_HINTS: Record<string, string> = {
  direct:
    "Structured, teacher-led. Explain \u2192 model \u2192 guided practice \u2192 independent practice.",
  "5e": "Engage \u2192 Explore \u2192 Explain \u2192 Elaborate \u2192 Evaluate. Great for science.",
  spiral: "Revisit topics repeatedly with increasing complexity over time.",
  mastery:
    "Must demonstrate mastery of each topic before advancing to the next.",
  project:
    "Learn through real-world projects. Good for applied/vocational courses.",
};

export const PERSONALITY_SLIDERS: SliderDef[] = [
  {
    key: "warmth",
    label: "Warmth",
    low: "Professional",
    high: "Warm & friendly",
  },
  {
    key: "directiveness",
    label: "Directiveness",
    low: "Guided discovery",
    high: "Direct instruction",
  },
  {
    key: "pace",
    label: "Pace",
    low: "Slower, thorough",
    high: "Faster, efficient",
  },
  {
    key: "encouragement",
    label: "Encouragement",
    low: "Measured",
    high: "Highly encouraging",
  },
];

// ── Step index mapping (for ScaffoldPanel) ───────────────

export const STEP_INDEX: Record<string, number> = {
  institution: 0,
  course: 1,
  content: 2,
  checkpoint: 3,
  welcome: 4,
  tune: 5,
  launch: 6,
};

// ── The conversation script ──────────────────────────────

export const CONVERSATION_SCRIPT: ConversationQuestion[] = [
  // ── Institution step (3 questions) ─────────────────────
  {
    id: "inst.name",
    stepId: "institution",
    message: "What\u2019s your school or organisation called?",
    subMessage: "Just start typing \u2014 if you\u2019ve used HF before, we\u2019ll find your existing organisation.",
    control: { type: "typeahead", dataKey: "institutionName" },
    hintKey: "institution.name",
  },
  {
    id: "inst.type",
    stepId: "institution",
    message: "What kind of place is this?",
    subMessage: "This helps the AI set the right tone and terminology.",
    control: { type: "type-picker", dataKey: "typeSlug", typeIdKey: "typeId" },
    showWhen: (g) => !g<string>("existingInstitutionId"),
    autoAdvance: true,
    hintKey: "institution.type",
  },
  {
    id: "inst.url",
    stepId: "institution",
    message: "Got a website? We can grab your logo and colours.",
    subMessage: "Optional \u2014 skip if you don\u2019t have one.",
    control: {
      type: "url",
      placeholder: "https://www.school.co.uk",
      dataKey: "websiteUrl",
    },
    showWhen: (g) => !g<string>("existingInstitutionId"),
    hintKey: "institution.website",
  },

  // ── Course step (4 questions) ──────────────────────────
  {
    id: "course.name",
    stepId: "course",
    message: (g) =>
      isCommunityKind(g)
        ? "What will conversations in your community be about?"
        : "Now let\u2019s set up the course. What will the AI tutor teach?",
    control: {
      type: "text",
      placeholder: "e.g. GCSE Biology, Level 2 Food Safety",
      dataKey: "courseName",
    },
    groupLabel: "Course",
    hintKey: "course.name",
  },
  {
    id: "course.discipline",
    stepId: "course",
    message: "What subject area is this?",
    subMessage: "Helps the AI understand the domain. Defaults to the course name if left blank.",
    control: {
      type: "text",
      placeholder: "e.g. Biology, Food Safety, English",
      dataKey: "subjectDiscipline",
    },
    showWhen: (g) => !isCommunityKind(g) && (g<string>("courseName")?.trim().length ?? 0) >= 3,
    hintKey: "get-started.discipline",
  },
  {
    id: "course.approach",
    stepId: "course",
    message: "How should the AI teach?",
    control: {
      type: "chips",
      options: APPROACH_OPTIONS,
      dataKey: "interactionPattern",
      hints: APPROACH_HINTS,
    },
    autoAdvance: true,
    hintKey: "course.interactionPattern",
  },
  {
    id: "course.emphasis",
    stepId: "course",
    message: "What should the AI emphasise?",
    control: {
      type: "chips",
      options: EMPHASIS_OPTIONS,
      dataKey: "teachingMode",
      hints: EMPHASIS_HINTS,
    },
    showWhen: (g) => !isCommunityKind(g),
    autoAdvance: true,
    hintKey: "get-started.emphasis",
  },

  // ── Content step (1 question) ──────────────────────────
  {
    id: "content.upload",
    stepId: "content",
    message:
      "Upload your teaching materials \u2014 PDFs, Word documents, or text files. The AI will classify each file and extract teaching points automatically.",
    subMessage: "You can skip this and add content later.",
    control: { type: "file-upload" },
    showWhen: (g) => !isCommunityKind(g),
    groupLabel: "Content",
  },

  // ── Checkpoint step (1 question) ───────────────────────
  {
    id: "checkpoint.ready",
    stepId: "checkpoint",
    message: (g) => {
      const isCommunity = isCommunityKind(g);
      const name = g<string>("courseName") || (isCommunity ? "Your community" : "Your course");
      const totals = g<{ assertions: number }>("extractionTotals");
      const tp = !isCommunity && totals ? ` with ${totals.assertions} teaching points` : "";
      return `${name}${tp} is ready to test! You can create it now and try a sim call, or continue setting up.`;
    },
    subMessage: (g) =>
      isCommunityKind(g)
        ? "Continuing adds: welcome message and conversation personality."
        : "Continuing adds: welcome message, session plan, tutor personality.",
    control: {
      type: "actions",
      primary: { label: "Create & Try a Call", icon: "Rocket", variant: "primary" },
      secondary: { label: "Continue Setup", icon: "ArrowRight", variant: "secondary" },
    },
    groupLabel: "Test",
  },

  // ── Welcome step (4 questions) ─────────────────────────
  {
    id: "welcome.message",
    stepId: "welcome",
    message: "What should the AI say to greet the student on their first call?",
    subMessage: "Here\u2019s a default \u2014 edit it or pick a suggestion below.",
    control: {
      type: "textarea",
      placeholder: "e.g. Welcome! I'm here to help you learn at your own pace...",
      dataKey: "welcomeMessage",
      rows: 3,
      defaultValue: (getData) => {
        const course = getData<string>("courseName") || "your course";
        return `Hi there! Welcome to ${course}. I\u2019m here to help you learn \u2014 no rush, no pressure. Let\u2019s start by getting to know each other a bit.`;
      },
      suggestions: [
        {
          label: "Casual & warm",
          value: (getData) => {
            const course = getData<string>("courseName") || "your course";
            return `Hey! Great to have you here for ${course}. Think of me as a study buddy who\u2019s always ready to help. Let\u2019s ease into things \u2014 tell me a bit about yourself first.`;
          },
        },
        {
          label: "Encouraging & structured",
          value: (getData) => {
            const course = getData<string>("courseName") || "your course";
            return `Welcome to ${course}! I\u2019m really glad you\u2019re here. We\u2019ll work through things at your pace, step by step. First, I\u2019d love to learn what you\u2019re hoping to get out of this.`;
          },
        },
      ],
    },
    groupLabel: "Welcome & Sessions",
    hintKey: "get-started.welcome",
  },
  {
    id: "welcome.sessionCount",
    stepId: "welcome",
    message: "How many sessions should the course run for?",
    control: {
      type: "chips",
      options: SESSION_COUNT_OPTIONS,
      dataKey: "sessionCount",
    },
    showWhen: (g) => !isCommunityKind(g),
    autoAdvance: true,
    hintKey: "get-started.sessions",
  },
  {
    id: "welcome.duration",
    stepId: "welcome",
    message: "How long should each session be?",
    control: {
      type: "chips",
      options: DURATION_OPTIONS,
      dataKey: "durationMins",
    },
    autoAdvance: true,
    hintKey: "get-started.duration",
  },
  {
    id: "welcome.planEmphasis",
    stepId: "welcome",
    message: "Should the AI go for breadth or depth?",
    control: {
      type: "chips",
      options: PLAN_EMPHASIS_OPTIONS,
      dataKey: "planEmphasis",
      hints: PLAN_EMPHASIS_HINTS,
    },
    showWhen: (g) => !isCommunityKind(g),
    autoAdvance: true,
    hintKey: "get-started.planEmphasis",
  },

  // ── Tune step (2 questions) ────────────────────────────
  {
    id: "tune.personality",
    stepId: "tune",
    message: "Adjust the tutor\u2019s personality. Drag the sliders to set the tone.",
    subMessage: "These defaults work well for most courses \u2014 only change if you have a preference.",
    control: {
      type: "sliders",
      sliders: PERSONALITY_SLIDERS,
      dataKey: "behaviorTargets",
    },
    groupLabel: "Fine-Tune",
  },
  {
    id: "tune.model",
    stepId: "tune",
    message: "Which lesson plan model works best for this course?",
    control: {
      type: "chips",
      options: MODEL_OPTIONS,
      dataKey: "lessonPlanModel",
      hints: MODEL_HINTS,
    },
    showWhen: (g) => !isCommunityKind(g),
    autoAdvance: true,
    hintKey: "get-started.model",
  },

  // ── Launch step (1 question) ───────────────────────────
  {
    id: "launch.review",
    stepId: "launch",
    message: "Everything looks good! Here\u2019s a summary of your AI tutor.",
    control: { type: "review" },
    groupLabel: "Launch",
  },
];
