import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const runtime = "nodejs";

interface ReadinessCheck {
  ok: boolean;
  message: string;
  count?: number;
  required?: number;
  link?: string;
}

interface SourceStatus {
  status: "green" | "amber" | "red";
  count: number;
  label: string;
  link: string;
}

interface SuggestedAction {
  priority: number;
  action: string;
  description: string;
  link?: string;
  opid?: string;
}

/**
 * @api GET /api/system/readiness
 * @visibility public
 * @scope system:readiness
 * @auth none
 * @tags system
 * @description Returns comprehensive system readiness status for the analyze workflow. Checks prerequisites (specs, parameters, run configs), data sources (callers, calls, transcripts), and suggests next actions.
 * @response 200 { ok: true, ready: boolean, checks: {...}, sources: {...}, suggestedActions: [...], stats: {...}, timestamp: "ISO8601" }
 * @response 500 { ok: false, ready: false, error: "...", checks: { database: { ok: false, message: "..." } } }
 */
export async function GET() {
  try {
    // Run all checks in parallel
    const [
      analysisSpecCount,
      publishedSpecCount,
      parameterCount,
      callerCount,
      callCount,
      knowledgeDocCount,
      transcriptCount,
      behaviorTargetCount,
      memoryCount,
    ] = await Promise.all([
      prisma.analysisSpec.count(),
      prisma.analysisSpec.count({ where: { isActive: true, compiledAt: { not: null } } }),
      prisma.parameter.count(),
      prisma.caller.count(),
      prisma.call.count(),
      prisma.knowledgeDoc.count(),
      prisma.processedFile.count(),
      prisma.behaviorTarget.count(),
      prisma.callerMemory.count(),
    ]);
    // Run configs = compiled specs (CompiledAnalysisSet was removed from schema)
    const runConfigCount = publishedSpecCount;

    // Build readiness checks
    const checks: Record<string, ReadinessCheck> = {
      database: {
        ok: true,
        message: "Connected",
      },
      analysisSpecs: {
        ok: publishedSpecCount > 0,
        message: publishedSpecCount > 0
          ? `${publishedSpecCount} active specs (${analysisSpecCount} total)`
          : "No published analysis specs",
        count: publishedSpecCount,
        required: 1,
        link: "/analysis-specs",
      },
      parameters: {
        ok: parameterCount > 0,
        message: parameterCount > 0 ? `${parameterCount} parameters defined` : "No parameters defined",
        count: parameterCount,
        link: "/admin",
      },
      runConfigs: {
        ok: runConfigCount > 0,
        message: runConfigCount > 0 ? `${runConfigCount} ready configs` : "No run configs compiled",
        count: runConfigCount,
        link: "/run-configs",
      },
      callers: {
        ok: callerCount > 0,
        message: callerCount > 0 ? `${callerCount} callers` : "No callers - process transcripts first",
        count: callerCount,
        link: "/callers",
      },
      calls: {
        ok: callCount > 0,
        message: callCount > 0 ? `${callCount} calls available` : "No calls - process transcripts first",
        count: callCount,
        link: "/calls",
      },
      behaviorTargets: {
        ok: behaviorTargetCount > 0,
        message: behaviorTargetCount > 0
          ? `${behaviorTargetCount} behavior targets`
          : "No behavior targets - needed for prompt composition",
        count: behaviorTargetCount,
        link: "/control-sets",
      },
    };

    // Build source status
    const sources: Record<string, SourceStatus> = {
      knowledge: {
        status: knowledgeDocCount > 0 ? "green" : "red",
        count: knowledgeDocCount,
        label: "Knowledge Docs",
        link: "/knowledge-docs",
      },
      transcripts: {
        status: transcriptCount > 0 ? "green" : callCount > 0 ? "amber" : "red",
        count: transcriptCount,
        label: "Processed Files",
        link: "/transcripts",
      },
      callers: {
        status: callerCount > 0 ? "green" : "red",
        count: callerCount,
        label: "Callers",
        link: "/callers",
      },
    };

    // Build suggested actions (priority 1 = most important)
    const suggestedActions: SuggestedAction[] = [];

    if (!checks.analysisSpecs.ok) {
      suggestedActions.push({
        priority: 1,
        action: "Create Analysis Specs",
        description: "Define how to measure personality traits and extract memories",
        link: "/analysis-specs",
      });
    }

    if (!checks.runConfigs.ok && checks.analysisSpecs.ok) {
      suggestedActions.push({
        priority: 2,
        action: "Create Run Config",
        description: "Bundle specs into a reusable analysis configuration",
        link: "/run-configs",
      });
    }

    if (!checks.calls.ok) {
      suggestedActions.push({
        priority: 3,
        action: "Process Transcripts",
        description: "Import call transcripts to create caller records",
        link: "/ops",
        opid: "transcripts:process",
      });
    }

    if (checks.calls.ok && memoryCount === 0) {
      suggestedActions.push({
        priority: 4,
        action: "Run Analysis",
        description: `Analyze ${callCount} calls to extract scores and memories`,
        link: "/analyze",
      });
    }

    if (!checks.behaviorTargets.ok && memoryCount > 0) {
      suggestedActions.push({
        priority: 5,
        action: "Set Behavior Targets",
        description: "Define target behaviors for prompt composition",
        link: "/control-sets",
      });
    }

    // Calculate overall readiness
    const criticalChecks = ["analysisSpecs", "runConfigs"];
    const ready = criticalChecks.every((key) => checks[key].ok);

    // Stats for display
    const stats = {
      totalCallers: callerCount,
      totalCalls: callCount,
      totalMemories: memoryCount,
      analyzedCalls: await prisma.call.count({ where: { scores: { some: {} } } }),
      callersWithPrompts: await prisma.callerIdentity.count({ where: { nextPrompt: { not: null } } }),
    };

    return NextResponse.json({
      ok: true,
      ready,
      checks,
      sources,
      suggestedActions: suggestedActions.sort((a, b) => a.priority - b.priority),
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[System Readiness Error]:", error);
    return NextResponse.json(
      {
        ok: false,
        ready: false,
        error: error?.message || "Failed to check system readiness",
        checks: {
          database: {
            ok: false,
            message: error?.message || "Connection failed",
          },
        },
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
