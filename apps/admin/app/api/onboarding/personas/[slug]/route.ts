import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import type { SpecConfig } from "@/lib/types/json-fields";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * @api GET /api/onboarding/personas/:slug
 * @visibility internal
 * @auth session
 * @tags onboarding
 * @description Get detailed onboarding configuration for a specific persona including welcome template, default targets, and first-call flow phases
 * @pathParam slug string - The persona slug (e.g., "tutor", "companion", "coach")
 * @response 200 { ok: true, specId: string, specSlug: string, persona: { slug, name, description, welcomeTemplate, defaultTargets, firstCallFlow, phaseSlugs } }
 * @response 404 { ok: false, error: "INIT-001 spec not found" | "Persona not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { slug: personaSlug } = await context.params;

    // Get onboarding spec slug (default: spec-init-001)
    const onboardingSlug = "spec-init-001";

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
        config: true,
        updatedAt: true,
      },
    });

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "INIT-001 spec not found. Run db:seed first." },
        { status: 404 }
      );
    }

    const specConfig = spec.config as SpecConfig || {};
    const personasConfig = specConfig.personas || {};
    const personaConfig = personasConfig[personaSlug];

    if (!personaConfig) {
      return NextResponse.json(
        { ok: false, error: `Persona '${personaSlug}' not found in onboarding spec` },
        { status: 404 }
      );
    }

    // Get system defaults for merging
    const defaultTargetsParam = specConfig.parameters?.find((p: any) => p.id === "BEH-DEFAULT-TARGETS-QUALITY");
    const systemDefaultTargets = defaultTargetsParam?.config?.defaultTargets || specConfig.defaultTargets || {};

    // Get associated prompt slugs
    const welcomeSlugRecord = personaConfig.welcomeSlug
      ? await prisma.promptSlug.findUnique({
          where: { slug: personaConfig.welcomeSlug },
          select: { id: true, slug: true, name: true, fallbackPrompt: true },
        })
      : null;

    // Get phase instruction slugs
    const phaseSlugs: Record<string, any> = {};
    if (personaConfig.firstCallFlow?.phases) {
      for (const phase of personaConfig.firstCallFlow.phases) {
        if (phase.instructionSlug) {
          const phaseSlugRecord = await prisma.promptSlug.findUnique({
            where: { slug: phase.instructionSlug },
            select: { id: true, slug: true, name: true, fallbackPrompt: true },
          });
          if (phaseSlugRecord) {
            phaseSlugs[phase.phase] = phaseSlugRecord;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      specId: spec.id,
      specSlug: spec.slug,
      updatedAt: spec.updatedAt,
      persona: {
        slug: personaSlug,
        name: personaConfig.name || personaSlug,
        description: personaConfig.description || null,
        welcomeTemplate: personaConfig.welcomeTemplate || null,
        welcomeSlug: personaConfig.welcomeSlug || null,
        welcomeSlugRecord,
        defaultTargets: personaConfig.defaultTargets || {},
        systemDefaultTargets, // For showing what's being overridden
        firstCallFlow: personaConfig.firstCallFlow || {},
        phaseSlugs,
      },
    });
  } catch (error: any) {
    console.error("Error fetching persona config:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch persona config" },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/onboarding/personas/:slug
 * @visibility internal
 * @auth session
 * @tags onboarding
 * @description Update onboarding configuration for a specific persona (welcome, targets, flow phases). Also updates associated PromptSlugs.
 * @pathParam slug string - The persona slug
 * @body name string - Updated persona name
 * @body description string - Updated description
 * @body welcomeTemplate string - Updated welcome message template
 * @body defaultTargets object - Updated default behavior targets
 * @body firstCallFlow object - Updated first-call flow configuration
 * @response 200 { ok: true, message: string, persona: object }
 * @response 404 { ok: false, error: "INIT-001 spec not found" | "Persona not found" }
 * @response 500 { ok: false, error: string }
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { slug: personaSlug } = await context.params;
    const body = await request.json();

    // Get onboarding spec slug (default: spec-init-001)
    const onboardingSlug = "spec-init-001";

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
        config: true,
      },
    });

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "INIT-001 spec not found. Run db:seed first." },
        { status: 404 }
      );
    }

    const specConfig = spec.config as SpecConfig || {};
    const personasConfig = specConfig.personas || {};

    if (!personasConfig[personaSlug]) {
      return NextResponse.json(
        { ok: false, error: `Persona '${personaSlug}' not found in onboarding spec` },
        { status: 404 }
      );
    }

    // Update the persona config
    const updatedPersonaConfig = {
      ...personasConfig[personaSlug],
    };

    // Apply updates from request body
    if (body.name !== undefined) updatedPersonaConfig.name = body.name;
    if (body.description !== undefined) updatedPersonaConfig.description = body.description;
    if (body.welcomeTemplate !== undefined) updatedPersonaConfig.welcomeTemplate = body.welcomeTemplate;
    if (body.defaultTargets !== undefined) updatedPersonaConfig.defaultTargets = body.defaultTargets;
    if (body.firstCallFlow !== undefined) updatedPersonaConfig.firstCallFlow = body.firstCallFlow;

    // Update the spec config
    const newConfig = {
      ...specConfig,
      personas: {
        ...personasConfig,
        [personaSlug]: updatedPersonaConfig,
      },
    };

    // Save to database
    await prisma.analysisSpec.update({
      where: { id: spec.id },
      data: {
        config: newConfig,
        updatedAt: new Date(),
      },
    });

    // If welcome template was updated, also update the PromptSlug
    if (body.welcomeTemplate !== undefined && updatedPersonaConfig.welcomeSlug) {
      await prisma.promptSlug.upsert({
        where: { slug: updatedPersonaConfig.welcomeSlug },
        update: {
          fallbackPrompt: body.welcomeTemplate,
          updatedAt: new Date(),
        },
        create: {
          slug: updatedPersonaConfig.welcomeSlug,
          name: `${updatedPersonaConfig.name || personaSlug} Welcome Message`,
          description: `First-call welcome message for ${personaSlug} persona`,
          sourceType: "COMPOSITE",
          fallbackPrompt: body.welcomeTemplate,
          priority: 100,
          isActive: true,
        },
      });
    }

    // If phase flow was updated, update the phase instruction slugs
    if (body.firstCallFlow?.phases) {
      for (const phase of body.firstCallFlow.phases) {
        if (phase.instructionSlug) {
          const instructionText = [
            `Phase: ${phase.phase.toUpperCase()} (${phase.duration})`,
            `Priority: ${phase.priority}`,
            "",
            "GOALS:",
            ...phase.goals.map((g: string) => `- ${g}`),
            "",
            "AVOID:",
            ...phase.avoid.map((a: string) => `- ${a}`),
          ].join("\n");

          await prisma.promptSlug.upsert({
            where: { slug: phase.instructionSlug },
            update: {
              fallbackPrompt: instructionText,
              updatedAt: new Date(),
            },
            create: {
              slug: phase.instructionSlug,
              name: `${phase.phase} Phase - ${updatedPersonaConfig.name || personaSlug}`,
              description: `Instructions for ${phase.phase} phase of first call for ${personaSlug} persona`,
              sourceType: "COMPOSITE",
              fallbackPrompt: instructionText,
              priority: 90,
              isActive: true,
            },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Persona '${personaSlug}' updated successfully`,
      persona: updatedPersonaConfig,
    });
  } catch (error: any) {
    console.error("Error updating persona config:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update persona config" },
      { status: 500 }
    );
  }
}
