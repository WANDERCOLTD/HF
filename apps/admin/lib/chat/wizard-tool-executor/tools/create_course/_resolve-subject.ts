/**
 * Stage 3 of `create_course` — subject-discipline guard.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Walks the
 * `(input.subjectDiscipline || input.courseName)` fallback and short-circuits
 * with a hard-fail payload if the resulting string is missing or matches
 * the placeholder-name pattern (e.g. literal "Course"). This is the #207
 * orphan-Subject guard: refuses to scaffold a course whose Subject row
 * would carry a generic discipline.
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L55-70. The helper takes the same `CreateCourseContext`
 * threaded by Stage 2 and returns either the resolved discipline string
 * or a `WizardToolExec` early-return payload.
 */

import type { WizardToolExec } from "../../_shared/types";
import type { CreateCourseContext } from "./_resolve-domain";

export type ResolveSubjectResult =
  | { ok: true; subjectDiscipline: string }
  | { ok: false; earlyReturn: WizardToolExec };

export async function resolveSubjectOrError(
  ctx: CreateCourseContext,
): Promise<ResolveSubjectResult> {
  const { input } = ctx;
  const { isPlaceholderSubjectName } = await import(
    "@/lib/knowledge/cleanup-placeholder-subjects"
  );

  const courseName = input.courseName as string;
  const rawSubjectDiscipline = (input.subjectDiscipline as string) || courseName;

  if (!rawSubjectDiscipline || isPlaceholderSubjectName(rawSubjectDiscipline)) {
    return {
      ok: false,
      earlyReturn: {
        content: JSON.stringify({
          ok: false,
          error:
            "Subject discipline is required. Ask the user what subject this course teaches (e.g. 'IELTS Speaking', 'Year 5 Maths', 'Food Safety') and pass it as subjectDiscipline.",
        }),
        is_error: true,
      },
    };
  }

  return { ok: true, subjectDiscipline: rawSubjectDiscipline };
}
