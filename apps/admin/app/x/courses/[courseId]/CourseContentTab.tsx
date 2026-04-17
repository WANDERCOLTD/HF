'use client';

import { CourseWhatTab, type CourseWhatTabProps } from './CourseWhatTab';
import { CourseGenomeTab } from './CourseGenomeTab';

// ── Types ──────────────────────────────────────────────

export type CourseContentTabProps = CourseWhatTabProps;

// ── Main Component ─────────────────────────────────────

export function CourseContentTab(props: CourseContentTabProps) {
  return (
    <>
      <CourseWhatTab {...props} />
      <CourseGenomeTab courseId={props.courseId} />
    </>
  );
}
