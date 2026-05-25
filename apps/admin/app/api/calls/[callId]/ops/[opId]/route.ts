/**
 * @api POST /api/calls/:callId/ops/:opId
 * @visibility public
 * @scope calls:write
 * @auth session
 * @tags calls, pipeline, ops
 * @description Run a specific analysis op on a single call. Valid ops: measure, learn, measure-agent, reward, adapt. Returns result with detailed logs for debugging.
 * @pathParam callId string - The call ID to run the op on
 * @pathParam opId string - The op to run: "measure" | "learn" | "measure-agent" | "reward" | "adapt"
 * @body callerId string - The caller ID (required)
 * @body engine string - AI engine to use: "mock" | "claude" | "openai" (default: "claude")
 * @response 200 { ok: true, message: string, data: object, logs: LogEntry[], duration: number }
 * @response 400 { ok: false, error: "callerId is required" | "Unknown op: ...", logs: LogEntry[], duration: number }
 * @response 500 { ok: false, error: string, logs: LogEntry[], duration: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { AIEngine, isEngineAvailable } from "@/lib/ai/client";
import { getConfiguredMeteredAICompletion, logMockAIUsage } from "@/lib/metering";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { bumpCallerComposeTimestamp } from "@/lib/compose/bump-timestamp";

const prisma = new PrismaClient();

// Log entry type
type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
};

// Op result with logs
type OpResult = {
  ok: boolean;
  message: string;
  data?: any;
  logs: LogEntry[];
  duration: number;
};

// Logger helper
function createLogger() {
  const logs: LogEntry[] = [];
  const startTime = Date.now();

  return {
    info: (message: string, data?: any) => {
      logs.push({ timestamp: new Date().toISOString(), level: "info", message, data });
    },
    warn: (message: string, data?: any) => {
      logs.push({ timestamp: new Date().toISOString(), level: "warn", message, data });
    },
    error: (message: string, data?: any) => {
      logs.push({ timestamp: new Date().toISOString(), level: "error", message, data });
    },
    debug: (message: string, data?: any) => {
      logs.push({ timestamp: new Date().toISOString(), level: "debug", message, data });
    },
    getLogs: () => logs,
    getDuration: () => Date.now() - startTime,
  };
}

// Op context passed to handlers
type OpContext = {
  callId: string;
  callerId: string;
  engine: AIEngine;
  log: ReturnType<typeof createLogger>;
};

// Op handlers
type OpHandler = (ctx: OpContext) => Promise<{ ok: boolean; message: string; data?: any }>;

/**
 * Score a transcript using AI
 */
async function scoreWithAI(
  transcript: string,
  parameterName: string,
  parameterDefinition: string | null,
  engine: AIEngine,
  log: ReturnType<typeof createLogger>,
  context?: { callId?: string; callerId?: string }
): Promise<{ score: number; confidence: number; reasoning: string }> {
  if (engine === "mock") {
    // Mock scoring
    const mockScore = 0.3 + (transcript.length % 50) / 100 + Math.random() * 0.3;
    // Log mock usage for visibility
    logMockAIUsage({
      callId: context?.callId,
      callerId: context?.callerId,
      sourceOp: "ops:measure",
      reason: "requested",
    }).catch(() => {});
    return {
      score: Math.min(1, mockScore),
      confidence: 0.7 + Math.random() * 0.2,
      reasoning: "Mock scoring based on pattern analysis",
    };
  }

  const prompt = `You are analyzing a call transcript to score a specific parameter.

Parameter: ${parameterName}
Definition: ${parameterDefinition || "No definition provided"}

Score this parameter on a scale of 0.0 to 1.0 based on the transcript below.
- 0.0 = Not present at all / Very negative
- 0.5 = Neutral / Average
- 1.0 = Strongly present / Very positive

Return your response as JSON with exactly these fields:
{
  "score": <number 0-1>,
  "confidence": <number 0-1>,
  "reasoning": "<brief explanation>"
}

TRANSCRIPT:
${transcript.slice(0, 4000)}`;

  // @ai-call analysis.measure — Standalone parameter scoring | config: /x/ai-config
  try {
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "analysis.measure",
      engineOverride: engine,
      messages: [
        { role: "system", content: "You are an expert call analyst. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ],
      maxTokens: 256,
      temperature: 0.3,
    }, { callId: context?.callId, callerId: context?.callerId, sourceOp: "ops:measure" });

    log.debug(`AI response for ${parameterName}`, { engine, model: result.model });

    // Parse the response - strip markdown code fences if present
    let jsonContent = result.content.trim();
    // Remove ```json ... ``` or ``` ... ``` wrappers
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(jsonContent);
    return {
      score: Math.max(0, Math.min(1, parsed.score || 0.5)),
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
      reasoning: parsed.reasoning || "AI analysis",
    };
  } catch (error: any) {
    log.error(`AI scoring failed for ${parameterName}`, { error: error.message });
    // Fall back to mock scoring on error
    return {
      score: 0.5,
      confidence: 0.3,
      reasoning: `AI error: ${error.message}. Using default score.`,
    };
  }
}

