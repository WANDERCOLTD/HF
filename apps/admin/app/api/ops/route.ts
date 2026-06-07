import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { processTranscripts } from "../../../lib/ops/transcripts-process";
import { ingestKnowledge } from "../../../lib/ops/knowledge-ingest";
import { extractKbLinks } from "../../../lib/ops/kb-links-extract";
import { analyzePersonality } from "../../../lib/ops/personality-analyze";
import { extractMemories } from "../../../lib/ops/memory-extract";
import { runPipeline } from "../../../lib/ops/pipeline-run";
import { measureAgent } from "../../../lib/ops/measure-agent";
import { computeReward } from "../../../lib/ops/compute-reward";
import { updateTargets } from "../../../lib/ops/update-targets";
import { composeNextPrompt, backfillUsedPromptIds } from "../../../lib/ops/compose-next-prompt";
import { runUsageRollup, cleanupOldUsageData } from "../../../lib/metering/rollup";

export const runtime = "nodejs";

// Increase timeout for long-running operations
export const maxDuration = 300; // 5 minutes

/**
 * @api GET /api/ops
 * @visibility internal
 * @scope ops:read
 * @auth session
 * @tags ops
 * @description List all available operations with their implementation status
 * @response 200 { ok: true, operations: Array<{ opid, status, description? }> }
 */
export async function GET() {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  // Return list of available operations
  return NextResponse.json({
    ok: true,
    operations: [
      { opid: "pipeline:run", status: "implemented", description: "Full end-to-end: transcripts → personality → memory → prompts" },
      { opid: "transcripts:process", status: "implemented" },
      { opid: "knowledge:ingest", status: "implemented" },
      { opid: "kb:links:extract", status: "implemented" },
      { opid: "personality:analyze", status: "implemented" },
      { opid: "memory:extract", status: "implemented" },
      { opid: "behavior:measure", status: "implemented", description: "Measure behaviour from transcripts" },
      { opid: "reward:compute", status: "implemented", description: "Compute rewards comparing behaviors to targets" },
      { opid: "targets:update", status: "implemented", description: "Update targets based on reward signals" },
      { opid: "prompt:compose-next", status: "implemented", description: "Compose personalized prompts for callers (creates ComposedPrompt records)" },
      { opid: "prompt:backfill", status: "implemented", description: "Backfill usedPromptId for existing calls" },
      { opid: "metering:rollup", status: "implemented", description: "Aggregate usage events into rollups (hour/day/week/month)" },
      { opid: "metering:cleanup", status: "implemented", description: "Clean up old usage events (30 day retention)" },
      { opid: "knowledge:embed", status: "not_implemented" },
      { opid: "kb:parameters:import", status: "not_implemented" },
      { opid: "kb:parameters:snapshot", status: "not_implemented" },
      { opid: "kb:build+embed", status: "not_implemented" },
      { opid: "manifest:manage", status: "not_implemented" },
    ],
  });
}

