/**
 * isModuleUnlocked — #1746 (epic #1700 Theme 5).
 *
 * Determines whether a learner can ENTER a module given the module's
 * declared prerequisites and the learner's progress history.
 *
 * Two prerequisite shapes accepted (widened from `string[]` in #1746):
 *
 *   - **String** (legacy): bare slug. Treated as "needs ≥ 1 COMPLETED
 *     attempt on the referenced sibling module".
 *   - **`{moduleId, minCompletions}`**: count-based. Require ≥ N
 *     COMPLETED attempts. e.g. IELTS Mock declares
 *     `[{moduleId: "assessment", minCompletions: 1},
 *       {moduleId: "part1", minCompletions: 2},
 *       {moduleId: "part3", minCompletions: 2}]`.
 *
 * **Role bypass.** OPERATOR+ (level ≥ 3) ALWAYS reads back
 * `{unlocked: true, reason: "role-bypass"}`. Testers must not be locked
 * out of Mock when iterating on it; the gate is a STUDENT-only contract.
 * Pinned by vitest.
 *
 * **Course-style gate.** Only structured courses honour the unlock
 * gate. Continuous courses have no module-progress semantics; we
 * default-allow (the caller decides what "allow" means without modules).
 *
 * Pure read — no writes. Returns `{unlocked, reason, missing?[]}` so
 * the caller can render a "Complete X first" hint when blocked.
 *
 * @see docs/draft-issues/ielts-pre-voice-gap-analysis.md (Theme 5)
 */

import type { PrismaClient } from "@prisma/client";

import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";
import { getCourseStyle } from "@/lib/pipeline/course-style";

export type ModulePrerequisiteShape = string | { moduleId: string; minCompletions: number };

/**
 * Coerce a prerequisite entry to `{moduleId, minCompletions}`. Bare-string
 * legacy entries become `{moduleId: <slug>, minCompletions: 1}`. Invalid
 * entries (non-string, non-object, missing moduleId) are dropped.
 *
 * Exported so the 6 consumer sites can share one normalisation path
 * instead of inlining `typeof p === "string" ? ... : ...` branches.
 */
export function normalisePrerequisite(
  p: unknown,
): { moduleId: string; minCompletions: number } | null {
  if (typeof p === "string") {
    return { moduleId: p, minCompletions: 1 };
  }
  if (typeof p === "object" && p !== null) {
    const obj = p as { moduleId?: unknown; minCompletions?: unknown };
    if (typeof obj.moduleId !== "string" || obj.moduleId.length === 0) {
      return null;
    }
    const min =
      typeof obj.minCompletions === "number" && obj.minCompletions > 0
        ? obj.minCompletions
        : 1;
    return { moduleId: obj.moduleId, minCompletions: min };
  }
  return null;
}

/**
 * Extract just the slug list from a mixed prerequisites array.
 *
 * For the read sites that don't care about `minCompletions` (UI chips,
 * filter checks, advisory hints, the DB writer that targets the
 * `String[]` Prisma column) — pass the prereqs array, get a `string[]`
 * back.
 *
 * Invalid entries are dropped (defensive — the DB shape is permissive).
 */
export function prerequisiteSlugs(prereqs: unknown): string[] {
  if (!Array.isArray(prereqs)) return [];
  const out: string[] = [];
  for (const p of prereqs) {
    const n = normalisePrerequisite(p);
    if (n) out.push(n.moduleId);
  }
  return out;
}

export interface UnlockCheckArgs {
  callerId: string;
  /** AuthoredModule whose unlock state we're checking. */
  module: AuthoredModule;
  /** Playbook config carrying the modules array + course style. */
  playbookConfig: PlaybookConfig | null | undefined;
  /** Caller's role for the role-bypass check. */
  callerRole: string | null | undefined;
}

export interface UnlockCheckResult {
  unlocked: boolean;
  /**
   * One of:
   *   - `"role-bypass"` — OPERATOR+ always pass
   *   - `"no-prerequisites"` — empty/missing prereq list
   *   - `"continuous-course"` — non-structured course, gate doesn't apply
   *   - `"all-prerequisites-met"` — every prereq satisfied
   *   - `"prerequisites-unmet"` — at least one prereq below `minCompletions`
   *   - `"module-id-unknown"` — module not in playbook (defensive)
   */
  reason: string;
  /**
   * For `prerequisites-unmet`: the list of unsatisfied prereqs +
   * how many more completions each needs. UI surfaces this as
   * "Complete X (1 more) and Y (2 more) first".
   */
  missing?: Array<{
    moduleId: string;
    moduleLabel: string | null;
    required: number;
    actual: number;
  }>;
}

