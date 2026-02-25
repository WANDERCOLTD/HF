/**
 * Document Type Icons & Labels
 *
 * Centralized mapping from DocumentType enum to lucide SVG icons,
 * human-readable labels, and short descriptions.
 *
 * Used by: Teach wizard classification card, DocumentTypeBadge, content sources.
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
} from "lucide-react";

export interface DocTypeInfo {
  icon: LucideIcon;
  label: string;
  description: string;
}

export const DOC_TYPE_INFO: Record<string, DocTypeInfo> = {
  TEXTBOOK:        { icon: BookOpen,      label: "Textbook",         description: "General reference or informational content" },
  CURRICULUM:      { icon: GraduationCap, label: "Curriculum",       description: "Syllabus, learning outcomes, or accreditation criteria" },
  WORKSHEET:       { icon: PenLine,       label: "Worksheet",        description: "Exercises, activities, or practice material" },
  COMPREHENSION:   { icon: BookOpenCheck, label: "Comprehension",    description: "Combined reading passage with questions" },
  READING_PASSAGE: { icon: ScrollText,    label: "Reading Passage",  description: "Standalone prose — story, article, or chapter" },
  ASSESSMENT:      { icon: ListChecks,    label: "Assessment",       description: "Formal test, exam, or mark scheme" },
  REFERENCE:       { icon: Library,       label: "Reference",        description: "Glossary, appendix, or reference guide" },
  EXAMPLE:         { icon: FileSearch,    label: "Example",          description: "Worked example or case study" },
  LESSON_PLAN:     { icon: LayoutList,    label: "Lesson Plan",      description: "Teaching guide or session plan" },
  POLICY_DOCUMENT: { icon: Scale,         label: "Policy Document",  description: "Regulatory or policy document" },
  QUESTION_BANK:   { icon: HelpCircle,    label: "Question Bank",    description: "Structured tutor questions with guidance" },
};

export function getDocTypeInfo(type: string): DocTypeInfo {
  return DOC_TYPE_INFO[type] ?? DOC_TYPE_INFO.TEXTBOOK;
}
