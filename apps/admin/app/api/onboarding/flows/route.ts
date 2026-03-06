import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import type { SpecConfig } from "@/lib/types/json-fields";

/**
 * @api GET /api/onboarding/flows
 * @visibility internal
 * @auth session
 * @tags onboarding
 * @description Returns all flow definitions across all specs — persona first-call flows,
 * session pattern flows, and identity spec session pedagogy flows. Used by the Onboarding
 * Flows page for a unified view of all flow configurations.
 * @response 200 { ok: true, personaFlows: Array, patternFlows: Array, identityFlows: Array }
 * @response 500 { ok: false, error: string }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    // 1. Load INIT-001 spec for persona flows + pattern flows
    const onboardingSlug = config.specs.onboarding.toLowerCase();
    const initSpec = await prisma.analysisSpec.findFirst({
      where: {
        OR: [
          { slug: { contains: onboardingSlug, mode: "insensitive" } },
          { slug: { contains: "onboarding" } },
          { domain: "onboarding" },
        ],
        isActive: true,
      },
      select: { id: true, slug: true, config: true },
    });

    const initConfig = (initSpec?.config as SpecConfig) || {};
    const personas = initConfig.personas || {};
    const rawPatternFlows = initConfig.patternFlows || {};

    // Extract persona first-call flows (skip meta keys)
    const personaFlows = Object.keys(personas)
      .filter(k => !k.startsWith("_") && k !== "defaultPersona")
      .map(key => {
        const pc = personas[key] || {};
        return {
          key,
          name: pc.name || key,
          icon: pc.icon || null,
          color: pc.color || null,
          identitySpec: pc.identitySpec || null,
          welcomeTemplate: pc.welcomeTemplate || null,
          firstCallFlow: pc.firstCallFlow || null,
        };
      });

    // Extract pattern flows (skip description meta key)
    const patternFlows = Object.keys(rawPatternFlows)
      .filter(k => k !== "description")
      .map(key => ({
        key,
        phases: rawPatternFlows[key]?.phases || [],
      }));

    // Also include the generic (top-level) first call flow from INIT-001
    const genericFirstCallFlow = initConfig.firstCallFlow || null;

    // 2. Load all IDENTITY specs to find session_pedagogy flows
    const identitySpecs = await prisma.analysisSpec.findMany({
      where: { specRole: "IDENTITY", isActive: true },
      select: { id: true, slug: true, name: true, config: true },
      orderBy: { slug: "asc" },
    });

    const identityFlows = identitySpecs.map(spec => {
      const specCfg = (spec.config as SpecConfig) || {};
      const parameters = (specCfg.parameters || []) as Array<{ id: string; config?: Record<string, any> }>;
      const pedagogy = parameters.find(p => p.id === "session_pedagogy");
      const pedagogyConfig = pedagogy?.config || {};

      return {
        specSlug: spec.slug,
        name: spec.name,
        firstCallFlow: pedagogyConfig.firstCallFlow || null,
        returningCallFlow: pedagogyConfig.returningCallFlow || null,
      };
    });

    // 3. Load domains for "Edit at domain" links
    const domains = await prisma.domain.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      ok: true,
      personaFlows,
      patternFlows,
      genericFirstCallFlow,
      identityFlows,
      domains,
    });
  } catch (error: any) {
    console.error("Error fetching onboarding flows:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch onboarding flows" },
      { status: 500 }
    );
  }
}
