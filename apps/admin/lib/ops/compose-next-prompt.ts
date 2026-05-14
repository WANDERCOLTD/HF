/**
 * compose-next-prompt.ts
 *
 * Compose Next Prompt (Final step of reward loop)
 *
 * Uses learned targets, reward history, and caller context to compose
 * a personalized prompt for the next conversation with each caller.
 *
 * Flow:
 * 1. Load caller's effective behavior targets (merged SYSTEM→SEGMENT→CALLER)
 * 2. Load recent reward history for context
 * 3. Load caller memories and personality profile
 * 4. Compose a prompt that guides agent behavior toward targets
 * 5. Store in Caller.nextPrompt for use in next conversation
 *
 * This is the final step in the post-call reward loop.
 */

import { PrismaClient, BehaviorTargetScope } from "@prisma/client";
import { PARAM_GROUPS, TRAITS, TRAIT_NAMES } from "@/lib/registry";
import type { SpecConfig } from "@/lib/types/json-fields";

const prisma = new PrismaClient();

// Config loaded from COMPOSE_NEXT_PROMPT spec
interface ComposeNextPromptConfig {
  targetLevelThresholds: {
    high: number;
    moderateHigh: number;
    balanced: number;
    moderateLow: number;
  };
  confidenceThresholds: {
    stillLearning: number;
    wellEstablished: number;
  };
  parameterGroups: {
    communicationStyle: string[];
    engagementApproach: string[];
    adaptability: string[];
  };
  personalityTraits: {
    thresholdHigh: number;
    thresholdLow: number;
    traitIds: string[];
    traitNames: Record<string, string>;
  };
  timeWindows: {
    maxAgeHours: number;
    recentActivityDays: number;
  };
}

// Default config uses registry constants instead of hardcoded strings
const DEFAULT_COMPOSE_CONFIG: ComposeNextPromptConfig = {
  targetLevelThresholds: {
    high: 0.8,
    moderateHigh: 0.6,
    balanced: 0.4,
    moderateLow: 0.2,
  },
  confidenceThresholds: {
    stillLearning: 0.4,
    wellEstablished: 0.7,
  },
  parameterGroups: {
    // Use registry constants - changes to parameter IDs flow through automatically
    communicationStyle: [...PARAM_GROUPS.COMMUNICATION_STYLE],
    engagementApproach: [...PARAM_GROUPS.ENGAGEMENT_APPROACH],
    adaptability: [...PARAM_GROUPS.ADAPTABILITY],
  },
  personalityTraits: {
    thresholdHigh: 0.7,
    thresholdLow: 0.3,
    traitIds: [...PARAM_GROUPS.PERSONALITY_TRAITS],
    traitNames: { ...TRAIT_NAMES },
  },
  timeWindows: {
    maxAgeHours: 24,
    recentActivityDays: 30,
  },
};

// Cached config
let cachedComposeConfig: ComposeNextPromptConfig | null = null;

/**
 * Load COMPOSE_NEXT_PROMPT spec config from database
 */
