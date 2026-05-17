/**
 * Curriculum module resolver — single helper for converting logical module
 * identifiers (authored slug or UUID) into verified `CurriculumModule.id`
 * values scoped to a specific curriculum.
 *
 * Slugs like "part1", "MOD-1", "mock" are NOT globally unique. They are
 * per-curriculum identifiers. Unscoped `findFirst({ where: { slug } })`
 * picked non-deterministically across all curricula in the DB, which
 * corrupted cross-playbook FKs (Opal/Freya/Tessa enrolled on the wrong
 * playbook's `part1` module). See epic #407.
 *
 * Every code path that needs to resolve a slug to a CurriculumModule.id
 * MUST go through this helper. Direct unscoped Prisma lookups are
 * rejected at runtime (the helper throws) and via a future ESLint rule
 * (#411).
 */
import { prisma } from "@/lib/prisma";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedModule {
  id: string;
}

/**
 * Resolve a logical module identifier (slug or UUID) to a verified
 * `CurriculumModule.id` belonging to the given `curriculumId`.
 *
 * - When `slugOrId` is a UUID, validates the row exists AND belongs to the
 *   given curriculum. Returns null on mismatch — refuses to "succeed" with
 *   a module from a different curriculum.
 * - When `slugOrId` is a slug, looks up by `(curriculumId, slug)` — the
 *   unique index on CurriculumModule.
 *
 * Throws when `curriculumId` is falsy. Returns null when the module does
 * not exist in the given curriculum.
 */
export async function resolveModuleByLogicalId(
  curriculumId: string,
  slugOrId: string,
): Promise<ResolvedModule | null> {
  if (!curriculumId) {
    throw new Error(
      "resolveModuleByLogicalId: curriculumId is required. " +
        "Unscoped slug lookups corrupt cross-playbook FKs — see #407.",
    );
  }
  if (!slugOrId) return null;

  if (UUID_RE.test(slugOrId)) {
    const row = await prisma.curriculumModule.findFirst({
      where: { id: slugOrId, curriculumId },
      select: { id: true },
    });
    return row;
  }

  const row = await prisma.curriculumModule.findFirst({
    where: { curriculumId, slug: slugOrId },
    select: { id: true },
  });
  return row;
}

/**
 * Resolve the canonical `Curriculum.id` attached to a `Playbook`. Pairs
 * with `resolveModuleByLogicalId()` — the two-step chain (playbook →
 * curriculum → module) is the supported way to derive a module FK from
 * caller context.
 *
 * When a playbook has multiple curricula attached (wizard-authored plus
 * imported content), returns the oldest by `createdAt` — matches the
 * convention already established in `pipeline/route.ts::loadCurrentModuleContext`.
 *
 * Returns null when the playbook has no curriculum attached or
 * `playbookId` is falsy.
 */
export async function resolveCurriculumIdForPlaybook(
  playbookId: string | null | undefined,
): Promise<string | null> {
  if (!playbookId) return null;
  const row = await prisma.curriculum.findFirst({
    where: { playbookId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return row?.id ?? null;
}
