/**
 * createCallEnteringPipeline — single chokepoint for pipeline-entry Call creation.
 *
 * Every Call row entering the adaptive loop MUST carry `playbookId`,
 * `requestedModuleId`, and `curriculumModuleId` (when resolvable) at creation
 * time. Without these the COMPOSE stage cannot scope `ComposedPrompt` to
 * `(callerId, playbookId)` and the sim UI has no way to load the next prompt.
 *
 * Bug class this defends against (#1333, live evidence Bertie Tallstaff
 * `ae3362f0-3e66-4e49-96f1-d83e10bce321` on hf_sandbox 2026-06-08):
 *   `outbound-dial/route.ts` was calling
 *     `prisma.call.create({ data: { callerId, source, voiceProvider, transcript } })`
 *   and dropping playbookId / requestedModuleId / curriculumModuleId. The
 *   sibling `voice/calls/start/route.ts` set all three. Two hand-rolled
 *   implementations of the same stage-entry operation; one drifted. The
 *   builder replaces both so the chain-contract pre-condition lives in one
 *   place enforceable by ESLint.
 *
 * Stage A only (placeholder-create). Stage B (`externalId` stamp after the
 * provider's `POST /call` returns) and Stage C (`persistEndOfCall` merge)
 * stay separate — external I/O between A and B can't be wrapped in one tx.
 *
 * Resolution cascade (TL revision #2):
 *   playbookId          ← resolveActivePlaybookId(callerId)        // null OK
 *   requestedModuleId   ← args.requestedModuleId
 *                       ?? Caller.lastSelectedModuleId
 *                       ?? null
 *   curriculumModuleId  ← resolveModuleByLogicalId(curriculumId, requestedModuleId)
 *                       ?? resolveDefaultModuleForCaller(callerId)  // G6
 *                       ?? null
 *
 * Does NOT throw on missing enrollment (TL revision #3). Three legitimate
 * zero-enrollment paths (`sim-runner`, `onboarding-call`, brand-new caller)
 * rely on returning `{ playbookId: null, ... }` and letting the caller decide.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3 (CURRICULUM → CALL compose)
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3 sub-contract I-VP3 (COMPOSE → VOICE PROVIDER)
 * @see github.com/.../issues/1333
 */

import { prisma } from "@/lib/prisma";
import { resolveActivePlaybookId } from "@/lib/caller/resolve-active-playbook";
import {
  resolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId,
} from "@/lib/curriculum/resolve-module";
import { resolveDefaultModuleForCaller } from "@/lib/curriculum/resolve-default-module";

export interface CallEntryArgs {
  callerId: string;
  source: string;
  voiceProvider: string | null;
  requestedModuleId?: string;
}

export interface CallEntryResult {
  call: { id: string };
  playbookId: string | null;
  requestedModuleId: string | null;
  curriculumModuleId: string | null;
}

/**
 * Create a Call row that will enter the pipeline, populating FK scope at
 * creation time. Always returns; never throws on a missing enrollment.
 *
 * Uses the singleton `prisma` client. No `tx` arg (TL revision #4) — the
 * caller routes do their own `externalId` stamp afterward and a wrapping
 * transaction would have to span the external VAPI fetch in between.
 */
export async function createCallEnteringPipeline(
  args: CallEntryArgs,
): Promise<CallEntryResult> {
  const { callerId, source, voiceProvider } = args;

  // 1. Playbook attribution — null when no ACTIVE enrollment. Returning
  //    null is intentional; the caller decides whether to abort or proceed
  //    with a zero-scope placeholder.
  const playbookId = await resolveActivePlaybookId(callerId);

  // 2. Module hint cascade: explicit arg → Caller.lastSelectedModuleId → null.
  //    Explicit arg wins so the URL/CLI/body override beats persistence
  //    (matches the sim page + POST /api/callers/[id]/calls behaviour).
  let requestedModuleId: string | null = args.requestedModuleId ?? null;
  if (!requestedModuleId) {
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { lastSelectedModuleId: true },
    });
    if (caller?.lastSelectedModuleId) {
      requestedModuleId = caller.lastSelectedModuleId;
    }
  }

  // 3. CurriculumModule FK — only resolvable when we have a playbook + a
  //    curriculum on it. Try the explicit slug first, fall back to G6.
  let curriculumModuleId: string | null = null;
  let resolvedRequestedSlug: string | null = requestedModuleId;
  if (playbookId) {
    const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
    if (curriculumId && requestedModuleId) {
      const mod = await resolveModuleByLogicalId(curriculumId, requestedModuleId);
      if (mod) {
        curriculumModuleId = mod.id;
      }
    }
    if (!curriculumModuleId) {
      // G6 — Caller hasn't picked + no progress yet. Fall back to the
      // most-recently-touched module or the playbook's first module.
      const fallback = await resolveDefaultModuleForCaller(callerId, playbookId);
      if (fallback) {
        curriculumModuleId = fallback.curriculumModuleId;
        // If no explicit requestedModuleId was set, surface the fallback's
        // slug so the placeholder carries a stable hint for COMPOSE.
        if (!resolvedRequestedSlug) {
          resolvedRequestedSlug = fallback.moduleSlug;
        }
      }
    }
  }

  // 4. Persist. Conditional spread keeps null fields out of the create
  //    payload so Prisma uses the column default (NULL) rather than
  //    explicit NULL — matches the start/route.ts reference implementation.
  //    Call.voiceProvider has a NOT NULL column with a "vapi" default; for
  //    the sim path (voiceProvider arg = null) we omit it and let the
  //    default land.
  const call = await prisma.call.create({
    data: {
      callerId,
      source,
      transcript: "",
      ...(voiceProvider !== null ? { voiceProvider } : {}),
      ...(playbookId ? { playbookId } : {}),
      ...(resolvedRequestedSlug ? { requestedModuleId: resolvedRequestedSlug } : {}),
      ...(curriculumModuleId ? { curriculumModuleId } : {}),
    },
    select: { id: true },
  });

  return {
    call,
    playbookId,
    requestedModuleId: resolvedRequestedSlug,
    curriculumModuleId,
  };
}
