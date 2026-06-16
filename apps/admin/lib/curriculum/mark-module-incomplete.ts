/**
 * markModuleIncomplete — #1703 (epic #1700 Theme 9).
 *
 * Single chokepoint for the incomplete-attempt counter on
 * `CallerModuleProgress`. Atomically increments `incompleteAttempts`
 * inside the supplied transaction. When a prior incomplete attempt
 * already exists (i.e. this is the second-or-later early exit), the
 * waiver fires: `status` is set to `"MASTERED"` so the picker stops
 * re-prompting and the learner advances.
 *
 * Pattern mirrors `lib/voice/create-call-entering-pipeline.ts` (#1333)
 * and `lib/measurement/write-call-score.ts` (#1539). The paired ESLint
 * rule `hf-curriculum/no-bare-module-progress-update` blocks bare
 * `prisma.callerModuleProgress.update` outside the allow-list so any
 * NEW write site is structurally forced to use this helper.
 *
 * AppLog: writes a `module.incomplete.waived` system event on the
 * waiver branch so the loud-skip pattern surfaces in `/x/logs` — see
 * `feat(curriculum): promote silent lo_mastery skip to AppLog` (#1599
 * follow-on).
 *
 * Caller decides "this session was incomplete" (e.g. endSession
 * comparing duration < moduleSettings.minSpeakingSec); the helper
 * only records + applies the waiver policy.
 *
 * @see lib/voice/end-session.ts (caller)
 * @see docs/kb/guard-registry.md#guard-no-bare-module-progress-update
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { log } from "@/lib/logger";
import type { CourseStyle } from "@/lib/pipeline/course-style";

/** Either a PrismaClient or a `$transaction` callback's `tx` handle. */
type PrismaTx = PrismaClient | Prisma.TransactionClient;

export interface MarkModuleIncompleteArgs {
  callerId: string;
  moduleId: string;
  /**
   * **Required** — guard #1252 (`no-module-read-without-course-style-guard`)
   * forces default-deny on `CallerModuleProgress` writes. The helper
   * short-circuits with `{attempts: 0, waived: false}` when this is
   * anything other than `"structured"`, and AppLogs the skip so
   * operators can see the gate fired. Caller MUST resolve via
   * `getCourseStyle(playbook.config)`.
   */
  courseStyle: CourseStyle;
  /**
   * Optional — included in the AppLog payload only. Not required for
   * the DB write because `(callerId, moduleId)` is unique on the
   * progress row.
   */
  playbookId?: string | null;
  /**
   * Optional — observed duration (sec). Recorded in the AppLog so
   * operators can see why the gate fired without reopening the
   * Session row.
   */
  durationSeconds?: number | null;
  /**
   * Optional — the per-module `minSpeakingSec` value that this session
   * failed to meet. Also AppLog-only.
   */
  minSpeakingSec?: number | null;
}

export interface MarkModuleIncompleteResult {
  /** Incremented value after this call. 1 on first incomplete, 2+ thereafter. */
  attempts: number;
  /**
   * True when the call triggered the waiver — i.e. the prior value was
   * ≥1, so this is the second-or-later incomplete and the helper has
   * set `status = "MASTERED"`.
   */
  waived: boolean;
}

/**
 * Atomically increment `CallerModuleProgress.incompleteAttempts`. When
 * the pre-increment count was ≥1 (i.e. this is the second incomplete
 * attempt), set `status = "MASTERED"` so the picker stops looping the
 * learner back into the module.
 *
 * The atomicity guarantee is required: two concurrent endSession
 * webhooks for the same (caller, module) MUST NOT both observe
 * `incompleteAttempts = 0` and both decide "not waived yet". Postgres
 * row-level locking via `update({ data: { incompleteAttempts: { increment: 1 } } })`
 * serialises the two writes; the second observes the incremented value.
 *
 * No-op when the `(callerId, moduleId)` progress row does not exist —
 * the enrollment-time instantiator (`lib/enrollment/instantiate-module-progress.ts`)
 * is responsible for creating the row. Missing rows are logged as
 * `module.incomplete.no_progress_row` for the loud-skip ratchet.
 */
export async function markModuleIncomplete(
  tx: PrismaTx,
  args: MarkModuleIncompleteArgs,
): Promise<MarkModuleIncompleteResult> {
  if (!args.callerId) throw new Error("markModuleIncomplete: callerId is required");
  if (!args.moduleId) throw new Error("markModuleIncomplete: moduleId is required");

  // Guard #1252 — default-deny on continuous courses. Module-scoped
  // progress only exists in structured courses; firing the gate against
  // a continuous course would write a counter that nothing reads.
  if (args.courseStyle !== "structured") {
    log("system", "module.incomplete.skipped_continuous", {
      level: "info",
      message: "markModuleIncomplete skipped — course is continuous (guard #1252 default-deny)",
      callerId: args.callerId,
      moduleId: args.moduleId,
      playbookId: args.playbookId ?? null,
      courseStyle: args.courseStyle,
    });
    return { attempts: 0, waived: false };
  }

  const existing = await tx.callerModuleProgress.findUnique({
    where: {
      callerId_moduleId: {
        callerId: args.callerId,
        moduleId: args.moduleId,
      },
    },
    select: { incompleteAttempts: true, status: true },
  });

  if (!existing) {
    log("system", "module.incomplete.no_progress_row", {
      level: "warn",
      message: "markModuleIncomplete called without a CallerModuleProgress row — caller never enrolled in this module?",
      callerId: args.callerId,
      moduleId: args.moduleId,
      playbookId: args.playbookId ?? null,
    });
    return { attempts: 0, waived: false };
  }

  const willWaive = existing.incompleteAttempts >= 1;

  // On waiver: status="COMPLETED" matches the DB convention used by the
  // canonical mastery writer (lib/curriculum/track-progress.ts:665). The
  // presentational layer maps DB COMPLETED → "Mastered" badge per
  // lib/types/json-fields.ts:887. track-progress.ts respects waived rows
  // (incompleteAttempts >= 2 + status=COMPLETED) so the waiver is
  // sticky across subsequent low-mastery pipeline runs.
  const updated = await tx.callerModuleProgress.update({
    where: {
      callerId_moduleId: {
        callerId: args.callerId,
        moduleId: args.moduleId,
      },
    },
    data: {
      incompleteAttempts: { increment: 1 },
      ...(willWaive ? { status: "COMPLETED", completedAt: new Date() } : {}),
    },
    select: { incompleteAttempts: true },
  });

  if (willWaive) {
    log("system", "module.incomplete.waived", {
      level: "info",
      message: "Second incomplete attempt — waiving completion gate, marking module MASTERED",
      callerId: args.callerId,
      moduleId: args.moduleId,
      playbookId: args.playbookId ?? null,
      attempts: updated.incompleteAttempts,
      durationSeconds: args.durationSeconds ?? null,
      minSpeakingSec: args.minSpeakingSec ?? null,
    });
  } else {
    log("system", "module.incomplete.recorded", {
      level: "info",
      message: "First incomplete attempt recorded",
      callerId: args.callerId,
      moduleId: args.moduleId,
      playbookId: args.playbookId ?? null,
      attempts: updated.incompleteAttempts,
      durationSeconds: args.durationSeconds ?? null,
      minSpeakingSec: args.minSpeakingSec ?? null,
    });
  }

  return {
    attempts: updated.incompleteAttempts,
    waived: willWaive,
  };
}
