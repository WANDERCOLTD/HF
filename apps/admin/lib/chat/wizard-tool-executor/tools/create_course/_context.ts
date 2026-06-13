/**
 * Shared context types for the `create_course` stage helpers (#1544).
 *
 * `CreateCourseContext` is the input bag every stage receives — just the
 * three arguments the orchestrator was originally called with.
 *
 * `ResolvedCreateCourseContext` extends it with the values Stages 2 + 3
 * derive (domainId, subjectDiscipline) and the orchestrator's downstream
 * input reads (courseName, interactionPattern, packSubjectIds,
 * uploadSourceIds). Stages 4, 5, 7, 8 take the resolved shape because each
 * needs the post-resolution values without re-doing the work.
 */

import type { CreateCourseContext } from "./_resolve-domain";

export type { CreateCourseContext };

export interface ResolvedCreateCourseContext extends CreateCourseContext {
  /** From Stage 2 (`_resolve-domain`). */
  domainId: string;
  /** From Stage 3 (`_resolve-subject`). */
  subjectDiscipline: string;
  /** From `input.courseName` (the AI's chosen course title). */
  courseName: string;
  /** From `input.interactionPattern` (educator-set delivery style). */
  interactionPattern: string;
  /** From `input.packSubjectIds` or `setupData.packSubjectIds`. */
  packSubjectIds?: string[];
  /** From `input.uploadSourceIds` or `setupData.uploadSourceIds` (#492 Phase 5). */
  uploadSourceIds?: string[];
}
