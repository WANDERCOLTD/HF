/**
 * #1006 / #1008 — Runtime guard for the five COMPOSE → LLM output invariants.
 *
 * See `docs/CHAIN-CONTRACTS.md` Link 3 sub-contract "COMPOSE → LLM
 * (output invariants)" for the canonical definitions.
 *
 *   I-C1  Module-lock honoured                — severity ERROR
 *   I-C2  Call-counter coherence              — severity ERROR
 *   I-C3  No memory-less reminisce            — severity WARN (→ ERROR after counter=0)
 *   I-C4  No generic-noun fallback            — ESLint build-time rule
 *   I-C5  estimatedProgress heuristic debug-only — static (code review + ESLint)
 *
 * This module checks I-C1, I-C2, I-C3 at runtime against the assembled
 * prompt; I-C4 and I-C5 are caught by the
 * `hf-compose/no-orphan-instruction-fallback` ESLint rule and by reviewer
 * discipline on `transforms/modules.ts::computeSharedState`.
 *
 * Severity model:
 *   - ERROR severity: throws ComposeInvariantViolation, which the
 *     pipeline-COMPOSE caller surfaces as a stageErrors entry (HTTP 200
 *     for `prep` mode, 500 for `prompt` mode per PIPELINE.md §3.1). The
 *     prompt is NOT persisted.
 *   - WARN severity: logs structured `console.warn` with id + offending
 *     fragment; the prompt IS persisted (so educator-facing surfaces can
 *     still operate while we measure the violation rate).
 *
 * Promotion path from WARN to ERROR: once the matching audit counter
 * (e.g. `composeGenericNounFallbackCount`) reads 0 across dev/test/prod
 * for ≥7 days, flip the severity. See chain-contracts.md.
 */

export type InvariantSeverity = "error" | "warn";

export interface ComposeInvariantContext {
  /** ComposedPrompt id (when known — undefined for dry-runs). */
  composedPromptId?: string;
  /** Caller id whose prompt is being composed. */
  callerId: string;
  /** `Call.requestedModuleId` (CurriculumModule.id) if set on the next call. */
  requestedModuleId?: string | null;
  /** The locked-module name surfaced via sharedState.lockedModule. */
  lockedModuleName?: string | null;
  /** sharedState.callNumber — the canonical "(call #N)" value. */
  callNumber: number;
  /** Count of CallerMemory rows loaded for this caller. */
  memoryCount: number;
  /** Whether the priorCallFeedback loader produced any feedback content. */
  priorCallFeedbackPresent: boolean;
  /**
   * Assembled markdown prompt body — what the LLM actually reads. The
   * invariant scans operate on this string + the structured llmPrompt
   * fragments below.
   */
  callerContextMarkdown: string;
  /**
   * Structured llmPrompt sections (the JSON form). Used for the
   * pedagogy.flow inspection.
   */
  llmPrompt: Record<string, unknown>;
}

export interface ComposeInvariantViolation {
  id: "I-C1" | "I-C2" | "I-C3";
  severity: InvariantSeverity;
  message: string;
  offendingText?: string;
}

const RECONNECT_PHRASES = [
  "reference last session",
  "as we covered",
  "pick up where we left off",
  "remember from before",
  "reference the learning journey so far",
];

/**
 * Inspects the composed output and returns any invariant violations.
 * Callers decide whether to throw (severity=error) or log (severity=warn).
 */
