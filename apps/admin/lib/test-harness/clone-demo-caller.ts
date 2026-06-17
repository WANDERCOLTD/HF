/**
 * cloneDemoCaller — #1750 (epic #1700 Theme 12).
 *
 * Tester direct-link primitive. Spins up (or reuses) a learner-shaped
 * caller for OPERATOR+ testers iterating on a specific module without
 * hunting for a fresh DB row each cycle.
 *
 * Two modes:
 *
 *   - **`fresh`** — always creates a NEW Caller. Copies the source's
 *     `profile:*` CallerAttribute rows (so intake-driven test runs
 *     start with the right learner shape) but blanks
 *     `CallerModuleProgress.loScoresJson` / `incompleteAttempts` /
 *     `orientationShown` so the new caller starts at "zero progress."
 *   - **`return`** — finds the tester's MOST RECENT prior clone (matched
 *     by `scope="TEST_HARNESS"` CallerAttribute markers) and returns
 *     it. If no prior clone exists, falls through to `fresh`.
 *
 * Lineage tracking lives in `CallerAttribute` under a dedicated scope:
 *
 *   - `scope="TEST_HARNESS" key="source_caller_id"  value=<sourceCallerId>`
 *   - `scope="TEST_HARNESS" key="tester_email"      value=<testerEmail>`
 *   - `scope="TEST_HARNESS" key="created_at"        value=<ISO ts>`
 *
 * Sibling-writer survey: existing test-learner creator
 * (`lib/enrollment/create-test-learner.ts`) creates a fresh random-name
 * Caller with no lineage; this helper differs by (a) carrying source
 * profile state and (b) tracking lineage so `return` mode can find
 * prior clones.
 *
 * @see docs/draft-issues/ielts-pre-voice-gap-analysis.md (Theme 12)
 */

import type { PrismaClient } from "@prisma/client";

import { enrollCaller } from "@/lib/enrollment";
import { instantiatePlaybookGoals } from "@/lib/enrollment/instantiate-goals";
import { instantiatePlaybookTargets } from "@/lib/enrollment/instantiate-targets";
import { instantiatePlaybookModuleProgress } from "@/lib/enrollment/instantiate-module-progress";
import { randomFakeName } from "@/lib/fake-names";

export const TEST_HARNESS_SCOPE = "TEST_HARNESS";
export const TEST_HARNESS_KEYS = {
  sourceCallerId: "source_caller_id",
  testerEmail: "tester_email",
  createdAt: "created_at",
} as const;

export type CloneDemoCallerMode = "fresh" | "return";

export interface CloneDemoCallerArgs {
  /** The "template" caller — clones carry their `profile:*` CallerAttribute. */
  sourceCallerId: string;
  /** Playbook to enrol the new clone into. */
  playbookId: string;
  /** Tester identity (typically session.user.email). Scopes `return` mode. */
  testerEmail: string;
  /** `fresh` always creates a new clone; `return` reuses if one exists. */
  mode: CloneDemoCallerMode;
}

export interface CloneDemoCallerResult {
  callerId: string;
  callerName: string;
  /** True when a new Caller was created; false when an existing clone was reused. */
  isNew: boolean;
  sourceCallerId: string;
}

type PrismaForClone = Pick<
  PrismaClient,
  "caller" | "callerAttribute" | "playbook"
>;

/**
 * Resolve the tester's clone (returning existing or creating fresh).
 */
export async function cloneDemoCaller(
  prisma: PrismaForClone,
  args: CloneDemoCallerArgs,
): Promise<CloneDemoCallerResult> {
  if (!args.sourceCallerId) throw new Error("cloneDemoCaller: sourceCallerId is required");
  if (!args.playbookId) throw new Error("cloneDemoCaller: playbookId is required");
  if (!args.testerEmail) throw new Error("cloneDemoCaller: testerEmail is required");

  const sourceCaller = await prisma.caller.findUnique({
    where: { id: args.sourceCallerId },
    select: { id: true, name: true, domainId: true },
  });
  if (!sourceCaller) {
    throw new Error(`cloneDemoCaller: source caller ${args.sourceCallerId} not found`);
  }
  if (!sourceCaller.domainId) {
    throw new Error(
      `cloneDemoCaller: source caller ${args.sourceCallerId} has no domainId — cannot clone`,
    );
  }

  // `return` mode — try to find an existing clone first.
  if (args.mode === "return") {
    const existing = await findExistingClone(prisma, args);
    if (existing) {
      return existing;
    }
    // Fall through to fresh creation if no prior clone.
  }

  // `fresh` mode (or `return` with no match) — create a new clone.
  return createFreshClone(prisma, args, sourceCaller.domainId, sourceCaller.name);
}

/**
 * Find the tester's most recent clone of the given source caller.
 * Returns null when no prior clone exists.
 */
