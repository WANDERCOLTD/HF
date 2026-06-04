/**
 * Voice provider factory (AnyVoice #1017).
 *
 * Maps a provider slug (today only "vapi") to the corresponding
 * VoiceProvider implementation. Routes call this once per request rather
 * than importing a specific provider — that's how a second provider
 * plugs in without touching the routes.
 *
 * Whitelist + throw on unknown slug, NOT silent fallback. Per the
 * AI-to-DB guard pattern in .claude/rules/ai-to-db-guard.md: when the
 * lookup misses, the right answer is to fail loudly so the operator
 * sees the misconfiguration. A silent fallback would mean a typo in
 * the system-settings `provider` field silently downgrades calls to
 * VAPI, masking the actual config the operator intended.
 */

import type { VoiceProvider } from "./types";
import { vapiProvider } from "./providers/vapi";

const PROVIDERS: Record<string, VoiceProvider> = {
  vapi: vapiProvider,
};

/**
 * Look up a VoiceProvider by slug.
 *
 * @throws Error("Unknown voice provider: <slug>") when the slug isn't
 *   registered. Routes that read the slug from system-settings should
 *   let this throw — middleware will catch and 500 with a clear message.
 */
export function getVoiceProvider(slug: string): VoiceProvider {
  const provider = PROVIDERS[slug];
  if (!provider) {
    throw new Error(`Unknown voice provider: ${slug}`);
  }
  return provider;
}

/** For tests / health checks — list registered slugs without instantiating. */
export function listRegisteredVoiceProviders(): string[] {
  return Object.keys(PROVIDERS);
}
