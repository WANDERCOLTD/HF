/**
 * Voice provider factory (AnyVoice #1031 — rewritten from #1017 to be
 * data-driven per CLAUDE.md "Configuration over Code / Database over
 * Filesystem").
 *
 * `getVoiceProvider(slug)` reads the `VoiceProvider` DB row by slug,
 * looks up the matching class constructor in `VOICE_ADAPTERS`
 * (`lib/voice/adapter-registry.ts`), instantiates it with the row's
 * `credentials` + `config`, and caches the instance per slug for the
 * TTL window. Throws on unknown slug or unknown adapterKey — no
 * silent fallback (AI-to-DB guard pattern: whitelist validation +
 * loud failure when the contract breaks).
 *
 * **Cache strategy:**
 *   - TTL: 5 minutes (longer than ContractRegistry's 30s because
 *     provider config changes are rare admin actions, not hot-path;
 *     5-min reduces DB reads on the call-start path).
 *   - Immediate eviction on POST/PATCH/DELETE — callers of those
 *     routes MUST invoke `invalidateVoiceProviderCache(slug)` after
 *     the DB write so a credential rotation propagates instantly.
 *     TTL alone is insufficient when an admin rotates a compromised
 *     key — 5 minutes of staleness in that scenario is unacceptable.
 *
 * TODO(security): credentials-encryption — `VoiceProvider.credentials`
 * is plaintext Json today. AES-256-GCM application-layer encryption
 * is tracked as R1 in #1031, non-blocking post-market-test follow-up.
 */

import { prisma } from "@/lib/prisma";
import { VOICE_ADAPTERS } from "./adapter-registry";
import type { VoiceProvider } from "./types";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  provider: VoiceProvider;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Look up the `VoiceProvider` for a slug. Reads the DB row, instantiates
 * the matching adapter class with the row's credentials + config, caches
 * for `CACHE_TTL_MS`.
 *
 * @throws Error("Unknown voice provider slug: <slug>") when no DB row
 *   exists for the slug. Route layers should let this throw — the
 *   middleware will surface as 500 with a clear message.
 * @throws Error("Voice provider <slug> is disabled") when the row exists
 *   but `enabled = false`. Same handling.
 * @throws Error("Unknown adapterKey: <key> for slug <slug>") when the
 *   row's `adapterKey` doesn't match any entry in `VOICE_ADAPTERS`.
 *   Indicates a misconfigured row (admin set an adapterKey for a class
 *   that doesn't exist yet).
 */
export async function getVoiceProvider(slug: string): Promise<VoiceProvider> {
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.provider;
  }

  const row = await prisma.voiceProvider.findUnique({ where: { slug } });
  if (!row) {
    throw new Error(`Unknown voice provider slug: ${slug}`);
  }
  if (!row.enabled) {
    throw new Error(`Voice provider ${slug} is disabled`);
  }

  const Constructor = VOICE_ADAPTERS[row.adapterKey];
  if (!Constructor) {
    throw new Error(
      `Unknown adapterKey: ${row.adapterKey} for slug ${slug} — add an entry to lib/voice/adapter-registry.ts`,
    );
  }

  const credentials = (row.credentials as Record<string, unknown>) ?? {};
  const config = (row.config as Record<string, unknown>) ?? {};
  const provider = new Constructor(credentials, config);

  cache.set(slug, { provider, expiresAt: now + CACHE_TTL_MS });
  return provider;
}

/**
 * Evict cached provider instance for a slug. Must be called after every
 * mutation to a `VoiceProvider` row (POST / PATCH / DELETE). TTL-only
 * invalidation leaves a 5-minute window where rotated credentials are
 * still served from cache — unacceptable for a credential store.
 */
export function invalidateVoiceProviderCache(slug: string): void {
  cache.delete(slug);
}

/** Evict the entire cache. Used by tests + after bulk operations. */
export function clearVoiceProviderCache(): void {
  cache.clear();
}

/**
 * Look up the default voice provider slug (the row with `isDefault = true`).
 * Used by routes that haven't resolved a per-caller / per-cohort override.
 * Returns the slug only — the caller passes it to `getVoiceProvider`.
 *
 * @throws Error("No default voice provider configured") when no row has
 *   isDefault=true. Indicates broken seed or admin-misconfiguration.
 */
export async function getDefaultVoiceProviderSlug(): Promise<string> {
  const row = await prisma.voiceProvider.findFirst({
    where: { isDefault: true, enabled: true },
    select: { slug: true },
  });
  if (!row) {
    throw new Error(
      "No default voice provider configured — seed VoiceProvider table or visit /x/settings/voice-providers",
    );
  }
  return row.slug;
}

/** List registered slugs without instantiating. Used by admin UI + tests. */
export async function listRegisteredVoiceProviders(): Promise<string[]> {
  const rows = await prisma.voiceProvider.findMany({
    select: { slug: true },
    orderBy: { slug: "asc" },
  });
  return rows.map((r) => r.slug);
}