async function loadComposeConfig(): Promise<ComposeNextPromptConfig> {
  if (cachedComposeConfig) {
    return cachedComposeConfig;
  }

  const spec = await prisma.analysisSpec.findFirst({
    where: {
      domain: "compose-next-prompt",
      outputType: "COMPOSE",
      isActive: true,
      scope: "SYSTEM",
    },
  });

  if (!spec?.config) {
    return DEFAULT_COMPOSE_CONFIG;
  }

  const specConfig = spec.config as SpecConfig;
  cachedComposeConfig = {
    targetLevelThresholds: {
      high: specConfig.targetLevelThresholds?.high ?? DEFAULT_COMPOSE_CONFIG.targetLevelThresholds.high,
      moderateHigh: specConfig.targetLevelThresholds?.moderateHigh ?? DEFAULT_COMPOSE_CONFIG.targetLevelThresholds.moderateHigh,
      balanced: specConfig.targetLevelThresholds?.balanced ?? DEFAULT_COMPOSE_CONFIG.targetLevelThresholds.balanced,
      moderateLow: specConfig.targetLevelThresholds?.moderateLow ?? DEFAULT_COMPOSE_CONFIG.targetLevelThresholds.moderateLow,
    },
    confidenceThresholds: {
      stillLearning: specConfig.confidenceThresholds?.stillLearning ?? DEFAULT_COMPOSE_CONFIG.confidenceThresholds.stillLearning,
      wellEstablished: specConfig.confidenceThresholds?.wellEstablished ?? DEFAULT_COMPOSE_CONFIG.confidenceThresholds.wellEstablished,
    },
    parameterGroups: {
      communicationStyle: specConfig.parameterGroups?.communicationStyle ?? DEFAULT_COMPOSE_CONFIG.parameterGroups.communicationStyle,
      engagementApproach: specConfig.parameterGroups?.engagementApproach ?? DEFAULT_COMPOSE_CONFIG.parameterGroups.engagementApproach,
      adaptability: specConfig.parameterGroups?.adaptability ?? DEFAULT_COMPOSE_CONFIG.parameterGroups.adaptability,
    },
    personalityTraits: {
      thresholdHigh: specConfig.personalityTraits?.thresholdHigh ?? DEFAULT_COMPOSE_CONFIG.personalityTraits.thresholdHigh,
      thresholdLow: specConfig.personalityTraits?.thresholdLow ?? DEFAULT_COMPOSE_CONFIG.personalityTraits.thresholdLow,
      traitIds: specConfig.personalityTraits?.traitIds ?? DEFAULT_COMPOSE_CONFIG.personalityTraits.traitIds,
      traitNames: specConfig.personalityTraits?.traitNames ?? DEFAULT_COMPOSE_CONFIG.personalityTraits.traitNames,
    },
    timeWindows: {
      maxAgeHours: specConfig.timeWindows?.maxAgeHours ?? DEFAULT_COMPOSE_CONFIG.timeWindows.maxAgeHours,
      recentActivityDays: specConfig.timeWindows?.recentActivityDays ?? DEFAULT_COMPOSE_CONFIG.timeWindows.recentActivityDays,
    },
  };

  return cachedComposeConfig;
}

interface ComposeNextPromptOptions {
  verbose?: boolean;
  plan?: boolean;
  callerId?: string;       // Compose for specific caller
  limit?: number;          // Max callers to process
  forceRecompose?: boolean; // Recompose even if recent
  maxAge?: number;         // Only recompose if older than N hours
}

interface PromptSection {
  category: string;
  instructions: string[];
}

interface ComposeNextPromptResult {
  callersProcessed: number;
  promptsComposed: number;
  skipped: number;
  errors: string[];
  compositions: Array<{
    callerId: string;
    callerName: string;
    targetCount: number;
    memoryCount: number;
    promptLength: number;
  }>;
}

/**
 * Format a target into a prompt instruction
 * Uses thresholds from config
 */
function formatTargetInstruction(
  parameterName: string,
  targetValue: number,
  confidence: number,
  interpretationHigh: string,
  interpretationLow: string,
  config: ComposeNextPromptConfig
): string {
  const { targetLevelThresholds, confidenceThresholds } = config;

  // Convert 0-1 scale to descriptive level using config thresholds
  let level: string;
  let instruction: string;

  if (targetValue >= targetLevelThresholds.high) {
    level = "high";
    instruction = interpretationHigh;
  } else if (targetValue >= targetLevelThresholds.moderateHigh) {
    level = "moderate-high";
    instruction = `Lean toward: ${interpretationHigh.toLowerCase()}`;
  } else if (targetValue >= targetLevelThresholds.balanced) {
    level = "balanced";
    instruction = `Balance between high and low approaches`;
  } else if (targetValue >= targetLevelThresholds.moderateLow) {
    level = "moderate-low";
    instruction = `Lean toward: ${interpretationLow.toLowerCase()}`;
  } else {
    level = "low";
    instruction = interpretationLow;
  }

  // Add confidence qualifier using config thresholds
  const confidenceNote = confidence < confidenceThresholds.stillLearning
    ? " (still learning - be flexible)"
    : confidence > confidenceThresholds.wellEstablished
      ? " (well-established preference)"
      : "";

  return `${parameterName}: ${instruction}${confidenceNote}`;
}

/**
 * Load effective targets for a caller identity (merged hierarchy)
 */
