/**
 * Instantiate Goal rows for a caller's ACTIVE playbook enrolments.
 *
 * Historically this took `(callerId, domainId)` and picked "a" published
 * playbook in the domain via findFirst — which was non-deterministic and,
 * in any multi-course domain, silently looked at the wrong playbook (most
 * often the oldest seed). The fix is to iterate the caller's real
 * CallerPlaybook enrolments and instantiate goals for each.
 *
 * For each active enrolment:
 *   1. Read `playbook.config.goals[]` — create one Goal per entry.
 *   2. If config.goals is empty, derive goals from the playbook's linked
 *      curriculum modules so the adapt loop always has a reward signal.
 *
 * Idempotent: skips a playbook if the caller already has ACTIVE/PAUSED
 * goals linked to it.
 */

import { prisma } from "@/lib/prisma";
import { GOAL_TYPE_VALUES, type GoalTypeLiteral, type PlaybookConfig } from "@/lib/types/json-fields";

const LEGACY_GOAL_TYPE_MAP: Record<string, GoalTypeLiteral> = {
  TOPIC_MASTERED: "LEARN",
  CONFIDENCE_GAIN: "CHANGE",
  KNOWLEDGE_GAIN: "LEARN",
  HABIT_CHANGE: "CHANGE",
};

function coerceGoalType(raw: unknown): GoalTypeLiteral {
  if (typeof raw === "string") {
    const upper = raw.toUpperCase();
    if ((GOAL_TYPE_VALUES as readonly string[]).includes(upper)) {
      return upper as GoalTypeLiteral;
    }
    if (LEGACY_GOAL_TYPE_MAP[upper]) {
      console.warn(`[instantiate-goals] Mapping legacy goal type "${upper}" → "${LEGACY_GOAL_TYPE_MAP[upper]}"`);
      return LEGACY_GOAL_TYPE_MAP[upper];
    }
  }
  console.warn(`[instantiate-goals] Unknown goal type ${JSON.stringify(raw)} — defaulting to LEARN`);
  return "LEARN";
}

type GoalConfigEntry = {
  type: string;
  name: string;
  description?: string | null;
  contentSpecSlug?: string;
  isAssessmentTarget?: boolean;
  assessmentConfig?: unknown;
  priority?: number;
};

/**
 * Derive fallback goals from the playbook's linked curriculum modules.
 * One LEARN goal per module using the module title. Returns [] if no
 * curriculum / no modules are linked.
 */
async function deriveGoalsFromCurriculum(playbookId: string): Promise<GoalConfigEntry[]> {
  const subjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    select: { subjectId: true },
  });
  if (subjects.length === 0) return [];

  const modules = await prisma.curriculumModule.findMany({
    where: {
      isActive: true,
      curriculum: { subjectId: { in: subjects.map((s) => s.subjectId) } },
    },
    select: { id: true, slug: true, title: true, description: true, sortOrder: true },
    orderBy: [{ curriculumId: "asc" }, { sortOrder: "asc" }],
  });

  return modules.map((m) => ({
    type: "LEARN" as const,
    name: `Master ${m.title}`,
    description: m.description || undefined,
    priority: 5,
  }));
}

/**
 * Instantiate goals for a single playbook the caller is enrolled in.
 * Returns the names of goals created (empty if skipped or nothing to do).
 */
async function instantiateForPlaybook(
  callerId: string,
  playbookId: string,
  playbookConfig: PlaybookConfig | null,
): Promise<string[]> {
  // Skip if caller already has goals for this playbook (idempotent)
  const existing = await prisma.goal.count({
    where: { callerId, playbookId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (existing > 0) return [];

  const cfg = playbookConfig || {};
  let goalConfigs: GoalConfigEntry[] = (cfg.goals as GoalConfigEntry[] | undefined) || [];

  // Fallback: if no explicit goals were captured (wizard miss), derive from
  // curriculum modules so the caller gets some reward signal.
  if (goalConfigs.length === 0) {
    const derived = await deriveGoalsFromCurriculum(playbookId);
    if (derived.length === 0) {
      console.warn(`[instantiate-goals] No goals in config and no curriculum modules for playbook ${playbookId} — caller ${callerId} will have 0 goals on this playbook`);
      return [];
    }
    console.log(`[instantiate-goals] Derived ${derived.length} fallback goal(s) from curriculum modules for playbook ${playbookId}`);
    goalConfigs = derived;
  }

  const created: string[] = [];

  for (const goalConfig of goalConfigs) {
    let contentSpecId: string | null = null;
    if (goalConfig.type === "LEARN" && goalConfig.contentSpecSlug) {
      const contentSpec = await prisma.analysisSpec.findFirst({
        where: {
          slug: { contains: goalConfig.contentSpecSlug.toLowerCase().replace(/_/g, "-") },
          isActive: true,
        },
        select: { id: true },
      });
      contentSpecId = contentSpec?.id || null;
    }

    const goal = await prisma.goal.create({
      data: {
        callerId,
        playbookId,
        type: coerceGoalType(goalConfig.type),
        name: goalConfig.name,
        description: goalConfig.description || null,
        contentSpecId,
        isAssessmentTarget: goalConfig.isAssessmentTarget || false,
        assessmentConfig: goalConfig.assessmentConfig || undefined,
        status: "ACTIVE",
        priority: goalConfig.priority || 5,
        startedAt: new Date(),
      },
    });

    created.push(goal.name);
  }

  return created;
}

/**
 * Create Goal records for every ACTIVE playbook enrolment a caller has.
 *
 * Previously this took a domainId and used findFirst to pick a playbook,
 * which was broken for any multi-course domain. Now it reads the caller's
 * real CallerPlaybook rows — the source of truth for what the caller is
 * enrolled in — and instantiates goals for each published playbook.
 *
 * @param callerId - The caller to create goals for
 * @param _legacyDomainIdIgnored - Deprecated positional parameter kept for
 *   call-site compatibility. Domain is derived from the playbook.
 */
export async function instantiatePlaybookGoals(
  callerId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _legacyDomainIdIgnored?: string,
): Promise<string[]> {
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: {
      playbookId: true,
      playbook: { select: { id: true, status: true, config: true } },
    },
  });

  if (enrollments.length === 0) {
    console.warn(`[instantiate-goals] Caller ${callerId} has no active enrolments — no goals to instantiate`);
    return [];
  }

  const allCreated: string[] = [];
  for (const e of enrollments) {
    if (e.playbook.status !== "PUBLISHED") {
      console.warn(`[instantiate-goals] Skipping playbook ${e.playbookId} — status is ${e.playbook.status}, not PUBLISHED`);
      continue;
    }
    const created = await instantiateForPlaybook(
      callerId,
      e.playbookId,
      (e.playbook.config || null) as PlaybookConfig | null,
    );
    allCreated.push(...created);
  }

  return allCreated;
}
