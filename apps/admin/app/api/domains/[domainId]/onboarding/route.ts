import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  AGENT_TUNING_DEFAULTS,
  deriveParametersFromMatrices,
} from "@/lib/domain/agent-tuning";

/**
 * @api GET /api/domains/:domainId/onboarding
 * @visibility internal
 * @auth session
 * @tags domains, onboarding
 * @description Get domain onboarding configuration including welcome message, identity spec, flow phases, and default targets
 * @pathParam domainId string - The domain ID
 * @response 200 { ok: true, domain: object, identitySpecs: Array<{ id, slug, name, description }> }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        onboardingWelcome: true,
        onboardingIdentitySpecId: true,
        onboardingFlowPhases: true,
        onboardingDefaultTargets: true,
        onboardingIdentitySpec: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // Get available identity specs for dropdown
    const identitySpecs = await prisma.analysisSpec.findMany({
      where: {
        specRole: "IDENTITY",
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
      },
      orderBy: { name: "asc" },
    });

    // Extract examConfig from onboardingDefaultTargets for convenience
    const targets = (domain.onboardingDefaultTargets as Record<string, any>) || {};
    const examConfig = targets.examConfig || { enabled: false };

    return NextResponse.json({
      ok: true,
      domain,
      identitySpecs,
      examConfig,
    });
  } catch (error: any) {
    console.error("Error fetching domain onboarding:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch domain onboarding" },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/domains/:domainId/onboarding
 * @visibility internal
 * @auth session
 * @tags domains, onboarding
 * @description Update domain onboarding configuration (welcome message, identity spec, flow phases, default targets)
 * @pathParam domainId string - The domain ID
 * @body onboardingWelcome string - Welcome message text
 * @body onboardingIdentitySpecId string - Identity spec ID for onboarding
 * @body onboardingFlowPhases object - Phase configuration for onboarding flow
 * @body onboardingDefaultTargets object - Default behavior targets for new callers
 * @response 200 { ok: true, domain: object }
 * @response 400 { ok: false, error: "Identity spec not found" | "Spec must have specRole=IDENTITY" }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: string }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const body = await req.json();

    const {
      onboardingWelcome,
      onboardingIdentitySpecId,
      onboardingFlowPhases,
      onboardingDefaultTargets,
    } = body;

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, slug: true },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // If identitySpecId provided, verify it exists
    if (onboardingIdentitySpecId) {
      const spec = await prisma.analysisSpec.findUnique({
        where: { id: onboardingIdentitySpecId },
        select: { id: true, specRole: true },
      });

      if (!spec) {
        return NextResponse.json(
          { ok: false, error: "Identity spec not found" },
          { status: 400 }
        );
      }

      if (spec.specRole !== "IDENTITY") {
        return NextResponse.json(
          { ok: false, error: "Spec must have specRole=IDENTITY" },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: {
      onboardingWelcome?: string | null;
      onboardingIdentitySpecId?: string | null;
      onboardingFlowPhases?: any;
      onboardingDefaultTargets?: any;
    } = {};

    if (onboardingWelcome !== undefined) updateData.onboardingWelcome = onboardingWelcome;
    if (onboardingIdentitySpecId !== undefined) updateData.onboardingIdentitySpecId = onboardingIdentitySpecId;
    if (onboardingFlowPhases !== undefined) updateData.onboardingFlowPhases = onboardingFlowPhases;

    // Convert personality presets to numeric BEH-* targets if present
    if (onboardingDefaultTargets !== undefined) {
      const { communicationPreset, teachingPreset, ...rest } = onboardingDefaultTargets || {};
      if (communicationPreset || teachingPreset) {
        // Look up preset positions from matrix definitions
        const positions: Record<string, { x: number; y: number }> = {};
        for (const matrix of AGENT_TUNING_DEFAULTS.matrices) {
          const presetId = matrix.id === "communication-style" ? communicationPreset : teachingPreset;
          if (presetId) {
            const preset = matrix.presets.find((p) => p.id === presetId);
            if (preset) positions[matrix.id] = { x: preset.x, y: preset.y };
          }
        }
        // Derive numeric BEH-* values from positions
        const derived = deriveParametersFromMatrices(AGENT_TUNING_DEFAULTS, positions);
        const numericTargets: Record<string, { value: number; confidence: number }> = {};
        for (const [paramId, dp] of Object.entries(derived)) {
          numericTargets[paramId] = { value: dp.value, confidence: dp.confidence };
        }
        // Merge: numeric BEH-* targets + metadata (prefixed with _) + any existing non-preset fields
        updateData.onboardingDefaultTargets = {
          ...rest,
          ...numericTargets,
          _communicationPreset: communicationPreset,
          _teachingPreset: teachingPreset,
          _matrixPositions: positions,
        };
      } else {
        updateData.onboardingDefaultTargets = onboardingDefaultTargets;
      }
    }

    // Update domain
    const updatedDomain = await prisma.domain.update({
      where: { id: domainId },
      data: updateData,
      select: {
        id: true,
        slug: true,
        name: true,
        onboardingWelcome: true,
        onboardingIdentitySpecId: true,
        onboardingFlowPhases: true,
        onboardingDefaultTargets: true,
        onboardingIdentitySpec: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    console.log(`[domain-onboarding-api] Updated onboarding config for domain ${domain.slug}`);

    return NextResponse.json({
      ok: true,
      domain: updatedDomain,
    });
  } catch (error: any) {
    console.error("Error updating domain onboarding:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update domain onboarding" },
      { status: 500 }
    );
  }
}
