/**
 * Subject Teaching Profiles
 *
 * 6 named profiles that bundle teachingMode + interactionPattern + deliveryHints.
 * Used to give subjects a baseline pedagogical approach before any playbook or
 * course reference overrides.
 *
 * Resolution cascade (most specific wins):
 *   1. Profile defaults from TEACHING_PROFILES[subject.teachingProfile]
 *   2. subject.teachingOverrides applied on top
 *   3. Playbook-level config.teachingMode / config.interactionPattern override if explicitly set
 *   4. COURSE_REFERENCE instructions overlay (existing, no changes needed)
 */

import type { TeachingMode, InteractionPattern } from "./resolve-config";

// ── Types ────────────────────────────────────────────────────────────────────

export type TeachingProfileKey =
  | "comprehension-led"
  | "recall-led"
  | "practice-led"
  | "syllabus-led"
  | "discussion-led"
  | "coaching-led";

export interface TeachingProfile {
  key: TeachingProfileKey;
  teachingMode: TeachingMode;
  interactionPattern: InteractionPattern;
  description: string;
  bestFor: string;
  deliveryHints: string[];
}

export interface TeachingOverrides {
  teachingMode?: TeachingMode;
  interactionPattern?: InteractionPattern;
  deliveryHints?: string[];
}

export interface ResolvedTeachingProfile {
  key: TeachingProfileKey;
  teachingMode: TeachingMode;
  interactionPattern: InteractionPattern;
  description: string;
  bestFor: string;
  deliveryHints: string[];
  hasOverrides: boolean;
}

// ── Profile Definitions ──────────────────────────────────────────────────────

export const TEACHING_PROFILES: Record<TeachingProfileKey, TeachingProfile> = {
  "comprehension-led": {
    key: "comprehension-led",
    teachingMode: "comprehension",
    interactionPattern: "socratic",
    description: "Read, analyse & discuss. Socratic questioning, close reading, vocabulary in context.",
    bestFor: "English, Literature, Languages",
    deliveryHints: [
      "Teach through questioning, not explanation — your job is to draw out understanding, not deliver it.",
      "One question at a time — never stack questions. Wait for the answer before asking the next.",
      "Scaffold, don't rescue — when a learner struggles, break the question into smaller steps rather than giving the answer.",
      "Always ground discussion in the text — ask 'Where does it say that?' or 'What words tell you that?'",
      "Introduce vocabulary in context — when a key word appears in the passage, check understanding before moving on.",
      "Build from literal (what does it say?) to inferential (what does it imply?) to evaluative (do you agree?).",
    ],
  },
  "recall-led": {
    key: "recall-led",
    teachingMode: "recall",
    interactionPattern: "directive",
    description: "Learn and remember facts. Structured quizzing, spaced retrieval, key terminology.",
    bestFor: "History, Biology, Geography",
    deliveryHints: [
      "Quiz before you teach — test what they already know to identify gaps before explaining.",
      "State facts clearly and concisely — then immediately test recall with a direct question.",
      "Re-quiz weak items later in the session — spaced retrieval is more effective than re-explanation.",
      "Use retrieval cues — 'Can you remember the three causes we discussed?' rather than restating them.",
      "Correct errors immediately and explicitly — 'Not quite — the answer is X because Y.'",
      "Link new facts to previously learned ones — 'Remember when we covered X? This connects because...'",
    ],
  },
  "practice-led": {
    key: "practice-led",
    teachingMode: "practice",
    interactionPattern: "directive",
    description: "Work through problems. Worked examples, guided practice, step-by-step methods.",
    bestFor: "Maths, Physics, Accounting",
    deliveryHints: [
      "Demonstrate the method first with a worked example — narrate each step and your reasoning.",
      "Then give a similar problem and coach them through it — hints, not answers.",
      "Focus on method over answer — 'How did you get that?' matters more than 'Is that right?'",
      "When they make an error, ask them to find where it went wrong before correcting.",
      "Gradually reduce scaffolding — first do it together, then let them lead with you checking.",
      "Name the technique being used — 'This is the balancing method' — so they can recall it independently.",
    ],
  },
  "syllabus-led": {
    key: "syllabus-led",
    teachingMode: "syllabus",
    interactionPattern: "directive",
    description: "Cover the syllabus systematically. Structured progress, checklists, compliance milestones.",
    bestFor: "Food Safety, BTEC, Apprenticeships",
    deliveryHints: [
      "Follow the syllabus order — teach each topic, verify understanding, then move on.",
      "Use a teach-check-advance pattern: explain, ask a question to confirm, then proceed.",
      "Reference progress explicitly — 'We've covered 3 of 6 topics. Next is...'",
      "When understanding is weak, re-explain with a different example — don't just repeat.",
      "Use the exact terminology from the syllabus — learners need to recognise these terms in assessments.",
      "Flag assessment-relevant content explicitly — 'This is a common exam question' or 'You need to know this definition.'",
    ],
  },
  "discussion-led": {
    key: "discussion-led",
    teachingMode: "comprehension",
    interactionPattern: "reflective",
    description: "Explore ideas through dialogue. Open questions, multiple perspectives, meaning-making.",
    bestFor: "Philosophy, Ethics, PSHE",
    deliveryHints: [
      "Ask open questions that have no single right answer — 'What do you think about...?' or 'Is it ever OK to...?'",
      "Present competing perspectives — 'Some people argue X, others say Y. What's your view?'",
      "Never shut down an opinion — instead, probe it: 'That's interesting — what makes you think that?'",
      "Use thought experiments and hypotheticals — 'What if the situation were different in this way...?'",
      "Encourage the learner to change their mind — 'Has anything we've discussed shifted your thinking?'",
      "Summarise their position back to them to check understanding — 'So you're saying that...?'",
    ],
  },
  "coaching-led": {
    key: "coaching-led",
    teachingMode: "practice",
    interactionPattern: "coaching",
    description: "Goal-focused development. Reflective practice, action planning, accountability.",
    bestFor: "Career, Leadership, Performance",
    deliveryHints: [
      "Start from their goals, not your agenda — 'What would you like to focus on today?'",
      "Ask questions that sharpen thinking — 'What options do you see?' rather than giving advice.",
      "When they ask 'What should I do?', reflect it back — 'What feels right to you?'",
      "Focus on action — every session should end with a concrete next step they commit to.",
      "Review previous commitments — 'Last time you said you'd try X. How did that go?'",
      "Surface assumptions — 'What are you assuming about that situation? Is that definitely true?'",
    ],
  },
};