async function loadEffectiveTargets(callerIdentityId: string, segmentId: string | null): Promise<Map<string, any>> {
  const effectiveTargets = new Map<string, any>();

  // Load SYSTEM targets first
  const systemTargets = await prisma.behaviorTarget.findMany({
    where: {
      scope: BehaviorTargetScope.SYSTEM,
      effectiveUntil: null,
    },
    include: {
      parameter: true,
    },
  });

  for (const target of systemTargets) {
    effectiveTargets.set(target.parameterId, {
      targetValue: target.targetValue,
      confidence: target.confidence,
      source: target.source,
      scope: "SYSTEM",
      parameter: target.parameter,
    });
  }

  // Override with SEGMENT targets if caller has a segment
  if (segmentId) {
    const segmentTargets = await prisma.behaviorTarget.findMany({
      where: {
        scope: BehaviorTargetScope.SEGMENT,
        segmentId,
        effectiveUntil: null,
      },
      include: {
        parameter: true,
      },
    });

    for (const target of segmentTargets) {
      effectiveTargets.set(target.parameterId, {
        targetValue: target.targetValue,
        confidence: target.confidence,
        source: target.source,
        scope: "SEGMENT",
        parameter: target.parameter,
      });
    }
  }

  // Override with CALLER targets
  const callerTargets = await prisma.behaviorTarget.findMany({
    where: {
      scope: BehaviorTargetScope.CALLER,
      callerIdentityId,
      effectiveUntil: null,
    },
    include: {
      parameter: true,
    },
  });

  for (const target of callerTargets) {
    effectiveTargets.set(target.parameterId, {
      targetValue: target.targetValue,
      confidence: target.confidence,
      source: target.source,
      scope: "CALLER",
      parameter: target.parameter,
    });
  }

  return effectiveTargets;
}

/**
 * Compose a prompt for a specific caller identity
 * Uses config loaded from COMPOSE_NEXT_PROMPT spec
 */
