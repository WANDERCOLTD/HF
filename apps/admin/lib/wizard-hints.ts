/**
 * Wizard field hint content — structured contextual help for intent fields.
 *
 * Keyed by <wizard>.<field>. Every wizard intent field MUST have an entry here.
 * Used by <FieldHint> component (Gold UI pattern).
 */

import type { FieldHintContent } from "@/components/shared/FieldHint";

export const WIZARD_HINTS: Record<string, FieldHintContent> = {
  // ── Teach wizard ──────────────────────────────────────

  "teach.institution": {
    why: "Determines which course, content, and AI persona your session uses.",
    effect: "The AI loads all teaching materials and settings linked to this institution.",
    examples: ["Riverside Academy", "CII Training Centre", "My Test School"],
  },

  "teach.goal": {
    why: "Tells the AI what you want to achieve in this session.",
    effect: "The AI tailors its opening, questioning strategy, and success criteria to your goal.",
    examples: [
      "Teach fractions using real-world examples",
      "Revise photosynthesis before the exam",
      "Understand compound interest",
    ],
  },

  "teach.objectives": {
    why: "Specific outcomes you want the student to demonstrate by the end.",
    effect: "The AI checks these during the session and adapts if the student is struggling.",
    examples: [
      "Explain the water cycle in their own words",
      "Solve 3 fraction problems correctly",
      "Compare two historical events",
    ],
  },

  "teach.content": {
    why: "Source materials give the AI accurate, trusted content to teach from.",
    effect: "The AI extracts teaching points and builds its knowledge base from these files.",
    examples: ["PDF syllabus", "Word lecture notes", "Slide deck", "Textbook chapter"],
  },

  "teach.plan": {
    why: "Controls how your content is broken into teachable sessions.",
    effect: "The AI generates a structured curriculum with learning outcomes per session.",
    examples: ["3 sessions of 30 min", "5 sessions breadth-first", "1 deep-dive session"],
  },

  // ── Course Setup wizard ───────────────────────────────

  "course.name": {
    why: "The course name becomes the title students see and the AI references.",
    effect: "Used to create the domain, label all materials, and greet students by course.",
    examples: ["High School Biology 101", "GCSE Maths Revision", "Leadership Essentials"],
  },

  "course.outcomes": {
    why: "Learning outcomes define what success looks like for this course.",
    effect: "The AI designs its curriculum, assessments, and session goals around these outcomes.",
    examples: [
      "Understand photosynthesis",
      "Explain cellular respiration",
      "Design experiments",
    ],
  },

  "course.persona": {
    why: "The persona sets the AI's teaching personality and communication style.",
    effect: "Controls warmth, formality, questioning approach, and how the AI introduces itself.",
    examples: ["Tutor (patient, structured)", "Coach (goal-driven)", "Socratic (questioning)"],
  },

  "course.content": {
    why: "Content gives the AI real subject matter to teach from.",
    effect: "Files are processed into teaching points that form the AI's knowledge base.",
    examples: ["Course pack (multiple files)", "Single PDF", "Text description of topics"],
  },

  "course.duration": {
    why: "Session length affects how deep each lesson can go.",
    effect: "Shorter sessions cover less per call; longer sessions allow deeper exploration.",
    examples: ["15 min (quick check-in)", "30 min (standard)", "60 min (deep dive)"],
  },

  "course.emphasis": {
    why: "Controls whether the AI prioritises breadth or depth of coverage.",
    effect: "Breadth covers all topics at surface level first; depth goes deep before moving on.",
    examples: ["Breadth-first (survey all topics)", "Depth-first (master each)", "Balanced"],
  },

  "course.assessments": {
    why: "Determines whether and how the AI checks student understanding.",
    effect: "Formal adds dedicated assessment sessions; light weaves checks into lessons; none skips.",
    examples: ["Formal (quiz sessions)", "Light (in-lesson checks)", "None"],
  },

  "course.welcome": {
    why: "The welcome message is the first thing students hear when they call.",
    effect: "Sets the tone for the entire learning experience — friendly, professional, or custom.",
    examples: ["Hi! I'm your biology tutor...", "Welcome to Leadership Essentials..."],
  },

  "course.callFlow": {
    why: "The call flow defines the structure of a student's first lesson.",
    effect: "Each phase guides the AI through a sequence — greeting, orientation, discovery, teaching, and wrap-up.",
    examples: [
      "Welcome (1-2 min) → Orient → Discover → Sample → Close",
      "Reorder phases to change how the AI structures the first call",
      "Remove phases you don't need or add custom ones",
    ],
  },

  "course.behavior": {
    why: "Behaviour tuning refines how your AI persona communicates.",
    effect: "Adjusts warmth, pacing, formality, and other traits within the chosen persona.",
    examples: [
      "\"warm, patient, challenges thinking\"",
      "\"formal and structured\"",
      "\"encouraging, uses humour\"",
    ],
  },

  "course.students": {
    why: "Enrolling students connects them to this course's content and AI tutor.",
    effect: "Students receive access and the AI tracks their individual progress across sessions.",
    examples: ["Add a class group", "Pick individuals", "Invite by email"],
  },
};
