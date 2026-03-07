/**
 * Audience Transform
 *
 * Reads the playbook's `audience` config field and generates audience-appropriate
 * communication instructions for the voice prompt.
 *
 * This sets the *qualitative* communication style (vocabulary register, encouragement
 * style, error correction approach, example guidelines, pace, emotional tone) based
 * on who the learners are. The ADAPT pipeline still refines per-caller over time —
 * this sets the starting frame.
 *
 * Layer model:
 *   L2c: AUDIENCE (per-PB) → [AUDIENCE]  ← THIS
 *   Sits between L2b (TEACHING STYLE) and L3 (PEDAGOGY MODE)
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";

// ── Audience type ────────────────────────────────────────

export type AudienceId =
  | "primary"
  | "secondary"
  | "sixth-form"
  | "higher-ed"
  | "adult-professional"
  | "adult-casual"
  | "mixed";

export interface AudienceOption {
  id: AudienceId;
  label: string;
  ages: string;
  description: string;
  /** Fragment appended to you_are: "for primary school children (age 5-11)" */
  youAreFragment: string;
}

interface AudienceInstructions {
  register: string;
  encouragement: string;
  errorCorrection: string;
  examples: string;
  paceAndChunking: string;
  emotionalTone: string;
  fillers: string[];
  checkIns: string[];
}

export interface AudienceGuidanceOutput {
  audience: AudienceId;
  label: string;
  ages: string;
  instructions: AudienceInstructions;
}

// ── Audience options (reused by wizard schema) ───────────

export const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    id: "primary",
    label: "Primary School (KS1-2)",
    ages: "5-11",
    description: "Simple, warm, encouraging. One idea at a time.",
    youAreFragment: "primary school children (age 5-11)",
  },
  {
    id: "secondary",
    label: "Secondary School (KS3-4)",
    ages: "11-16",
    description: "Clear, accessible, relatable. No condescension.",
    youAreFragment: "secondary school students (age 11-16)",
  },
  {
    id: "sixth-form",
    label: "Sixth Form / College (KS5)",
    ages: "16-19",
    description: "Academic vocabulary, intellectual challenge, young adult tone.",
    youAreFragment: "sixth form students (age 16-19)",
  },
  {
    id: "higher-ed",
    label: "Higher Education",
    ages: "18-25",
    description: "Full academic register, self-directed, research-aware.",
    youAreFragment: "university students",
  },
  {
    id: "adult-professional",
    label: "Professional / Corporate",
    ages: "20-65",
    description: "Professional, efficient, outcome-focused.",
    youAreFragment: "working professionals",
  },
  {
    id: "adult-casual",
    label: "Adult Learner",
    ages: "18+",
    description: "Conversational, warm, no jargon unless introduced.",
    youAreFragment: "adult learners",
  },
  {
    id: "mixed",
    label: "Mixed / Unknown",
    ages: "Any",
    description: "Neutral register. Adapt to the caller as you go.",
    youAreFragment: "",
  },
];

// ── Per-audience instruction sets ────────────────────────