export function checkComposeInvariants(
  ctx: ComposeInvariantContext,
): ComposeInvariantViolation[] {
  const violations: ComposeInvariantViolation[] = [];

  // ---------------------------------------------------------------
  // I-C1 — Module-lock honoured.
  //
  // When the composer has resolved a `lockedModuleName` (whether from an
  // explicit `Call.requestedModuleId` OR from the scheduler / default-
  // module resolver), the assembled prompt MUST narrate that module's
  // name and MUST NOT name a different module as "Current" or as the
  // spaced-retrieval target.
  //
  // G6 / #1154 (audit 2026-06): pre-widening, the gate only fired when
  // BOTH requestedModuleId AND lockedModuleName were truthy. That left
  // 61% of IELTS V1.0 calls and 100% of voice-path calls (where
  // requestedModuleId was always null at call-create) silently bypassing
  // the invariant — the gap that allowed #1006 Maya-class hallucination
  // to re-enter on courses without a learner-picker UI. With the
  // G6 backfill at the call-create write sites (callers/calls/route.ts
  // and voice/calls/start/route.ts), `requestedModuleId` is now non-null
  // for any new call where a default module resolved. The gate is widened
  // to fire on `lockedModuleName` alone so scheduler-set locks (no
  // explicit picker click) are also enforced.
  // ---------------------------------------------------------------
  if (ctx.lockedModuleName) {
    const promptHasLock = ctx.callerContextMarkdown.includes(ctx.lockedModuleName);
    if (!promptHasLock) {
      violations.push({
        id: "I-C1",
        severity: "error",
        message:
          `Module-lock honoured: composer resolved locked module "${ctx.lockedModuleName}"` +
          (ctx.requestedModuleId
            ? ` (Call.requestedModuleId="${ctx.requestedModuleId}")`
            : ` (scheduler / default-module resolver; Call.requestedModuleId=null)`) +
          `, but the assembled prompt does not name it. Pedagogy / quickstart / curriculum transforms produced an unrelated module reference (#1006 Maya class).`,
      });
    }
  }

  // ---------------------------------------------------------------
  // I-C2 — Call-counter coherence.
  //
  // Every "(call #N)" or "This is call N" reference in the assembled
  // prompt MUST resolve to the same N. The canonical value is
  // ctx.callNumber. Multiple distinct N values means quickstart and
  // offboarding/pedagogy disagree — same-prompt drift.
  // ---------------------------------------------------------------
  const callRefRegex = /\bcall\s*#\s*(\d+)\b|\bThis is call (\d+)\b/gi;
  const distinct = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = callRefRegex.exec(ctx.callerContextMarkdown))) {
    const n = Number(match[1] ?? match[2]);
    if (Number.isFinite(n)) distinct.add(n);
  }
  if (distinct.size > 1) {
    violations.push({
      id: "I-C2",
      severity: "error",
      message: `Call-counter coherence: assembled prompt contains ${distinct.size} distinct call numbers ${JSON.stringify(Array.from(distinct))}. Canonical sharedState.callNumber=${ctx.callNumber}. Source of drift is usually quickstart.this_caller vs offboarding/session_pedagogy fields.`,
      offendingText: Array.from(distinct).join(","),
    });
  }

  // ---------------------------------------------------------------
  // I-C3 — No memory-less reminisce.
  //
  // When the learner has zero CallerMemory rows AND no priorCallFeedback,
  // the prompt must not contain reminisce-class imperatives. WARN
  // severity initially; persists the prompt while we measure violation
  // rate via composeMemorylessReminisceCount.
  // ---------------------------------------------------------------
  const hasPriorEvidence = ctx.memoryCount > 0 || ctx.priorCallFeedbackPresent;
  if (!hasPriorEvidence) {
    const found = RECONNECT_PHRASES.filter((phrase) =>
      ctx.callerContextMarkdown.toLowerCase().includes(phrase),
    );
    if (found.length > 0) {
      violations.push({
        id: "I-C3",
        severity: "warn",
        message: `Memory-less reminisce: caller has memoryCount=${ctx.memoryCount} and priorCallFeedback=${ctx.priorCallFeedbackPresent ? "present" : "absent"} yet the prompt contains reminisce-class phrase(s): ${JSON.stringify(found)}. Risk of fabrication (#1006 Maya class).`,
        offendingText: found.join(", "),
      });
    }
  }

  return violations;
}

/**
 * Top-level guard. Throws on ERROR-severity violations; logs WARN-
 * severity violations as structured `console.warn` so the educator-
 * facing call-feedback chain can surface them.
 *
 * Returns the violation list for callers that want to inspect or pipe
 * it into stageErrors (#1008 pipeline-COMPOSE integration).
 */
export class ComposeInvariantError extends Error {
  readonly violations: ComposeInvariantViolation[];
  constructor(violations: ComposeInvariantViolation[]) {
    const msg = violations
      .map((v) => `[${v.id} ${v.severity}] ${v.message}`)
      .join("\n");
    super(`Compose invariant violation:\n${msg}`);
    this.name = "ComposeInvariantError";
    this.violations = violations;
  }
}

export function runComposeInvariants(
  ctx: ComposeInvariantContext,
): ComposeInvariantViolation[] {
  const violations = checkComposeInvariants(ctx);
  for (const v of violations) {
    const payload = {
      invariant: v.id,
      severity: v.severity,
      composedPromptId: ctx.composedPromptId ?? null,
      callerId: ctx.callerId,
      message: v.message,
      offendingText: v.offendingText ?? null,
    };
    if (v.severity === "warn") {
      console.warn("[compose-invariant]", JSON.stringify(payload));
    } else {
      console.error("[compose-invariant]", JSON.stringify(payload));
    }
  }
  const errorViolations = violations.filter((v) => v.severity === "error");
  if (errorViolations.length > 0) {
    throw new ComposeInvariantError(errorViolations);
  }
  return violations;
}
