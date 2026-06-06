/**
 * Pipeline Runs API
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";
import { parsePagination } from "@/lib/api-utils";

interface CompositionInputs {
  callerContext?: any;
  memoriesCount?: number;
  personalityAvailable?: boolean;
  recentCallsCount?: number;
  behaviorTargetsCount?: number;
  playbooksUsed?: string[];
  playbooksCount?: number;
  identitySpec?: string | null;
  contentSpec?: string | null;
  specUsed?: string;
  specConfig?: any;
  composition?: {
    sectionsActivated?: string[];
    sectionsSkipped?: string[];
    loadTimeMs?: number;
    transformTimeMs?: number;
  };
}

/**
 * @api GET /api/pipeline/runs
 * @visibility public
 * @scope pipeline:read
 * @auth session
 * @tags pipeline
 * @description List pipeline runs derived from ComposedPrompt records. Each run includes
 *   steps (load data, compose prompt), timing information, and input context (memories,
 *   personality, behavior targets).
 * @query callerId string - Filter runs by caller ID
 * @query limit number - Max results (default 20)
 * @query offset number - Pagination offset (default 0)
 * @response 200 { ok: true, runs: PipelineRun[], total: number, limit: number, offset: number }
 * @response 500 { ok: false, error: "Failed to fetch pipeline runs" }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const searchParams = request.nextUrl.searchParams;

  const requestedCallerId = searchParams.get("callerId");
  // B7 — STUDENT sessions are locked to their own LEARNER caller; OPERATOR+
  // passes the requested id through (null = no filter, admin browsing).
  const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
  if (isScopeError(scope)) return scope.error;
  const callerId = scope.scopedCallerId;
  const { limit, offset } = parsePagination(searchParams, { defaultLimit: 20 });

  try {
    const where = {
      ...(callerId && { callerId }),
    };

    const [prompts, total] = await Promise.all([
      prisma.composedPrompt.findMany({
        where,
        orderBy: { composedAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          callerId: true,
          prompt: true,
          llmPrompt: true,
          triggerType: true,
          composedAt: true,
          model: true,
          status: true,
          inputs: true,
          caller: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.composedPrompt.count({ where }),
    ]);

    // Transform ComposedPrompt records into "runs" format
    const runs = prompts.map((prompt) => {
      const inputs = (prompt.inputs as CompositionInputs) || {};
      const composition = inputs.composition || {};
      const sectionsActivated = composition.sectionsActivated || [];
      const sectionsSkipped = composition.sectionsSkipped || [];
      const loadTimeMs = composition.loadTimeMs || 0;
      const transformTimeMs = composition.transformTimeMs || 0;
      const totalDuration = loadTimeMs + transformTimeMs;

      // Build "steps" from sections
      const steps = [
        // Load step
        {
          id: `${prompt.id}-load`,
          operation: "data:load",
          label: "Load Data",
          status: "SUCCESS",
          durationMs: loadTimeMs,
          specSlug: null,
          outputCounts: {
            memories: inputs.memoriesCount || 0,
            recentCalls: inputs.recentCallsCount || 0,
            behaviorTargets: inputs.behaviorTargetsCount || 0,
            playbooks: inputs.playbooksCount || 0,
          },
          error: null,
          sectionsActivated: [],
          sectionsSkipped: [],
          inputs: {
            callerId: prompt.callerId,
            identitySpec: inputs.identitySpec,
            contentSpec: inputs.contentSpec,
          },
          outputs: {
            memoriesCount: inputs.memoriesCount || 0,
            recentCallsCount: inputs.recentCallsCount || 0,
            behaviorTargetsCount: inputs.behaviorTargetsCount || 0,
            playbooksCount: inputs.playbooksCount || 0,
            playbooksUsed: inputs.playbooksUsed || [],
            personalityAvailable: inputs.personalityAvailable || false,
          },
        },
        // Compose step
        {
          id: `${prompt.id}-compose`,
          operation: "prompt:compose",
          label: "Compose Prompt",
          status: "SUCCESS",
          durationMs: transformTimeMs,
          specSlug: inputs.specUsed || null,
          outputCounts: {
            sections: sectionsActivated.length,
          },
          error: null,
          sectionsActivated,
          sectionsSkipped,
          inputs: {
            specUsed: inputs.specUsed || null,
            specConfig: inputs.specConfig || null,
          },
          outputs: {
            sectionsActivated,
            sectionsSkipped,
            promptLength: prompt.prompt?.length || 0,
            // Include actual llmPrompt data for inspection
            llmPrompt: prompt.llmPrompt || null,
          },
          sectionTimings: null, // Could be added if we track per-section timing
        },
      ];

      return {
        id: prompt.id,
        phase: "ADAPT" as const,
        callerId: prompt.callerId,
        callId: null,
        triggeredBy: prompt.triggerType,
        status: "SUCCESS",
        startedAt: prompt.composedAt.toISOString(),
        finishedAt: prompt.composedAt.toISOString(),
        durationMs: totalDuration,
        stepsTotal: steps.length,
        stepsSucceeded: steps.length,
        stepsFailed: 0,
        stepsSkipped: 0,
        errorSummary: null,
        steps,
        // Extra metadata for display
        _caller: prompt.caller,
        _model: prompt.model,
        _status: prompt.status,
      };
    });

    return NextResponse.json({
      ok: true,
      runs,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch pipeline runs:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch pipeline runs" },
      { status: 500 }
    );
  }
}
