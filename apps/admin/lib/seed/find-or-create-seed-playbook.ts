/**
 * Seed-driven playbook idempotency.
 *
 * Each seed (`seed-ielts-course.ts`, `seed-demo-course.ts`, etc.)
 * historically used `findFirst({where:{domainId, name}})` to locate
 * "its" playbook. That works when the seed always runs against the
 * same domain — but if a wizard- or hand-created playbook with the
 * same name lives on a DIFFERENT domain, the seed misses it and
 * creates a duplicate.
 *
 * This helper introduces a `seedSourceTag` convention stored on
 * `Playbook.config.seedSourceTag`. Lookups are tag-first
 * (cross-domain). On miss, falls back to legacy `(domainId, name)`
 * for backwards compatibility with playbooks created before this
 * helper existed — those get the tag attached on first re-seed.
 *
 * Usage:
 *
 *   const playbook = await findOrCreateSeedPlaybook(prisma, {
 *     seedSourceTag: "ielts-seed-v1",
 *     domainId: domain.id,
 *     name: "IELTS Speaking Practice",
 *     createData: { ... full playbook create input ... },
 *   });
 */

import type { PrismaClient, Prisma } from "@prisma/client";

interface PlaybookConfigWithTag {
  seedSourceTag?: string;
  [key: string]: unknown;
}

export interface FindOrCreateSeedPlaybookOptions {
  /** Unique tag identifying this seed (e.g. "ielts-seed-v1"). */
  seedSourceTag: string;
  /** Domain the seed targets (used in the legacy-fallback lookup AND the create payload). */
  domainId: string;
  /** Human-readable playbook name. */
  name: string;
  /**
   * Full `Playbook.create` data, MINUS the `config` — config is merged
   * inside the helper so the tag is always present without callers
   * needing to know about it.
   */
  createData: Omit<Prisma.PlaybookUncheckedCreateInput, "config"> & {
    config?: Record<string, unknown>;
  };
}

/**
 * Locate or create the seed's canonical playbook idempotently.
 *
 * Resolution order:
 *   1. Look up by `Playbook.config.seedSourceTag === seedSourceTag` (cross-domain).
 *   2. If not found, look up by `(domainId, name)` (legacy fallback — pre-tag rows).
 *   3. If still not found, create the playbook with the tag baked into `config`.
 *
 * Any playbook found via step 2 (legacy) gets the tag attached on the
 * way out so subsequent runs converge through step 1.
 */
export async function findOrCreateSeedPlaybook(
  prisma: PrismaClient,
  opts: FindOrCreateSeedPlaybookOptions,
): Promise<{ id: string; name: string }> {
  const { seedSourceTag, domainId, name, createData } = opts;

  // Step 1 — tag-based lookup (cross-domain, canonical).
  //
  // Prisma can't index into JSON natively in a strongly-typed way,
  // so we use the path-based JSON filter — `config.seedSourceTag`.
  const byTag = await prisma.playbook.findFirst({
    where: {
      config: {
        path: ["seedSourceTag"],
        equals: seedSourceTag,
      },
    },
    select: { id: true, name: true },
  });
  if (byTag) return byTag;

  // Step 2 — legacy fallback for rows created before this helper
  // existed. Match by (domainId, name) and attach the tag.
  const byName = await prisma.playbook.findFirst({
    where: { domainId, name },
    select: { id: true, name: true, config: true },
  });
  if (byName) {
    // Merge the tag into the existing config (preserving any other keys).
    const currentConfig = (byName.config ?? {}) as PlaybookConfigWithTag;
    const mergedConfig: PlaybookConfigWithTag = { ...currentConfig, seedSourceTag };
    await prisma.playbook.update({
      where: { id: byName.id },
      data: { config: mergedConfig as Prisma.InputJsonValue },
    });
    return { id: byName.id, name: byName.name };
  }

  // Step 3 — create. Merge the tag into the caller's config.
  const callerConfig = (createData.config ?? {}) as PlaybookConfigWithTag;
  const finalConfig: PlaybookConfigWithTag = { ...callerConfig, seedSourceTag };
  const created = await prisma.playbook.create({
    data: {
      ...createData,
      config: finalConfig as Prisma.InputJsonValue,
    },
    select: { id: true, name: true },
  });
  return created;
}
