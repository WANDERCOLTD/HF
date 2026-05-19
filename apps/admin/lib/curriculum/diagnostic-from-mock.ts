/**
 * Diagnostic from Mock — #494 E2 Slice 2.6.
 *
 * After a "Mock" call (a `CurriculumModule` whose `coversModules` declares
 * 2+ child slugs — e.g. IELTS Mock covering part1/part2/part3) finishes
 * AGGREGATE, generate a deterministic per-learner diagnostic that tells the
 * learner which modules to focus on next.
 *
 * Strategy:
 *   1. Compute mastery for each covered module using the EMA helper.
 *   2. Sort ascending. `focusModules` = first up to 3 (weakest). The
 *      strongest covered module becomes `strengthModule`. When every
 *      mastery value ties at 0 (no evidence yet, e.g. first Mock for this
 *      caller), `strengthModule` is null — there is no signal to call out.
 *   3. `weakSkill` = name of the lowest-scored `CallScore.parameter` from
 *      this Mock call. Null when the call produced no scores.
 *   4. `summary` = single-sentence canned template referencing module
 *      titles for human readability.
 *
 * Persistence is the caller's responsibility — the pipeline route writes
 * the returned diagnostic to `CallerAttribute` with scope=DIAGNOSTIC,
 * key=fromMock. See `route.ts` AGGREGATE stage.
 *
 * Failure mode: returns `null` when the call shouldn't produce a
 * diagnostic (coveredModuleIds < 2). The pipeline route additionally
 * try/catches generation so any thrown error never fails the pipeline.
 */

import type { PrismaClient } from "@prisma/client";

import { computeModuleMastery } from "@/lib/curriculum/compute-mastery";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/** Mock detection rule: a Mock attributes evidence to ≥2 child modules. */
export const MOCK_MIN_COVERED_MODULES = 2;

/** Max number of focus modules surfaced to the learner. */
export const MAX_FOCUS_MODULES = 3;

export interface DiagnosticFromMockInput {
  callId: string;
  callerId: string;
  curriculumId: string;
  /** Resolved CurriculumModule.id list — the Mock + every part it covers. */
  coveredModuleIds: string[];
  /** Source of `skillScoringEmaHalfLifeDays` / `skillMinCallsToFull`. */
  playbookConfig: PlaybookConfig | null;
}

export interface DiagnosticFromMock {
  /** Module IDs ordered weakest-first, up to {@link MAX_FOCUS_MODULES}. */
  focusModules: string[];
  /** Highest-mastery covered module ID, or null when no clear winner. */
  strengthModule: string | null;
  /** Parameter name of the lowest CallScore for this call, or null. */
  weakSkill: string | null;
  /** Single-sentence learner-facing summary referencing module titles. */
  summary: string;
  /** The Mock callId that produced this diagnostic. */
  fromCallId: string;
  /** ISO-8601 timestamp of when this diagnostic was generated. */
  generatedAt: string;
}

/**
 * Minimal PlaybookConfig fields read by this helper. PlaybookConfig is the
 * full union of every config key the codebase touches — narrow to the EMA
 * tuning knobs the mastery formula needs.
 */
type MasteryTuning = Pick<
  PlaybookConfig,
  never
> & {
  skillScoringEmaHalfLifeDays?: number;
  skillMinCallsToFull?: number;
};

/**
 * Generate a diagnostic from a finished Mock call's covered module set.
 *
 * Returns null when `coveredModuleIds.length < MOCK_MIN_COVERED_MODULES` —
 * a Mock by definition covers ≥2 child modules; anything less is a
 * regular call and produces no diagnostic.
 *
 * Deterministic: identical inputs → identical output (modulo `generatedAt`).
 * No AI calls — purely DB-derived.
 */
