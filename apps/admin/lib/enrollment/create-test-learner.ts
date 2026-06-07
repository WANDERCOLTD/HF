/**
 * Create a fresh test learner for a course.
 *
 * Spins up a random-named Caller, enrolls them in the playbook, instantiates
 * Goals from the playbook config, and lets enrollCaller's auto-compose hook
 * persist the bootstrap prompt asynchronously.
 *
 * Used by the "+ New test learner" button on the course Learners tab so
 * educators can verify config changes (e.g. welcome flow toggles) against
 * a guaranteed-fresh prompt.
 *
 * @see https://github.com/WANDERCOLTD/HF/issues/211
 */

import { prisma } from "@/lib/prisma";
import { randomFakeName } from "@/lib/fake-names";
import { enrollCaller } from "@/lib/enrollment";
import { instantiatePlaybookGoals } from "@/lib/enrollment/instantiate-goals";
import { instantiatePlaybookTargets } from "@/lib/enrollment/instantiate-targets";
import { instantiatePlaybookModuleProgress } from "@/lib/enrollment/instantiate-module-progress";

export interface CreateTestLearnerResult {
  callerId: string;
  callerName: string;
}

/**
 * Create a test learner enrolled in `playbookId`.
 *
 * Caller-of-this-function should pre-validate that the course has a usable
 * curriculum before invoking — this helper assumes the playbook is in a
 * valid state for compose. Throws on infrastructure failures.
 *
 * Compose is fire-and-forget via enrollCaller's auto-compose hook — by the
 * time the educator lands on the new caller's page, the prompt is either
 * ready or visibly composing.
 */
export async function createTestLearnerForPlaybook(
  playbookId: string,
  source: string = "test-learner-button",
): Promise<CreateTestLearnerResult> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { domainId: true, status: true },
  });
  if (!playbook) {
    throw new Error(`Playbook ${playbookId} not found`);
  }
  if (!playbook.domainId) {
    throw new Error(`Playbook ${playbookId} has no domainId — cannot create caller`);
  }

  const callerName = randomFakeName();

  const caller = await prisma.caller.create({
    data: {
      name: callerName,
      domainId: playbook.domainId,
    },
  });

  // Tag this caller as a test-button creation so the Learners tab can
  // surface them differently if needed later (no schema change required —
  // CallerAttribute is the existing extensibility point).
  await prisma.callerAttribute.create({
    data: {
      callerId: caller.id,
      key: "source",
      valueType: "STRING",
      stringValue: source,
      scope: "GLOBAL",
    },
  });

  // enrollCaller auto-composes (fire-and-forget) when called outside a
  // transaction — that's exactly what we want here.
  await enrollCaller(caller.id, playbookId, source);

  await instantiatePlaybookGoals(caller.id);

  // Pre-create CallerTarget placeholders for per-skill BehaviorTargets so the
  // ACHIEVE banding UI has rows to render before call #1. Non-fatal — goals
  // are the load-bearing artifact; targets are a UI affordance.
  await instantiatePlaybookTargets(caller.id).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[create-test-learner] Target instantiation failed for ${caller.id}: ${message}`);
  });

  // #1254 — Pre-create CallerModuleProgress NOT_STARTED rows for STRUCTURED
  // playbooks. CONTINUOUS is skipped.
  await instantiatePlaybookModuleProgress(caller.id).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[create-test-learner] Module-progress instantiation failed for ${caller.id}: ${message}`);
  });

  return { callerId: caller.id, callerName };
}
