/**
 * markOrientationShownIfApplicable — #1730 Story D (epic #1700 Theme 1, G8 consumer D).
 *
 * Single chokepoint for the `CallerModuleProgress.orientationShown` latch.
 * Sibling to `lib/curriculum/mark-module-incomplete.ts` (#1703) — same shape
 * (default-deny by `courseStyle`, AppLog observability, transaction-aware).
 *
 * Producer side: `lib/prompt/composition/transforms/instructions.ts::resolveModuleOrientationLine`
 * (consumer D from epic #1730) reads `CallerModuleProgress.orientationShown`
 * for the locked module's `(callerId, moduleId)` pair. When `false` (or row
 * absent), the FIRST-TIME ORIENTATION directive fires; when `true`, the
 * directive is suppressed.
 *
 * This helper is the WRITER that closes the latch. Without it, the
 * directive fires on call #1, then EVERY subsequent call too — silent
 * regression.
 *
 * Schema header in `prisma/schema.prisma` `CallerModuleProgress.orientationShown`
 * mandates the contract: "endSession writes `true` for the (caller, module)
 * pair on first successful completion so subsequent calls skip the
 * orientation."
 *
 * AppLog: writes `module.orientation.marked` on success;
 * `module.orientation.skipped_continuous` on the default-deny branch.
 * Flag-off branch is silent (too noisy during the migration window).
 *
 * Allow-listed in `eslint-rules/no-bare-module-progress-update.mjs` so the
 * `upsert` here is the canonical write site.
 *
 * @see lib/voice/end-session.ts (caller)
 * @see lib/prompt/composition/transforms/instructions.ts:510 (consumer)
 * @see prisma/schema.prisma CallerModuleProgress.orientationShown
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { log } from "@/lib/logger";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import type { CourseStyle } from "@/lib/pipeline/course-style";

/** Either a PrismaClient or a `$transaction` callback's `tx` handle. */
type PrismaTx = PrismaClient | Prisma.TransactionClient;

export interface MarkOrientationShownArgs {
  callerId: string;
  moduleId: string;
  /**
   * **Required** — guard #1252 (`no-module-read-without-course-style-guard`)
   * forces default-deny on `CallerModuleProgress` writes. Helper
   * short-circuits with `{marked: false, skipReason: "non_structured_course"}`
   * + AppLog when not `"structured"`. Caller MUST resolve via
   * `getCourseStyle(playbook.config)`.
   */
  courseStyle: CourseStyle;
  /**
   * Optional — included in the AppLog payload only. Not required for the
   * DB write because `(callerId, moduleId)` is unique on the progress row.
   */
  playbookId?: string | null;
}

export interface MarkOrientationShownResult {
  /** True when the latch was written this call (or was already true). */
  marked: boolean;
  /** Set when `marked: false` — `"non_structured_course"` or `"flag_off"`. */
  skipReason?: "non_structured_course" | "flag_off";
}

/**
 * Idempotent upsert of `CallerModuleProgress.orientationShown = true` for the
 * given `(callerId, moduleId)` pair.
 *
 * Default-deny rules (in order):
 *
 *   1. `isIeltsModuleSettingsEnabled()` (HF_FLAG_IELTS_MODULE_SETTINGS) MUST
 *      be true. Mirrors the consumer-side gate in
 *      `resolveModuleOrientationLine`. Silent skip (no AppLog) — the flag
 *      is off org-wide during migration, so logging every call would drown
 *      `/x/logs`.
 *   2. `courseStyle === "structured"` — guard #1252. Module-scoped progress
 *      only exists in structured courses. AppLog the skip so operators
 *      can see the gate fired.
 *
 * Upsert semantics:
 *   - `update` branch: sets `orientationShown = true`. Idempotent — if the
 *     row already has `orientationShown = true` the value stays true.
 *   - `create` branch: creates a row with `orientationShown = true` and
 *     `status = "NOT_STARTED"` (DB convention sentinel). This branch fires
 *     when the orientation directive renders BEFORE the canonical mastery
 *     writer (`track-progress.ts`) has materialised the row for this
 *     (caller, module). Other progress fields (`mastery`, `loScoresJson`,
 *     `incompleteAttempts`) remain at column defaults.
 *
 * Does NOT touch `status`, `mastery`, `loScoresJson`, `completedAt`, or
 * `incompleteAttempts` on existing rows — sibling-writer isolation. The
 * sticky-waiver invariant in `track-progress.ts:665` and the
 * incomplete-attempt counter in `mark-module-incomplete.ts` are unaffected.
 */
export async function markOrientationShownIfApplicable(
  tx: PrismaTx,
  args: MarkOrientationShownArgs,
): Promise<MarkOrientationShownResult> {
  if (!args.callerId) {
    throw new Error("markOrientationShownIfApplicable: callerId is required");
  }
  if (!args.moduleId) {
    throw new Error("markOrientationShownIfApplicable: moduleId is required");
  }

  // Gate 1 — feature flag. Silent skip during the migration window.
  if (!isIeltsModuleSettingsEnabled()) {
    return { marked: false, skipReason: "flag_off" };
  }

  // Gate 2 — guard #1252 default-deny on continuous courses.
  if (args.courseStyle !== "structured") {
    log("system", "module.orientation.skipped_continuous", {
      level: "info",
      message:
        "markOrientationShownIfApplicable skipped — course is continuous (guard #1252 default-deny)",
      callerId: args.callerId,
      moduleId: args.moduleId,
      playbookId: args.playbookId ?? null,
      courseStyle: args.courseStyle,
    });
    return { marked: false, skipReason: "non_structured_course" };
  }

  await tx.callerModuleProgress.upsert({
    where: {
      callerId_moduleId: {
        callerId: args.callerId,
        moduleId: args.moduleId,
      },
    },
    update: {
      orientationShown: true,
    },
    create: {
      callerId: args.callerId,
      moduleId: args.moduleId,
      orientationShown: true,
      status: "NOT_STARTED",
    },
    select: { id: true },
  });

  log("system", "module.orientation.marked", {
    level: "info",
    message: "First-time orientation latch closed for (caller, module)",
    callerId: args.callerId,
    moduleId: args.moduleId,
    playbookId: args.playbookId ?? null,
  });

  return { marked: true };
}
