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
 * #611 Fix A — canonical moduleId resolution for AGGREGATE-stage writers.
 *
 * Returns the verified `CurriculumModule.slug` for a module given any
 * logical identifier (slug, UUID, or display-name guess). The slug is the
 * canonical form for the `{moduleId}` token in `lo_mastery:*` storage keys
 * (and any other contract that requires per-curriculum stability).
 *
 * Returns null when the module cannot be resolved within the given
 * curriculum — callers MUST treat that as a failure and either log+skip
 * or throw, never fall back to writing the unresolved string into a key.
 *
 * Throws on empty `curriculumId` (mirrors `resolveModuleByLogicalId`).
 *
 * See: docs/epic-100-chain-walk.md (Link 4 — CALL → SCORE; Link 6 — ADAPT → COMPOSE)
 *      docs-archive/bdd-specs/contracts/CURRICULUM_PROGRESS_V1.contract.json
 */
export async function resolveModuleSlug(
  curriculumId: string,
  slugOrIdOrName: string | null | undefined,
): Promise<string | null> {
  if (!curriculumId) {
    throw new Error(
      "resolveModuleSlug: curriculumId is required. " +
        "Unscoped slug lookups corrupt cross-playbook FKs — see #407.",
    );
  }
  if (!slugOrIdOrName) return null;

  // Case 1: UUID — look up by id (scoped) and return the slug.
  if (UUID_RE.test(slugOrIdOrName)) {
    const row = await prisma.curriculumModule.findFirst({
      where: { id: slugOrIdOrName, curriculumId },
      select: { slug: true },
    });
    return row?.slug ?? null;
  }

  // Case 2: slug — verify it exists in this curriculum, return as-is.
  const direct = await prisma.curriculumModule.findFirst({
    where: { curriculumId, slug: slugOrIdOrName },
    select: { slug: true },
  });
  if (direct) return direct.slug;

  // Case 3: display title — AI sometimes echoes the module's `title` field
  // verbatim instead of its slug (e.g. "Part 1: Familiar Topics" instead of
  // "part1"). Last-resort case-insensitive lookup by title. If multiple
  // modules in this curriculum share a title (shouldn't happen, but possible)
  // we refuse rather than guess.
  const byTitle = await prisma.curriculumModule.findMany({
    where: { curriculumId, title: { equals: slugOrIdOrName, mode: "insensitive" } },
    select: { slug: true },
    take: 2,
  });
  if (byTitle.length === 1) return byTitle[0].slug;
  return null;
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

  // #1034 — Prefer PlaybookCurriculum (join table). A variant Playbook has a
  // `linked` row pointing at the parent's Curriculum; reading the deprecated
  // Curriculum.playbookId column would silently miss it and the pipeline
  // would skip module-aware composition for every variant Call.
  // Order: primary before linked, then oldest first — matches the
  // pre-#1034 convention of "the oldest Curriculum for this Playbook."
  const join = await prisma.playbookCurriculum.findFirst({
    where: { playbookId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { curriculumId: true },
  });
  if (join) return join.curriculumId;

  // Fallback: deprecated Curriculum.playbookId column. Rollback safety
  // during the #1034 → #1038 transition window — covers the narrow case
  // where a Curriculum write site hasn't yet been updated to dual-write.
  // Dropped in #1038.
  const row = await prisma.curriculum.findFirst({
    where: { playbookId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return row?.id ?? null;
}
