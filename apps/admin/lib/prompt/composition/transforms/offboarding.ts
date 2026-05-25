/**
 * Offboarding Transform
 *
 * When the cadence gate fires, emits offboarding guidance instructing the AI
 * to summarise the learning journey, invite reflection, and suggest next
 * steps. With Felt Progress S2 (#780) the transform can now also emit a
 * structured `progressSummary` so the AI cites concrete module mastery / goal
 * progress / skill scores in its closing turn — the difference between a
 * generic "well done!" and "you mastered Part 2 at 78%".
 *
 * Cadence gate (default 'final_only' preserves the original behaviour):
 *   - 'final_only' — fires when `sharedState.isFinalSession === true`
 *   - 'every_session_with_data' — fires on every post-call-1 session that
 *     has at least one mastery / goal / skill data point
 *
 * Null guard: when the cadence gate fires but every data dimension is empty
 * (brand-new caller on every_session_with_data, or a final session with no
 * tracked progress at all), the `progressSummary` is omitted and only the
 * generic guidance lines are emitted. The transform never invents data.
 *
 * Settings live at `Playbook.config.offboardingSummary` — see
 * `lib/types/json-fields.ts::PlaybookConfig.offboardingSummary`.
 */

import { registerTransform } from "../TransformRegistry";
import { prisma } from "@/lib/prisma";
import type { AssembledContext } from "../types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface ModuleProgressEntry {
  slug: string;
  title: string;
  mastery: number;
  callCount: number;
}

export interface GoalProgressEntry {
  name: string;
  progress: number;
  type: string;
}

export interface SkillScoreEntry {
  name: string;
  currentScore: number;
}

export interface ProgressSummary {
  modules?: ModuleProgressEntry[];
  goals?: GoalProgressEntry[];
  skills?: SkillScoreEntry[];
}

export interface OffboardingOutput {
  isFinalSession: boolean;
  cadenceFired: "final_only" | "every_session_with_data";
  guidance: string[];
  progressSummary: ProgressSummary | null;
}

const DEFAULTS = {
  enabled: true,
  cadence: "final_only" as const,
  includeModuleMastery: true,
  includeGoalProgress: true,
  includeSkillCurrentScore: true,
};

const GENERIC_FINAL_GUIDANCE = [
  "This is the learner's final session.",
  "Summarise their learning journey — reference specific topics covered and progress made.",
  "Invite reflection on what they have achieved and how their understanding has grown.",
  "Suggest concrete next steps for continued learning beyond this course.",
  "End on an encouraging note that reinforces their capability to continue independently.",
];

const GENERIC_EVERY_SESSION_GUIDANCE = [
  "Wind down this session with a brief progress acknowledgement.",
  "Reference specific topics worked on and the learner's demonstrated capability.",
  "Suggest one concrete focus for the next session.",
];

function formatModulesLine(modules: ModuleProgressEntry[]): string {
  const parts = modules.map(
    (m) => `${m.title} (${Math.round(m.mastery * 100)}% mastery, ${m.callCount} call${m.callCount === 1 ? "" : "s"})`,
  );
  return `Module mastery so far: ${parts.join("; ")}.`;
}

function formatGoalsLine(goals: GoalProgressEntry[]): string {
  const parts = goals.map(
    (g) => `${g.name} at ${Math.round(g.progress * 100)}%`,
  );
  return `Goal progress: ${parts.join("; ")}.`;
}

function formatSkillsLine(skills: SkillScoreEntry[]): string {
  const parts = skills.map(
    (s) => `${s.name} = ${s.currentScore.toFixed(2)}`,
  );
  return `Skill scores (current demonstrated level): ${parts.join("; ")}.`;
}

