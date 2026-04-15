/**
 * Checkpoint Evaluator
 *
 * After pipeline scoring, evaluates whether session checkpoints have been met.
 * Checkpoints are defined in course reference documents and stored as
 * ContentAssertions with category "session_flow" and tag "checkpoint".
 *
 * Results stored as CallerAttributes with scope "CHECKPOINT".
 */

import { prisma } from "@/lib/prisma";

interface CheckpointResult {
  label: string;
  status: "PASSED" | "NOT_MET";
  score: number;
  threshold: number;
}

/**
 * Evaluate checkpoints for the current session based on learning outcome CallScores.
 *
 * @param callerId - The caller to evaluate
 * @param callId - The current call (scores come from this call)
 * @param sessionNumber - Current session number (1-based)
 * @returns Array of checkpoint results evaluated
 */
export async function evaluateCheckpoints(
  callerId: string,
  callId: string,
  sessionNumber: number,
): Promise<CheckpointResult[]> {
  // Load learning outcome scores from this call
  const scores = await prisma.callScore.findMany({
    where: {
      callId,
      parameter: {
        OR: [
          { parameterId: { startsWith: "COMP_" } },
          { parameterId: { startsWith: "DISC_" } },
          { parameterId: { startsWith: "COACH_" } },
        ],
      },
    },
    select: { score: true, parameter: { select: { parameterId: true } } },
  });

  // #155 checkpoint starvation warning — event-gated scoring (Slice 1 event-gate.ts)
  // now suppresses caller scores on teach/review calls, so checkpoint evaluator
  // can receive zero LO scores on legitimate teach-only callers. Without this
  // log, the checkpoint silently reports no progress across multiple sessions
  // until a dashboard notices. Minimum observations threshold is low (1) because
  // one explicit assess call is enough evidence.
  const MIN_OBSERVATIONS = 1;
  if (scores.length < MIN_OBSERVATIONS) {
    console.warn(
      `[checkpoint-evaluator] Score starvation: caller=${callerId} call=${callId} ` +
      `session=${sessionNumber} produced ${scores.length} LO scores (min=${MIN_OBSERVATIONS}). ` +
      `Likely cause: event-gated scoring suppressed teach-mode call. ` +
      `Checkpoint will not be evaluated until a scheduler 'mode: assess' decision runs.`,
    );
    return [];
  }

  // Average score across all learning outcome parameters for this session
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const threshold = 0.4; // Developing or higher = checkpoint passed

  // Determine which checkpoint(s) to evaluate based on session number
  // Convention: CP{sessionNumber * 2 - 1} = end of session, CP{sessionNumber * 2} = start of next
  // Simplified: one checkpoint per session end
  const checkpointLabel = `CP${sessionNumber}`;

  const status = avgScore >= threshold ? "PASSED" as const : "NOT_MET" as const;

  // Store result as CallerAttribute
  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: {
        callerId,
        key: checkpointLabel,
        scope: "CHECKPOINT",
      },
    },
    create: {
      callerId,
      key: checkpointLabel,
      scope: "CHECKPOINT",
      valueType: "STRING",
      stringValue: status,
      numberValue: avgScore,
      confidence: null,
    },
    update: {
      stringValue: status,
      numberValue: avgScore,
    },
  });

  return [{
    label: checkpointLabel,
    status,
    score: avgScore,
    threshold,
  }];
}
