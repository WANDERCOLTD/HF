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
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },
  TEXTBOOK: {
    icon: BookOpen,      emojiIcon: '📖',
    label: "Textbook",
    description: "Dense reference text — extracts key concepts, facts, and definitions.",
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },
  COMPREHENSION: {
    icon: BookOpenCheck, emojiIcon: '📖',
    label: "Comprehension",
    description: "Passage WITH embedded questions in the same document (e.g. a comprehension test paper).",
    role: 'passage',
    color: 'var(--accent-primary)',
    bg: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
  },

  // ── ASSESSMENTS (questions) ────────────────────────────────────────────
  ASSESSMENT: {
    icon: ListChecks,   emojiIcon: '✅',
    label: "Assessment",
    description: "Formal test, exam, or mark scheme — extracts questions and answers.",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },
  WORKSHEET: {
    icon: PenLine,      emojiIcon: '📝',
    label: "Worksheet",
    description: "Exercises, activities, or practice material for learners.",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },
  QUESTION_BANK: {
    icon: HelpCircle,   emojiIcon: '❓',
    label: "Question Bank",
    description: "Structured tutor questions with guidance — feeds the question pool.",
    role: 'questions',
    color: '#d97706',
    bg: 'color-mix(in srgb, #d97706 12%, transparent)',
  },

  // ── TEACHING (pedagogy) ────────────────────────────────────────────────
  LESSON_PLAN: {
    icon: LayoutList,   emojiIcon: '📋',
    label: "Lesson Plan",
    description: "Teaching guide or session plan. Not shown to students.",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },
  POLICY_DOCUMENT: {
    icon: Scale,        emojiIcon: '⚖️',
    label: "Policy Document",
    description: "Regulatory or policy document — shapes rules and guardrails.",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },
  COURSE_REFERENCE: {
    icon: Compass,      emojiIcon: '🧭',
    label: "Course Guide",
    description: "Teaching methodology — skills framework, session flow, scaffolding rules. Not shown to students.",
    role: 'pedagogy',
    color: '#7c3aed',
    bg: 'color-mix(in srgb, #7c3aed 12%, transparent)',
  },

  // ── REFERENCE (reference) ──────────────────────────────────────────────
  REFERENCE: {
    icon: Library,      emojiIcon: '🔍',
    label: "Reference",
    description: "Glossary, appendix, or reference guide — supplementary lookup material.",
    role: 'reference',
    color: 'var(--text-muted)',
    bg: 'var(--surface-tertiary)',
  },
  CURRICULUM: {
    icon: GraduationCap, emojiIcon: '📐',
    label: "Curriculum",
    description: "Formal syllabus with learning outcomes or accreditation criteria.",
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
 */
const STUDENT_VISIBLE_DOC_TYPES = new Set([
  "READING_PASSAGE",
  "WORKSHEET",
  "COMPREHENSION",
  "QUESTION_BANK",
  "EXAMPLE",
]);

/** Should this document type be shared with students by default? */
export function isStudentVisibleDefault(documentType: string): boolean {
  return STUDENT_VISIBLE_DOC_TYPES.has(documentType);
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
