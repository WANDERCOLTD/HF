/**
 * Voice adapter registry (AnyVoice #1031).
 *
 * The ONE hardcoded lookup in the voice subsystem: maps an `adapterKey`
 * string (stored on the `VoiceProvider` DB row) to a class constructor
 * that implements `VoiceProvider`. Adding a new provider class to HF
 * means: (a) write the class under `lib/voice/providers/<slug>/`, (b)
 * add one entry to `VOICE_ADAPTERS` here. Everything else — credentials,
 * config, enablement, default selection — is data in the `VoiceProvider`
 * table managed via /x/settings/voice-providers.
 *
 * This file is deliberately small and deliberately the only place
 * voice-implementation classes are referenced by name. The factory
 * (`lib/voice/provider-factory.ts`) looks up the constructor here when
 * instantiating an adapter from a DB row.
 *
 * Per CLAUDE.md "Configuration over Code": the registry is the
 * unavoidable code seam — class implementations can't live in a Json
 * blob — but registration/credentials/config/enable-state are all data.
 */

import { VapiProvider } from "./providers/vapi";
import type { VoiceProvider } from "./types";

/** Constructor signature every adapter class must satisfy. */
export interface VoiceProviderConstructor {
  new (credentials: Record<string, unknown>, config: Record<string, unknown>): VoiceProvider;
}

/**
 * `adapterKey` → constructor. Add a new line per new provider class.
 * The key stored on `VoiceProvider.adapterKey` must match a key here, or
 * the factory throws on instantiation.
 */
export const VOICE_ADAPTERS: Record<string, VoiceProviderConstructor> = {
  vapi: VapiProvider as unknown as VoiceProviderConstructor,
};

/** For tests / health checks — list registered adapter keys without
 *  instantiating. Distinct from `listRegisteredVoiceProviders` (factory)
 *  which lists DB-registered slugs; this lists CODE-registered class keys. */
export function listRegisteredAdapterKeys(): string[] {
  return Object.keys(VOICE_ADAPTERS);
}
