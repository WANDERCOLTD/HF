/**
 * Playbook mastery-discipline config accessors — #1081 Slice 1.
 *
 * Surfaces two forward-declared `PRESET_CONFIGS` keys (see
 * `lib/playbooks/create-variant.ts:75-98`) to the AGGREGATE write site so
 * the values are actually enforced at write time:
 *
 *   - `Playbook.config.useFreshMastery: true`  → mastery writes route to
 *     `Call.scratchMastery` instead of `CallerAttribute.lo_mastery:*`.
 *     (Exam Assessment uses this to keep its scoring out of the learner's
 *     long-term mastery.)
 *
 *   - `Playbook.config.maxMasteryTier: "DEVELOPING" | ...`  → per-Playbook
 *     cap on the mastery tier this Playbook can write. Applied to the
 *     CONTRIBUTION, not the final value — see track-progress.ts for the
 *     `max(existing, clamped)` discipline. (Pop Quiz uses this so quick
 *     checks can't promote an LO past "Developing".)
 *
 * Both accessors are in-memory cached for 30 seconds with the same TTL
 * shape as `ContractRegistry.ensureLoaded()`. The cache is per-playbook
 * keyed; a config update invalidates only its own entry via
 * `invalidatePlaybookMasteryConfigCache(playbookId)`.
 */

import { prisma } from "@/lib/prisma";
import { isMasteryTier, type MasteryTier } from "@/lib/curriculum/mastery-tiers";

const CACHE_TTL_MS = 30_000;

type CachedConfig = {
  maxMasteryTier: MasteryTier | null;
  useFreshMastery: boolean;
  loadedAt: number;
};

const CACHE = new Map<string, CachedConfig>();

async function loadFromDb(playbookId: string): Promise<CachedConfig> {
  const row = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });

  const config = (row?.config ?? null) as Record<string, unknown> | null;

  let maxMasteryTier: MasteryTier | null = null;
  if (config && "maxMasteryTier" in config) {
    const raw = config.maxMasteryTier;
    if (isMasteryTier(raw)) {
      maxMasteryTier = raw;
    } else if (raw != null) {
      console.warn(
        `[playbook-mastery-config] Playbook ${playbookId} has invalid maxMasteryTier (${JSON.stringify(raw)}); treating as unset.`,
      );
    }
  }

  let useFreshMastery = false;
  if (config && "useFreshMastery" in config) {
    const raw = config.useFreshMastery;
    if (typeof raw === "boolean") {
      useFreshMastery = raw;
    } else if (raw != null) {
      console.warn(
        `[playbook-mastery-config] Playbook ${playbookId} has non-boolean useFreshMastery (${JSON.stringify(raw)}); treating as false.`,
      );
    }
  }

  return { maxMasteryTier, useFreshMastery, loadedAt: Date.now() };
}

async function ensureLoaded(playbookId: string): Promise<CachedConfig> {
  const cached = CACHE.get(playbookId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached;
  }
  const fresh = await loadFromDb(playbookId);
  CACHE.set(playbookId, fresh);
  return fresh;
}

/**
 * Returns the per-Playbook mastery-tier cap from `Playbook.config.maxMasteryTier`.
 * Returns `null` when the field is unset, malformed, or the Playbook does not exist
 * (caller should treat null as "no cap" — Revision Aid path).
 */
export async function getMaxMasteryTier(
  playbookId: string,
): Promise<MasteryTier | null> {
  const cached = await ensureLoaded(playbookId);
  return cached.maxMasteryTier;
}

/**
 * Returns whether `Playbook.config.useFreshMastery` is `true`. Anything else —
 * unset, false, malformed, missing Playbook — returns false.
 */
export async function isUseFreshMastery(playbookId: string): Promise<boolean> {
  const cached = await ensureLoaded(playbookId);
  return cached.useFreshMastery;
}

/** Test/admin hook — drop a single playbook's cache entry. */
export function invalidatePlaybookMasteryConfigCache(playbookId?: string): void {
  if (playbookId) CACHE.delete(playbookId);
  else CACHE.clear();
}
