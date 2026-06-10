/**
 * Eager reprompt-on-bump fan-out — #1429.
 *
 * Closes the demo-call latency gap: epic #832 ships lazy recompose
 * (next-call-but-one is the worst case), which is correct for production
 * learners but breaks the operator flow of "tweak a setting, place a
 * test call 30 seconds later, hear the change". For callers flagged
 * `CallerPlaybook.policyMode='demo'` we proactively recompose the
 * cached `ComposedPrompt` immediately after an educator-driven config
 * bump, so the next `createSession`'s I-CT2 step 1 finds a fresh row
 * keyed against the new inputs.
 *
 * ## Wire-up discipline — call this from EDUCATOR-INTENT WRITERS only
 *
 * Specifically (current scope, AC of #1429):
 *
 *   1. `lib/playbook/update-playbook-config.ts` — the central config
 *      chokepoint (already exists; this helper is called immediately
 *      after the `bumpPlaybookComposeTimestamp` equivalent inside the
 *      helper succeeds).
 *
 *   2. `lib/compose/bump-curriculum-fanout.ts` — ONCE after the fan-out
 *      loop completes (NOT per-iteration). Curriculum-affecting writes
 *      (LO edit, module rename, assertion edit, lesson plan change)
 *      land here and span sibling Playbooks; one helper call covers
 *      every sibling.
 *
 *   3. `lib/chat/admin-tool-handlers.ts::update_behavior_target` — the
 *      AgentTuner write path. Called after the `writeBehaviorTarget`
 *      succeeds; PLAYBOOK-scope writes only (LEARNER-scope writes do
 *      not need it — the demo caller IS the one being tweaked).
 *
 * Do NOT wire this into `lib/compose/bump-timestamp.ts` itself.
 * `bumpPlaybookComposeTimestamp` is called from ~10 sites including
 * `for (const pbId of playbookIds) await bumpPlaybookComposeTimestamp(pbId)`
 * loops, which would multiply the fan-out by playbook count for every
 * LO edit. The TL review on #1429 captures this rationale verbatim.
 *
 * ## Behaviour
 *
 *   - Lists `CallerPlaybook(playbookId, policyMode='demo', status='ACTIVE')`
 *   - Calls `autoComposeForCaller(callerId, playbookId)` per row
 *   - Idempotent (autoComposeForCaller is already short-circuited via
 *     `isPromptStale`; a second call for an already-fresh caller no-ops)
 *   - Never throws — per-caller failures log + skip; the educator's
 *     upstream write has already succeeded
 *   - Concurrency-bounded via `p-limit(3)` when > 3 demo callers, to
 *     avoid hammering Anthropic on a course with many demo testers
 *   - Returns immediately if `playbookId` is falsy (defence-in-depth)
 *
 * ## What this does NOT do
 *
 *   - Does NOT bump the `composeInputsUpdatedAt` timestamps. The
 *     upstream writer (the helper that called THIS helper) is
 *     responsible for that — and must call us only AFTER the bump
 *     commits, so `isPromptStale` will read the new timestamp inside
 *     `autoComposeForCaller`.
 *   - Does NOT touch production callers. Lazy recompose still applies.
 *   - Does NOT throw or block. Fire-and-forget at every call site
 *     (`void triggerEagerRepromptForDemoCallers(...)`).
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";

const DEMO_REPROMPT_CONCURRENCY = 3;

/**
 * Result shape for tests / telemetry hooks. The helper itself returns
 * Promise<void> from the call-site perspective — this type is exposed
 * so tests can assert what fired.
 */
export interface DemoRepromptResult {
  /** Caller IDs the fan-out enumerated. */
  callerIds: string[];
  /** Caller IDs the fan-out attempted to recompose (== callerIds.length). */
  attempted: number;
  /** Caller IDs whose `autoComposeForCaller` threw. */
  failures: string[];
}

/**
 * Fan out an eager recompose to every `policyMode='demo'` caller on the
 * given playbook. Fire-and-forget at every call site — use
 * `void triggerEagerRepromptForDemoCallers(playbookId)`.
 *
 * @param playbookId The Playbook whose demo callers should be eagerly
 *   recomposed. Empty/null → no-op (returns immediately).
 * @returns A summary the caller can `.then(...)` for telemetry. Most
 *   call sites discard it via `void`.
 */
export async function triggerEagerRepromptForDemoCallers(
  playbookId: string | null | undefined,
): Promise<DemoRepromptResult> {
  const result: DemoRepromptResult = {
    callerIds: [],
    attempted: 0,
    failures: [],
  };
  if (!playbookId) return result;

  let demoCallers: { callerId: string }[] = [];
  try {
    demoCallers = await prisma.callerPlaybook.findMany({
      where: {
        playbookId,
        policyMode: "demo",
        status: "ACTIVE",
      },
      select: { callerId: true },
    });
  } catch (err: unknown) {
    // Best-effort. If the SELECT failed we log and walk away — the
    // upstream educator write has already committed and lazy recompose
    // still covers the next call.
    console.warn(
      `[demo-reprompt] failed to enumerate demo callers for playbookId=${playbookId}:`,
      err,
    );
    return result;
  }

  result.callerIds = demoCallers.map((c) => c.callerId);
  if (result.callerIds.length === 0) return result;

  // Lazy-import `autoComposeForCaller` so this module stays cheap to
  // pull in from helpers that may run during cold boot.
  const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");

  const limit = pLimit(DEMO_REPROMPT_CONCURRENCY);

  await Promise.all(
    result.callerIds.map((callerId) =>
      limit(async () => {
        const startedAt = Date.now();
        result.attempted += 1;
        try {
          await autoComposeForCaller(callerId, playbookId);
          const durationMs = Date.now() - startedAt;
          // Structured log line — match the AC shape from #1429 so the
          // ops dashboards / log searches can grep one canonical
          // prefix.
          console.log(
            `[demo-reprompt] callerId=${callerId} playbookId=${playbookId} success=true durationMs=${durationMs}`,
          );
        } catch (err: unknown) {
          const durationMs = Date.now() - startedAt;
          result.failures.push(callerId);
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[demo-reprompt] callerId=${callerId} playbookId=${playbookId} success=false durationMs=${durationMs} error=${message}`,
          );
        }
      }),
    ),
  );

  return result;
}
