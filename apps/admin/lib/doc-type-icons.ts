/**
 * Document Type Icons & Labels
 *
 * Single source of truth for DocumentType enum metadata.
 * Maps all 12 DB enum values to Lucide icons, emoji, labels, descriptions,
 * role groupings, and role colours.
 *
 * Used by: DocTypeBadge, PackUploadStep, Teach wizard, content sources.
 */

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  GraduationCap,
  PenLine,
  BookOpenCheck,
  ScrollText,
  ListChecks,
  Library,
  FileSearch,
  LayoutList,
  Scale,
  HelpCircle,
  Compass,
} from "lucide-react";

export type DocTypeRole = 'passage' | 'questions' | 'pedagogy' | 'reference';

export interface DocTypeInfo {
  icon: LucideIcon;   // Lucide component — for badges, cards, detail views
  emojiIcon: string;  // Emoji string — for <option> text in <select> dropdowns
  label: string;
  description: string;
  /** Plain-language narration for wizard chat — what the AI tells the teacher about this doc type */
  promptLabel: string;
  role: DocTypeRole;
  color: string;      // CSS var string for text/border
  bg: string;         // CSS var string for background
}

export const DOC_TYPE_INFO: Record<string, DocTypeInfo> = {
  // ── READING MATERIAL (passage) ─────────────────────────────────────────
  READING_PASSAGE: {
    icon: ScrollText,    emojiIcon: '📄',
    label: "Reading Passage",
    description: "Standalone prose to be read aloud. No questions included.",
    promptLabel: "teaching content — I'll extract the key points and teach from those",
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },
  TEXTBOOK: {
    icon: BookOpen,      emojiIcon: '📖',
    label: "Textbook",
    description: "Dense reference text — extracts key concepts, facts, and definitions.",
    promptLabel: "teaching content — I'll extract the key points and teach from those",
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },
  COMPREHENSION: {
    icon: BookOpenCheck, emojiIcon: '📖',
    label: "Comprehension",
    description: "Passage WITH embedded questions in the same document (e.g. a comprehension test paper).",
    promptLabel: "teaching content — I'll extract the key points and teach from those",
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },

  // ── ASSESSMENTS (questions) ────────────────────────────────────────────
  ASSESSMENT: {
    icon: ListChecks,   emojiIcon: '✅',
    label: "Assessment",
    description: "Formal test, exam, or mark scheme — extracts questions and answers.",
    promptLabel: "practice material — feeds the question pool",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },
  WORKSHEET: {
    icon: PenLine,      emojiIcon: '📝',
    label: "Worksheet",
    description: "Exercises, activities, or practice material for learners.",
    promptLabel: "practice material — feeds the question pool",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },
  QUESTION_BANK: {
    icon: HelpCircle,   emojiIcon: '❓',
    label: "Question Bank",
    description: "Structured tutor questions with guidance — feeds the question pool.",
    promptLabel: "tutor question guide — shapes how I question and assess, but students won't see it",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },

  // ── TEACHING (pedagogy) ────────────────────────────────────────────────
  LESSON_PLAN: {
    icon: LayoutList,   emojiIcon: '📋',
    label: "Lesson Plan",
    description: "Teaching guide or session plan. Not shown to students.",
    promptLabel: "teaching guide — tells me about session structure and pedagogy",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },
  POLICY_DOCUMENT: {
    icon: Scale,        emojiIcon: '⚖️',
    label: "Policy Document",
    description: "Regulatory or policy document — shapes rules and guardrails.",
    promptLabel: "policy document — shapes rules and guardrails for the AI",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },
  COURSE_REFERENCE: {
    icon: Compass,      emojiIcon: '🧭',
    label: "Course Guide",
    description: "Teaching methodology — skills framework, session flow, scaffolding rules. Not shown to students.",
    promptLabel: "course guide — tells me how to run the course",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },

  // ── REFERENCE (reference) ──────────────────────────────────────────────
  REFERENCE: {
    icon: Library,      emojiIcon: '🔍',
    label: "Reference",
    description: "Glossary, appendix, or reference guide — supplementary lookup material.",
    promptLabel: "reference material — available for lookup during sessions",
    role: 'reference',
    color: 'var(--text-muted)',
    bg: 'var(--surface-tertiary)',
  },
  CURRICULUM: {
    icon: GraduationCap, emojiIcon: '📐',
    label: "Curriculum",
    description: "Formal syllabus with learning outcomes or accreditation criteria.",
    promptLabel: "curriculum spec — I'll extract learning outcomes and structure from this",
    role: 'reference',
    color: 'var(--text-muted)',
    bg: 'var(--surface-tertiary)',
  },
  EXAMPLE: {
    icon: FileSearch,   emojiIcon: '📄',
    label: "Example",
    description: "Worked example or case study — illustrates concepts in context.",
    role: 'reference',
    color: 'var(--text-muted)',
    bg: 'var(--surface-tertiary)',
  },
};

