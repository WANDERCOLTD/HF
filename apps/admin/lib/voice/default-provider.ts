/**
 * DEFAULT_VOICE_PROVIDER_SLUG — canonical fallback when no provider
 * is configured via `VoiceSystemSettings.defaultProviderSlug`.
 *
 * Several voice paths fall back to "vapi" when neither the per-call
 * resolution nor the system-settings row supplies a slug. Centralising
 * the literal makes the fallback explicit and lets a future operator
 * change it in one place.
 *
 *  - `load-voice-config.ts:48` — picks an enabled provider when
 *    `VoiceSystemSettings.defaultProviderSlug` is empty.
 *  - `poll-stale-calls.ts::pollStaleCalls()` — defaults the slug arg
 *    when the cron entry omits it.
 *
 * Provider-internal `slug` fields (e.g. `providers/vapi/index.ts:70`)
 * are the provider's own identity and stay as literals — they're not
 * "the default fallback," they're "the vapi provider's slug."
 */

export const DEFAULT_VOICE_PROVIDER_SLUG = "vapi";