/**
 * Build a prompt for memory extraction based on LEARN spec action
 */
function buildLearnPrompt(
  description: string,
  category: string,
  keyPrefix: string,
  keyHint: string,
  triggerGiven: string,
  triggerWhen: string
): string {
  return `You are extracting structured information from a call transcript.

CONTEXT:
- Given: ${triggerGiven}
- When: ${triggerWhen}

WHAT TO EXTRACT:
${description}

MEMORY TYPE: ${category}
${keyPrefix ? `KEY PREFIX: ${keyPrefix}` : ""}
${keyHint ? `KEY HINT: ${keyHint}` : ""}

Instructions:
1. Read the transcript carefully
2. Look for information matching the description
3. Extract the specific value if found
4. Be precise - only extract what is explicitly stated or clearly implied

Return your response as JSON with exactly these fields:
{
  "found": true/false,
  "key": "<specific key for this memory, e.g. 'city' or 'employer_name'>",
  "value": "<the extracted value>",
  "confidence": <0.0-1.0>,
  "evidence": "<the exact quote from transcript that supports this>"
}

If nothing matching is found, return: {"found": false}`;
}

/**
 * Extract memory from transcript using AI
 */
async function extractWithAI(
  transcript: string,
  prompt: string,
  engine: AIEngine,
  log: ReturnType<typeof createLogger>,
  context?: { callId?: string; callerId?: string }
): Promise<{ found: boolean; key?: string; value?: string; confidence: number; evidence?: string }> {
  if (engine === "mock") {
    // Mock extraction - look for common patterns
    const patterns = [
      { regex: /my name is (\w+)/i, key: "name", category: "FACT" },
      { regex: /I(?:'m| am) (\w+)/i, key: "name", category: "FACT" },
      { regex: /I work (?:at|for) ([^.,]+)/i, key: "employer", category: "FACT" },
      { regex: /I live in ([^.,]+)/i, key: "location", category: "FACT" },
      { regex: /I(?:'m| am) from ([^.,]+)/i, key: "origin", category: "FACT" },
      { regex: /I prefer ([^.,]+)/i, key: "preference", category: "PREFERENCE" },
      { regex: /I like ([^.,]+)/i, key: "preference", category: "PREFERENCE" },
      { regex: /call me (?:back )?(?:on |at )?(\w+day|tomorrow|next week)/i, key: "callback", category: "EVENT" },
      { regex: /my (?:wife|husband|partner|spouse) (\w+)/i, key: "spouse", category: "RELATIONSHIP" },
      { regex: /I have (\d+) (?:kids?|children)/i, key: "children_count", category: "RELATIONSHIP" },
    ];

    // Log mock usage for visibility
    logMockAIUsage({
      callId: context?.callId,
      callerId: context?.callerId,
      sourceOp: "ops:learn",
      reason: "requested",
    }).catch(() => {});

    for (const pattern of patterns) {
      const match = transcript.match(pattern.regex);
      if (match) {
        return {
          found: true,
          key: pattern.key,
          value: match[1].trim(),
          confidence: 0.75,
          evidence: match[0],
        };
      }
    }

    return { found: false, confidence: 0 };
  }

  // Use AI for extraction
  const fullPrompt = `${prompt}

TRANSCRIPT:
${transcript.slice(0, 4000)}`;

  // @ai-call analysis.learn — Standalone memory/fact extraction | config: /x/ai-config
  try {
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "analysis.learn",
      engineOverride: engine,
      messages: [
        { role: "system", content: "You are an expert at extracting structured information from conversations. Always respond with valid JSON." },
        { role: "user", content: fullPrompt },
      ],
      maxTokens: 256,
      temperature: 0.2,
    }, { callId: context?.callId, callerId: context?.callerId, sourceOp: "ops:learn" });

    log.debug("AI extraction response", { engine, model: result.model });

    // Parse the response - strip markdown code fences if present
    let jsonContent = result.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(jsonContent);

    if (parsed.found) {
      return {
        found: true,
        key: parsed.key,
        value: parsed.value,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        evidence: parsed.evidence,
      };
    }

    return { found: false, confidence: 0 };
  } catch (error: any) {
    log.error("AI extraction failed", { error: error.message });
    return { found: false, confidence: 0 };
  }
}

const opHandlers: Record<string, OpHandler> = {
  // MEASURE - Score caller traits from transcript
  measure: async ({ callId, callerId, engine, log }) => {
    log.info("Starting MEASURE op", { callId, callerId, engine });

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, transcript: true, callSequence: true },
    });

    if (!call) {
      log.error("Call not found", { callId });
      return { ok: false, message: "Call not found" };
    }

    log.info("Found call", { transcriptLength: call.transcript?.length, callSequence: call.callSequence });

    // Load active, compiled MEASURE specs
    const specs = await prisma.analysisSpec.findMany({
      where: {
        outputType: "MEASURE",
        isActive: true,
        isDirty: false, // Only use compiled specs
      },
      include: {
        triggers: {
          include: { actions: true },
        },
      },
    });

    log.info(`Found ${specs.length} MEASURE specs`);

    if (specs.length === 0) {
      log.error("No compiled MEASURE specs found");
      return { ok: false, message: "No compiled MEASURE specs found. Compile your specs first in Analysis Specs." };
    }

    const scoresCreated: { parameterId: string; score: number }[] = [];
    const transcript = call.transcript || "";

    for (const spec of specs) {
      log.debug(`Processing spec: ${spec.slug}`);

      for (const trigger of spec.triggers) {
        for (const action of trigger.actions) {
          if (action.parameterId) {
            // Get parameter details for AI scoring
            const parameter = await prisma.parameter.findUnique({
              where: { parameterId: action.parameterId },
              select: { name: true, definition: true },
            });

            // Score using AI or mock
            const { score: finalScore, confidence, reasoning } = await scoreWithAI(
              transcript,
              parameter?.name || action.parameterId,
              parameter?.definition || null,
              engine,
              log,
              { callId: call.id, callerId }
            );

            log.debug(`Scoring ${action.parameterId}`, { score: finalScore, confidence, engine });

            // Check if score already exists for this call+parameter
            const existing = await prisma.callScore.findFirst({
              where: {
                callId: call.id,
                parameterId: action.parameterId,
              },
            });

            const scoredBy = engine === "mock" ? "mock_v1" : `${engine}_v1`;

            if (existing) {
              // Update existing
              await prisma.callScore.update({
                where: { id: existing.id },
                data: {
                  score: finalScore,
                  confidence,
                  evidence: [reasoning, `Scored by ${engine} via ${spec.slug}`],
                  scoredAt: new Date(),
                  scoredBy,
                  analysisSpecId: spec.id,
                },
              });
              log.info(`Updated score for ${action.parameterId}`, { score: finalScore });
            } else {
              // Create new
              await prisma.callScore.create({
                data: {
                  callId: call.id,
                  callerId: callerId,
                  parameterId: action.parameterId,
                  score: finalScore,
                  confidence,
                  evidence: [reasoning, `Scored by ${engine} via ${spec.slug}`],
                  analysisSpecId: spec.id,
                  scoredBy,
                },
              });
              log.info(`Created score for ${action.parameterId}`, { score: finalScore });
            }

            scoresCreated.push({ parameterId: action.parameterId, score: finalScore });
          }
        }
      }
    }

    log.info(`MEASURE complete`, { scoresCreated: scoresCreated.length });

    return {
      ok: true,
      message: `Created ${scoresCreated.length} scores`,
      data: { scoresCreated },
    };
  },

  // LEARN - Extract memories from transcript using compiled LEARN specs
  learn: async ({ callId, callerId, engine, log }) => {
    log.info("Starting LEARN op", { callId, callerId, engine });

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, transcript: true },
    });

    if (!call) {
      log.error("Call not found");
      return { ok: false, message: "Call not found" };
    }

    const transcript = call.transcript || "";
    log.info("Found call", { transcriptLength: transcript.length });

    // Load active, compiled LEARN specs
    const specs = await prisma.analysisSpec.findMany({
      where: {
        outputType: "LEARN",
        isActive: true,
        isDirty: false, // Only use compiled specs
      },
      include: {
        triggers: {
          include: { actions: true },
        },
      },
    });

    log.info(`Found ${specs.length} compiled LEARN specs`);

    if (specs.length === 0) {
      log.error("No compiled LEARN specs found");
      return { ok: false, message: "No compiled LEARN specs found. Compile your specs first in Analysis Specs." };
    }

    const memoriesCreated: { category: string; key: string; value: string }[] = [];

    // Process each spec's triggers and actions
    for (const spec of specs) {
      log.debug(`Processing spec: ${spec.slug}`);

      for (const trigger of spec.triggers) {
        for (const action of trigger.actions) {
          // Skip actions without learn configuration
          if (!action.learnCategory) {
            log.debug(`Skipping action ${action.id} - no learnCategory`);
            continue;
          }

          // Build extraction prompt based on action configuration
          const extractionPrompt = buildLearnPrompt(
            action.description,
            action.learnCategory,
            action.learnKeyPrefix || "",
            action.learnKeyHint || "",
            trigger.given,
            trigger.when
          );

          // Extract using AI or mock
          const extraction = await extractWithAI(
            transcript,
            extractionPrompt,
            engine,
            log,
            { callId: call.id, callerId }
          );

          if (extraction.found && extraction.value) {
            const memoryKey = action.learnKeyPrefix
              ? `${action.learnKeyPrefix}_${extraction.key || "value"}`
              : extraction.key || action.learnCategory.toLowerCase();

            log.debug(`Extracted ${action.learnCategory}:${memoryKey}`, {
              value: extraction.value,
              confidence: extraction.confidence,
            });

            // Check if memory already exists for this key
            const existing = await prisma.callerMemory.findFirst({
              where: {
                callerId,
                key: memoryKey,
                supersededById: null,
              },
            });

            const extractedBy = engine === "mock" ? "mock_v1" : `${engine}_v1`;

            if (existing) {
              log.info(`Memory ${memoryKey} already exists, superseding`);
              const newMemory = await prisma.callerMemory.create({
                data: {
                  callerId,
                  callId: call.id,
                  category: action.learnCategory,
                  key: memoryKey,
                  value: extraction.value,
                  confidence: extraction.confidence,
                  evidence: extraction.evidence || `Extracted via ${spec.slug}`,
                  extractedBy,
                },
              });
              await prisma.callerMemory.update({
                where: { id: existing.id },
                data: { supersededById: newMemory.id },
              });
            } else {
              await prisma.callerMemory.create({
                data: {
                  callerId,
                  callId: call.id,
                  category: action.learnCategory,
                  key: memoryKey,
                  value: extraction.value,
                  confidence: extraction.confidence,
                  evidence: extraction.evidence || `Extracted via ${spec.slug}`,
                  extractedBy,
                },
              });
            }

            memoriesCreated.push({
              category: action.learnCategory,
              key: memoryKey,
              value: extraction.value,
            });
          } else {
            log.debug(`No extraction for ${action.learnCategory} from action ${action.id}`);
          }
        }
      }
    }

    log.info(`LEARN complete`, { memoriesCreated: memoriesCreated.length });

    // #830 — out-of-band CallerMemory writes from the ops route (an
    // operator/admin re-running this op against an existing call). The
    // pipeline-internal memory writer is excluded by Story 6 because
    // COMPOSE runs at the end of the same pipeline invocation; the ops
    // route runs after the pipeline has already completed and the cached
    // ComposedPrompt is stale.
    if (memoriesCreated.length > 0) {
      await bumpCallerComposeTimestamp(callerId);
    }

    return {
      ok: true,
      message: `Extracted ${memoriesCreated.length} memories from ${specs.length} specs`,
      data: { memoriesCreated, specsProcessed: specs.length },
    };
  },

  // MEASURE_AGENT - Score behaviour
  "measure-agent": async ({ callId, callerId, engine, log }) => {
    log.info("Starting MEASURE_AGENT op", { callId, engine });

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, transcript: true },
    });

    if (!call) {
      log.error("Call not found");
      return { ok: false, message: "Call not found" };
    }

    // Load active, compiled MEASURE_AGENT specs
    const specs = await prisma.analysisSpec.findMany({
      where: {
        outputType: "MEASURE_AGENT",
        isActive: true,
        isDirty: false, // Only use compiled specs
      },
      include: {
        triggers: { include: { actions: true } },
      },
    });

    log.info(`Found ${specs.length} MEASURE_AGENT specs`);

    if (specs.length === 0) {
      log.error("No compiled MEASURE_AGENT specs found");
      return { ok: false, message: "No compiled MEASURE_AGENT specs found. Compile your specs first in Analysis Specs." };
    }

    const transcript = call.transcript || "";
    const measurementsCreated: { parameterId: string; actualValue: number }[] = [];

    for (const spec of specs) {
      for (const trigger of spec.triggers) {
        for (const action of trigger.actions) {
          if (action.parameterId) {
            let actualValue = 0.5;
            const evidence: string[] = [];

            // Simple heuristics for demo
            if (action.parameterId.includes("WARMTH")) {
              const warmthMarkers = (transcript.match(/thank|please|happy|glad|great|wonderful/gi) || []).length;
              actualValue = Math.min(1, warmthMarkers / 10);
              evidence.push(`Found ${warmthMarkers} warmth markers`);
            } else if (action.parameterId.includes("DIRECT")) {
              const avgLength = transcript.length / (transcript.split(/[.!?]/).length || 1);
              actualValue = avgLength < 100 ? 0.8 : 0.4;
              evidence.push(`Avg sentence length: ${avgLength.toFixed(0)}`);
            } else if (action.parameterId.includes("EMPATHY")) {
              const empathyMarkers = (transcript.match(/understand|hear you|feel|sorry|appreciate/gi) || []).length;
              actualValue = Math.min(1, empathyMarkers / 5);
              evidence.push(`Found ${empathyMarkers} empathy markers`);
            }

            log.debug(`Measuring ${action.parameterId}`, { actualValue, evidence });

            // Check if measurement exists
            const existing = await prisma.behaviorMeasurement.findFirst({
              where: { callId: call.id, parameterId: action.parameterId },
            });

            if (existing) {
              await prisma.behaviorMeasurement.update({
                where: { id: existing.id },
                data: { actualValue, confidence: 0.75, evidence },
              });
            } else {
              await prisma.behaviorMeasurement.create({
                data: {
                  callId: call.id,
                  parameterId: action.parameterId,
                  actualValue,
                  confidence: 0.75,
                  evidence,
                },
              });
            }

            measurementsCreated.push({ parameterId: action.parameterId, actualValue });
          }
        }
      }
    }

    log.info(`MEASURE_AGENT complete`, { measurementsCreated: measurementsCreated.length });

    return {
      ok: true,
      message: `Created ${measurementsCreated.length} behavior measurements`,
      data: { measurementsCreated },
    };
  },

  // REWARD - Compare behavior vs targets
  reward: async ({ callId, callerId, engine, log }) => {
    log.info("Starting REWARD op", { callId, engine });

    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: { behaviorMeasurements: true },
    });

    if (!call) {
      log.error("Call not found");
      return { ok: false, message: "Call not found" };
    }

    if (call.behaviorMeasurements.length === 0) {
      log.error("No behavior measurements found");
      return { ok: false, message: "No behavior measurements found. Run measure-agent first." };
    }

    log.info(`Found ${call.behaviorMeasurements.length} behavior measurements`);

    // Load system-level behavior targets
    const targets = await prisma.behaviorTarget.findMany({
      where: {
        scope: "SYSTEM",
        parameterId: { startsWith: "MVP-BEH" },
      },
    });

    log.info(`Found ${targets.length} behavior targets`);

    if (targets.length === 0) {
      log.warn("No behavior targets found, using defaults");
    }

    // Compute reward by comparing measurements to targets
    const diffs: { parameterId: string; target: number; actual: number; diff: number }[] = [];

    for (const measurement of call.behaviorMeasurements) {
      const target = targets.find((t) => t.parameterId === measurement.parameterId);
      const targetValue = target?.targetValue ?? 0.5; // Default target
      const diff = Math.abs(measurement.actualValue - targetValue);
      diffs.push({
        parameterId: measurement.parameterId,
        target: targetValue,
        actual: measurement.actualValue,
        diff,
      });
      log.debug(`Diff for ${measurement.parameterId}`, { target: targetValue, actual: measurement.actualValue, diff });
    }

    // Overall reward: higher when behavior matches targets
    const avgDiff = diffs.length > 0 ? diffs.reduce((sum, d) => sum + d.diff, 0) / diffs.length : 0;
    const overallScore = Math.max(0, 1 - avgDiff);

    log.info(`Computed reward`, { overallScore, avgDiff });

    // Store reward score (upsert)
    const existing = await prisma.rewardScore.findUnique({ where: { callId: call.id } });

    if (existing) {
      await prisma.rewardScore.update({
        where: { callId: call.id },
        data: {
          overallScore,
          parameterDiffs: diffs,
          scoredAt: new Date(),
        },
      });
    } else {
      await prisma.rewardScore.create({
        data: {
          callId: call.id,
          overallScore,
          modelVersion: "mock_v1",
          parameterDiffs: diffs,
        },
      });
    }

    log.info(`REWARD complete`);

    return {
      ok: true,
      message: `Reward score: ${(overallScore * 100).toFixed(0)}%`,
      data: { overallScore, diffs },
    };
  },

  // ADAPT - Compute deltas and update targets
  adapt: async ({ callId, callerId, engine, log }) => {
    log.info("Starting ADAPT op", { callId, callerId, engine });

    // Get current call and its scores
    const currentCall = await prisma.call.findUnique({
      where: { id: callId },
      include: {
        scores: true,
        rewardScore: true,
      },
    });

    if (!currentCall) {
      log.error("Call not found");
      return { ok: false, message: "Call not found" };
    }

    if (!currentCall.rewardScore) {
      log.error("No reward score found");
      return { ok: false, message: "No reward score found. Run compute-reward first." };
    }

    log.info(`Found call with ${currentCall.scores.length} scores`);

    // Find previous call for this caller to compute deltas
    const previousCall = await prisma.call.findFirst({
      where: {
        callerId,
        createdAt: { lt: currentCall.createdAt },
      },
      orderBy: { createdAt: "desc" },
      include: { scores: true },
    });

    const deltasComputed: { parameterId: string; previous: number | null; current: number; delta: number }[] = [];

    if (previousCall) {
      log.info(`Found previous call: ${previousCall.id}`);

      // Compute deltas for each parameter
      for (const currentScore of currentCall.scores) {
        const previousScore = previousCall.scores.find((s) => s.parameterId === currentScore.parameterId);

        if (previousScore) {
          const delta = currentScore.score - previousScore.score;
          deltasComputed.push({
            parameterId: currentScore.parameterId,
            previous: previousScore.score,
            current: currentScore.score,
            delta,
          });
          log.debug(`Delta for ${currentScore.parameterId}`, {
            previous: previousScore.score,
            current: currentScore.score,
            delta,
          });

          // Store delta score (e.g., MVP-ENGAGEMENT → MVP-ENGAGEMENT-DELTA)
          const deltaParameterId = `${currentScore.parameterId}-DELTA`;
          const deltaParam = await prisma.parameter.findUnique({
            where: { parameterId: deltaParameterId },
          });

          if (deltaParam) {
            const existingDelta = await prisma.callScore.findFirst({
              where: { callId, parameterId: deltaParameterId },
            });

            const deltaScore = (delta + 1) / 2; // Normalize -1..1 to 0..1

            if (existingDelta) {
              await prisma.callScore.update({
                where: { id: existingDelta.id },
                data: { score: deltaScore, scoredAt: new Date() },
              });
            } else {
              await prisma.callScore.create({
                data: {
                  callId,
                  callerId,
                  parameterId: deltaParameterId,
                  score: deltaScore,
                  confidence: 0.9,
                  evidence: [`Delta from ${previousCall.id}`],
                  scoredBy: "adapt_v1",
                },
              });
            }
            log.info(`Stored delta score for ${deltaParameterId}`, { deltaScore });
          }
        }
      }
    } else {
      log.info("No previous call found - this is the first call for this caller");
    }

    // Update behavior targets based on reward
    const updatesApplied: string[] = [];
    const diffs = (currentCall.rewardScore.parameterDiffs as any[]) || [];

    for (const diff of diffs) {
      // If behavior was different from target but outcome was good, adjust target
      if (diff.diff > 0.2 && currentCall.rewardScore.overallScore > 0.7) {
        const adjustment = (diff.actual - diff.target) * 0.1;

        await prisma.behaviorTarget.updateMany({
          where: {
            parameterId: diff.parameterId,
            scope: "SYSTEM",
          },
          data: {
            targetValue: diff.target + adjustment,
            updatedAt: new Date(),
          },
        });

        updatesApplied.push(`${diff.parameterId}: ${diff.target.toFixed(2)} → ${(diff.target + adjustment).toFixed(2)}`);
        log.info(`Updated target for ${diff.parameterId}`, { from: diff.target, to: diff.target + adjustment });
      }
    }

    log.info(`ADAPT complete`, { deltasComputed: deltasComputed.length, updatesApplied: updatesApplied.length });

    return {
      ok: true,
      message: deltasComputed.length > 0
        ? `Computed ${deltasComputed.length} deltas, ${updatesApplied.length} target updates`
        : "First call for caller - no deltas to compute",
      data: { deltasComputed, updatesApplied, isFirstCall: !previousCall },
    };
  },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string; opId: string }> }
) {
  const log = createLogger();

  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callId, opId } = await params;
    const body = await request.json().catch(() => ({}));
    const { callerId, engine: requestedEngine } = body;

    // Validate and default engine - default to claude for real AI inference
    let engine: AIEngine = "claude";
    if (requestedEngine && ["mock", "claude", "openai"].includes(requestedEngine)) {
      engine = requestedEngine as AIEngine;
    }

    // Verify the engine is available (has API key configured)
    if (!isEngineAvailable(engine)) {
      if (engine !== "mock") {
        log.warn(`Engine "${engine}" not available (missing API key), falling back to mock`);
        engine = "mock";
      }
    }

    log.info("Op request received", { callId, opId, callerId, engine });

    if (!callerId) {
      log.error("callerId is required");
      return NextResponse.json({
        ok: false,
        error: "callerId is required",
        logs: log.getLogs(),
        duration: log.getDuration(),
      }, { status: 400 });
    }

    const handler = opHandlers[opId];
    if (!handler) {
      log.error(`Unknown op: ${opId}`);
      return NextResponse.json({
        ok: false,
        error: `Unknown op: ${opId}. Valid ops: ${Object.keys(opHandlers).join(", ")}`,
        logs: log.getLogs(),
        duration: log.getDuration(),
      }, { status: 400 });
    }

    const result = await handler({ callId, callerId, engine, log });

    return NextResponse.json({
      ...result,
      logs: log.getLogs(),
      duration: log.getDuration(),
    });
  } catch (error: any) {
    log.error("Op failed", { error: error.message, stack: error.stack });
    return NextResponse.json({
      ok: false,
      error: error.message,
      logs: log.getLogs(),
      duration: log.getDuration(),
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
