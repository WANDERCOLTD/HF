import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/playbooks/:playbookId/compile-targets
 * @visibility internal
 * @scope playbooks:write
 * @auth session
 * @tags playbooks
 * @description Compiles the playbook's behavior targets by scanning all enabled specs,
 *   finding adjustable BEHAVIOR parameters, and creating PLAYBOOK-scope BehaviorTarget
 *   rows initialized to SYSTEM defaults. Prepares the Targets tab for editing.
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, message: "...", compiled: number, skipped: number, total: number, parameters: [...] }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    // Get playbook with its specs
    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        items: {
          where: { itemType: "SPEC", isEnabled: true },
          include: {
            spec: {
              select: {
                id: true,
                slug: true,
                config: true,
                triggers: {
                  include: {
                    actions: {
                      where: { parameterId: { not: null } },
                      include: {
                        parameter: {
                          select: {
                            id: true,
                            parameterId: true,
                            name: true,
                            parameterType: true,
                            isAdjustable: true,
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
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    // Extract unique adjustable parameters from playbook specs
    // Parameters can be referenced two ways:
    // 1. Via triggers/actions (spec.triggers[].actions[].parameterId)
    // 2. Via config.parameterId (MVP specs store parameter directly in config)
    const adjustableParams = new Map<string, { parameterId: string; name: string }>();
    const configParamIds: string[] = [];

    for (const item of playbook.items) {
      if (!item.spec) continue;

      // Method 1: Check triggers/actions
      for (const trigger of item.spec.triggers) {
        for (const action of trigger.actions) {
          if (action.parameter?.isAdjustable) {
            adjustableParams.set(action.parameter.parameterId, {
              parameterId: action.parameter.parameterId,
              name: action.parameter.name,
            });
          }
        }
      }

      // Method 2: Check config.parameterId (MVP specs)
      const config = item.spec.config as Record<string, any> | null;
      if (config?.parameterId && typeof config.parameterId === "string") {
        configParamIds.push(config.parameterId);
      }
    }

    // Fetch parameters referenced in config that we haven't found yet
    if (configParamIds.length > 0) {
      const configParams = await prisma.parameter.findMany({
        where: {
          parameterId: { in: configParamIds },
          isAdjustable: true,
        },
        select: {
          parameterId: true,
          name: true,
        },
      });
      for (const param of configParams) {
        if (!adjustableParams.has(param.parameterId)) {
          adjustableParams.set(param.parameterId, {
            parameterId: param.parameterId,
            name: param.name,
          });
        }
      }
    }

    if (adjustableParams.size === 0) {
      return NextResponse.json({
        ok: true,
        message: "No adjustable parameters found in playbook specs",
        compiled: 0,
        skipped: 0,
        total: 0,
      });
    }

    // Get existing PLAYBOOK-scope targets for this playbook
    const existingTargets = await prisma.behaviorTarget.findMany({
      where: {
        playbookId,
        scope: "PLAYBOOK",
        effectiveUntil: null,
      },
      select: { parameterId: true },
    });
    const existingParamIds = new Set(existingTargets.map((t) => t.parameterId));

    // Get SYSTEM-level targets for these parameters (to initialize values)
    const systemTargets = await prisma.behaviorTarget.findMany({
      where: {
        scope: "SYSTEM",
        parameterId: { in: Array.from(adjustableParams.keys()) },
        effectiveUntil: null,
      },
    });
    const systemTargetMap = new Map(systemTargets.map((t) => [t.parameterId, t.targetValue]));

    // Create missing PLAYBOOK-scope targets
    const toCreate: { parameterId: string; name: string; systemValue: number }[] = [];
    for (const [parameterId, param] of adjustableParams) {
      if (!existingParamIds.has(parameterId)) {
        toCreate.push({
          parameterId,
          name: param.name,
          systemValue: systemTargetMap.get(parameterId) ?? 0.5,
        });
      }
    }

    // Batch create
    let created = 0;
    for (const item of toCreate) {
      await prisma.behaviorTarget.create({
        data: {
          parameterId: item.parameterId,
          playbookId,
          scope: "PLAYBOOK",
          targetValue: item.systemValue, // Initialize to system value
          confidence: 1.0,
          source: "SEED",
        },
      });
      created++;
    }

    // Update playbook timestamp
    await prisma.playbook.update({
      where: { id: playbookId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      message: `Compiled ${created} new targets (${existingParamIds.size} already existed)`,
      compiled: created,
      skipped: existingParamIds.size,
      total: adjustableParams.size,
      parameters: Array.from(adjustableParams.values()),
    });
  } catch (error: any) {
    console.error("Error compiling playbook targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to compile playbook targets" },
      { status: 500 }
    );
  }
}
