import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { PARAMS } from "@/lib/registry";
import { config } from "@/lib/config";
import type { SpecConfig } from "@/lib/types/json-fields";

/**
 * @api GET /api/onboarding
 * @visibility internal
 * @auth session
 * @tags onboarding
 * @description Fetch onboarding spec data for visualization. Returns persona-specific config including default targets, first-call flow, and welcome templates.
 * @query persona string - Persona slug to load config for (e.g., "tutor", "companion", "coach")
 * @response 200 { ok: true, source: "database" | "hardcoded", spec: object, availablePersonas: string[], personasList: Array, personaDescription: string, personaIcon: string, personaColor: string, firstCallFlow: object, welcomeTemplate: string, welcomeSlug: string }
 * @response 500 { ok: false, error: string }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const personaSlug = searchParams.get("persona");

    // Get onboarding spec slug from config (env-configurable, default: INIT-001)
    const onboardingSlug = config.specs.onboarding.toLowerCase();

    // Find onboarding spec
    const spec = await prisma.analysisSpec.findFirst({
      where: {
        OR: [
          { slug: { contains: onboardingSlug.toLowerCase(), mode: "insensitive" } },
          { slug: { contains: "onboarding" } },
          { domain: "onboarding" },
        ],
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        config: true,
        updatedAt: true,
      },
    });

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "INIT-001 onboarding spec not found. Import it via /x/admin/spec-sync." },
        { status: 404 }
      );
    }

    const specConfig = spec.config as SpecConfig || {};
    const personas = specConfig.personas || {};
    const defaultPersona = personas.defaultPersona || "tutor";

    // Get available persona keys (excluding metadata keys)
    const availablePersonaKeys = Object.keys(personas).filter(k => !k.startsWith("_") && k !== "defaultPersona");
    const selectedPersona = personaSlug && availablePersonaKeys.includes(personaSlug) ? personaSlug : defaultPersona;
    const personaConfig = personas[selectedPersona] || {};

    // Build personas list with display properties for tabs
    const personasList = availablePersonaKeys.map(slug => {
      const pc = personas[slug] || {};
      return {
        slug,
        name: pc.name || slug,
        description: pc.description || null,
        icon: pc.icon || "🎭",
        color: pc.color || { bg: "#e5e7eb", border: "#6b7280", text: "#374151" },
      };
    });

    // Extract system defaults from parameters
    const defaultTargetsParam = specConfig.parameters?.find((p: any) => p.id === "default_targets_quality");
    const welcomeParam = specConfig.parameters?.find((p: any) => p.id === "welcome_quality");
    const systemDefaultTargets = defaultTargetsParam?.config?.defaultTargets || specConfig.defaultTargets || {};
    const systemWelcomeTemplates = welcomeParam?.config?.welcomeTemplates || specConfig.welcomeTemplates || {};

    // Merge system defaults with persona-specific overrides
    const mergedTargets = {
      ...systemDefaultTargets,
      ...(personaConfig.defaultTargets || {}),
    };

    // Get persona-specific flow or fall back to system default
    const personaFlow = personaConfig.firstCallFlow || specConfig.firstCallFlow || {};

    return NextResponse.json({
      ok: true,
      source: "database",
      spec: {
        id: spec.id,
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        updatedAt: spec.updatedAt,
      },
      // Persona info
      selectedPersona,
      availablePersonas: availablePersonaKeys,
      personasList, // Full list with icons and colors for tabs
      personaName: personaConfig.name || selectedPersona,
      personaDescription: personaConfig.description || null,
      personaIcon: personaConfig.icon || "🎭",
      personaColor: personaConfig.color || { bg: "#e5e7eb", border: "#6b7280", text: "#374151" },
      // Persona-specific data (merged with system defaults)
      defaultTargets: mergedTargets,
      firstCallFlow: personaFlow,
      welcomeTemplate: personaConfig.welcomeTemplate || systemWelcomeTemplates[selectedPersona] || "",
      welcomeSlug: personaConfig.welcomeSlug || null,
      // All welcome templates (for reference)
      welcomeTemplates: systemWelcomeTemplates,
      // Full persona config for editing
      personaConfig: personaConfig,
      // System-level parameters for detailed view
      parameters: specConfig.parameters || [],
    });
  } catch (error: any) {
    console.error("Error fetching onboarding spec:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch onboarding spec" },
      { status: 500 }
    );
  }
}