registerTransform("computeOffboarding", async (
  _rawData: unknown,
  context: AssembledContext,
): Promise<OffboardingOutput | null> => {
  const { sharedState, loadedData } = context;
  const playbook = loadedData.playbooks?.[0];
  const config = (playbook?.config ?? {}) as PlaybookConfig;
  const settings = config.offboardingSummary ?? {};

  const enabled = settings.enabled ?? DEFAULTS.enabled;
  if (!enabled) return null;

  const cadence = settings.cadence ?? DEFAULTS.cadence;
  const callNumber: number = (sharedState as { callNumber?: number }).callNumber ?? 1;
  const isFinalSession = !!sharedState.isFinalSession;

  // Cadence gate.
  if (cadence === "final_only" && !isFinalSession) return null;
  if (cadence === "every_session_with_data" && callNumber <= 1) return null;

  const includeModuleMastery = settings.includeModuleMastery ?? DEFAULTS.includeModuleMastery;
  const includeGoalProgress = settings.includeGoalProgress ?? DEFAULTS.includeGoalProgress;
  const includeSkillCurrentScore = settings.includeSkillCurrentScore ?? DEFAULTS.includeSkillCurrentScore;

  // ── Module mastery ─────────────────────────────────────────────────────────
  // Reads CallerModuleProgress directly — non-blocking. Same pattern as
  // transforms/modules.ts ~line 431. Curriculum scope from sharedState.
  let modules: ModuleProgressEntry[] | undefined;
  if (includeModuleMastery) {
    const callerId = loadedData.caller?.id;
    const curriculumSpecSlug = (sharedState as { curriculumSpecSlug?: string }).curriculumSpecSlug;
    if (callerId) {
      try {
        const rows = await prisma.callerModuleProgress.findMany({
          where: {
            callerId,
            ...(curriculumSpecSlug
              ? { module: { curriculum: { slug: curriculumSpecSlug } } }
              : {}),
            mastery: { gt: 0 },
          },
          select: {
            mastery: true,
            callCount: true,
            module: { select: { slug: true, title: true } },
          },
          orderBy: { mastery: "desc" },
          take: 8,
        });
        if (rows.length > 0) {
          modules = rows.map((r) => ({
            slug: r.module.slug ?? "",
            title: r.module.title ?? r.module.slug ?? "module",
            mastery: r.mastery,
            callCount: r.callCount ?? 0,
          }));
        }
      } catch (err) {
        console.warn(
          "[offboarding] CallerModuleProgress query failed (non-blocking):",
          err,
        );
      }
    }
  }

  // ── Goals ──────────────────────────────────────────────────────────────────
  let goals: GoalProgressEntry[] | undefined;
  if (includeGoalProgress) {
    const goalRows = (loadedData.goals ?? []).filter((g) => g.progress > 0);
    if (goalRows.length > 0) {
      goals = goalRows.slice(0, 6).map((g) => ({
        name: g.name,
        progress: g.progress,
        type: g.type,
      }));
    }
  }

  // ── Skill current scores ───────────────────────────────────────────────────
  // Option A: surface `currentScore` only (Story #780). Skill delta (start→now)
  // requires an `initialScore` field on CallerTarget — deferred.
  let skills: SkillScoreEntry[] | undefined;
  if (includeSkillCurrentScore) {
    const skillRows = (loadedData.callerTargets ?? []).filter(
      (t) =>
        typeof t.currentScore === "number" &&
        t.currentScore > 0 &&
        (t.parameter?.parameterId?.startsWith("skill_") ||
          t.parameter?.name?.toLowerCase().includes("skill")),
    );
    if (skillRows.length > 0) {
      skills = skillRows.slice(0, 6).map((t) => ({
        name: t.parameter?.name ?? t.parameterId,
        currentScore: t.currentScore as number,
      }));
    }
  }

  // ── Null guard ─────────────────────────────────────────────────────────────
  const hasAnyData = !!modules || !!goals || !!skills;

  const baseGuidance =
    cadence === "final_only"
      ? [...GENERIC_FINAL_GUIDANCE]
      : [...GENERIC_EVERY_SESSION_GUIDANCE];

  if (!hasAnyData) {
    return {
      isFinalSession,
      cadenceFired: cadence,
      guidance: baseGuidance,
      progressSummary: null,
    };
  }

  const progressSummary: ProgressSummary = {};
  if (modules) progressSummary.modules = modules;
  if (goals) progressSummary.goals = goals;
  if (skills) progressSummary.skills = skills;

  const dataLines: string[] = [
    "",
    "Concrete progress data — cite these numbers verbatim if you mention progress; do not invent any others:",
  ];
  if (modules) dataLines.push(`  - ${formatModulesLine(modules)}`);
  if (goals) dataLines.push(`  - ${formatGoalsLine(goals)}`);
  if (skills) dataLines.push(`  - ${formatSkillsLine(skills)}`);
  dataLines.push(
    "",
    "STRICT RULES — read every time:",
    "  - When acknowledging progress, cite ONLY values from the lines above. Never invent or round dramatically.",
    "  - Translate scores into plain language alongside the number ('78% — solid grasp', 'goal at 60% — close to the milestone').",
    "  - Keep it tight: name at most two dimensions to celebrate. Don't recite the whole list.",
  );

  return {
    isFinalSession,
    cadenceFired: cadence,
    guidance: [...baseGuidance, ...dataLines],
    progressSummary,
  };
});
