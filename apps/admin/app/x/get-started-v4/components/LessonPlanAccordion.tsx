"use client";

import { useState } from "react";
import { ChevronDown, BookOpen } from "lucide-react";

export interface LessonEntry {
  session: number;
  label: string;
  type: "introduction" | "lesson" | "review" | string;
  notes?: string;
  estimatedDurationMins?: number;
}

interface LessonPlanAccordionProps {
  entries: LessonEntry[];
  courseName?: string;
}

const TYPE_LABELS: Record<string, string> = {
  introduction: "Intro",
  review: "Review",
  lesson: "Lesson",
};

export function LessonPlanAccordion({ entries, courseName }: LessonPlanAccordionProps) {
  const [open, setOpen] = useState(false);

  if (!entries.length) return null;

  return (
    <div className="cv4-accordion">
      <button
        type="button"
        className="cv4-accordion-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="cv4-accordion-title">
          <BookOpen size={14} />
          <span>{courseName ? `${courseName} — Lesson Plan` : "Lesson Plan"}</span>
          <span className="cv4-accordion-count">{entries.length} sessions</span>
        </div>
        <ChevronDown
          size={14}
          className="cv4-accordion-chevron"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="cv4-accordion-body">
          {entries.map((entry) => (
            <div key={entry.session} className="cv4-lesson-row">
              <span className="cv4-lesson-num">{entry.session}</span>
              <div className="cv4-lesson-info">
                <span className="cv4-lesson-label">{entry.label}</span>
                {entry.notes && (
                  <span className="cv4-lesson-notes">{entry.notes}</span>
                )}
              </div>
              <span className="cv4-lesson-type">
                {TYPE_LABELS[entry.type] ?? entry.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
