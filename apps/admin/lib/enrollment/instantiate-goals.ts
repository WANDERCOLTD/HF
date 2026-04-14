/**
 * Instantiate goals from a domain's published playbook config.
 * Called on caller creation and domain switch.
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

/**
 * Create Goal records for a caller from their domain's published playbook.
 * Reads `playbook.config.goals[]` and creates one Goal per entry.
 * Safe to call multiple times — skips if goals already exist for the playbook.
 */
export async function instantiatePlaybookGoals(
  callerId: string,
  domainId: string,
): Promise<string[]> {
  const playbook = await prisma.playbook.findFirst({
    where: { domainId, status: "PUBLISHED" },
    select: { id: true, config: true },
  });

  if (!playbook?.config) return [];

  const pbConfig = playbook.config as PlaybookConfig;
  const goalConfigs = pbConfig.goals || [];
  if (goalConfigs.length === 0) return [];

  // Skip if caller already has goals for this playbook (idempotent)
  const existing = await prisma.goal.count({
    where: { callerId, playbookId: playbook.id, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (existing > 0) return [];

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
        playbookId: playbook.id,
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
