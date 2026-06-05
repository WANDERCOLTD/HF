/**
 * Speech-assessment provider factory (#1118). Parallel to
 * `lib/voice/provider-factory.ts` — reads the
 * `SpeechAssessmentProvider` DB row, looks up the matching adapter
 * class in `SPEECH_ASSESSMENT_ADAPTERS`, instantiates with the row's
 * credentials + config, caches per-slug for `CACHE_TTL_MS`.
 *
 * TODO: extract at 3rd provider type — the cache primitive +
 * invalidate pattern is identical to the voice factory. Lifting to a
 * `createProviderCache<T>()` helper after a third use earns its keep;
 * with two uses it doesn't.
 */

import { prisma } from "@/lib/prisma";

import { SPEECH_ASSESSMENT_ADAPTERS } from "./adapter-registry";
import type { SpeechAssessmentAdapter } from "./types";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  adapter: SpeechAssessmentAdapter;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Look up the `SpeechAssessmentAdapter` for a slug. Reads the
 * `SpeechAssessmentProvider` DB row, instantiates the matching
 * adapter class with the row's credentials + config, caches for
 * `CACHE_TTL_MS`.
 *
 * @throws when the slug is unknown, disabled, or has an `adapterKey`
 *   not registered in `SPEECH_ASSESSMENT_ADAPTERS`.
 */
export async function getSpeechAssessmentProvider(
  slug: string,
): Promise<SpeechAssessmentAdapter> {
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.adapter;
  }

  const row = await prisma.speechAssessmentProvider.findUnique({
    where: { slug },
  });
  if (!row) {
    throw new Error(`Unknown speech assessment provider slug: ${slug}`);
  }
  if (!row.enabled) {
    throw new Error(`Speech assessment provider ${slug} is disabled`);
  }

  const Constructor = SPEECH_ASSESSMENT_ADAPTERS[row.adapterKey];
  if (!Constructor) {
    throw new Error(
      `Unknown adapterKey: ${row.adapterKey} for slug ${slug} — add an entry to lib/speech-assessment/adapter-registry.ts`,
    );
  }

  const credentials = (row.credentials as Record<string, unknown>) ?? {};
  const config = (row.config as Record<string, unknown>) ?? {};
  const adapter = new Constructor(credentials, config);

  cache.set(slug, { adapter, expiresAt: now + CACHE_TTL_MS });
  return adapter;
}

/**
 * Evict cached adapter instance for a slug. Must be called after
 * every mutation to a `SpeechAssessmentProvider` row (POST / PATCH /
 * DELETE).
 */
export function invalidateSpeechAssessmentProviderCache(slug: string): void {
  cache.delete(slug);
}

/** Evict the entire cache. Used by tests + after bulk operations. */
export function clearSpeechAssessmentProviderCache(): void {
  cache.clear();
}

/**
 * Look up the default speech-assessment provider slug (the row with
 * `isDefault = true`). Used by the PROSODY pipeline stage (#1119) when
 * no per-playbook override exists.
 *
 * @throws when no row has `isDefault: true` AND `enabled: true`.
 */
export async function getDefaultSpeechAssessmentProviderSlug(): Promise<string> {
  const row = await prisma.speechAssessmentProvider.findFirst({
    where: { isDefault: true, enabled: true },
    select: { slug: true },
  });
  if (!row) {
    throw new Error(
      "No default speech assessment provider configured — seed SpeechAssessmentProvider table or visit /x/settings/voice-scoring-providers",
    );
  }
  return row.slug;
}

/** List registered slugs without instantiating. Used by admin UI + tests. */
export async function listRegisteredSpeechAssessmentProviders(): Promise<
  string[]
> {
  const rows = await prisma.speechAssessmentProvider.findMany({
    select: { slug: true },
    orderBy: { slug: "asc" },
  });
  return rows.map((r) => r.slug);
}
