/**
 * Goal Extraction from Transcripts
 *
 * Extracts explicit and implicit learner goals from call transcripts.
 * - Explicit: "I want to learn X", "My goal is Y"
 * - Implicit: Frustrations, repeated topics, curiosity signals
 *
 * Part of GOAL-001 spec implementation.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { GoalType, GoalStatus, Goal } from "@prisma/client";
import { AIEngine } from "@/lib/ai/client";
import { getConfiguredMeteredAICompletion, logMockAIUsage } from "@/lib/metering";
import {
  GOALS_EXTRACT_SYSTEM_PROMPT,
  GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT,
} from "@/lib/ai/analyst-system-prompts";

import { getGoalSettings, getAITimeoutSettings, type GoalSettings } from "@/lib/system-settings";

// =====================================================
// TYPES
// =====================================================

export interface GoalExtractionResult {
  goalsCreated: number;
  goalsUpdated: number;
  goalsSkipped: number;
  errors: string[];
}

interface ExtractedGoal {
  type: GoalType;
  name: string;
  description: string;
  extractionMethod: "EXPLICIT" | "IMPLICIT";
  confidence: number;
  evidence: string;
  duplicateOfGoalId?: string;
}

interface GoalExtractionResponse {
  goals: Array<{
    t: string;   // GoalType
    n: string;   // name
    d: string;   // description
    e: string;   // EXPLICIT | IMPLICIT
    c: number;   // confidence
    ev: string;  // evidence
    dup?: string; // duplicate goal ID
  }>;
}

type Logger = {
  info: (msg: string, data?: any) => void;
  warn: (msg: string, data?: any) => void;
  error: (msg: string, data?: any) => void;
  debug: (msg: string, data?: any) => void;
};

// =====================================================
// CONSTANTS
// =====================================================

// Defaults — overridden at runtime by getGoalSettings()
let TRANSCRIPT_LIMIT = 4000;
let MIN_TRANSCRIPT_LENGTH = 100;
let CONFIDENCE_THRESHOLD = 0.5;
let SIMILARITY_THRESHOLD = 0.8;

async function loadGoalConstants() {
  const s = await getGoalSettings();
  TRANSCRIPT_LIMIT = s.transcriptLimitChars;
  MIN_TRANSCRIPT_LENGTH = s.transcriptMinChars;
  CONFIDENCE_THRESHOLD = s.confidenceThreshold;
  SIMILARITY_THRESHOLD = s.similarityThreshold;
}

// =====================================================
// MAIN EXPORT
// =====================================================

/**
 * Extract learner goals from a call transcript.
 * Creates Goal records with playbookId: null to mark them as caller-expressed.
 */
