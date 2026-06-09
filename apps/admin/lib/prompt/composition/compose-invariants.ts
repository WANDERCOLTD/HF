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
  /**
   * #1344 Slice 4 — cross-system source of truth for the learner-facing
   * call number. When supplied, I-C2 also asserts that
   * `callNumber === sessionLearnerFacingNumber + 1`
   * (i.e. the composer is narrating the right "next call number" for
   * this caller). Supplied by the COMPOSE caller via a side-channel
   * `Session.learnerFacingNumber` read (taking the MAX of qualifying
   * Sessions). Undefined during the grace window or in tests that
   * don't thread the DB read — those skip the cross-system check.
   */
  sessionMaxLearnerFacingNumber?: number | null;
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
  // I-C2 (cross-system, #1344 Slice 4) — `callNumber` MUST equal
  // `Session.learnerFacingNumber + 1` (i.e. the next learner-facing
  // number for this Caller). The composer reads from
  // `data.nextLearnerFacingNumber` which is the Session aggregate;
  // when the COMPOSE caller threads `sessionMaxLearnerFacingNumber`
  // here as a side-channel evidence read, we assert they agree.
  //
  // WARN severity initially — the grace window after #1344 lands may
  // surface legacy callers whose Session backfill is incomplete. Promote
  // to ERROR once `scripts/proof-1344-cutover.ts` reads green for
  // ≥7 days on dev/staging.
  // ---------------------------------------------------------------
  if (ctx.sessionMaxLearnerFacingNumber !== undefined && ctx.sessionMaxLearnerFacingNumber !== null) {
    const expected = ctx.sessionMaxLearnerFacingNumber + 1;
    if (ctx.callNumber !== expected) {
      violations.push({
        id: "I-C2",
        severity: "warn",
        message:
          `Call-counter cross-system coherence (#1344 Slice 4): canonical sharedState.callNumber=${ctx.callNumber} ` +
          `but Session.learnerFacingNumber MAX=${ctx.sessionMaxLearnerFacingNumber} (expected next=${expected}). ` +
          `One side has drifted — typically the backfill missed a Session row or createSession failed to bump the counter. ` +
          `Run scripts/backfill-learner-facing-number.ts to reconcile.`,
        offendingText: `${ctx.callNumber}≠${expected}`,
      });
    }
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

// ===========================================================================
// #1346 Slice 5 — query-based invariants over Session ↔ ComposedPrompt state
// ===========================================================================
//
// These are DIFFERENT from I-C1/I-C2/I-C3 above:
//   - I-C* runs synchronously inside each COMPOSE call, against the
//     in-memory assembled prompt;
//   - I-CT* runs against the live DB, evaluated by cron + by check-fk-
//     consistency, and surfaces eventually-consistent breakage classes.
//
// Both styles co-exist here because the carry-through contract is part of
// the same overall "every COMPOSE produces a valid n+1 surface" property.
// Splitting into a sibling file would have meant two import surfaces for
// callers that want "all the compose invariants" — and we already have
// runComposeInvariants() as the natural reuse point.
//
// I-CT1 — Carry-through eventual consistency (WARN-only initially).
//   For every Session(endedAt NOT NULL, countsTowardPipelineNumber = true),
//   there MUST exist a non-null `producedComposedPromptId` within 60s of
//   `endedAt`. Promote severity to ERROR once `scripts/proof-1346-reconciler.ts`
//   reads green for ≥3 weeks on dev/staging.
//
// I-CT2 — Terminal fallback (ERROR — structural).
//   `createSession(...).usedPromptId` MUST resolve via the cascade in
//   `lib/voice/resolve-used-prompt.ts`. Any Session row written in the
//   last 60s with `usedPromptId IS NULL` AND a non-empty prior history
//   for the caller indicates the cascade silently returned null — a
//   structural break. Verified by the cascade implementation's
//   `tests/lib/voice/resolve-used-prompt.test.ts` plus this DB-level
//   detector for live drift.
//
// Both are pure read-side checks; they call no LLM and write nothing.

import { prisma } from "@/lib/prisma";

export type CarryThroughInvariantId = "I-CT1" | "I-CT2";

export interface CarryThroughInvariantResult {
  id: CarryThroughInvariantId;
  severity: InvariantSeverity;
  passed: boolean;
  /** Population that failed the invariant. 0 = clean. */
  violatingCount: number;
  /** Brief sample of violating ids for forensic logs (capped at 5). */
  sampleIds: string[];
  /** Human-readable description for the report line. */
  description: string;
}

/**
 * I-CT1 — 60-second carry-through eventual consistency.
 *
 * Counts Sessions that have ended but whose pipeline never wrote a
 * `producedComposedPromptId` and are now older than the budget. This
 * is the same query the reconciler uses to find work; if the reconciler
 * is running on schedule, this count should approach zero between cron
 * ticks.
 *
 * WARN-only initially per the 3-week soak window in #1346. Promote to
 * ERROR by editing the `severity` constant here.
 */
export const I_CT1_CARRY_THROUGH_SEVERITY: InvariantSeverity = "warn";

export async function checkI_CT1_CarryThrough(args: {
  /** Override the staleness budget (mostly for tests). Defaults to 60s. */
  staleAfterMs?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
} = {}): Promise<CarryThroughInvariantResult> {
  const now = args.now ?? (() => new Date());
  const staleAfterMs = args.staleAfterMs ?? 60_000;
  const cutoff = new Date(now().getTime() - staleAfterMs);

  const orphans = await prisma.session.findMany({
    where: {
      endedAt: { lt: cutoff, not: null },
      producedComposedPromptId: null,
      countsTowardPipelineNumber: true,
    },
    select: { id: true },
    take: 200,
    orderBy: { endedAt: "asc" },
  });

  return {
    id: "I-CT1",
    severity: I_CT1_CARRY_THROUGH_SEVERITY,
    passed: orphans.length === 0,
    violatingCount: orphans.length,
    sampleIds: orphans.slice(0, 5).map((s) => s.id),
    description:
      "Every Session(endedAt NOT NULL, countsTowardPipelineNumber=true) must have a non-null producedComposedPromptId within 60s. " +
      "Slice 5 reconciler enforces this; the count should approach zero between cron ticks.",
  };
}

/**
 * I-CT2 — Terminal fallback / always-valid usedPromptId.
 *
 * Counts Sessions started in the last 60 seconds where:
 *   - `usedPromptId IS NULL`, AND
 *   - the caller has at least one prior Session (so the cascade should
 *     have found SOMETHING — step 1 or step 2 of the I-CT2 cascade).
 *
 * This is a structural break: the cascade is supposed to always resolve
 * to a non-null id when the caller has any prior history. Severity is
 * ERROR because the contract is supposed to be impossible to violate.
 *
 * Excludes brand-new callers (no prior Session at all) — those legitimately
 * may have a null `usedPromptId` if their ENROLLMENT chain hasn't committed
 * a ComposedPrompt yet.
 */
export const I_CT2_TERMINAL_FALLBACK_SEVERITY: InvariantSeverity = "error";

export async function checkI_CT2_TerminalFallback(args: {
  /** Window over which to consider Sessions "recent". Defaults to 60s. */
  windowMs?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
} = {}): Promise<CarryThroughInvariantResult> {
  const now = args.now ?? (() => new Date());
  const windowMs = args.windowMs ?? 60_000;
  const since = new Date(now().getTime() - windowMs);

  // Sessions started recently with no usedPromptId. Then for each, check
  // whether the caller has any prior Session (older than this one). If
  // yes, the cascade should have resolved to a non-null id.
  const recentNullUsedPrompt = await prisma.session.findMany({
    where: {
      startedAt: { gte: since },
      usedPromptId: null,
    },
    select: { id: true, callerId: true, startedAt: true },
    take: 200,
    orderBy: { startedAt: "desc" },
  });

  const violations: string[] = [];
  for (const candidate of recentNullUsedPrompt) {
    // Look for ANY prior Session for this caller (Session.startedAt strictly
    // less than this row's startedAt). If found, the cascade was expected
    // to find a usedPromptId.
    const prior = await prisma.session.findFirst({
      where: {
        callerId: candidate.callerId,
        startedAt: { lt: candidate.startedAt },
      },
      select: { id: true },
    });
    if (prior) {
      violations.push(candidate.id);
    }
  }

  return {
    id: "I-CT2",
    severity: I_CT2_TERMINAL_FALLBACK_SEVERITY,
    passed: violations.length === 0,
    violatingCount: violations.length,
    sampleIds: violations.slice(0, 5),
    description:
      "Every Session for a Caller with prior history MUST have a non-null usedPromptId — resolved via the I-CT2 cascade in lib/voice/resolve-used-prompt.ts. " +
      "Null with prior history = cascade silently returned null (structural break).",
  };
}

/**
 * Run both I-CT1 and I-CT2. Returns the two results so callers can
 * report or fail-fast as appropriate. Does NOT throw — leaves the
 * decision to the caller (cron reports; check-fk-consistency may exit
 * non-zero on ERROR severity).
 */
export async function runCarryThroughInvariants(args: {
  staleAfterMs?: number;
  now?: () => Date;
} = {}): Promise<CarryThroughInvariantResult[]> {
  const [iCt1, iCt2] = await Promise.all([
    checkI_CT1_CarryThrough(args),
    checkI_CT2_TerminalFallback(args),
  ]);
  return [iCt1, iCt2];
}