export function getDocTypeInfo(type: string): DocTypeInfo {
  return DOC_TYPE_INFO[type] ?? DOC_TYPE_INFO.TEXTBOOK;
}

/**
 * Document types that students should see by default.
 * Teacher can override via the eye toggle on the sources panel.
 *
 * Rule of thumb: if it's material the student would reference, read, or work
 * from during a session, it's student-visible. If it's a tutor playbook or
 * teacher-facing methodology, it's teacher-only.
 */
const STUDENT_VISIBLE_DOC_TYPES = new Set([
  "READING_PASSAGE",
  "WORKSHEET",
  "COMPREHENSION",
  "EXAMPLE",
  "TEXTBOOK",        // Study texts — students read during sessions
  "ASSESSMENT",      // Past papers, mark schemes — students reference during practice
  "REFERENCE",       // Quick-reference cards, glossaries, framework docs
  "CURRICULUM",      // Syllabus/curriculum specs — students see what they're learning
]);

/**
 * Document types that stay teacher-only by default — these are for tutor
 * guidance and would confuse students. Teacher can still override per-file.
 */
const TEACHER_ONLY_DOC_TYPES = new Set([
  "COURSE_REFERENCE",  // Tutor methodology / course delivery guide
  "LESSON_PLAN",        // Teacher-facing plans
  "QUESTION_BANK",      // Tutor playbook with tiered model answers
  "POLICY_DOCUMENT",    // Regulatory / compliance reference
]);

/** Should this document type be shared with students by default? */
export function isStudentVisibleDefault(documentType: string): boolean {
  return STUDENT_VISIBLE_DOC_TYPES.has(documentType);
}

/** Should this document type stay teacher-only? */
export function isTeacherOnlyDocType(documentType: string): boolean {
  return TEACHER_ONLY_DOC_TYPES.has(documentType);
}

/**
 * Prompt-ready visibility summary derived from the canonical sets above.
 * Used by wizard system prompts so they never drift from the source of truth.
 */
export function getVisibilitySummary(): string {
  const toList = (set: Set<string>): string =>
    [...set].map(t => (DOC_TYPE_INFO[t]?.label ?? t).toLowerCase() + "s").join(", ");
  return [
    `- ${toList(STUDENT_VISIBLE_DOC_TYPES)} are automatically shared with students (they can see them on their phone during calls).`,
    `- ${toList(TEACHER_ONLY_DOC_TYPES)} stay behind the scenes — the AI uses them to shape how it teaches, but students never see them.`,
    `- "You can adjust what students see using the eye toggles in the panel."`,
  ].join("\n");
}

/** Ordered groups for the role-grouped picker UI */
export const DOC_TYPE_GROUPS: Array<{
  role: DocTypeRole;
  label: string;
  types: string[];
}> = [
  { role: 'passage',   label: 'READING MATERIAL', types: ['READING_PASSAGE', 'TEXTBOOK', 'COMPREHENSION'] },
  { role: 'questions', label: 'ASSESSMENTS',       types: ['ASSESSMENT', 'WORKSHEET', 'QUESTION_BANK'] },
  { role: 'pedagogy',  label: 'TEACHING',          types: ['LESSON_PLAN', 'POLICY_DOCUMENT', 'COURSE_REFERENCE'] },
  { role: 'reference', label: 'REFERENCE',         types: ['REFERENCE', 'CURRICULUM', 'EXAMPLE'] },
];