export const TEACHING_PROFILE_KEYS = Object.keys(TEACHING_PROFILES) as TeachingProfileKey[];

/**
 * Look up a teaching profile by key. Returns null for invalid/missing keys.
 */
export function getTeachingProfile(
  key: string | null | undefined,
): TeachingProfile | null {
  if (!key) return null;
  return TEACHING_PROFILES[key as TeachingProfileKey] ?? null;
}

// ── Profile Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a teaching profile for a subject, merging overrides on top of defaults.
 *
 * @param subject - Subject with teachingProfile and teachingOverrides fields
 * @returns Resolved profile with overrides applied, or null if no profile set
 */
export function resolveTeachingProfile(
  subject: {
    teachingProfile?: string | null;
    teachingOverrides?: Record<string, unknown> | null;
  },
): ResolvedTeachingProfile | null {
  if (!subject.teachingProfile) return null;

  const profileKey = subject.teachingProfile as TeachingProfileKey;
  const profile = TEACHING_PROFILES[profileKey];
  if (!profile) return null;

  const overrides = subject.teachingOverrides as TeachingOverrides | null;
  const hasOverrides = !!(overrides && Object.keys(overrides).length > 0);

  return {
    key: profileKey,
    teachingMode: overrides?.teachingMode || profile.teachingMode,
    interactionPattern: overrides?.interactionPattern || profile.interactionPattern,
    description: profile.description,
    bestFor: profile.bestFor,
    deliveryHints: [
      ...profile.deliveryHints,
      ...(overrides?.deliveryHints || []),
    ],
    hasOverrides,
  };
}

// ── Profile Suggestion ───────────────────────────────────────────────────────

/**
 * Keyword → TeachingProfileKey map for heuristic suggestion based on subject name.
 * Multi-word keys checked first (longest match wins).
 */
const PROFILE_KEYWORDS: Record<string, TeachingProfileKey> = {
  // comprehension-led — reading, analysis, language subjects
  english: "comprehension-led",
  literature: "comprehension-led",
  french: "comprehension-led",
  spanish: "comprehension-led",
  german: "comprehension-led",
  language: "comprehension-led",
  languages: "comprehension-led",
  reading: "comprehension-led",
  comprehension: "comprehension-led",
  literacy: "comprehension-led",
  "creative writing": "comprehension-led",

  // recall-led — fact-heavy subjects
  history: "recall-led",
  biology: "recall-led",
  geography: "recall-led",
  science: "recall-led",
  chemistry: "recall-led",
  anatomy: "recall-led",
  psychology: "recall-led",
  sociology: "recall-led",
  economics: "recall-led",
  politics: "recall-led",
  law: "recall-led",
  medicine: "recall-led",
  nursing: "recall-led",

  // practice-led — problem-solving subjects
  maths: "practice-led",
  math: "practice-led",
  mathematics: "practice-led",
  accounting: "practice-led",
  statistics: "practice-led",
  calculus: "practice-led",
  algebra: "practice-led",
  programming: "practice-led",
  coding: "practice-led",
  engineering: "practice-led",
  physics: "practice-led",
  finance: "practice-led",

  // syllabus-led — structured coverage / compliance
  "food safety": "syllabus-led",
  "health and safety": "syllabus-led",
  btec: "syllabus-led",
  apprenticeship: "syllabus-led",
  apprenticeships: "syllabus-led",
  compliance: "syllabus-led",
  certification: "syllabus-led",
  induction: "syllabus-led",
  safeguarding: "syllabus-led",
  "first aid": "syllabus-led",

  // discussion-led — philosophical / ethical subjects
  philosophy: "discussion-led",
  ethics: "discussion-led",
  pshe: "discussion-led",
  theology: "discussion-led",
  "religious studies": "discussion-led",
  "religious education": "discussion-led",
  citizenship: "discussion-led",

  // coaching-led — development subjects
  career: "coaching-led",
  leadership: "coaching-led",
  coaching: "coaching-led",
  mentoring: "coaching-led",
  performance: "coaching-led",
  "personal development": "coaching-led",
};

/** Sorted entries — longest key first so multi-word keys match before substrings */
const PROFILE_KEYWORD_ENTRIES = Object.entries(PROFILE_KEYWORDS)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Suggest a TeachingProfileKey from a subject name using keyword matching.
 * Returns null if no keyword matches.
 */
export function suggestTeachingProfile(name: string): TeachingProfileKey | null {
  if (!name || name.trim().length < 3) return null;
  const lower = name.toLowerCase();
  for (const [keyword, profile] of PROFILE_KEYWORD_ENTRIES) {
    if (lower.includes(keyword)) return profile;
  }
  return null;
}