export async function extractGoals(
  call: { id: string; transcript: string | null },
  callerId: string,
  engine: AIEngine,
  log: Logger
): Promise<GoalExtractionResult> {
  await loadGoalConstants();

  const result: GoalExtractionResult = {
    goalsCreated: 0,
    goalsUpdated: 0,
    goalsSkipped: 0,
    errors: [],
  };

  // 1. Validate input
  if (!call.transcript || call.transcript.length < MIN_TRANSCRIPT_LENGTH) {
    log.info("Skipping goal extraction - transcript too short", {
      callId: call.id,
      transcriptLength: call.transcript?.length ?? 0,
    });
    return result;
  }

  try {
    // 2. Load existing goals for deduplication
    const existingGoals = await prisma.goal.findMany({
      where: {
        callerId,
        status: { in: [GoalStatus.ACTIVE, GoalStatus.PAUSED] },
      },
    });

    // 3. Build prompt
    const prompt = buildGoalExtractionPrompt(call.transcript, existingGoals);

    // 4. Handle mock engine
    if (engine === "mock") {
      await logMockAIUsage({
        callId: call.id,
        callerId,
        sourceOp: "pipeline:extract_goals",
        metadata: { reason: "mock_engine" },
      }).catch((e) => log.warn("Failed to log mock usage", { error: (e as Error).message }));
      log.info("Mock goal extraction complete", { callId: call.id });
      return result;
    }

    // @ai-call pipeline.extract_goals — Extract learner goals from transcript | config: /x/ai-config
    const timeouts = await getAITimeoutSettings();
    const aiResult = await getConfiguredMeteredAICompletion(
      {
        callPoint: "pipeline.extract_goals",
        engineOverride: engine,
        messages: [
          {
            role: "system",
            content: GOALS_EXTRACT_SYSTEM_PROMPT,
          },
          { role: "user", content: prompt },
        ],
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: timeouts.pipelineTimeoutMs,
      },
      { callId: call.id, callerId, sourceOp: "pipeline:extract_goals" }
    );

    log.debug("AI goal extraction response", { model: aiResult.model, tokens: aiResult.usage });

    // 6. Parse response (handle markdown fences)
    let jsonContent = aiResult.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed: GoalExtractionResponse;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (parseError) {
      log.error("Goal extraction JSON parse failed", {
        error: (parseError as Error).message,
        content: jsonContent.slice(0, 200),
      });
      result.errors.push(`JSON parse error: ${(parseError as Error).message}`);
      return result;
    }

    // 7. Process each extracted goal
    if (parsed.goals && Array.isArray(parsed.goals)) {
      for (const rawGoal of parsed.goals) {
        try {
          const extracted = normalizeGoal(rawGoal);
          if (!extracted) {
            result.goalsSkipped++;
            continue;
          }

          // Skip low confidence goals
          if (extracted.confidence < CONFIDENCE_THRESHOLD) {
            log.debug("Skipping low confidence goal", {
              name: extracted.name,
              confidence: extracted.confidence,
            });
            result.goalsSkipped++;
            continue;
          }

          await processExtractedGoal(extracted, callerId, call.id, existingGoals, result, log);
        } catch (goalError) {
          log.error("Failed to process goal", {
            error: (goalError as Error).message,
            goal: rawGoal.n,
          });
          result.errors.push(`Goal "${rawGoal.n}": ${(goalError as Error).message}`);
        }
      }
    }

    log.info("Goal extraction complete", result);
    return result;
  } catch (error: any) {
    log.error("Goal extraction failed", { error: error.message, callId: call.id });
    result.errors.push(error.message);
    return result;
  }
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Build the LLM prompt for goal extraction
 */
function buildGoalExtractionPrompt(transcript: string, existingGoals: Goal[]): string {
  const existingList =
    existingGoals.length > 0
      ? existingGoals.map((g) => `${g.id}|${g.type}|${g.name}`).join("\n")
      : "None";

  return `Extract learner goals from this conversation transcript.

GOAL TYPES:
- LEARN: Knowledge/skill acquisition ("I want to understand X", "teach me about Y")
- ACHIEVE: Specific milestones ("I need to pass the exam", "I want to finish the project")
- CHANGE: Behavior/habit change ("I want to stop procrastinating", "I need to be more organized")
- CONNECT: Relationship building ("I want to feel less lonely", "I need someone to talk to")
- SUPPORT: Emotional support ("I'm struggling with X", "I need help coping")
- CREATE: Creative projects ("I want to write a book", "I'm building an app")

EXTRACTION RULES:
- EXPLICIT goals: Caller directly states intention ("I want to...", "My goal is...", "I need to...")
- IMPLICIT goals: Inferred from frustration, curiosity, repeated mentions, or wishes
- Confidence: 0.8-1.0 for explicit, 0.4-0.7 for implicit
- Only extract if confidence >= 0.5
- If goal matches an existing one, set "dup" to that goal's ID

EXISTING GOALS:
${existingList}

TRANSCRIPT:
${transcript.slice(0, TRANSCRIPT_LIMIT)}

Return JSON (no markdown):
{"goals":[{"t":"LEARN","n":"Goal name","d":"Why they want this","e":"EXPLICIT","c":0.85,"ev":"verbatim quote"}]}

If no goals detected, return: {"goals":[]}`;
}

/**
 * Normalize raw LLM response to ExtractedGoal
 */
function normalizeGoal(raw: GoalExtractionResponse["goals"][0]): ExtractedGoal | null {
  const typeMap: Record<string, GoalType> = {
    LEARN: GoalType.LEARN,
    ACHIEVE: GoalType.ACHIEVE,
    CHANGE: GoalType.CHANGE,
    CONNECT: GoalType.CONNECT,
    SUPPORT: GoalType.SUPPORT,
    CREATE: GoalType.CREATE,
  };

  const goalType = typeMap[raw.t?.toUpperCase()];
  if (!goalType) return null;

  const extractionMethod = raw.e?.toUpperCase() === "IMPLICIT" ? "IMPLICIT" : "EXPLICIT";

  return {
    type: goalType,
    name: raw.n || "Unnamed goal",
    description: raw.d || "",
    extractionMethod,
    confidence: Math.max(0, Math.min(1, raw.c ?? 0.5)),
    evidence: raw.ev || "",
    duplicateOfGoalId: raw.dup || undefined,
  };
}

/**
 * Process a single extracted goal - create or update
 */
async function processExtractedGoal(
  extracted: ExtractedGoal,
  callerId: string,
  callId: string,
  existingGoals: Goal[],
  result: GoalExtractionResult,
  log: Logger
): Promise<void> {
  // Check for duplicates
  const dedup = deduplicateGoal(extracted, existingGoals);

  if (dedup.action === "skip") {
    result.goalsSkipped++;
    return;
  }

  if (dedup.action === "update" && dedup.existingGoalId) {
    // Update existing goal with new evidence
    const existing = existingGoals.find((g) => g.id === dedup.existingGoalId);
    if (existing) {
      const currentMetrics = (existing.progressMetrics as any) || {};
      const existingEvidence = currentMetrics.evidence || [];

      await prisma.goal.update({
        where: { id: existing.id },
        data: {
          progressMetrics: {
            ...currentMetrics,
            evidence: [...existingEvidence, extracted.evidence],
            lastMentionedCallId: callId,
            lastMentionedAt: new Date().toISOString(),
            mentionCount: (currentMetrics.mentionCount || 1) + 1,
          },
          // Bump priority if re-emphasized (max 10)
          priority: Math.min(10, existing.priority + 1),
          updatedAt: new Date(),
        },
      });

      log.info("Updated existing goal with new evidence", {
        goalId: existing.id,
        goalName: existing.name,
      });
      result.goalsUpdated++;
      return;
    }
  }

  // Create new goal
  const goal = await prisma.goal.create({
    data: {
      callerId,
      playbookId: null, // NULL marks caller-expressed goals
      type: extracted.type,
      name: extracted.name,
      description: extracted.description,
      status: GoalStatus.ACTIVE,
      priority: extracted.extractionMethod === "EXPLICIT" ? 7 : 5,
      progress: 0,
      progressMetrics: {
        extractionMethod: extracted.extractionMethod,
        confidence: extracted.confidence,
        evidence: [extracted.evidence],
        sourceCallId: callId,
        extractedAt: new Date().toISOString(),
      },
      startedAt: new Date(),
    },
  });

  log.info("Created caller-expressed goal", {
    goalId: goal.id,
    goalName: goal.name,
    type: goal.type,
    extractionMethod: extracted.extractionMethod,
  });
  result.goalsCreated++;
}

/**
 * Check if extracted goal is a duplicate of an existing one
 */
function deduplicateGoal(
  extracted: ExtractedGoal,
  existingGoals: Goal[]
): { action: "create" | "update" | "skip"; existingGoalId?: string } {
  // 1. LLM flagged it as duplicate
  if (extracted.duplicateOfGoalId) {
    const existing = existingGoals.find((g) => g.id === extracted.duplicateOfGoalId);
    if (existing) {
      return { action: "update", existingGoalId: existing.id };
    }
  }

  // 2. Exact name match (same type, case-insensitive)
  const exactMatch = existingGoals.find(
    (g) =>
      g.type === extracted.type && g.name.toLowerCase().trim() === extracted.name.toLowerCase().trim()
  );
  if (exactMatch) {
    return { action: "update", existingGoalId: exactMatch.id };
  }

  // 3. Very similar name (same type)
  const similarMatch = existingGoals.find(
    (g) =>
      g.type === extracted.type &&
      calculateSimilarity(g.name.toLowerCase(), extracted.name.toLowerCase()) > SIMILARITY_THRESHOLD
  );
  if (similarMatch) {
    return { action: "update", existingGoalId: similarMatch.id };
  }

  return { action: "create" };
}

// =====================================================
// GOAL COMPLETION SIGNAL EXTRACTION
// =====================================================

export interface CompletionSignalResult {
  signalsDetected: number;
  errors: string[];
}

/**
 * Extract goal completion signals from a call transcript.
 * When a caller says "I passed the Beit Din!" or similar, stores a pending
 * CallerAttribute with scope GOAL_EVENT for teacher confirmation.
 *
 * Only checks assessment target goals — regular goals auto-complete via progress tracking.
 */
export async function extractGoalCompletionSignals(
  call: { id: string; transcript: string | null },
  callerId: string,
  engine: AIEngine,
  log: Logger
): Promise<CompletionSignalResult> {
  const result: CompletionSignalResult = { signalsDetected: 0, errors: [] };

  if (!call.transcript || call.transcript.length < MIN_TRANSCRIPT_LENGTH) {
    return result;
  }

  // Only check if caller has active assessment targets
  const assessmentGoals = await prisma.goal.findMany({
    where: {
      callerId,
      isAssessmentTarget: true,
      status: GoalStatus.ACTIVE,
    },
    select: { id: true, name: true },
  });

  if (assessmentGoals.length === 0) return result;

  if (engine === "mock") {
    log.info("Mock completion signal extraction", { callId: call.id });
    return result;
  }

  try {
    const goalList = assessmentGoals.map(g => `${g.id}|${g.name}`).join("\n");
    const prompt = `Analyze this conversation transcript for COMPLETION SIGNALS.

The caller has these assessment targets:
${goalList}

A completion signal means the caller claims to have ACHIEVED one of these targets.
Examples: "I passed!", "I got my certificate", "I did it — I passed the exam".

RULES:
- Only detect EXPLICIT claims of completion, NOT progress updates
- Must match one of the listed assessment targets
- Include the verbatim quote as evidence
- Confidence: 0.9+ for clear claims, 0.7-0.9 for indirect claims

TRANSCRIPT:
${call.transcript.slice(0, TRANSCRIPT_LIMIT)}

Return JSON (no markdown):
{"signals":[{"goalId":"<id>","evidence":"verbatim quote","confidence":0.9}]}
If no signals, return: {"signals":[]}`;

    const timeouts = await getAITimeoutSettings();
    // @ai-call pipeline.extract_completion_signals — Detect goal completion claims | config: /x/ai-config
    const aiResult = await getConfiguredMeteredAICompletion(
      {
        callPoint: "pipeline.extract_completion_signals",
        engineOverride: engine,
        messages: [
          { role: "system", content: GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        maxTokens: 512,
        temperature: 0.1,
        timeoutMs: timeouts.pipelineTimeoutMs,
      },
      { callId: call.id, callerId, sourceOp: "pipeline:extract_completion_signals" }
    );

    let jsonContent = aiResult.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(jsonContent) as {
      signals: Array<{ goalId: string; evidence: string; confidence: number }>;
    };

    if (parsed.signals && Array.isArray(parsed.signals)) {
      for (const signal of parsed.signals) {
        if (signal.confidence < 0.7) continue;

        // Verify goalId is valid
        const matchingGoal = assessmentGoals.find(g => g.id === signal.goalId);
        if (!matchingGoal) continue;

        // Check for existing unconfirmed signal for this goal
        const existing = await prisma.callerAttribute.findFirst({
          where: {
            callerId,
            key: `goal_completion_signal:${signal.goalId}`,
            scope: "GOAL_EVENT",
            booleanValue: null, // unconfirmed
          },
        });

        if (existing) {
          log.info("Completion signal already pending for goal", { goalId: signal.goalId });
          continue;
        }

        await prisma.callerAttribute.create({
          data: {
            callerId,
            key: `goal_completion_signal:${signal.goalId}`,
            scope: "GOAL_EVENT",
            jsonValue: {
              goalId: signal.goalId,
              goalName: matchingGoal.name,
              evidence: signal.evidence,
              confidence: signal.confidence,
              callId: call.id,
              extractedAt: new Date().toISOString(),
            },
            booleanValue: null, // null = pending, true = confirmed, false = dismissed
            confidence: signal.confidence,
            sourceSpecSlug: config.specs.goal,
          },
        });

        result.signalsDetected++;
        log.info("Goal completion signal detected", {
          goalId: signal.goalId,
          goalName: matchingGoal.name,
          confidence: signal.confidence,
        });
      }
    }
  } catch (error: any) {
    log.error("Goal completion signal extraction failed", { error: error.message });
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Simple string similarity (Jaccard index on words)
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}