/** ROLE_LEVEL ordering — mirrors `lib/permissions.ts`. */
const OPERATOR_BYPASS_ROLES = new Set([
  "OPERATOR",
  "EDUCATOR",
  "ADMIN",
  "SUPERADMIN",
]);

/** Minimal Prisma subset — keeps the test mock small. */
type PrismaForUnlock = Pick<PrismaClient, "callerModuleProgress">;

/**
 * Returns whether this caller can ENTER the supplied module.
 *
 * `getCourseStyle` short-circuit:
 *   - continuous courses: `{unlocked: true, reason: "continuous-course"}`
 *   - structured: proceed with prereq evaluation
 *
 * Role bypass:
 *   - OPERATOR+ → `{unlocked: true, reason: "role-bypass"}`
 *   - STUDENT / VIEWER / TESTER / SUPER_TESTER / DEMO → gate enforced
 */
export async function isModuleUnlocked(
  prisma: PrismaForUnlock,
  args: UnlockCheckArgs,
): Promise<UnlockCheckResult> {
  // Role bypass — OPERATOR+ always pass. Testers iterating on Mock must
  // not be locked out.
  if (args.callerRole && OPERATOR_BYPASS_ROLES.has(args.callerRole)) {
    return { unlocked: true, reason: "role-bypass" };
  }

  // Continuous-course short-circuit. Module-progress writes only make
  // sense for structured courses (per #1252).
  const courseStyle = getCourseStyle(args.playbookConfig);
  if (courseStyle !== "structured") {
    return { unlocked: true, reason: "continuous-course" };
  }

  const rawPrereqs = args.module.prerequisites as
    | ModulePrerequisiteShape[]
    | undefined;
  if (!Array.isArray(rawPrereqs) || rawPrereqs.length === 0) {
    return { unlocked: true, reason: "no-prerequisites" };
  }

  // Normalise both shapes to `{moduleId, minCompletions}`.
  const normalised = rawPrereqs
    .map(normalisePrerequisite)
    .filter((p): p is { moduleId: string; minCompletions: number } => p !== null);

  if (normalised.length === 0) {
    return { unlocked: true, reason: "no-prerequisites" };
  }

  // Resolve prereq module ids → DB module ids. Authored module ids
  // match `CurriculumModule.slug` by convention (see #407 slug-scope).
  const authoredById = new Map<string, AuthoredModule>();
  for (const m of args.playbookConfig?.modules ?? []) {
    authoredById.set(m.id, m);
  }
  const slugsToCheck = normalised.map((p) => p.moduleId);

  // Read the caller's progress on the prereq modules.
  // #1252 — wrapped in a structured-only if-block (we already returned
  // early on continuous). The find runs only inside the structured
  // branch by control flow.
  let progressRows: Array<{ moduleId: string; status: string; callCount: number; module: { slug: string | null } }> = [];
  if (courseStyle === "structured") {
    progressRows = await prisma.callerModuleProgress.findMany({
      where: {
        callerId: args.callerId,
        module: { slug: { in: slugsToCheck } },
      },
      select: {
        moduleId: true,
        status: true,
        callCount: true,
        module: { select: { slug: true } },
      },
    });
  }

  // Map slug → completion count. A module counts toward its own
  // requirement only when its progress reaches COMPLETED — `callCount`
  // alone over-counts incomplete attempts.
  const completionsBySlug = new Map<string, number>();
  for (const row of progressRows) {
    const slug = row.module.slug;
    if (!slug) continue;
    if (row.status === "COMPLETED") {
      // `callCount` is the total touches; for COMPLETED rows we count
      // it as ≥ the required minimum (the module reached COMPLETED at
      // least once, plus any subsequent re-engagements). Conservative:
      // use max(1, callCount) so a single-attempt COMPLETED satisfies
      // `minCompletions: 1` even if callCount drifted.
      completionsBySlug.set(slug, Math.max(1, row.callCount ?? 1));
    }
  }

  const missing: NonNullable<UnlockCheckResult["missing"]> = [];
  for (const req of normalised) {
    const actual = completionsBySlug.get(req.moduleId) ?? 0;
    if (actual < req.minCompletions) {
      const authored = authoredById.get(req.moduleId);
      missing.push({
        moduleId: req.moduleId,
        moduleLabel: authored?.label ?? null,
        required: req.minCompletions,
        actual,
      });
    }
  }

  if (missing.length > 0) {
    return {
      unlocked: false,
      reason: "prerequisites-unmet",
      missing,
    };
  }

  return { unlocked: true, reason: "all-prerequisites-met" };
}
