/**
 * recommendNextModule — #494 E2 Slice 2.5
 *
 * Picks the next `CurriculumModule` a learner should attempt within a given
 * curriculum. Works uniformly for BOTH authored courses (modules listed in
 * `Playbook.config.modules` and synced into `CurriculumModule` rows by
 * `sync-modules`) and AI-generated courses (modules extracted into
 * `Curriculum.modules` directly), because both routes ultimately produce
 * `CurriculumModule` rows attached to a `Curriculum`.
 *
 * Algorithm (in priority order):
 *
 *   1. Find the first non-mastered module in `sortOrder` whose prerequisites
 *      (a list of sibling slugs) are all `COMPLETED` → "next-in-sequence".
 *   2. If `strictPrerequisites === false` AND step 1 returned nothing, return
 *      the first non-mastered module ignoring prerequisites →
 *      "first-unstarted".
 *   3. If nothing above AND any module is `IN_PROGRESS`, return the
 *      lowest-sortOrder IN_PROGRESS module → "interleave-review".
 *   4. Otherwise return null (course effectively complete, or no modules).
 *
 * NOTE: `prerequisites` is declared on `CurriculumModule` in the schema as
 * `String[]` (slug list). Slice 2.4 will populate / surface it through the
 * authoring UI; for now it may be absent on legacy rows. We read it through
 * `(module as any).prerequisites ?? []` so this helper is safe to ship ahead
 * of 2.4.
 *
 * No DB writes here — pure read + recommendation.
 */
import { prisma } from "@/lib/prisma";
import { readCourseFlags } from "@/lib/curriculum/course-completion";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface RecommendedModule {
  moduleId: string;
  slug: string;
  title: string;
  reason:
    | "next-in-sequence"
    | "weakest-not-mastered"
    | "first-unstarted"
    | "interleave-review";
}

export interface RecommendInput {
  callerId: string;
  curriculumId: string;
  playbookConfig: PlaybookConfig | null;
}

type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  // Cast defensively — see file header. Slice 2.4 will guarantee this field.
  prerequisites?: string[];
}

/**
 * Resolve the next module for a learner within a curriculum. Returns `null`
 * when the course has no modules or every module is mastered.
 *
 * Safe for both authored and AI-generated routes: both write
 * `CurriculumModule` rows.
 */
export async function recommendNextModule(
  input: RecommendInput,
): Promise<RecommendedModule | null> {
  const { callerId, curriculumId, playbookConfig } = input;

  if (!callerId || !curriculumId) return null;

  const { strictPrerequisites } = readCourseFlags(playbookConfig);

  // 1. Load all modules for this curriculum, in teaching order.
  const modules = (await prisma.curriculumModule.findMany({
    where: { curriculumId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      sortOrder: true,
      prerequisites: true,
    },
  })) as unknown as ModuleRow[];

  if (modules.length === 0) return null;

  // 2. Load progress rows; index by moduleId.
  const progressRows = await prisma.callerModuleProgress.findMany({
    where: { callerId, moduleId: { in: modules.map((m) => m.id) } },
    select: { moduleId: true, status: true },
  });

  const statusById = new Map<string, ProgressStatus>();
  for (const row of progressRows) {
    statusById.set(row.moduleId, normaliseStatus(row.status));
  }

  // Slug → status helper (prerequisites are referenced by slug).
  const statusBySlug = new Map<string, ProgressStatus>();
  for (const m of modules) {
    statusBySlug.set(m.slug, statusById.get(m.id) ?? "NOT_STARTED");
  }

  // 3. Pick: first non-mastered module whose prereqs are all mastered.
  const nonMastered = modules.filter(
    (m) => (statusById.get(m.id) ?? "NOT_STARTED") !== "COMPLETED",
  );

  if (nonMastered.length === 0) {
    // Every module mastered.
    return null;
  }

  const reachable = nonMastered.find((m) => {
    const prereqs = readPrerequisites(m);
    return prereqs.every((slug) => statusBySlug.get(slug) === "COMPLETED");
  });

  if (reachable) {
    return {
      moduleId: reachable.id,
      slug: reachable.slug,
      title: reachable.title,
      reason: "next-in-sequence",
    };
  }

  // 4. Soft-prereq fallback: if strict=false, ignore prereqs and pick lowest
  // sortOrder non-mastered.
  if (!strictPrerequisites) {
    const fallback = nonMastered[0];
    return {
      moduleId: fallback.id,
      slug: fallback.slug,
      title: fallback.title,
      reason: "first-unstarted",
    };
  }

  // 5. Interleave-review: nothing reachable, but learner has work mid-flight.
  const inProgress = nonMastered.find(
    (m) => (statusById.get(m.id) ?? "NOT_STARTED") === "IN_PROGRESS",
  );
  if (inProgress) {
    return {
      moduleId: inProgress.id,
      slug: inProgress.slug,
      title: inProgress.title,
      reason: "interleave-review",
    };
  }

  // Strict mode + every remaining module is gated by an unmet prereq + no
  // IN_PROGRESS to fall back on. Course is structurally stuck — return null
  // and let the caller surface a "blocked" UI rather than silently pick a
  // gated module.
  return null;
}

function normaliseStatus(raw: string | null | undefined): ProgressStatus {
  if (raw === "COMPLETED" || raw === "IN_PROGRESS" || raw === "NOT_STARTED") {
    return raw;
  }
  return "NOT_STARTED";
}

function readPrerequisites(m: ModuleRow): string[] {
  // Defensive cast — slice 2.4 will land the canonical field. Until then
  // legacy rows may omit it.
  const raw = (m as { prerequisites?: unknown }).prerequisites;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}
