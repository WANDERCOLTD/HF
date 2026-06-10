/**
 * I-CT2 prompt-resolution cascade (epic #1338 / story #1342).
 *
 * Resolves which `ComposedPrompt.id` the new Session ran with. Walked
 * in order — first non-null wins.
 *
 * #1420 NOTE — kind-independence: this resolver intentionally takes only
 * `callerId` and does NOT filter by the asking Session's `kind`. The
 * cascade is enrollment-keyed, not kind-keyed: a brand-new SIM_CALL,
 * TEXT_CHAT, or ASSESSMENT Session is just as entitled to land on the
 * ENROLLMENT bootstrap (step 3) as a VOICE_CALL. This means the #1420
 * post-tx auto-compose fix (which writes the bootstrap ComposedPrompt
 * per-playbook for ACTIVE enrollments) benefits every session kind —
 * not just voice. SIM_CALL alignment is locked in
 * `tests/lib/voice/sim-cascade-alignment.test.ts`.
 *
 *   Step 1 — previous Session's produced prompt
 *     `Session(callerId, sequenceNumber = current-1).producedComposedPromptId`
 *     i.e. the prompt the pipeline composed at the end of the n-1 call.
 *     Happy path.
 *
 *   Step 2 — most-recent ACTIVE ComposedPrompt for caller
 *     `ComposedPrompt(callerId, status='active') ORDER BY composedAt DESC`.
 *     Used when the previous Session's pipeline crashed mid-COMPOSE —
 *     a stale `active` prompt might still be the right one to run with.
 *
 *   Step 3 — Bootstrap from the ENROLLMENT Session
 *     `Session(callerId, kind='ENROLLMENT').producedComposedPromptId`.
 *     Guaranteed non-null for any caller with a completed intake.
 *
 * Returns the first non-null id; returns `null` only when every step
 * returned null (brand-new caller with no enrollment Session yet).
 *
 * Each step is a single indexed Prisma query. Total latency budget
 * ~30ms on hot path.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b invariant I-CT2
 */

import { prisma } from "@/lib/prisma";

export interface UsedPromptResolution {
  usedPromptId: string | null;
  /** Which cascade step produced the id (for telemetry + the proof script). */
  source: "previous-session" | "active-composed-prompt" | "enrollment-bootstrap" | "none";
}

export async function resolveUsedPromptId(args: {
  callerId: string;
}): Promise<UsedPromptResolution> {
  const { callerId } = args;

  // Step 1 — most-recent prior Session's produced prompt. ORDER BY
  // startedAt DESC; the per-(callerId, kind) sequenceNumber unique
  // ensures the same row would win.
  const prevSession = await prisma.session.findFirst({
    where: {
      callerId,
      producedComposedPromptId: { not: null },
    },
    orderBy: { startedAt: "desc" },
    select: { producedComposedPromptId: true },
  });
  if (prevSession?.producedComposedPromptId) {
    return {
      usedPromptId: prevSession.producedComposedPromptId,
      source: "previous-session",
    };
  }

  // Step 2 — any ACTIVE ComposedPrompt for the caller. The historic
  // status discriminator is the lower-case string "active".
  //
  // NOTE(multi-playbook): step 2 is intentionally NOT scoped by
  // playbookId. `build-assistant-config.ts:159-167` DOES scope its own
  // active-prompt lookup by `defaultPlaybookId`. The asymmetry is
  // benign for single-enrollment callers (one ACTIVE row exists), but
  // a caller enrolled in two courses could resolve the "wrong" prompt
  // here. Tracked as the multi-playbook follow-up to #1420; the
  // current mitigation is the post-tx auto-compose writing per-
  // playbook rows so the most-recent one is the relevant one. If
  // multi-playbook enrolment ever becomes the common case, tighten
  // this to take a `playbookId` arg.
  const activePrompt = await prisma.composedPrompt.findFirst({
    where: {
      callerId,
      status: "active",
    },
    orderBy: { composedAt: "desc" },
    select: { id: true },
  });
  if (activePrompt?.id) {
    return { usedPromptId: activePrompt.id, source: "active-composed-prompt" };
  }

  // Step 3 — ENROLLMENT Session's produced prompt. Bootstrap fallback.
  const enrolment = await prisma.session.findFirst({
    where: {
      callerId,
      kind: "ENROLLMENT",
      producedComposedPromptId: { not: null },
    },
    orderBy: { startedAt: "asc" }, // first ENROLLMENT wins on the rare retry
    select: { producedComposedPromptId: true },
  });
  if (enrolment?.producedComposedPromptId) {
    return {
      usedPromptId: enrolment.producedComposedPromptId,
      source: "enrollment-bootstrap",
    };
  }

  return { usedPromptId: null, source: "none" };
}