async function composePromptForCaller(
  callerIdentity: any,
  effectiveTargets: Map<string, any>,
  verbose: boolean,
  config: ComposeNextPromptConfig
): Promise<string> {
  const sections: PromptSection[] = [];

  // === SECTION 1: Caller Context ===
  const contextInstructions: string[] = [];

  // Get the linked Caller record
  const callerRecord = callerIdentity.caller;

  if (callerIdentity.name || callerRecord?.name) {
    const name = callerIdentity.name || callerRecord?.name;
    contextInstructions.push(`This caller's name is ${name}. Use their name naturally in conversation.`);
  }

  // Load recent memories (only if caller identity has an associated caller)
  let memories: any[] = [];
  if (callerIdentity.callerId) {
    memories = await prisma.callerMemory.findMany({
      where: {
        callerId: callerIdentity.callerId,
        supersededById: null, // Only current, non-superseded memories
      },
      orderBy: { extractedAt: "desc" },
      take: 10,
    });
  }

  if (memories.length > 0) {
    contextInstructions.push("Key things to remember about this caller:");
    for (const memory of memories) {
      contextInstructions.push(`  - ${memory.key}: ${memory.value}`);
    }
  }

  // Load personality profile if available (using config thresholds)
  if (callerRecord) {
    const callerPersonality = await prisma.callerPersonality.findUnique({
      where: { callerId: callerRecord.id },
    });

    if (callerPersonality) {
      const traits: string[] = [];
      const { thresholdHigh, thresholdLow } = config.personalityTraits;

      // Trait descriptions (could also be moved to config if needed)
      const traitDescriptions: Record<string, { high: string; low: string }> = {
        openness: { high: "Open to new experiences and ideas", low: "Prefers familiar, proven approaches" },
        conscientiousness: { high: "Detail-oriented and organized", low: "Flexible and spontaneous" },
        extraversion: { high: "Energetic and talkative", low: "Reserved and reflective" },
        agreeableness: { high: "Cooperative and trusting", low: "Direct and analytical" },
        neuroticism: { high: "May need extra reassurance", low: "Emotionally stable" },
      };

      // Check each trait using config thresholds
      for (const [traitField, descriptions] of Object.entries(traitDescriptions)) {
        const value = (callerPersonality as unknown as Record<string, number | null>)[traitField];
        if (value !== null) {
          const traitName = traitField.charAt(0).toUpperCase() + traitField.slice(1);
          if (value >= thresholdHigh) {
            traits.push(`High ${traitName}: ${descriptions.high}`);
          } else if (value <= thresholdLow) {
            traits.push(`Low ${traitName}: ${descriptions.low}`);
          }
        }
      }

      if (traits.length > 0) {
        contextInstructions.push("Caller personality traits to consider:");
        for (const trait of traits) {
          contextInstructions.push(`  - ${trait}`);
        }
      }

      // Add communication preferences if available
      if (callerPersonality.preferredTone) {
        contextInstructions.push(`  - Preferred tone: ${callerPersonality.preferredTone}`);
      }
      if (callerPersonality.preferredLength) {
        contextInstructions.push(`  - Preferred response length: ${callerPersonality.preferredLength}`);
      }
    }
  }

  if (contextInstructions.length > 0) {
    sections.push({
      category: "Caller Context",
      instructions: contextInstructions,
    });
  }

  // === SECTION 2: Communication Style (using config parameter groups) ===
  const styleInstructions: string[] = [];
  for (const paramId of config.parameterGroups.communicationStyle) {
    const target = effectiveTargets.get(paramId);
    if (target && target.parameter) {
      styleInstructions.push(formatTargetInstruction(
        target.parameter.name,
        target.targetValue,
        target.confidence,
        target.parameter.interpretationHigh || "",
        target.parameter.interpretationLow || "",
        config
      ));
    }
  }

  if (styleInstructions.length > 0) {
    sections.push({
      category: "Communication Style",
      instructions: styleInstructions,
    });
  }

  // === SECTION 3: Engagement Approach (using config parameter groups) ===
  const engagementInstructions: string[] = [];
  for (const paramId of config.parameterGroups.engagementApproach) {
    const target = effectiveTargets.get(paramId);
    if (target && target.parameter) {
      engagementInstructions.push(formatTargetInstruction(
        target.parameter.name,
        target.targetValue,
        target.confidence,
        target.parameter.interpretationHigh || "",
        target.parameter.interpretationLow || "",
        config
      ));
    }
  }

  if (engagementInstructions.length > 0) {
    sections.push({
      category: "Engagement Approach",
      instructions: engagementInstructions,
    });
  }

  // === SECTION 4: Adaptability (using config parameter groups) ===
  const adaptInstructions: string[] = [];
  for (const paramId of config.parameterGroups.adaptability) {
    const target = effectiveTargets.get(paramId);
    if (target && target.parameter) {
      adaptInstructions.push(formatTargetInstruction(
        target.parameter.name,
        target.targetValue,
        target.confidence,
        target.parameter.interpretationHigh || "",
        target.parameter.interpretationLow || "",
        config
      ));
    }
  }

  if (adaptInstructions.length > 0) {
    sections.push({
      category: "Adaptability",
      instructions: adaptInstructions,
    });
  }

  // === SECTION 5: Recent Interaction Notes ===
  // Only fetch recent calls if caller identity has an associated caller
  let recentCalls: any[] = [];
  if (callerIdentity.callerId) {
    recentCalls = await prisma.call.findMany({
      where: {
        callerId: callerIdentity.callerId,
      },
      include: {
        rewardScore: true,
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
  }

  const recentNotes: string[] = [];
  for (const call of recentCalls) {
    if (call.rewardScore) {
      const reward = call.rewardScore;
      if (reward.overallScore < 0) {
        // Extract learnings from negative outcomes
        const diffs = reward.parameterDiffs as Record<string, any> | null;
        if (diffs) {
          const missedTargets = Object.entries(diffs)
            .filter(([_, v]) => !v.withinTolerance)
            .map(([k, _]) => k);
          if (missedTargets.length > 0) {
            recentNotes.push(`In recent conversation, these areas needed improvement: ${missedTargets.join(", ")}`);
          }
        }
      }
    }
  }

  if (recentNotes.length > 0) {
    sections.push({
      category: "Recent Interaction Notes",
      instructions: recentNotes,
    });
  }

  // === Compose final prompt ===
  const promptParts: string[] = [
    "# Caller-Specific Guidance",
    "",
    "The following guidance has been learned from past interactions with this caller.",
    "Use it to personalize your communication approach.",
    "",
  ];

  for (const section of sections) {
    promptParts.push(`## ${section.category}`);
    for (const instruction of section.instructions) {
      promptParts.push(instruction);
    }
    promptParts.push("");
  }

  return promptParts.join("\n");
}

export async function composeNextPrompt(
  options: ComposeNextPromptOptions = {}
): Promise<ComposeNextPromptResult> {
  const {
    verbose = false,
    plan = false,
    callerId,
    limit = 100,
    forceRecompose = false,
    maxAge = 24, // Hours
  } = options;

  const result: ComposeNextPromptResult = {
    callersProcessed: 0,
    promptsComposed: 0,
    skipped: 0,
    errors: [],
    compositions: [],
  };

  // Load config from spec
  const config = await loadComposeConfig();

  // Find caller identities that need prompt composition
  const maxAgeDate = new Date(Date.now() - maxAge * 60 * 60 * 1000);
  const recentActivityDate = new Date(Date.now() - config.timeWindows.recentActivityDays * 24 * 60 * 60 * 1000);

  const callerIdentities = await prisma.callerIdentity.findMany({
    where: {
      ...(callerId ? { id: callerId } : {}),
      // Only compose for callers with recent activity (using lastCallAt)
      lastCallAt: { gte: recentActivityDate },
      // Optionally filter by last composition time
      ...(!forceRecompose ? {
        OR: [
          { nextPromptComposedAt: null },
          { nextPromptComposedAt: { lt: maxAgeDate } },
        ],
      } : {}),
    },
    include: {
      caller: true,
      segment: true,
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  if (verbose) console.log(`Found ${callerIdentities.length} caller identities needing prompt composition`);

  if (plan) {
    console.log("\n=== COMPOSE NEXT PROMPT PLAN ===");
    console.log(`Caller identities to process: ${callerIdentities.length}`);
    console.log(`Max age: ${maxAge} hours`);
    console.log(`Force recompose: ${forceRecompose}`);
    for (const c of callerIdentities.slice(0, 5)) {
      console.log(`  - ${c.name || c.id}: last composed ${c.nextPromptComposedAt || "never"}`);
    }
    return result;
  }

  // Process each caller identity
  for (const callerIdentity of callerIdentities) {
    try {
      result.callersProcessed++;

      // Load effective targets
      const effectiveTargets = await loadEffectiveTargets(callerIdentity.id, callerIdentity.segmentId);

      if (effectiveTargets.size === 0) {
        if (verbose) console.log(`CallerIdentity ${callerIdentity.id}: No behavior targets found, skipping`);
        result.skipped++;
        continue;
      }

      // Compose the prompt
      const prompt = await composePromptForCaller(callerIdentity, effectiveTargets, verbose, config);

      // Load memory count for reporting
      let memoryCount = 0;
      if (callerIdentity.callerId) {
        memoryCount = await prisma.callerMemory.count({
          where: {
            callerId: callerIdentity.callerId,
            supersededById: null,
          },
        });
      }

      // Store the composed prompt in CallerIdentity (legacy)
      await prisma.callerIdentity.update({
        where: { id: callerIdentity.id },
        data: {
          nextPrompt: prompt,
          nextPromptComposedAt: new Date(),
          nextPromptInputs: {
            targetCount: effectiveTargets.size,
            memoryCount,
            composedAt: new Date().toISOString(),
          },
        },
      });

      // Also create a ComposedPrompt record (for usedPromptId tracking)
      // Only create if we have a linked Caller record
      if (callerIdentity.callerId) {
        // Mark previous prompts as superseded
        await prisma.composedPrompt.updateMany({
          where: {
            callerId: callerIdentity.callerId,
            status: "active",
          },
          data: {
            status: "superseded",
          },
        });

        // Create the new ComposedPrompt record
        await prisma.composedPrompt.create({
          data: {
            callerId: callerIdentity.callerId,
            prompt,
            llmPrompt: {
              _source: "compose-next-prompt",
              targetCount: effectiveTargets.size,
              memoryCount,
              targets: Object.fromEntries(
                Array.from(effectiveTargets.entries()).map(([k, v]) => [
                  k,
                  { value: v.targetValue, confidence: v.confidence, scope: v.scope },
                ])
              ),
            },
            triggerType: "scheduled",
            model: "compose-next-prompt",
            status: "active",
            inputs: {
              targetCount: effectiveTargets.size,
              memoryCount,
              segmentId: callerIdentity.segmentId,
              composedAt: new Date().toISOString(),
            },
          },
        });
      }

      result.promptsComposed++;
      result.compositions.push({
        callerId: callerIdentity.id,
        callerName: callerIdentity.name || "(anonymous)",
        targetCount: effectiveTargets.size,
        memoryCount,
        promptLength: prompt.length,
      });

      if (verbose) {
        console.log(`CallerIdentity ${callerIdentity.name || callerIdentity.id}: Composed prompt (${prompt.length} chars, ${effectiveTargets.size} targets)`);
      }
    } catch (error: any) {
      const errorMsg = `Error composing prompt for caller identity ${callerIdentity.id}: ${error.message}`;
      result.errors.push(errorMsg);
      if (verbose) console.error(errorMsg);
    }
  }

  if (verbose) {
    console.log(`\nCompose Next Prompt Complete:`);
    console.log(`  Callers processed: ${result.callersProcessed}`);
    console.log(`  Prompts composed: ${result.promptsComposed}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Errors: ${result.errors.length}`);
  }

  return result;
}

/**
 * Backfill usedPromptId for calls that don't have it set.
 * For each call, finds the most recent ComposedPrompt before the call's createdAt.
 */
interface BackfillResult {
  callsProcessed: number;
  callsUpdated: number;
  callsSkipped: number;
  errors: string[];
}

export async function backfillUsedPromptIds(options: {
  verbose?: boolean;
  plan?: boolean;
  limit?: number;
  callerId?: string;
} = {}): Promise<BackfillResult> {
  const { verbose = false, plan = false, limit = 1000, callerId } = options;

  const result: BackfillResult = {
    callsProcessed: 0,
    callsUpdated: 0,
    callsSkipped: 0,
    errors: [],
  };

  // Find calls without usedPromptId
  const calls = await prisma.call.findMany({
    where: {
      usedPromptId: null,
      callerId: { not: null },
      ...(callerId ? { callerId } : {}),
    },
    select: {
      id: true,
      callerId: true,
      createdAt: true,
      callSequence: true,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (verbose) console.log(`Found ${calls.length} calls without usedPromptId`);

  if (plan) {
    console.log("\n=== BACKFILL PLAN ===");
    console.log(`Calls to process: ${calls.length}`);
    for (const call of calls.slice(0, 10)) {
      console.log(`  - Call ${call.id.slice(0, 8)}... (seq #${call.callSequence || "?"}) at ${call.createdAt.toISOString()}`);
    }
    if (calls.length > 10) console.log(`  ... and ${calls.length - 10} more`);
    return result;
  }

  for (const call of calls) {
    result.callsProcessed++;

    try {
      // Find the most recent ComposedPrompt before this call
      const prompt = await prisma.composedPrompt.findFirst({
        where: {
          callerId: call.callerId!,
          composedAt: { lt: call.createdAt },
        },
        orderBy: { composedAt: "desc" },
        select: { id: true, composedAt: true },
      });

      if (prompt) {
        await prisma.call.update({
          where: { id: call.id },
          data: { usedPromptId: prompt.id },
        });
        result.callsUpdated++;
        if (verbose) {
          console.log(`Call ${call.id.slice(0, 8)}... → Prompt ${prompt.id.slice(0, 8)}... (composed ${prompt.composedAt.toISOString()})`);
        }
      } else {
        result.callsSkipped++;
        if (verbose) {
          console.log(`Call ${call.id.slice(0, 8)}... → No prompt found before ${call.createdAt.toISOString()}`);
        }
      }
    } catch (error: any) {
      result.errors.push(`Error processing call ${call.id}: ${error.message}`);
      if (verbose) console.error(`Error processing call ${call.id}:`, error.message);
    }
  }

  if (verbose) {
    console.log(`\nBackfill Complete:`);
    console.log(`  Calls processed: ${result.callsProcessed}`);
    console.log(`  Calls updated: ${result.callsUpdated}`);
    console.log(`  Calls skipped (no matching prompt): ${result.callsSkipped}`);
    console.log(`  Errors: ${result.errors.length}`);
  }

  return result;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: ComposeNextPromptOptions = {
    verbose: args.includes("--verbose") || args.includes("-v"),
    plan: args.includes("--plan"),
    forceRecompose: args.includes("--force"),
    limit: parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "100"),
    callerId: args.find(a => a.startsWith("--caller="))?.split("=")[1],
    maxAge: parseInt(args.find(a => a.startsWith("--max-age="))?.split("=")[1] || "24"),
  };

  composeNextPrompt(options)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error("Fatal error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
