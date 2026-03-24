/**
 * Backfill teachMethod on ContentAssertions that have teachMethod=null.
 *
 * Uses the course's teachingMode (from playbook config) or falls back to each
 * subject's teaching profile. Shared by the API route and wizard create_course.
 */

import { prisma } from "@/lib/prisma";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import {
  categoryToTeachMethod,
  type TeachingMode,
} from "./resolve-config";
import {
  getTeachingProfile,
} from "./teaching-profiles";

export interface BackfillResult {
  updated: number;
  total: number;
  teachingMode: string | null;
}

export async function backfillTeachMethods(
  courseId: string,
): Promise<BackfillResult> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      config: true,
      domain: { select: { id: true } },
    },
  });

  if (!playbook) {
    return { updated: 0, total: 0, teachingMode: null };
  }

  const domainId = playbook.domain?.id;
  if (!domainId) {
    return { updated: 0, total: 0, teachingMode: null };
  }

  const pbConfig = (playbook.config as Record<string, any>) || {};
  const courseTeachingMode: TeachingMode | undefined = pbConfig.teachingMode || undefined;

  const { subjects, scoped } = await getSubjectsForPlaybook(courseId, domainId);
  if (!scoped || subjects.length === 0) {
    return { updated: 0, total: 0, teachingMode: courseTeachingMode || null };
  }

  let totalUpdated = 0;
  let totalCount = 0;

  for (const subject of subjects) {
    const sourceIds = subject.sources.map((s) => s.sourceId);
    if (sourceIds.length === 0) continue;

    // Resolve teachingMode: course-level > subject profile > fallback "recall"
    let subjectTeachingMode: TeachingMode = courseTeachingMode || "recall";
    if (!courseTeachingMode && subject.id) {
      const subjectRecord = await prisma.subject.findUnique({
        where: { id: subject.id },
        select: { teachingProfile: true, teachingOverrides: true },
      });
      if (subjectRecord?.teachingProfile) {
        const profile = getTeachingProfile(subjectRecord.teachingProfile);
        if (profile) {
          const overrides = subjectRecord.teachingOverrides as Record<string, any> | null;
          subjectTeachingMode = (overrides?.teachingMode || profile.teachingMode) as TeachingMode;
        }
      }
    }

    const nullAssertions = await prisma.contentAssertion.findMany({
      where: {
        sourceId: { in: sourceIds },
        teachMethod: null,
      },
      select: { id: true, category: true },
    });

    totalCount += nullAssertions.length;
    if (nullAssertions.length === 0) continue;

    // Batch update by category
    const byCat = new Map<string, string[]>();
    for (const a of nullAssertions) {
      const cat = a.category || "fact";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(a.id);
    }

    for (const [category, ids] of byCat) {
      const teachMethod = categoryToTeachMethod(category, subjectTeachingMode);
      const result = await prisma.contentAssertion.updateMany({
        where: { id: { in: ids } },
        data: { teachMethod },
      });
      totalUpdated += result.count;
    }
  }

  return {
    updated: totalUpdated,
    total: totalCount,
    teachingMode: courseTeachingMode || "per-subject",
  };
}
