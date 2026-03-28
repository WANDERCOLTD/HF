'use client';

import { CourseWhatTab, type CourseWhatTabProps } from './CourseWhatTab';

// ── Types ──────────────────────────────────────────────

export type CourseContentTabProps = CourseWhatTabProps;

// ── Main Component ─────────────────────────────────────

export function CourseContentTab(props: CourseContentTabProps) {
  return <CourseWhatTab {...props} />;
}
