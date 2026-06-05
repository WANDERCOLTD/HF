/**
 * Per-call speech-assessment provider resolver (#1119).
 *
 * Picks the SpeechAssessmentProvider slug for a given Call by walking
 * a typed cascade — mirrors `resolve-voice-provider.ts`.
 *
 * Cascade (highest precedence first):
 *
 *   1. Caller-level override            — stubbed today (no field on Caller yet)
 *   2. Cohort-level override            — stubbed (no field on CohortGroup)
 *   3. Playbook-level override          — stubbed (no field on PlaybookConfig)
 *   4. SpeechAssessmentProvider.isDefault = true — system default (#1118)
 *
 * Layers 1–3 are stubs that return null today. Per the same convention
 * as `resolve-voice-provider.ts`, the resolver walks every cascade level
 * from day one so a future field add is a one-function-body change, not
 * a re-plumb.
 *
 * Returns `{ slug, source }` so debug surfaces can show which knob took
 * effect. Throws when no provider is configured at any layer — the
 * PROSODY stage catches and emits `mode: "unavailable"` +
 * `errorReason: "no_provider_configured"`.
 */

import { getDefaultSpeechAssessmentProviderSlug } from "@/lib/speech-assessment/provider-factory";

export type SpeechAssessmentProviderSource =
  | "caller"
  | "cohort"
  | "playbook"
  | "system";

export interface ResolvedSpeechAssessmentProvider {
  slug: string;
  source: SpeechAssessmentProviderSource;
}

/**
 * Resolve the speech-assessment provider slug for a call.
 *
 * @throws Error when no system default is configured AND no override
 *   layer matched. PROSODY catches this and emits a
 *   `mode: "unavailable"` envelope.
 */
export async function resolveSpeechAssessmentProviderForCall(
  callId: string,
  callerId: string | null,
  playbookId: string | null,
): Promise<ResolvedSpeechAssessmentProvider> {
  // Layer 1 — Caller-level override (stub)
  const callerOverride = await resolveCallerSpeechAssessmentProvider(callerId);
  if (callerOverride) {
    return { slug: callerOverride, source: "caller" };
  }

  // Layer 2 — Cohort-level override (stub)
  const cohortOverride = await resolveCohortSpeechAssessmentProvider(callerId);
  if (cohortOverride) {
    return { slug: cohortOverride, source: "cohort" };
  }

  // Layer 3 — Playbook-level override (stub)
  const playbookOverride =
    await resolvePlaybookSpeechAssessmentProvider(playbookId);
  if (playbookOverride) {
    return { slug: playbookOverride, source: "playbook" };
  }

  // Layer 4 — System default from SpeechAssessmentProvider table (#1118)
  const sysDefault = await getDefaultSpeechAssessmentProviderSlug();
  return { slug: sysDefault, source: "system" };
}

async function resolveCallerSpeechAssessmentProvider(
  _callerId: string | null,
): Promise<string | null> {
  // Intentional stub. Caller has no speechAssessmentProvider field today.
  return null;
}

async function resolveCohortSpeechAssessmentProvider(
  _callerId: string | null,
): Promise<string | null> {
  // Intentional stub. CohortGroup has no speechAssessmentProvider field today.
  return null;
}

async function resolvePlaybookSpeechAssessmentProvider(
  _playbookId: string | null,
): Promise<string | null> {
  // Intentional stub. PlaybookConfig has no speechAssessmentProvider field today.
  return null;
}
