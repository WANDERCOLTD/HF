/**
 * Composed Prompt Persistence
 *
 * Stores a composed prompt and supersedes previous active prompts.
 * Shared by both the compose-prompt API route and the pipeline COMPOSE stage.
 */

import { db, type TxClient } from "@/lib/prisma";
import type { CompositionResult } from "./types";

export interface PersistOptions {
  callerId: string;
  playbookId?: string | null;
  triggerType?: string;
  triggerCallId?: string | null;
  composeSpecSlug?: string | null;
  specConfig?: Record<string, any>;
  /** Skip DB persistence — return a preview-only mock prompt (used by forceFirstCall) */
  skipPersist?: boolean;
}

export interface PersistedPrompt {
  id: string;
  callerId: string;
  prompt: string;
  llmPrompt: any;
  status: string;
  composedAt: Date;
}

/**
 * Persist a composed prompt and supersede old active prompts for this caller.
 *
 * @param composition - The result from executeComposition()
 * @param promptSummary - The rendered prompt markdown from renderPromptSummary()
 * @param options - Persistence options (callerId, trigger info, etc.)
 * @param tx - Optional transaction client for atomic operations
 * @returns The created ComposedPrompt record
 */
export async function persistComposedPrompt(
  composition: CompositionResult,
  promptSummary: string,
  options: PersistOptions,
  tx?: TxClient,
): Promise<PersistedPrompt> {
  const {
    callerId,
    playbookId,
    triggerType = "pipeline",
    triggerCallId,
    composeSpecSlug,
    specConfig,
    skipPersist = false,
  } = options;

  const { llmPrompt, callerContext, loadedData, resolvedSpecs, metadata } = composition;

  // Preview-only mode — return mock prompt without DB write
  if (skipPersist) {
    console.log("[persist] Preview mode: skipping DB persistence (forceFirstCall)");
    return {
      id: `preview-${Date.now()}`,
      callerId,
      prompt: promptSummary,
      llmPrompt,
      status: "preview",
      composedAt: new Date(),
    };
  }

  const p = db(tx);

  const composedPrompt = await p.composedPrompt.create({
    data: {
      callerId,
      playbookId: playbookId || null,
      prompt: promptSummary,
      llmPrompt,
      triggerType,
      triggerCallId: triggerCallId || null,
      model: "deterministic",
      status: "active",
      inputs: {
        callerContext,
        memoriesCount: loadedData.memories.length,
        personalityAvailable: !!loadedData.personality,
        recentCallsCount: loadedData.recentCalls.length,
        behaviorTargetsCount: metadata.mergedTargetCount,
        playbooksUsed: loadedData.playbooks.map((p: any) => p.name),
        playbooksCount: loadedData.playbooks.length,
        identitySpec: resolvedSpecs.identitySpec?.name || null,
        contentSpec: null, // Removed in ADR-002
        specUsed: composeSpecSlug || "(defaults)",
        specConfig: specConfig || {},
        composition: {
          sectionsActivated: metadata.sectionsActivated,
          sectionsSkipped: metadata.sectionsSkipped,
          loadTimeMs: metadata.loadTimeMs,
          transformTimeMs: metadata.transformTimeMs,
        },
      },
    },
  });

  // Supersede previous active prompts for this caller, scoped to same playbook.
  // A caller can have one active prompt per playbook (course) simultaneously.
  await p.composedPrompt.updateMany({
    where: {
      callerId,
      id: { not: composedPrompt.id },
      status: "active",
      ...(playbookId ? { playbookId } : { playbookId: null }),
    },
    data: {
      status: "superseded",
    },
  });

  return composedPrompt as PersistedPrompt;
}
