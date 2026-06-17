/**
 * #1743 (epic #1700 Theme 2b) — module-scoped cue registration.
 *
 * At session-start, walk `Playbook.config.modules[]` for the locked
 * module's `settings.scheduledCues`, and for each `(at, text)` row
 * persist a row via `scheduleCue` keyed on `externalCallId`.
 *
 * Wired from two call sites — the two routes where `externalCallId`
 * first becomes definitively known:
 *
 *   1. `POST /api/voice/calls/outbound-dial` — immediately after the
 *      VAPI POST /call response returns the `externalCallId` and the
 *      stamp on `Call.externalId` succeeds. (PSTN path.)
 *
 *   2. `processTranscriptUpdate` in `lib/voice/route-handlers.ts` —
 *      inside the self-heal block where the WebRTC placeholder gets
 *      its `externalId` stamped from the first webhook delivery.
 *
 * Idempotence: the helper queries `CueScheduleEntry` for any existing
 * row keyed on `externalCallId` BEFORE inserting. The WebRTC self-heal
 * branch fires once per call, but a duplicate webhook (VAPI is
 * at-least-once delivery — `route-handlers.ts:108`) could re-enter; the
 * pre-insert query absorbs the duplicate.
 *
 * Capability gate: this writes rows; the dispatch-time
 * `supportsProactiveSpeech` check in `drainDueCues` decides whether the
 * provider can actually fire them. Registration is provider-agnostic.
 *
 * Feature flag: gated on `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700
 * decision 5. Flag-off short-circuits with `reason: "flag_off"` and
 * writes nothing — keeps non-IELTS sessions unaffected during the
 * migration window.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import { scheduleCue } from "./cue-scheduler";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

export interface RegisterModuleCuesArgs {
  externalCallId: string;
  callId: string;
  playbookId: string | null;
  /** `AuthoredModule.id` (== `CurriculumModule.slug`). */
  moduleSlug: string | null;
  /** Wall-clock anchor for `at`-relative scheduling. Defaults to now. */
  startedAt?: Date;
}

export type RegisterModuleCuesReason =
  | "flag_off"
  | "no_external_call_id"
  | "no_playbook"
  | "no_module_match"
  | "no_cues"
  | "already_registered";

export interface RegisterModuleCuesResult {
  registered: number;
  reason?: RegisterModuleCuesReason;
}

export async function registerModuleScheduledCues(
  args: RegisterModuleCuesArgs,
): Promise<RegisterModuleCuesResult> {
  if (!isIeltsModuleSettingsEnabled()) {
    return { registered: 0, reason: "flag_off" };
  }
  if (!args.externalCallId) {
    return { registered: 0, reason: "no_external_call_id" };
  }
  if (!args.playbookId || !args.moduleSlug) {
    return { registered: 0, reason: "no_playbook" };
  }

  const existing = await prisma.cueScheduleEntry.findFirst({
    where: { externalCallId: args.externalCallId },
    select: { id: true },
  });
  if (existing) {
    log("system", "voice.cue_registration.skipped_already_registered", {
      externalCallId: args.externalCallId,
      callId: args.callId,
    });
    return { registered: 0, reason: "already_registered" };
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: args.playbookId },
    select: { config: true },
  });
  if (!playbook) {
    return { registered: 0, reason: "no_playbook" };
  }

  const config = (playbook.config ?? {}) as PlaybookConfig;
  const modules: AuthoredModule[] = config.modules ?? [];
  const matched = modules.find((m) => m.id === args.moduleSlug);
  if (!matched) {
    return { registered: 0, reason: "no_module_match" };
  }

  const cues = matched.settings?.scheduledCues ?? [];
  if (cues.length === 0) {
    return { registered: 0, reason: "no_cues" };
  }

  const baseMs = (args.startedAt ?? new Date()).getTime();
  let registered = 0;
  for (const cue of cues) {
    if (typeof cue.at !== "number" || !Number.isFinite(cue.at) || cue.at < 0) continue;
    if (typeof cue.text !== "string" || cue.text.trim().length === 0) continue;
    await scheduleCue({
      externalCallId: args.externalCallId,
      callId: args.callId,
      scheduledFor: new Date(baseMs + cue.at * 1000),
      content: cue.text,
    });
    registered += 1;
  }

  log("system", "voice.cue_registration.registered", {
    externalCallId: args.externalCallId,
    callId: args.callId,
    moduleSlug: args.moduleSlug,
    count: registered,
  });

  return { registered };
}
