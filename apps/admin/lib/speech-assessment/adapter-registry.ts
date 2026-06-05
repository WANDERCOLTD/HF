/**
 * Speech-assessment adapter registry (#1118).
 *
 * Parallel to `lib/voice/adapter-registry.ts` — maps an `adapterKey`
 * string (stored on the `SpeechAssessmentProvider` DB row) to a class
 * constructor implementing `SpeechAssessmentAdapter`. Adding a new
 * scoring vendor means: (a) write the class under
 * `lib/speech-assessment/providers/<slug>/`, (b) add one entry here.
 * Everything else — credentials, config, enablement, default
 * selection — is data in the `SpeechAssessmentProvider` table managed
 * via /x/settings/voice-scoring-providers.
 *
 * TODO: extract at 3rd provider type — when a third provider category
 * (e.g. STT-only, sentiment) lands, lift the registry + factory pattern
 * into a generic `createProviderRegistry<T>()` helper. With two uses
 * (VoiceProvider + SpeechAssessmentProvider) the duplication is honest.
 */

import { SpeechAceAdapter } from "./providers/speechace";
import { SpeechSuperAdapter } from "./providers/speechsuper";
import type { SpeechAssessmentAdapterConstructor } from "./types";

/**
 * `adapterKey` → constructor. Add a new line per new vendor adapter.
 * The key stored on `SpeechAssessmentProvider.adapterKey` must match
 * a key here, or the factory throws on instantiation.
 */
export const SPEECH_ASSESSMENT_ADAPTERS: Record<
  string,
  SpeechAssessmentAdapterConstructor
> = {
  speechace: SpeechAceAdapter as unknown as SpeechAssessmentAdapterConstructor,
  speechsuper:
    SpeechSuperAdapter as unknown as SpeechAssessmentAdapterConstructor,
};

/** Health-check / test enumeration of registered keys without instantiation. */
export function listRegisteredSpeechAssessmentAdapterKeys(): string[] {
  return Object.keys(SPEECH_ASSESSMENT_ADAPTERS);
}
