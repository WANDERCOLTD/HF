/**
 * @api GET /api/callers/:callerId/lo-progress
 * @scope callers:read
 * @auth session (VIEWER+)
 * @desc Get caller's per-LO mastery scores with linked assertions per module.
 *       Returns LO scores from CallerAttribute (CURRICULUM scope) joined with
 *       LearningObjective descriptions and ContentAssertion teaching points.
 *       Lazy-loaded by UI when a module is expanded.
 * @query moduleId - optional CurriculumModule slug to filter to a single module
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getActiveCurricula, getCurriculumProgress } from "@/lib/curriculum/track-progress";

type Params = { params: Promise<{ callerId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const moduleSlug = req.nextUrl.searchParams.get("moduleId");

    // Get all curricula this caller has progress in
    const specSlugs = await getActiveCurricula(callerId);
    if (specSlugs.length === 0) {
      return NextResponse.json({ ok: true, modules: [] });
    }

    // Load LO mastery from all curricula
    const allModules: ModuleLoProgress[] = [];

    for (const specSlug of specSlugs) {
      const progress = await getCurriculumProgress(callerId, specSlug);

      // Get modules with LO data
      const moduleIds = Object.keys(progress.loMastery);
      if (moduleIds.length === 0) continue;

      // Resolve module slugs to DB records with LOs and assertions.
      // Scope by curriculumId derived from specSlug (Curriculum.slug is
      // globally unique). Without this scope, slugs like "part1" or "MOD-1"
      // would return modules from any curriculum sharing the slug — #407.
      const curriculum = await prisma.curriculum.findFirst({
        where: { slug: specSlug },
        select: { id: true },
      });
      if (!curriculum) continue;

      const modules = await prisma.curriculumModule.findMany({
        where: moduleSlug
          ? { curriculumId: curriculum.id, slug: moduleSlug }
          : { curriculumId: curriculum.id, slug: { in: moduleIds } },
        select: {
          id: true,
          slug: true,
          title: true,
          sortOrder: true,
          learningObjectives: {
            select: {
              id: true,
              ref: true,
              description: true,
              sortOrder: true,
              assertions: {
                select: {
                  id: true,
                  assertion: true,
                  category: true,
                  chapter: true,
                  trustLevel: true,
                  examRelevance: true,
                  tags: true,
                  depth: true,
                },
                orderBy: { orderIndex: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      });

      for (const mod of modules) {
        const loScores = progress.loMastery[mod.slug] || {};
        const moduleMastery = progress.modulesMastery[mod.slug] || 0;

        allModules.push({
          moduleId: mod.id,
          moduleSlug: mod.slug,
          moduleTitle: mod.title,
          sortOrder: mod.sortOrder,
          specSlug,
          mastery: moduleMastery,
          learningObjectives: mod.learningObjectives.map((lo) => ({
            id: lo.id,
            ref: lo.ref,
            description: lo.description,
            sortOrder: lo.sortOrder,
            mastery: loScores[lo.ref] ?? null,
            assertionCount: lo.assertions.length,
            assertions: lo.assertions.map((a) => ({
              id: a.id,
              assertion: a.assertion,
              category: a.category,
              chapter: a.chapter,
              trustLevel: a.trustLevel,
              examRelevance: a.examRelevance,
              tags: a.tags,
              depth: a.depth,
            })),
          })),
        });
      }
    }

    return NextResponse.json({ ok: true, modules: allModules });
  } catch (error: any) {
    console.error("[callers/:id/lo-progress] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

type ModuleLoProgress = {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  sortOrder: number;
  specSlug: string;
  mastery: number;
  learningObjectives: {
    id: string;
    ref: string;
    description: string;
    sortOrder: number;
    mastery: number | null;
    assertionCount: number;
    assertions: {
      id: string;
      assertion: string;
      category: string;
      chapter: string | null;
      trustLevel: string | null;
      examRelevance: number | null;
      tags: string[];
      depth: number | null;
    }[];
  }[];
};
