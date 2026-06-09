/**
 * Composed Prompt Persistence
 *
 * Stores a composed prompt and supersedes previous active prompts.
 * Shared by both the compose-prompt API route and the pipeline COMPOSE stage.
 */

import { db, prisma, type TxClient } from "@/lib/prisma";
import type { CompositionResult } from "./types";

export interface PersistOptions {
  callerId: string;
  playbookId?: string | null;
  triggerType?: string;
  /**
   * #1344 Slice 4 — `triggerCallId` is GONE. Pipeline callers must pass
   * `triggerSessionId` (looked up via `Call.sessionId` when starting from
   * a Call id, or resolved directly from the active Session). The
   * Session is the canonical trigger surface; the dual-FK transition
   * window from #1341 Slice 0 is complete.
   */
  triggerSessionId?: string | null;
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
    triggerSessionId,
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

  // #599 Slice 1 — populate the recap cache column when the loader produced
  // a synthesized recap. The loader writes the AI call + audit row; persist
  // just stores the cached text alongside the new prompt row so subsequent
  // composes for the same triggerSessionId can short-circuit.
  const synthesizedRecap = composition.loadedData?.priorCallFeedback?.synthesizedRecap ?? null;
  const recapSynthesisCache = synthesizedRecap
    ? {
        depth: synthesizedRecap.depth,
        text: synthesizedRecap.text,
        cachedAt: synthesizedRecap.cachedAt,
      }
    : undefined;

  // A2 — the create-new-active + supersede-old-active pair MUST be atomic.
  // Pre-fix, two concurrent recomposes could both finish their create()
  // before either reached updateMany(), leaving two `status:"active"` rows
  // for the same (callerId, playbookId). The downstream reader at
  // /api/callers/[id]/active-playbook then picks one non-deterministically.
  // When the caller already supplied a tx (rare: pipeline COMPOSE stage
  // wraps a bigger commit), reuse it; otherwise open a fresh one.
  const persist = async (client: TxClient): Promise<PersistedPrompt> => {
    const composedPrompt = await client.composedPrompt.create({
      data: {
        callerId,
        playbookId: playbookId || null,
        prompt: promptSummary,
        llmPrompt,
        triggerType,
        triggerSessionId: triggerSessionId || null,
        model: "deterministic",
        status: "active",
        ...(recapSynthesisCache ? { recapSynthesisCache } : {}),
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
    await client.composedPrompt.updateMany({
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
  };

  if (tx) {
    return persist(db(tx));
  }
  return prisma.$transaction(async (innerTx) => persist(innerTx as TxClient));
}
