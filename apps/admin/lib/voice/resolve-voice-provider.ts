/**
 * Per-caller voice provider resolver (AnyVoice #1027).
 *
 * Picks the voice provider slug for a given caller by walking a typed
 * cascade. The first non-null layer wins. Returns the slug AND the
 * source layer so debug surfaces / educator UIs can show which knob
 * actually took effect.
 *
 * Cascade order (highest precedence first):
 *
 *   1. Caller.voiceProvider                 — per-learner override (#1031)
 *   2. cohort-level override                — stubbed today (no field on
 *                                              CohortGroup yet; structure
 *                                              in place for future story)
 *   3. playbook-level override              — stubbed today (would live
 *                                              on PlaybookConfig.voice.*)
 *   4. VoiceProvider.isDefault = true       — system default (#1031)
 *
 * Layers 2 and 3 are stubs that return null today. Per TL guidance during
 * the #1015 epic grooming, the resolver MUST walk every cascade level
 * from day one so a future field add is a one-function-body change, not
 * a re-plumb. When CohortGroup grows a voiceProvider field, fill in
 * `resolveCohortVoiceProvider`. Same for `resolvePlaybookVoiceProvider`.
 *
 * Mirrors the pattern in `lib/tolerance/resolve-tolerance.ts` — first
 * non-null wins, source recorded for debugability.
 */

import { prisma } from "@/lib/prisma";
import { getDefaultVoiceProviderSlug } from "./provider-factory";

export type VoiceProviderSource =
  | "caller"
  | "cohort"
  | "playbook"
  | "system";

export interface ResolvedVoiceProvider {
  slug: string;
  source: VoiceProviderSource;
}

/**
 * Resolve the voice provider slug for a caller via the typed cascade.
 *
 * @throws Error("No default voice provider configured") — only when no
 *   layer returns a slug (including the SYSTEM fallback). Indicates a
 *   broken seed or missing isDefault row; the route should let this
 *   throw so the operator sees the misconfiguration.
 */
export async function resolveVoiceProviderForCaller(
  callerId: string,
): Promise<ResolvedVoiceProvider> {
  // Layer 1 — Caller-level override
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { voiceProvider: true, cohortGroupId: true },
  });
  if (caller?.voiceProvider) {
    return { slug: caller.voiceProvider, source: "caller" };
  }

  // Layer 2 — Cohort-level override
  const cohortOverride = await resolveCohortVoiceProvider(
    callerId,
    caller?.cohortGroupId ?? null,
  );
  if (cohortOverride) {
    return { slug: cohortOverride, source: "cohort" };
  }

  // Layer 3 — Playbook-level override
  const playbookOverride = await resolvePlaybookVoiceProvider(callerId);
  if (playbookOverride) {
    return { slug: playbookOverride, source: "playbook" };
  }

  // Layer 4 — SYSTEM default from VoiceProvider table (#1031)
  const sysDefault = await getDefaultVoiceProviderSlug();
  return { slug: sysDefault, source: "system" };
}

/**
 * Cohort-level voice provider lookup. STUB — CohortGroup doesn't have
 * a voiceProvider field today. When the educator workflow needs cohort
 * routing, add `voiceProvider String?` to CohortGroup, then fill in the
 * query here. Multi-cohort membership tie-break: most recently assigned
 * non-null value wins (mirrors the BehaviorTarget cohort pattern).
 */
async function resolveCohortVoiceProvider(
  _callerId: string,
  _cohortGroupId: string | null,
): Promise<string | null> {
  // Intentional stub. Function exists so the cascade is structurally
  // present from day one — adding cohort support later is a one-body
  // change, not a re-plumb. See lib/tolerance/resolve-tolerance.ts for
  // the same pattern.
  return null;
}

/**
 * Playbook-level voice provider lookup. STUB — there's no
 * Playbook-scoped voice provider field today. When needed, store on
 * PlaybookConfig.voiceProvider (Json) and resolve via the active
 * playbook's `resolvePlaybookId(callerId)`.
 */
async function resolvePlaybookVoiceProvider(
  _callerId: string,
): Promise<string | null> {
  // Intentional stub. See cohort note above.
  return null;
}
