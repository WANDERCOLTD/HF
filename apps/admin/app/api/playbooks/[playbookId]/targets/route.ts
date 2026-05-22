import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { writeBehaviorTargets } from "@/lib/agent-tuner/write-target";

/**
 * @api GET /api/playbooks/:playbookId/targets
 * @visibility internal
 * @scope playbooks:read
 * @auth session
 * @tags playbooks
 * @description Returns all adjustable BEHAVIOR parameters with their cascade of targets
 *   (system base layer, playbook overrides). Behavior dimensions exist globally and
 *   every playbook can configure targets for any BEHAVIOR parameter.
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, playbookId, playbookName, playbookStatus, parameters: [...], counts: { total, withPlaybookOverride, withSystemDefault } }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    // Get playbook with its targets
    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        domain: { select: { id: true, slug: true, name: true } },
        behaviorTargets: {
          where: { scope: "PLAYBOOK", effectiveUntil: null },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    // Get ALL adjustable BEHAVIOR parameters (not just from specs)
    const allBehaviorParams = await prisma.parameter.findMany({
      where: {
        parameterType: "BEHAVIOR",
        isAdjustable: true,
      },
      select: {
        id: true,
        parameterId: true,
        name: true,
        definition: true,
        domainGroup: true,
        interpretationHigh: true,
        interpretationLow: true,
      },
      orderBy: [
        { domainGroup: "asc" },
        { name: "asc" },
      ],
    });

    // Get SYSTEM-level targets for all behavior parameters
    const systemTargets = await prisma.behaviorTarget.findMany({
      where: {
        scope: "SYSTEM",
        parameterId: { in: allBehaviorParams.map(p => p.parameterId) },
        effectiveUntil: null,
      },
    });

    // Build target lookup maps
    const systemTargetMap = new Map(systemTargets.map(t => [t.parameterId, t]));
    const playbookTargetMap = new Map(playbook.behaviorTargets.map(t => [t.parameterId, t]));

    // Build response with cascade - all behavior parameters
    const parameters = allBehaviorParams.map(param => {
      const systemTarget = systemTargetMap.get(param.parameterId);
      const playbookTarget = playbookTargetMap.get(param.parameterId);

      // Effective = playbook overrides system
      const effectiveValue = playbookTarget?.targetValue ?? systemTarget?.targetValue ?? 0.5;
      const effectiveScope = playbookTarget ? "PLAYBOOK" : (systemTarget ? "SYSTEM" : "DEFAULT");

      return {
        parameterId: param.parameterId,
        name: param.name,
        definition: param.definition,
        domainGroup: param.domainGroup,
        interpretationHigh: param.interpretationHigh ?? null,
        interpretationLow: param.interpretationLow ?? null,

        // Cascade values
        systemValue: systemTarget?.targetValue ?? null,
        systemSource: systemTarget?.source ?? null,

        playbookValue: playbookTarget?.targetValue ?? null,
        playbookTargetId: playbookTarget?.id ?? null,

        // Computed effective
        effectiveValue,
        effectiveScope,
      };
    });

    return NextResponse.json({
      ok: true,
      playbookId,
      playbookName: playbook.name,
      playbookStatus: playbook.status,
      parameters,
      counts: {
        total: parameters.length,
        withPlaybookOverride: parameters.filter(p => p.playbookValue !== null).length,
        withSystemDefault: parameters.filter(p => p.systemValue !== null).length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching playbook targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch playbook targets" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/playbooks/:playbookId/targets
 * @visibility internal
 * @scope playbooks:write
 * @auth session
 * @tags playbooks
 * @description Update playbook-level behavior targets. Set targetValue to null to remove
 *   the playbook override and fall back to system defaults. PLAYBOOK-scope targets are an
 *   operational overlay applied at composition time — edits are safe on PUBLISHED playbooks
 *   because targets are read live (not snapshot per call). Each parameterId is validated
 *   against the adjustable BEHAVIOR parameter catalogue before write.
 * @pathParam playbookId string - Playbook UUID
 * @body targets Array<{ parameterId: string, targetValue: number | null }> - Target updates
 * @response 200 { ok: true, results: [...], rejected: [...], message: "Updated N targets" }
 * @response 400 { ok: false, error: "targets must be an array" }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;
    const body = await request.json();
    const { targets } = body;

    if (!Array.isArray(targets)) {
      return NextResponse.json(
        { ok: false, error: "targets must be an array" },
        { status: 400 }
      );
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { id: true },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    const writeResults = await writeBehaviorTargets(
      playbookId,
      targets.filter(
        (t): t is { parameterId: string; targetValue: number | null } =>
          typeof t?.parameterId === "string" &&
          (t.targetValue === null || typeof t.targetValue === "number"),
      ),
    );

    const results: Array<{ parameterId: string; action: string; value?: number }> = [];
    const rejected: Array<{ parameterId: string; reason: string }> = [];
    for (const r of writeResults) {
      if (r.ok) {
        if (r.action === "noop") continue;
        results.push({
          parameterId: r.parameterId,
          action: r.action,
          ...(r.value !== null ? { value: r.value } : {}),
        });
      } else {
        rejected.push({
          parameterId: r.parameterId,
          reason:
            r.reason === "parameter_not_adjustable"
              ? "not an adjustable BEHAVIOR parameter"
              : r.reason,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      rejected,
      message: `Updated ${results.length} targets${rejected.length > 0 ? `, rejected ${rejected.length}` : ""}`,
    });
  } catch (error: any) {
    console.error("Error updating playbook targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update playbook targets" },
      { status: 500 }
    );
  }
}
