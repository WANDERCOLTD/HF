import { NextRequest, NextResponse } from "next/server";
import {
  composePromptsFromSpecs,
  TemplateContext,
} from "@/lib/prompt/PromptTemplateCompiler";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

export const runtime = "nodejs";

/**
 * @api POST /api/prompt/compose-from-specs
 * @visibility public
 * @scope prompts:compose
 * @auth session
 * @tags prompts
 * @description Spec-based prompt composition. Gathers all active AnalysisSpecs with
 *   promptTemplates and renders them with the provided context (parameter values,
 *   memories, etc.). Returns combined prompt text and per-spec breakdown.
 * @body callerId string - Fetch caller's parameter values and memories
 * @body callerIdentityId string - Fetch caller identity's latest values
 * @body parameterValues Record<string, number> - Override/provide parameter values
 * @body includeMemories boolean - Include caller memories in composition (default true)
 * @body domain string - Filter specs by domain
 * @body outputType string - Filter specs by output type (MEASURE, LEARN)
 * @response 200 { ok: true, prompt: string, prompts: [...], metadata: { totalSpecs, specsWithTemplates, promptsRendered, memoriesIncluded, composedAt, parameterValuesUsed } }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const {
      callerId,
      callerIdentityId,
      parameterValues: providedValues,
      includeMemories = true,
      domain,
      outputType,
    } = body;

    // Build the template context
    const context: TemplateContext = {
      callerId,
      parameterValues: providedValues || {},
    };

    // If callerId provided, fetch their latest parameter values
    if (callerId && !providedValues) {
      const callerProfile = await prisma.callerPersonalityProfile.findUnique({
        where: { callerId },
      });
      if (callerProfile?.parameterValues) {
        context.parameterValues = callerProfile.parameterValues as Record<string, number>;
      }
    }

    // If callerIdentityId provided, fetch caller identity's caller and their values
    if (callerIdentityId && !callerId) {
      const callerIdentity = await prisma.callerIdentity.findUnique({
        where: { id: callerIdentityId },
        include: {
          caller: {
            include: {
              personalityProfile: true,
            },
          },
        },
      });
      if (callerIdentity?.caller) {
        context.callerId = callerIdentity.caller.id;
        if (callerIdentity.caller.personalityProfile?.parameterValues) {
          context.parameterValues = callerIdentity.caller.personalityProfile.parameterValues as Record<
            string,
            number
          >;
        }
      }
    }

    // Fetch memories if needed
    if (includeMemories && context.callerId) {
      const memories = await prisma.callerMemory.findMany({
        where: {
          callerId: context.callerId,
          supersededById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ confidence: "desc" }, { extractedAt: "desc" }],
        take: 100,
      });

      context.memories = memories.map((m) => ({
        category: m.category,
        key: m.key,
        value: m.value,
        confidence: m.confidence,
        decayFactor: m.decayFactor,
      }));
    }

    // Compose prompts from specs
    const result = await composePromptsFromSpecs(context);

    // Optionally filter by domain or outputType
    let filteredPrompts = result.prompts;
    if (domain) {
      filteredPrompts = filteredPrompts.filter((p) => p.domain === domain);
    }
    if (outputType) {
      filteredPrompts = filteredPrompts.filter((p) => p.outputType === outputType);
    }

    // Build the combined prompt text
    const combinedPrompt = filteredPrompts.map((p) => p.renderedPrompt).join("\n\n");

    return NextResponse.json({
      ok: true,
      prompt: combinedPrompt,
      prompts: filteredPrompts,
      metadata: {
        totalSpecs: result.totalSpecs,
        specsWithTemplates: result.specsWithTemplates,
        promptsRendered: filteredPrompts.length,
        memoriesIncluded: result.memoriesIncluded,
        composedAt: result.composedAt,
        parameterValuesUsed: context.parameterValues,
      },
    });
  } catch (error: any) {
    console.error("Spec-based prompt compose error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to compose prompts" },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/prompt/compose-from-specs
 * @visibility public
 * @scope prompts:compose
 * @auth session
 * @tags prompts
 * @description Quick spec-based prompt composition for a caller by ID or identity ID.
 *   Returns combined prompt text with spec and memory counts.
 * @query callerId string - Caller UUID
 * @query callerIdentityId string - Caller identity UUID
 * @query domain string - Filter specs by domain
 * @query outputType string - Filter specs by output type (MEASURE, LEARN)
 * @response 200 { ok: true, prompt: string, promptCount: number, specCount: number, memoryCount: number }
 * @response 400 { ok: false, error: "Must provide callerId or callerIdentityId" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const callerId = searchParams.get("callerId");
    const callerIdentityId = searchParams.get("callerIdentityId");
    const domain = searchParams.get("domain");
    const outputType = searchParams.get("outputType") as "MEASURE" | "LEARN" | null;

    if (!callerId && !callerIdentityId) {
      return NextResponse.json(
        { ok: false, error: "Must provide callerId or callerIdentityId" },
        { status: 400 }
      );
    }

    // Build context
    const context: TemplateContext = {
      callerId: callerId || undefined,
      parameterValues: {},
    };

    // B7 — direct callerId branch: STUDENT can only read their own.
    if (callerId && !studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }

    // Fetch parameter values
    if (callerId) {
      const callerProfile = await prisma.callerPersonalityProfile.findUnique({
        where: { callerId },
      });
      if (callerProfile?.parameterValues) {
        context.parameterValues = callerProfile.parameterValues as Record<string, number>;
      }
    } else if (callerIdentityId) {
      const callerIdentity = await prisma.callerIdentity.findUnique({
        where: { id: callerIdentityId },
        include: {
          caller: {
            include: {
              personalityProfile: true,
            },
          },
        },
      });
      // B7 — indirect callerIdentityId branch: check the resolved Caller.id
      // after the lookup. STUDENT supplying a foreign identity is rejected.
      if (callerIdentity?.caller && !studentAllowedToReadCaller(authResult.session, callerIdentity.caller.id)) {
        return callerScopeMismatchResponse();
      }
      if (callerIdentity?.caller) {
        context.callerId = callerIdentity.caller.id;
        if (callerIdentity.caller.personalityProfile?.parameterValues) {
          context.parameterValues = callerIdentity.caller.personalityProfile.parameterValues as Record<
            string,
            number
          >;
        }
      }
    }

    // Fetch memories
    if (context.callerId) {
      const memories = await prisma.callerMemory.findMany({
        where: {
          callerId: context.callerId,
          supersededById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ confidence: "desc" }, { extractedAt: "desc" }],
        take: 50,
      });

      context.memories = memories.map((m) => ({
        category: m.category,
        key: m.key,
        value: m.value,
        confidence: m.confidence,
        decayFactor: m.decayFactor,
      }));
    }

    // Compose
    const result = await composePromptsFromSpecs(context);

    // Filter
    let filteredPrompts = result.prompts;
    if (domain) {
      filteredPrompts = filteredPrompts.filter((p) => p.domain === domain);
    }
    if (outputType) {
      filteredPrompts = filteredPrompts.filter((p) => p.outputType === outputType);
    }

    const combinedPrompt = filteredPrompts.map((p) => p.renderedPrompt).join("\n\n");

    return NextResponse.json({
      ok: true,
      prompt: combinedPrompt,
      promptCount: filteredPrompts.length,
      specCount: result.totalSpecs,
      memoryCount: result.memoriesIncluded,
    });
  } catch (error: any) {
    console.error("Spec-based prompt compose error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to compose prompts" },
      { status: 500 }
    );
  }
}
