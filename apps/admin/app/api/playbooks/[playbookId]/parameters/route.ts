import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/playbooks/:playbookId/parameters
 * @visibility public
 * @scope playbooks:read
 * @auth session
 * @tags playbooks
 * @description Returns all parameters used by specs in this playbook, organized by category
 *   (Personality, Cognitive, Behavior, Learning, Supervision, Session, Reward, Style, Other).
 *   Includes scoring anchors for each parameter.
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, playbook: { id, name, status }, categories: ParametersByCategory[], counts: { parameters, anchors, categories } }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */

type ScoringAnchorInfo = {
  id: string;
  score: number;
  example: string;
  rationale: string | null;
  positiveSignals: string[];
  negativeSignals: string[];
  isGold: boolean;
};

type ParameterInfo = {
  id: string;
  parameterId: string;
  name: string;
  definition: string | null;
  scaleType: string;
  parameterType: string;
  interpretationHigh: string | null;
  interpretationLow: string | null;
  sourceFeatureSet: { id: string; featureId: string; name: string; version: string } | null;
  scoringAnchors: ScoringAnchorInfo[];
  usedBySpecs: { specId: string; specSlug: string; specName: string }[];
};

type ParametersByCategory = {
  category: string;
  icon: string;
  description: string;
  parameters: ParameterInfo[];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    // Load playbook with all specs and their triggers/actions
    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        items: {
          where: { isEnabled: true, itemType: "SPEC" },
          include: {
            spec: {
              include: {
                triggers: {
                  include: {
                    actions: {
                      include: {
                        parameter: {
                          include: {
                            sourceFeatureSet: {
                              select: { id: true, featureId: true, name: true, version: true },
                            },
                            scoringAnchors: {
                              orderBy: { score: "asc" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // specs: removed - PlaybookSpec model doesn't exist
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    // Load all SYSTEM specs (implicitly included)
    const allSystemSpecs = await prisma.analysisSpec.findMany({
      where: { scope: "SYSTEM", isActive: true },
      include: {
        triggers: {
          include: {
            actions: {
              include: {
                parameter: {
                  include: {
                    sourceFeatureSet: {
                      select: { id: true, featureId: true, name: true, version: true },
                    },
                    scoringAnchors: {
                      orderBy: { score: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // TODO: System spec toggles not yet implemented - PlaybookSpec model doesn't exist
    // For now, include all system specs
    const enabledSystemSpecs = allSystemSpecs;

    // Combine all enabled specs
    const allEnabledSpecs = [
      ...enabledSystemSpecs,
      ...playbook.items.filter((i) => i.spec).map((i) => i.spec!),
    ];

    // Collect all parameters with their specs
    const parameterMap = new Map<string, ParameterInfo>();

    for (const spec of allEnabledSpecs) {
      for (const trigger of spec.triggers || []) {
        for (const action of trigger.actions || []) {
          if (action.parameter) {
            const param = action.parameter;
            const paramKey = param.parameterId;

            if (!parameterMap.has(paramKey)) {
              parameterMap.set(paramKey, {
                id: param.id,
                parameterId: param.parameterId,
                name: param.name,
                definition: param.definition,
                scaleType: param.scaleType,
                parameterType: param.parameterType,
                interpretationHigh: param.interpretationHigh,
                interpretationLow: param.interpretationLow,
                sourceFeatureSet: param.sourceFeatureSet || null,
                scoringAnchors: param.scoringAnchors.map((a) => ({
                  id: a.id,
                  score: a.score,
                  example: a.example,
                  rationale: a.rationale,
                  positiveSignals: a.positiveSignals as string[],
                  negativeSignals: a.negativeSignals as string[],
                  isGold: a.isGold,
                })),
                usedBySpecs: [],
              });
            }

            // Add spec reference if not already there
            const paramInfo = parameterMap.get(paramKey)!;
            if (!paramInfo.usedBySpecs.find((s) => s.specId === spec.id)) {
              paramInfo.usedBySpecs.push({
                specId: spec.id,
                specSlug: spec.slug,
                specName: spec.name,
              });
            }
          }
        }
      }
    }

    // Categorize parameters
    const categories: ParametersByCategory[] = [];
    const categorizedIds = new Set<string>();

    // Helper to mark parameter as categorized
    const markCategorized = (params: ParameterInfo[]) => {
      params.forEach(p => categorizedIds.add(p.parameterId));
    };

    // Personality parameters (PERS-*, B5-*)
    const persParams = Array.from(parameterMap.values()).filter((p) =>
      p.parameterId.startsWith("PERS-") || p.parameterId.startsWith("B5-")
    );
    if (persParams.length > 0) {
      markCategorized(persParams);
      categories.push({
        category: "Personality",
        icon: "🧠",
        description: "Big Five personality traits measured from conversation",
        parameters: persParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Cognitive parameters (CA-*, COG-*)
    const cogParams = Array.from(parameterMap.values()).filter(
      (p) => !categorizedIds.has(p.parameterId) &&
        (p.parameterId.startsWith("CA-") || p.parameterId.startsWith("COG-"))
    );
    if (cogParams.length > 0) {
      markCategorized(cogParams);
      categories.push({
        category: "Cognitive",
        icon: "💡",
        description: "Cognitive activation and engagement levels",
        parameters: cogParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Behavior parameters (BEH-*, TONE_*, CONV_*, communication_*, *_adaptation, *_level, formality_*, pacing_*)
    const behParams = Array.from(parameterMap.values()).filter((p) =>
      !categorizedIds.has(p.parameterId) && (
        p.parameterId.startsWith("BEH-") ||
        p.parameterId.startsWith("TONE_") ||
        p.parameterId.startsWith("CONV_") ||
        p.parameterId.startsWith("communication_") ||
        p.parameterId.startsWith("formality_") ||
        p.parameterId.startsWith("pacing_") ||
        p.parameterId.includes("_adaptation") ||
        p.parameterId.includes("_level") ||
        p.parameterId.includes("assertiveness") ||
        p.parameterId.includes("warmth") ||
        p.parameterId.includes("core_identity") ||
        p.parameterId.includes("empathy") ||
        p.parameterId.includes("directness") ||
        p.parameterId.includes("style")
      )
    );
    if (behParams.length > 0) {
      markCategorized(behParams);
      categories.push({
        category: "Behavior",
        icon: "🎯",
        description: "Agent behavior targets and adjustments",
        parameters: behParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Curriculum/Learning parameters (CURR-*, GOAL-*, LEARN-*, MEM_*, CP-*, COMP-*, chapter*, module_*, goal_*, case_*)
    const learnParams = Array.from(parameterMap.values()).filter(
      (p) =>
        !categorizedIds.has(p.parameterId) && (
          p.parameterId.startsWith("CURR-") ||
          p.parameterId.startsWith("GOAL-") ||
          p.parameterId.startsWith("LEARN-") ||
          p.parameterId.startsWith("MEM_") ||
          p.parameterId.startsWith("CP-") ||
          p.parameterId.startsWith("COMP-") ||
          p.parameterId.startsWith("chapter") ||
          p.parameterId.startsWith("book_") ||
          p.parameterId.startsWith("application_") ||
          p.parameterId.startsWith("assessment_") ||
          p.parameterId.startsWith("comprehension_") ||
          p.parameterId.startsWith("engagement_") ||
          p.parameterId.startsWith("concept_") ||
          p.parameterId.startsWith("core_argument") ||
          p.parameterId.startsWith("discussion_") ||
          p.parameterId.startsWith("module_") ||
          p.parameterId.startsWith("case_") ||
          p.parameterId.startsWith("opening_") ||
          p.parameterId.startsWith("prerequisite_") ||
          p.parameterId.startsWith("exploration_") ||
          p.parameterId.includes("goal_") ||
          p.parameterId.includes("curriculum") ||
          p.parameterId.includes("progress") ||
          p.parameterId.includes("_score") ||
          p.parameterId.includes("context_relevance") ||
          p.parameterId.includes("continuity") ||
          p.parameterId.includes("mastery")
        )
    );
    if (learnParams.length > 0) {
      markCategorized(learnParams);
      categories.push({
        category: "Learning",
        icon: "📚",
        description: "Curriculum progress and learning goals",
        parameters: learnParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Supervision parameters (SUPV-*, SAFETY-*, QUALITY-*, session_*, call_frequency*, crisis_*, error_*, critical_*)
    const supvParams = Array.from(parameterMap.values()).filter(
      (p) =>
        !categorizedIds.has(p.parameterId) && (
          p.parameterId.startsWith("SUPV-") ||
          p.parameterId.startsWith("SAFETY-") ||
          p.parameterId.startsWith("QUALITY-") ||
          p.parameterId.startsWith("session_") ||
          p.parameterId.startsWith("call_frequency") ||
          p.parameterId.startsWith("crisis_") ||
          p.parameterId.startsWith("error_") ||
          p.parameterId.startsWith("critical_")
        )
    );
    if (supvParams.length > 0) {
      markCategorized(supvParams);
      categories.push({
        category: "Supervision",
        icon: "👁️",
        description: "Agent quality and safety monitoring",
        parameters: supvParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Session parameters (SESSION-*)
    const sessionParams = Array.from(parameterMap.values()).filter((p) =>
      !categorizedIds.has(p.parameterId) && p.parameterId.startsWith("SESSION-")
    );
    if (sessionParams.length > 0) {
      markCategorized(sessionParams);
      categories.push({
        category: "Session",
        icon: "📅",
        description: "Session arc and planning parameters",
        parameters: sessionParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Reward parameters (REW-*, *_reward, composite_reward)
    const rewParams = Array.from(parameterMap.values()).filter((p) =>
      !categorizedIds.has(p.parameterId) && (
        p.parameterId.startsWith("REW-") ||
        p.parameterId.includes("_reward") ||
        p.parameterId.includes("BEH-COMPOSITE-REWARD")
      )
    );
    if (rewParams.length > 0) {
      markCategorized(rewParams);
      categories.push({
        category: "Reward",
        icon: "⭐",
        description: "Reward signal computation",
        parameters: rewParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Style parameters (STYLE-*)
    const styleParams = Array.from(parameterMap.values()).filter((p) =>
      !categorizedIds.has(p.parameterId) && p.parameterId.startsWith("STYLE-")
    );
    if (styleParams.length > 0) {
      markCategorized(styleParams);
      categories.push({
        category: "Style",
        icon: "🎨",
        description: "Conversation style measurements",
        parameters: styleParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Other parameters (everything else)
    const otherParams = Array.from(parameterMap.values()).filter(
      (p) => !categorizedIds.has(p.parameterId)
    );
    if (otherParams.length > 0) {
      categories.push({
        category: "Other",
        icon: "📋",
        description: "Other parameters",
        parameters: otherParams.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Count totals
    const totalParameters = parameterMap.size;
    const totalAnchors = Array.from(parameterMap.values()).reduce(
      (sum, p) => sum + p.scoringAnchors.length,
      0
    );

    return NextResponse.json({
      ok: true,
      playbook: {
        id: playbook.id,
        name: playbook.name,
        status: playbook.status,
      },
      categories,
      counts: {
        parameters: totalParameters,
        anchors: totalAnchors,
        categories: categories.length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching playbook parameters:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch playbook parameters" },
      { status: 500 }
    );
  }
}
