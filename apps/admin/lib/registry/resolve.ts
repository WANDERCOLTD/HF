/**
 * Alias-aware parameter id resolution (#1949 — epic #1946 S1).
 *
 * `resolveParameterId(rawId)` returns the canonical `parameterId` for an
 * input that may be either (a) a current canonical id, (b) a legacy id
 * now sitting in some Parameter row's `aliases[]`, or (c) an unknown
 * id (returned unchanged — the caller decides whether to treat as
 * brand-new or as a typo).
 *
 * Used by:
 *   - `getEffectiveBehaviorTargetsForCaller` cascade reader to surface
 *     the right Parameter row when a stale `BehaviorTarget.parameterId`
 *     points to a now-aliased id
 *   - `lib/cascade/resolvers/behavior-target.ts` for the same reason
 *   - any write-side path that takes an externally-supplied id and
 *     needs to normalise before insert (wizard YAML extraction, admin
 *     tools, sync routes)
 *
 * Cache: 60s TTL on the in-memory map, mirroring the contract registry
 * cache convention. Refreshed on demand if a write path detects a
 * miss.
 *
 * @see docs/decisions/2026-06-18-alias-resolver.md (TBD if needed)
 * @see github.com/.../issues/1949
 */

import { prisma } from "@/lib/prisma";

interface AliasMapEntry {
  canonicalId: string;
  deprecatedAt: Date | null;
}

interface AliasCache {
  /** Map keyed by EITHER the canonical id OR any alias → canonical id. */
  byAnyId: Map<string, AliasMapEntry>;
  loadedAt: number;
}

let _cache: AliasCache | null = null;
const TTL_MS = 60_000;

async function loadAliasMap(): Promise<AliasCache> {
  const now = Date.now();
  if (_cache && now - _cache.loadedAt < TTL_MS) {
    return _cache;
  }

  const rows = await prisma.parameter.findMany({
    select: { parameterId: true, aliases: true, deprecatedAt: true },
  });

  const byAnyId = new Map<string, AliasMapEntry>();
  for (const row of rows) {
    const entry: AliasMapEntry = {
      canonicalId: row.parameterId,
      deprecatedAt: row.deprecatedAt,
    };
    byAnyId.set(row.parameterId, entry);
    for (const alias of row.aliases ?? []) {
      byAnyId.set(alias, entry);
    }
  }

  _cache = { byAnyId, loadedAt: now };
  return _cache;
}

/**
 * Resolve a parameter id, following `aliases[]` if needed.
 *
 * @param rawId — incoming id (may be canonical, alias, or unknown).
 * @returns `{ canonicalId, isAlias, deprecatedAt, found }`
 *   - `canonicalId`: the canonical Parameter.parameterId. When the
 *     input is unknown, the input is returned unchanged.
 *   - `isAlias`: true when `rawId !== canonicalId` (input was a known alias).
 *   - `deprecatedAt`: the Parameter row's deprecation timestamp; null
 *     when the row is active.
 *   - `found`: true when `rawId` matched a row (canonical or alias).
 */
export async function resolveParameterId(
  rawId: string,
): Promise<{
  canonicalId: string;
  isAlias: boolean;
  deprecatedAt: Date | null;
  found: boolean;
}> {
  if (!rawId) {
    return { canonicalId: rawId, isAlias: false, deprecatedAt: null, found: false };
  }
  const cache = await loadAliasMap();
  const entry = cache.byAnyId.get(rawId);
  if (!entry) {
    return { canonicalId: rawId, isAlias: false, deprecatedAt: null, found: false };
  }
  return {
    canonicalId: entry.canonicalId,
    isAlias: rawId !== entry.canonicalId,
    deprecatedAt: entry.deprecatedAt,
    found: true,
  };
}

/**
 * Bulk variant — single DB read for many ids. Returns a map keyed by
 * the input id. Use this when resolving many parameterIds in the
 * cascade reader (avoids N round-trips through `resolveParameterId`).
 */
export async function resolveParameterIds(
  rawIds: readonly string[],
): Promise<Map<string, { canonicalId: string; deprecatedAt: Date | null; found: boolean }>> {
  const out = new Map<
    string,
    { canonicalId: string; deprecatedAt: Date | null; found: boolean }
  >();
  if (rawIds.length === 0) return out;
  const cache = await loadAliasMap();
  for (const rawId of rawIds) {
    const entry = cache.byAnyId.get(rawId);
    if (entry) {
      out.set(rawId, {
        canonicalId: entry.canonicalId,
        deprecatedAt: entry.deprecatedAt,
        found: true,
      });
    } else {
      out.set(rawId, { canonicalId: rawId, deprecatedAt: null, found: false });
    }
  }
  return out;
}

/** Force-drop the in-memory cache. Call after a Parameter write. */
export function clearAliasCache(): void {
  _cache = null;
}