async function findExistingClone(
  prisma: PrismaForClone,
  args: CloneDemoCallerArgs,
): Promise<CloneDemoCallerResult | null> {
  // Match on (sourceCallerId, testerEmail) via CallerAttribute rows.
  // Walk: find all callers with matching sourceCallerId attribute, then
  // narrow to those whose tester_email attribute also matches. Order by
  // updatedAt desc; pick most recent.
  const sourceMatches = await prisma.callerAttribute.findMany({
    where: {
      scope: TEST_HARNESS_SCOPE,
      key: TEST_HARNESS_KEYS.sourceCallerId,
      stringValue: args.sourceCallerId,
    },
    select: { callerId: true },
  });
  if (sourceMatches.length === 0) return null;

  const candidateCallerIds = sourceMatches.map((m) => m.callerId);
  const testerMatches = await prisma.callerAttribute.findMany({
    where: {
      callerId: { in: candidateCallerIds },
      scope: TEST_HARNESS_SCOPE,
      key: TEST_HARNESS_KEYS.testerEmail,
      stringValue: args.testerEmail,
    },
    select: { callerId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  if (testerMatches.length === 0) return null;

  const mostRecentCallerId = testerMatches[0].callerId;
  const cloneCaller = await prisma.caller.findUnique({
    where: { id: mostRecentCallerId },
    select: { id: true, name: true },
  });
  if (!cloneCaller) return null;

  return {
    callerId: cloneCaller.id,
    callerName: cloneCaller.name ?? "Test Clone",
    isNew: false,
    sourceCallerId: args.sourceCallerId,
  };
}

/**
 * Create a fresh clone — new Caller, profile:* CallerAttribute copied
 * from source, blank progress.
 */
async function createFreshClone(
  prisma: PrismaForClone,
  args: CloneDemoCallerArgs,
  domainId: string,
  sourceName: string | null,
): Promise<CloneDemoCallerResult> {
  const callerName = `${randomFakeName()} (test clone of ${sourceName ?? args.sourceCallerId.slice(0, 8)})`;

  const newCaller = await prisma.caller.create({
    data: {
      name: callerName,
      domainId,
    },
  });

  // Carry source's profile:* CallerAttribute rows (intake answers,
  // target band, timeline, self-level, etc.).
  const sourceProfileAttrs = await prisma.callerAttribute.findMany({
    where: {
      callerId: args.sourceCallerId,
      key: { startsWith: "profile:" },
    },
    select: {
      key: true,
      scope: true,
      domain: true,
      valueType: true,
      stringValue: true,
      numberValue: true,
      booleanValue: true,
      jsonValue: true,
    },
  });

  for (const attr of sourceProfileAttrs) {
    await prisma.callerAttribute.create({
      data: {
        callerId: newCaller.id,
        key: attr.key,
        scope: attr.scope,
        domain: attr.domain,
        valueType: attr.valueType,
        stringValue: attr.stringValue,
        numberValue: attr.numberValue,
        booleanValue: attr.booleanValue,
        jsonValue: attr.jsonValue ?? undefined,
      },
    });
  }

  // Write lineage markers (so future `return` mode finds this clone).
  const now = new Date().toISOString();
  await prisma.callerAttribute.create({
    data: {
      callerId: newCaller.id,
      key: TEST_HARNESS_KEYS.sourceCallerId,
      scope: TEST_HARNESS_SCOPE,
      valueType: "STRING",
      stringValue: args.sourceCallerId,
    },
  });
  await prisma.callerAttribute.create({
    data: {
      callerId: newCaller.id,
      key: TEST_HARNESS_KEYS.testerEmail,
      scope: TEST_HARNESS_SCOPE,
      valueType: "STRING",
      stringValue: args.testerEmail,
    },
  });
  await prisma.callerAttribute.create({
    data: {
      callerId: newCaller.id,
      key: TEST_HARNESS_KEYS.createdAt,
      scope: TEST_HARNESS_SCOPE,
      valueType: "STRING",
      stringValue: now,
    },
  });

  // Enroll + instantiate progress shells (zero callCount, no
  // loScoresJson, no incompleteAttempts, no orientationShown).
  // instantiatePlaybookGoals + instantiatePlaybookTargets read
  // enrollments by callerId (no per-playbook arg), so they must run
  // AFTER enrollCaller writes the CallerPlaybook row.
  await enrollCaller(newCaller.id, args.playbookId, "test-harness-clone");
  // All three instantiators read enrollments by callerId — single-arg form.
  await instantiatePlaybookModuleProgress(newCaller.id);
  await instantiatePlaybookGoals(newCaller.id);
  await instantiatePlaybookTargets(newCaller.id);

  return {
    callerId: newCaller.id,
    callerName,
    isNew: true,
    sourceCallerId: args.sourceCallerId,
  };
}