export async function generateDiagnosticFromMock(
  prisma: PrismaClient,
  input: DiagnosticFromMockInput,
): Promise<DiagnosticFromMock | null> {
  const { callId, callerId, coveredModuleIds, playbookConfig } = input;

  if (coveredModuleIds.length < MOCK_MIN_COVERED_MODULES) {
    return null;
  }

  // Pull EMA tuning from playbook config (matches aggregate-runner / route.ts).
  const tuning: MasteryTuning = (playbookConfig as MasteryTuning | null) ?? {};
  const emaHalfLifeDays =
    typeof tuning.skillScoringEmaHalfLifeDays === "number"
      ? tuning.skillScoringEmaHalfLifeDays
      : undefined;
  const minCallsToFull =
    typeof tuning.skillMinCallsToFull === "number"
      ? tuning.skillMinCallsToFull
      : undefined;

  // 1. Compute mastery per covered module in parallel. Each row is
  // independent — the EMA helper queries CallScore directly and does not
  // mutate state.
  const masteryByModule = await Promise.all(
    coveredModuleIds.map(async (moduleId) => {
      const result = await computeModuleMastery(prisma, {
        callerId,
        moduleId,
        emaHalfLifeDays,
        minCallsToFull,
      });
      return { moduleId, mastery: result.mastery };
    }),
  );

  // 2. Sort ascending by mastery for focusModules + strengthModule. Break
  // ties by moduleId (stable lexicographic) so the output is deterministic
  // when masteries are equal.
  const sorted = [...masteryByModule].sort((a, b) => {
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return a.moduleId.localeCompare(b.moduleId);
  });

  // Strongest module = last entry. Null when every mastery is 0 (no
  // evidence yet) — without a clear winner we don't want to mislead the
  // learner. The "all tied at 0" case is exactly "first Mock, no prior
  // calls" which is when the diagnostic matters most.
  const allZero = sorted.every((row) => row.mastery === 0);
  const strengthModule = allZero ? null : sorted[sorted.length - 1]!.moduleId;

  // focusModules = weakest first, capped at MAX_FOCUS_MODULES, with the
  // strengthModule excluded so we don't tell the learner to focus on
  // their strongest area. When strengthModule is null (all tied at 0)
  // every covered module is fair game.
  const eligibleForFocus = strengthModule
    ? sorted.filter((row) => row.moduleId !== strengthModule)
    : sorted;
  const focusModules = eligibleForFocus
    .slice(0, MAX_FOCUS_MODULES)
    .map((row) => row.moduleId);

  // 3. Lowest CallScore parameter for this call → weakSkill.
  const lowestScore = await prisma.callScore.findFirst({
    where: { callId },
    orderBy: { score: "asc" },
    select: { parameter: { select: { name: true } } },
  });
  const weakSkill = lowestScore?.parameter?.name ?? null;

  // 4. Resolve module titles for the summary string. Pull every covered
  // module title in one query, then substitute by ID.
  const titleRows = await prisma.curriculumModule.findMany({
    where: { id: { in: coveredModuleIds } },
    select: { id: true, title: true },
  });
  const titleById = new Map<string, string>(
    titleRows.map((row) => [row.id, row.title]),
  );

  const focusTitles = focusModules.map(
    (id) => titleById.get(id) ?? id, // Fallback to ID when title missing.
  );
  const strengthTitle = strengthModule
    ? (titleById.get(strengthModule) ?? strengthModule)
    : null;

  const summary = buildSummary(strengthTitle, focusTitles);

  return {
    focusModules,
    strengthModule,
    weakSkill,
    summary,
    fromCallId: callId,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compose a single-sentence learner-facing summary. Two shapes:
 *   - with strength: "On your Mock, your strongest area was X. To improve, focus next on A, B."
 *   - without strength (all tied at 0): "On your Mock, focus next on A, B."
 *
 * Falls back gracefully when focusTitles is empty (defensive — by
 * construction `coveredModuleIds.length >= 2` so focusModules always has
 * at least 2 entries, but the empty case can arise if the title query
 * misses every row).
 */
function buildSummary(
  strengthTitle: string | null,
  focusTitles: string[],
): string {
  const focusJoined = focusTitles.join(", ");
  if (focusTitles.length === 0) {
    return strengthTitle
      ? `On your Mock, your strongest area was ${strengthTitle}.`
      : `Diagnostic generated from your Mock.`;
  }
  if (strengthTitle) {
    return `On your Mock, your strongest area was ${strengthTitle}. To improve, focus next on ${focusJoined}.`;
  }
  return `On your Mock, focus next on ${focusJoined}.`;
}