/**
 * @api POST /api/ops
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Execute an operation by opid. Supports pipeline, transcript, knowledge, analysis, reward loop, and metering operations.
 * @body opid string - Operation identifier (e.g. "pipeline:run", "transcripts:process", "personality:analyze")
 * @body settings object - Operation-specific settings
 * @body dryRun boolean - If true, plan only without executing (default: false)
 * @response 200 { success: boolean, opid: string, result: object, timestamp: string }
 * @response 400 { error: "Unknown operation: ..." }
 * @response 403 { error: "Operations are disabled..." }
 * @response 500 { error: "..." }
 * @response 501 { error: "Operation ... not yet implemented" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const { opid, settings = {}, dryRun = false } = body;

    console.log(`[ops] Executing operation: ${opid}${dryRun ? " (dry run)" : ""}`);

    // Check if ops are enabled
    const opsEnabled = process.env.HF_OPS_ENABLED === "true";
    if (!opsEnabled) {
      return NextResponse.json(
        { error: "Operations are disabled. Set HF_OPS_ENABLED=true to enable." },
        { status: 403 }
      );
    }

    // #1260 / #1261 — mock-mode heuristics (compute-reward.ts::estimateOutcomeSignals
    // keyword regex + sentiment word count, personality-analyze.ts mock keyword
    // scoring with Math.random() jitter, mock behavior measurement) write to
    // RewardScore / CallerPersonality / BehaviorMeasurement. ADAPT reads these
    // tables as if they were real. The live pipeline has its own non-mock
    // implementations of REWARD / EXTRACT — the ops endpoint is a separate
    // legacy CLI surface, not the runtime pipeline.
    //
    // Gate: any opid whose handler defaults `mock: true` (or where settings.mock
    // is explicitly true) is blocked unless HF_ALLOW_MOCK_OPS=1. Production
    // never has this env set; dev/CI/test fixtures opt in explicitly.
    const MOCK_DEFAULTING_OPIDS = new Set([
      "pipeline:run",
      "personality:analyze",
      "memory:extract",
      "behavior:measure",
    ]);
    const isMockHeuristicCall =
      MOCK_DEFAULTING_OPIDS.has(opid) && settings.mock !== false;
    if (isMockHeuristicCall && process.env.HF_ALLOW_MOCK_OPS !== "1") {
      return NextResponse.json(
        {
          error:
            `Operation '${opid}' would invoke mock-mode keyword heuristics (writes to RewardScore / CallerPersonality / BehaviorMeasurement that ADAPT reads as real). ` +
            `Set HF_ALLOW_MOCK_OPS=1 in env to opt in (dev/CI only), or pass settings.mock=false to use the real LLM-backed path.`,
        },
        { status: 403 }
      );
    }

    // Route to appropriate operation handler
    switch (opid) {
      // ========================================
      // FULL PIPELINE
      // ========================================
      case "pipeline:run": {
        const result = await runPipeline({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          mock: settings.mock ?? true,
          filepath: settings.filepath,
          callerId: settings.callerId,
          limit: settings.limit ?? 100,
          skipTranscripts: settings.skipTranscripts ?? false,
          skipPersonality: settings.skipPersonality ?? false,
          skipMemory: settings.skipMemory ?? false,
          generatePrompts: settings.generatePrompts ?? true,
        });

        return NextResponse.json({
          success: result.success,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // TRANSCRIPT PROCESSING
      // ========================================
      case "transcripts:process": {
        const result = await processTranscripts({
          autoDetectType: settings.autoDetectType ?? true,
          createCallers: settings.createCallers ?? true,
          filepath: settings.filepath,
        });

        return NextResponse.json({
          success: result.success,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // KNOWLEDGE BASE OPERATIONS
      // ========================================
      case "knowledge:ingest": {
        const result = await ingestKnowledge({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          sourcePath: settings.sourcePath,
          maxDocuments: settings.limit,
        });

        return NextResponse.json({
          success: !result.errors || result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "kb:links:extract": {
        const result = await extractKbLinks({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          force: settings.force ?? false,
        });

        return NextResponse.json({
          success: true,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // ANALYSIS OPERATIONS
      // ========================================
      case "personality:analyze": {
        const result = await analyzePersonality({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          mock: settings.mock ?? true, // Default to mock mode
          callId: settings.callId,
          callerId: settings.callerId,
          limit: settings.limit ?? 100,
          aggregate: settings.aggregate ?? true,
          halfLifeDays: settings.halfLifeDays ?? 30,
          specSlug: settings.specSlug,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "memory:extract": {
        const result = await extractMemories({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          mock: settings.mock ?? true, // Default to mock mode
          callId: settings.callId,
          callerId: settings.callerId,
          limit: settings.limit ?? 100,
          aggregate: settings.aggregate ?? true,
          confidenceThreshold: settings.confidenceThreshold ?? 0.5,
          specSlug: settings.specSlug,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // REWARD LOOP OPERATIONS
      // ========================================
      case "behavior:measure": {
        const result = await measureAgent({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          mock: settings.mock ?? true,
          callId: settings.callId,
          limit: settings.limit ?? 100,
          specSlug: settings.specSlug,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "reward:compute": {
        const result = await computeReward({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          callId: settings.callId,
          limit: settings.limit ?? 100,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "targets:update": {
        const result = await updateTargets({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          callId: settings.callId,
          limit: settings.limit ?? 100,
          learningRate: settings.learningRate ?? 0.1,
          minConfidence: settings.minConfidence ?? 0.2,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "prompt:compose-next": {
        const result = await composeNextPrompt({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          callerId: settings.callerId,
          limit: settings.limit ?? 100,
          forceRecompose: settings.forceRecompose ?? false,
          maxAge: settings.maxAge ?? 24,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "prompt:backfill": {
        const result = await backfillUsedPromptIds({
          verbose: settings.verbose ?? false,
          plan: dryRun,
          callerId: settings.callerId,
          limit: settings.limit ?? 1000,
        });

        return NextResponse.json({
          success: result.errors.length === 0,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // METERING OPERATIONS
      // ========================================
      case "metering:rollup": {
        const validPeriods = ["HOUR", "DAY", "WEEK", "MONTH"];
        const period = validPeriods.includes(settings.period?.toUpperCase())
          ? settings.period.toUpperCase()
          : "HOUR";

        const result = await runUsageRollup({
          period: period as "HOUR" | "DAY" | "WEEK" | "MONTH",
          force: settings.force ?? false,
          verbose: settings.verbose ?? false,
          since: settings.since ? new Date(settings.since) : undefined,
        });

        return NextResponse.json({
          success: result.success,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      case "metering:cleanup": {
        const result = await cleanupOldUsageData({
          eventRetentionDays: settings.eventRetentionDays ?? 30,
          hourlyRetentionDays: settings.hourlyRetentionDays ?? 90,
          verbose: settings.verbose ?? false,
        });

        return NextResponse.json({
          success: result.success,
          opid,
          result,
          timestamp: new Date().toISOString(),
        });
      }

      // ========================================
      // NOT YET IMPLEMENTED
      // ========================================
      case "knowledge:embed":
      case "kb:parameters:import":
      case "kb:parameters:snapshot":
      case "kb:build+embed":
      case "manifest:manage":
        return NextResponse.json(
          {
            error: `Operation ${opid} not yet implemented`,
            opid,
            status: "not_implemented",
          },
          { status: 501 }
        );

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${opid}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("[ops] Error:", error);
    return NextResponse.json(
      {
        error: error.message || "Operation failed",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
