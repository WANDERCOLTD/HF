'use client';

import { CourseWhatTab, type CourseWhatTabProps } from './CourseWhatTab';
import { CourseRefTab } from './CourseRefTab';
import { ClipboardList } from 'lucide-react';

// ── Types ──────────────────────────────────────────────

export type CourseContentTabProps = CourseWhatTabProps & {
  // CourseRefTab only needs courseId + isOperator (already in CourseWhatTabProps)
};

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export function CourseContentTab(props: CourseContentTabProps) {
  return (
    <>
      {/* ── Course Content (from What tab) ────────────── */}
      <CourseWhatTab {...props} />

      {/* ── Course Reference ──────────────────────────── */}
      <div className="hf-mt-xl">
        <SectionHeader title="Course Reference" icon={ClipboardList} />
        <CourseRefTab courseId={props.courseId} isOperator={props.isOperator} />
      </div>
    </>
  );
}