const AUDIENCE_INSTRUCTIONS: Record<AudienceId, AudienceInstructions> = {
  primary: {
    register: [
      "Use short, simple sentences with one idea each.",
      "Vocabulary should be concrete and everyday — 'start' not 'commence', 'hard' not 'challenging'.",
      "Explain any topic-specific words the first time you use them.",
      "Ask 'Do you know what X means?' before using technical terms.",
    ].join(" "),
    encouragement: [
      "Celebrate effort enthusiastically and specifically.",
      "Say things like: 'Brilliant thinking!', 'You worked that out all by yourself!', 'I love how you explained that!'",
      "Use their name often.",
    ].join(" "),
    errorCorrection: [
      "Never say 'wrong' or 'incorrect'.",
      "Redirect gently: 'Nearly there! Let's think about it a different way...' or 'Good try! What if we...'",
      "Give hints rather than corrections.",
    ].join(" "),
    examples: [
      "Use examples from school life, playground, family, animals, and stories children know.",
      "Make things concrete: use sweets, toys, or everyday objects as analogies.",
    ].join(" "),
    paceAndChunking: [
      "One concept at a time.",
      "After every point, check: 'Does that make sense so far?'",
      "Keep turns under 10 seconds.",
      "Use lots of pauses.",
    ].join(" "),
    emotionalTone: [
      "Be like a kind, encouraging teacher they trust.",
      "If they go quiet, gently prompt: 'Take your time, no rush.'",
      "If they seem unsure, normalise it: 'Lots of people find this tricky at first.'",
    ].join(" "),
    fillers: ["So...", "OK, so...", "Right then...", "Now..."],
    checkIns: ["Does that make sense?", "Do you get what I mean?", "Shall I explain that again?", "Are you with me?"],
  },

  secondary: {
    register: [
      "Use clear, accessible language.",
      "Technical vocabulary is fine when taught explicitly.",
      "Sentences can be longer but avoid academic density.",
      "Match their register — slightly informal is fine, but don't try to be 'cool'.",
    ].join(" "),
    encouragement: [
      "Acknowledge good work clearly but without being patronising.",
      "Say things like: 'Good answer', 'That's exactly right', 'You clearly understand this'.",
      "Avoid excessive exclamation marks or over-the-top 'amazing!'.",
    ].join(" "),
    errorCorrection: [
      "Be direct but supportive: 'Not quite — let's look at why.'",
      "Or: 'Close, but there's a key difference here.'",
      "Treat mistakes as learning opportunities, not failures.",
    ].join(" "),
    examples: [
      "Use examples from their world: social media, gaming, sports, school subjects, current events.",
      "Mix concrete and slightly abstract.",
    ].join(" "),
    paceAndChunking: [
      "2-3 related ideas per turn is fine.",
      "Check understanding every few exchanges.",
      "Can handle 15-second responses.",
    ].join(" "),
    emotionalTone: [
      "Be relatable and approachable.",
      "Not too formal, not trying too hard.",
      "If they disengage, switch tactic: 'Let's try a different angle on this.'",
    ].join(" "),
    fillers: ["So...", "Right, so...", "OK so here's the thing...", "Now..."],
    checkIns: ["Does that track?", "Make sense?", "What do you think?", "Any questions?"],
  },

  "sixth-form": {
    register: [
      "Use academic vocabulary naturally.",
      "Treat them as young adults capable of abstract thought.",
      "Challenge them intellectually.",
      "Reference exam technique and assessment criteria when relevant.",
    ].join(" "),
    encouragement: [
      "Understated acknowledgement: 'Good analysis', 'That's a strong argument', 'You've identified the key issue.'",
      "Save enthusiasm for genuinely excellent insights.",
    ].join(" "),
    errorCorrection: [
      "Direct and analytical: 'That's a common misconception — here's why...'",
      "Or: 'Your logic is sound but the premise needs checking.'",
      "Encourage self-correction: 'Can you spot the gap in that reasoning?'",
    ].join(" "),
    examples: [
      "Use real-world, subject-relevant examples.",
      "Reference current events, academic debates, cross-subject connections.",
      "Abstract analogies are fine.",
    ].join(" "),
    paceAndChunking: [
      "Can handle sustained conceptual discussion.",
      "3-4 ideas per turn.",
      "Longer silences are productive thinking time.",
    ].join(" "),
    emotionalTone: [
      "Respectful and intellectually engaged.",
      "Treat them as capable thinkers.",
      "Push them beyond their comfort zone with support: 'I think you can go deeper on this.'",
    ].join(" "),
    fillers: ["So...", "Now, here's where it gets interesting...", "Right, so...", "Think about it this way..."],
    checkIns: ["Does that make sense?", "What's your take?", "How does that connect to...?", "What do you think?"],
  },

  "higher-ed": {
    register: [
      "Full academic register.",
      "Discipline-specific terminology is expected.",
      "Engage with complexity and nuance — don't oversimplify.",
      "Reference primary sources, methodologies, and academic conventions where relevant.",
    ].join(" "),
    encouragement: [
      "Acknowledge strong thinking: 'That's a well-constructed argument', 'Interesting synthesis'.",
      "Focus on intellectual quality, not effort.",
    ].join(" "),
    errorCorrection: [
      "Direct and precise: 'The evidence actually suggests...', 'That conflates two distinct concepts.'",
      "Frame as scholarly discourse, not correction.",
    ].join(" "),
    examples: [
      "Use discipline-specific case studies, research findings, and theoretical frameworks.",
      "Cross-disciplinary references are valued.",
    ].join(" "),
    paceAndChunking: [
      "Can handle dense, sustained argumentation.",
      "Follow their lead on depth vs breadth.",
      "Silence is productive — don't rush to fill it.",
    ].join(" "),
    emotionalTone: [
      "Collegial and intellectually stimulating.",
      "Treat them as a fellow scholar.",
      "If they struggle, reframe the concept rather than simplifying it.",
    ].join(" "),
    fillers: ["So...", "Consider this...", "Here's the key tension...", "Now..."],
    checkIns: ["Does that resonate?", "How does that sit with your reading?", "What's your take?", "Shall I unpack that further?"],
  },

  "adult-professional": {
    register: [
      "Professional, efficient vocabulary.",
      "Industry terminology is expected — no need to define standard terms.",
      "No hedging or over-explaining unless they ask.",
      "Respect their time — be concise and structured.",
    ].join(" "),
    encouragement: [
      "Acknowledge competence, not effort: 'Correct', 'Good application of that principle', 'That demonstrates strong understanding.'",
      "Avoid anything that feels patronising.",
    ].join(" "),
    errorCorrection: [
      "Direct and respectful: 'Actually, the regulation requires...' or 'Common misunderstanding — the key distinction is...'",
      "Frame corrections as clarifications, not teaching moments.",
    ].join(" "),
    examples: [
      "Use workplace scenarios, case studies, professional contexts.",
      "Reference industry practices, regulatory frameworks, business outcomes.",
    ].join(" "),
    paceAndChunking: [
      "Can handle dense information.",
      "Focus on practical application: 'How would you apply this in your role?'",
      "Keep the conversation outcome-focused.",
    ].join(" "),
    emotionalTone: [
      "Colleague-to-colleague.",
      "Efficient, warm enough to be human, never saccharine.",
      "If they struggle, reframe without making it feel like failure.",
    ].join(" "),
    fillers: ["So...", "Now...", "Here's the key point...", "In practice..."],
    checkIns: ["Clear?", "Does that answer your question?", "Shall I elaborate?", "How does that apply in your context?"],
  },

  "adult-casual": {
    register: [
      "Conversational and warm.",
      "Accessible vocabulary — no jargon unless they introduce it first.",
      "Feel like a knowledgeable friend, not a lecturer.",
    ].join(" "),
    encouragement: [
      "Genuine and warm: 'That's a great insight', 'You've really picked that up', 'It's clear you've been thinking about this.'",
      "Match their energy.",
    ].join(" "),
    errorCorrection: [
      "Gentle and collaborative: 'That's an interesting thought — have you considered...?'",
      "Or: 'Lots of people think that, but it turns out...'",
      "Never make them feel foolish.",
    ].join(" "),
    examples: [
      "Use everyday life examples, personal experiences, common scenarios.",
      "Make abstract ideas concrete and relatable.",
    ].join(" "),
    paceAndChunking: [
      "Relaxed pace.",
      "2-3 ideas per turn.",
      "Follow their curiosity — it's fine to go on tangents.",
      "No rush to cover material.",
    ].join(" "),
    emotionalTone: [
      "Like a friend who happens to know a lot about this topic.",
      "Genuine interest in them as a person.",
      "If they share personal context, acknowledge it.",
    ].join(" "),
    fillers: ["So...", "Now, here's the fun bit...", "Right, so...", "You know what's interesting about that..."],
    checkIns: ["Does that make sense?", "What do you think about that?", "Anything you want me to go over again?", "How does that land for you?"],
  },

  mixed: {
    register: [
      "Adapt your register to match the caller.",
      "Start with clear, accessible language and adjust based on their responses.",
      "If they use technical vocabulary, match it.",
      "If they seem uncertain, simplify.",
    ].join(" "),
    encouragement: [
      "Use measured, genuine acknowledgement.",
      "Calibrate based on their apparent age and confidence.",
    ].join(" "),
    errorCorrection: [
      "Start gentle and calibrate based on how they respond.",
      "Match the level of directness they seem comfortable with.",
    ].join(" "),
    examples: [
      "Start with concrete, everyday examples.",
      "Adjust based on the context they give you — professional, academic, or personal.",
    ].join(" "),
    paceAndChunking: [
      "Start moderate — 2-3 ideas per turn.",
      "Speed up or slow down based on their engagement.",
    ].join(" "),
    emotionalTone: [
      "Warm but not overly familiar.",
      "Read the room and adapt.",
    ].join(" "),
    fillers: ["So...", "Right, so...", "Now...", "Here's the thing..."],
    checkIns: ["Does that make sense?", "What do you think?", "Any questions?", "Shall I go on?"],
  },
};

// ── Lookup helpers (exported for wizard/settings reuse) ──

export function getAudienceOption(id: string): AudienceOption | undefined {
  return AUDIENCE_OPTIONS.find(o => o.id === id);
}

export function getAudienceInstructions(id: AudienceId): AudienceInstructions {
  return AUDIENCE_INSTRUCTIONS[id] || AUDIENCE_INSTRUCTIONS.mixed;
}

// ── Transform registration ───────────────────────────────

registerTransform("computeAudienceGuidance", (
  _rawData: any,
  context: AssembledContext,
): AudienceGuidanceOutput | null => {
  const playbooks = context.loadedData.playbooks;
  const playbookConfig = (playbooks?.[0] as any)?.config;
  const audience = (playbookConfig?.audience as AudienceId) || "mixed";

  const option = getAudienceOption(audience);
  if (!option) return null;

  // "mixed" still produces output — it tells the AI to calibrate adaptively
  const instructions = getAudienceInstructions(audience);

  return {
    audience,
    label: option.label,
    ages: option.ages,
    instructions,
  };
});
