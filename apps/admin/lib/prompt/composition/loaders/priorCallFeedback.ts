/**
 * priorCallFeedback loader (#492 Slice 3.5 + #599 Slice 1)
 *
 * When composing the prompt for the next call on a given module, pull a brief
 * "since your last attempt on this module" recap so the AI tutor can reference
 * what the learner struggled with last time.
 *
 * The output is consumed by the `renderPriorCallFeedback` transform and emitted
 * as the `priorCallFeedback` section between `curriculum` and `learner_goals`.
 *
 * Implementation notes:
 *   - Pure function — takes a prisma client + scope as args so it can be tested
 *     against a mock client and reused outside the composition path.
 *   - Single Call query + single CallScore query (no N+1) for the templated
 *     path. The synthesis path adds: optional Caller lookup, optional Call
 *     transcript fetch, SystemSetting allowlist check, UsageEvent cap count,
 *     ComposedPrompt cache read, AuditLog write — all behind feature gates.
 *   - Safe by default: any unexpected error returns `hasFeedback: false`.
 *     Synthesis failures degrade to the templated path (caught in the loader).
 *
 * **#599 Slice 1 — synthesis wrapping.** When `opts.playbookConfig?.priorCallRecap`
 * opts in (and every gate passes), the loader replaces the templated summary
 * with an AI-synthesized version. Gates fire in order:
 *   1. `process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED === "true"` (kill switch)
 *   2. `playbookConfig.priorCallRecap.enabled === true`
 *   3. `SystemSetting prior_call_recap.allowlist` contains `playbookId`
 *   4. `UsageEvent` count for today < `dailyCap`
 *   5. Depth dispatch: `minimal` short-circuits to templated path (no AI call)
 *   6. Cache read: existing `ComposedPrompt.recapSynthesisCache.depth` match → hit
 *   7. Synthesize → audit log → return
 *
 * Cache writes happen at persist time — see `lib/prompt/composition/persist.ts`,
 * which reads `synthesizedRecap` off the loader output and writes it to
 * `ComposedPrompt.recapSynthesisCache`.
 *
 * @see SectionDataLoader.registerLoader("priorCallFeedback", ...)
 * @see transforms/priorCallFeedback.ts (renderPriorCallFeedback transform)
 * @see loaders/synthesizePriorCallRecap.ts (synthesis function)
 */

import type { PrismaClient } from "@prisma/client";
import type { PlaybookConfig, PriorCallRecapDepth } from "@/lib/types/json-fields";
import { synthesizePriorCallRecap, RICH_TRANSCRIPT_SLICE_LIMIT } from "./synthesizePriorCallRecap";

/** Server-side ceiling on `priorCallRecap.dailyCap`. Anything larger is treated as this. */
export const PRIOR_CALL_RECAP_DAILY_CAP_MAX = 500;

/** Default per-playbook cap when `priorCallRecap.dailyCap` is absent. */
export const PRIOR_CALL_RECAP_DAILY_CAP_DEFAULT = 50;

/** SystemSetting key holding the JSON-encoded playbookId allowlist. */
export const PRIOR_CALL_RECAP_ALLOWLIST_KEY = "prior_call_recap.allowlist";

/** UsageEvent.sourceOp value emitted by the synthesis AI call. */
export const PRIOR_CALL_RECAP_SOURCE_OP = "compose.prior-call-recap";

/** AuditLog.action values written by the gate sequence. */
export const PRIOR_CALL_RECAP_ACTIONS = {
  synthesized: "prior-call-recap-synthesized",
  allowlistEmpty: "prior-call-recap-allowlist-empty",
  capExceeded: "prior-call-recap-cap-exceeded",
} as const;

export interface PriorCallRecapCacheEntry {
  depth: PriorCallRecapDepth;
  text: string;
  cachedAt: string;
}

export interface SynthesizedRecapResult {
  depth: PriorCallRecapDepth;
  text: string;
  cachedAt: string;
  cachedHit: boolean;
}

export interface PriorCallFeedbackData {
  hasFeedback: boolean;
  /** ISO date of the most recent prior call on this module */
  lastCallAt: string | null;
  lastCallId: string | null;
  /** Lowest-scoring parameter's name */
  weakestParameterName: string | null;
  /** Lowest-scoring parameter's score (0–1) */
  weakestParameterScore: number | null;
  /** Average of all CallScore rows on the prior call (0–1) */
  overallScore: number | null;
  /** 1–2 sentence canned summary — friendly, with relative time */
  summary: string | null;
  /**
   * #599 Slice 1 — when the AI synthesis path ran (or returned a cache hit),
   * the resolved depth + text. Null on the templated path (every gate-blocked
   * scenario, plus `depth: "minimal"`). Persisted to
   * `ComposedPrompt.recapSynthesisCache` by `persistComposedPrompt`.
   */
  synthesizedRecap?: SynthesizedRecapResult | null;
}

export interface LoadPriorCallFeedbackOptions {
  callerId: string;
  /** CurriculumModule.id to scope the prior-call lookup */
  moduleId: string;
  /** Current call id to exclude from the search (so we never self-reference) */
  currentCallId?: string | null;
  /** Override "now" for deterministic tests */
  now?: Date;
  /**
   * #599 Slice 1 — playbook being composed for. Required for the synthesis
   * gate sequence (allowlist + daily cap + cache key). When absent, the
   * loader runs the templated path only.
   */
  playbookId?: string | null;
  /**
   * #599 Slice 1 — playbook config feeding `priorCallRecap` gates. Pass
   * `null` (or omit) to bypass synthesis entirely (templated path only).
   */
  playbookConfig?: PlaybookConfig | null;
}

const EMPTY: PriorCallFeedbackData = {
  hasFeedback: false,
  lastCallAt: null,
  lastCallId: null,
  weakestParameterName: null,
  weakestParameterScore: null,
  overallScore: null,
  summary: null,
};

/**
 * Subset of PrismaClient used by this loader — narrows the surface so tests
 * can pass a minimal mock object. #599 Slice 1 widens the surface to cover
 * the synthesis gates.
 */
type PrismaForLoader = Pick<
  PrismaClient,
  "call" | "callScore" | "systemSetting" | "usageEvent" | "composedPrompt" | "auditLog" | "caller"
>;

/**
 * Load the prior-call feedback summary for a given caller + module.
 *
 * Returns {@link EMPTY} (with `hasFeedback: false`) when:
 *   - `moduleId` or `callerId` is missing/empty
 *   - No prior `Call` row exists for the (callerId, moduleId) pair (other than
 *     `currentCallId`, which is excluded)
 *   - The prior call exists but has no `CallScore` rows (still returns
 *     `hasFeedback: true` with a friendly fallback summary — see tests)
 */
export async function loadPriorCallFeedback(
  prisma: PrismaForLoader,
  opts: LoadPriorCallFeedbackOptions,
): Promise<PriorCallFeedbackData> {
  const { callerId, moduleId, currentCallId, now } = opts;
  if (!callerId || !moduleId) return EMPTY;

  // 1. Most recent prior call on this module (excluding currentCallId)
  const priorCall = await prisma.call.findFirst({
    where: {
      callerId,
      curriculumModuleId: moduleId,
      ...(currentCallId ? { id: { not: currentCallId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (!priorCall) return EMPTY;

  // 2. Scores from that prior call (joined to parameter name + parameterId)
  const allScores = await prisma.callScore.findMany({
    where: { callId: priorCall.id },
    select: {
      score: true,
      moduleId: true,
      parameterId: true,
      parameter: { select: { name: true, parameterId: true } },
    },
  });

  // #611 Fix C — relevance filter for "weakest area" selection.
  //
  // The pre-#611 behaviour picked the lowest-scoring parameter across the
  // FULL CallScore set, including coaching parameters (`action_commitment`,
  // `goal_clarity`, …) that wandered into the AGGREGATE batch and scored 0
  // in the zero-storm bug. That surfaced "your weakest area was
  // action_commitment (0.0/9)" in the priorCallFeedback summary on an IELTS
  // playbook — nonsense.
  //
  // Strategy (primary = category filter):
  //   1. If the prior call has any `skill_*` parameters, restrict the
  //      weakest-area pick to those (skill-domain relevance).
  //   2. If `CallScore.moduleId` matches the current module on any of those
  //      skill rows, prefer those (module-domain relevance).
  //   3. Otherwise fall back to the full set (pure coaching playbooks have
  //      no skill params; this keeps the legacy behaviour for them).
  //
  // Why NOT a strict `moduleId: moduleId` where-clause on the query:
  // `CallScore.moduleId` is `String?` (nullable). A strict filter would
  // silently drop legitimate null-moduleId rows. The post-filter approach
  // surfaces both null and matching-moduleId rows for the relevance pick
  // while keeping the full set for the overall-score average.
  //
  // See: docs/epic-100-chain-walk.md (Link 5 — SCORE → ADAPT)
  //      gh issue view 611 (Symptom 3 — irrelevant param in priorCallFeedback)
  const skillScores = allScores.filter((s) =>
    (s.parameterId ?? s.parameter?.parameterId ?? "").startsWith("skill_"),
  );
  const moduleSkillScores = skillScores.filter((s) => s.moduleId === moduleId);
  const relevanceCandidates =
    moduleSkillScores.length > 0
      ? moduleSkillScores
      : skillScores.length > 0
        ? skillScores
        : allScores;

  const lastCallAt = priorCall.createdAt.toISOString();
  const relativeTime = formatRelativeTime(priorCall.createdAt, now ?? new Date());

  if (allScores.length === 0) {
    return {
      hasFeedback: true,
      lastCallAt,
      lastCallId: priorCall.id,
      weakestParameterName: null,
      weakestParameterScore: null,
      overallScore: null,
      summary:
        `On your last attempt ${relativeTime} we didn't have clear score signals to learn from — let's pick up where we left off.`,
    };
  }

  // Average overall score — uses ALL rows (full prior-call summary).
  const overallScore = allScores.reduce((sum, s) => sum + (s.score ?? 0), 0) / allScores.length;

  // Weakest parameter — pick from the relevance-filtered candidates so
  // coaching params never surface as "weakest area" on a skill playbook.
  // Tie-break by name for determinism.
  const sortedByScore = [...relevanceCandidates].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.parameter?.name ?? "").localeCompare(b.parameter?.name ?? "");
  });
  const weakest = sortedByScore[0];
  const weakestParameterName = weakest?.parameter?.name ?? null;
  const weakestParameterScore = weakest?.score ?? null;

  const summary = buildSummary({
    relativeTime,
    weakestParameterName,
    weakestParameterScore,
    overallScore,
  });

  const templated: PriorCallFeedbackData = {
    hasFeedback: true,
    lastCallAt,
    lastCallId: priorCall.id,
    weakestParameterName,
    weakestParameterScore,
    overallScore,
    summary,
  };

  // #599 Slice 1 — opt-in AI synthesis path. Failures degrade silently to
  // the templated path so a flaky AI call cannot break composition.
  let synthesizedRecap: SynthesizedRecapResult | null = null;
  try {
    synthesizedRecap = await maybeSynthesizeRecap(prisma, opts, templated);
  } catch (err) {
    console.warn("[priorCallFeedback] synthesis failed — falling back to templated path:", err);
  }

  return { ...templated, synthesizedRecap };
}

// =============================================================
// #599 Slice 1 — synthesis gate sequence
// =============================================================

/**
 * Resolves the AI-synthesized recap when every gate passes. Returns null on
 * any gate miss (templated path wins), null on `minimal` depth (no AI), and
 * the full result on cache hit or synth success.
 *
 * Side-effects: writes UsageEvent (via the metering helper inside the
 * synthesizer) and AuditLog rows (synth-success / allowlist-empty / cap-exceeded).
 */
async function maybeSynthesizeRecap(
  prisma: PrismaForLoader,
  opts: LoadPriorCallFeedbackOptions,
  templated: PriorCallFeedbackData,
): Promise<SynthesizedRecapResult | null> {
  if (!templated.hasFeedback) return null;

  // Gate 1 — kill switch (env var, strict string compare).
  if (process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED !== "true") return null;

  // Gate 1a — #2055 (sub-epic F) cost gate. `recapSynthesisEnabled`
  // is the operator-flippable COST toggle, distinct from
  // `priorCallRecap.enabled` (the feature toggle in Gate 2).
  // - `false` → explicit cost-shutoff. Short-circuit to templated path
  //   WITHOUT the AI call (no allowlist query, no usage event, no
  //   audit row — same behaviour as Gate 1 failing).
  // - `true`  → proceed through the existing gate sequence.
  // - undefined → preserve legacy behaviour (proceed). Operators who
  //   never touched the flag get the previous gates as before.
  if (opts.playbookConfig?.recapSynthesisEnabled === false) return null;

  // Gate 2 — playbook config opt-in.
  const recapCfg = opts.playbookConfig?.priorCallRecap;
  if (!recapCfg?.enabled) return null;

  const requestedDepth: PriorCallRecapDepth = recapCfg.depth ?? "minimal";

  // #1404 — Cross-course safety degrade. `rich` depth feeds the previous
  // call's raw transcript (up to RICH_TRANSCRIPT_SLICE_LIMIT chars)
  // straight into the synthesis LLM. ASR errors flow through unsanitised
  // ("folk-psychology terms" → "folk mouses", "shy/neurotic" → "sky
  // neurotic" — surfaced live 2026-06-09 on the Big 5 Personality course).
  //
  // Until the transcript sanitiser ships (#TBD A2), degrade `rich` → `standard`
  // GLOBALLY for every course — existing courses that explicitly opted into
  // `rich` get `standard`, new courses default to `minimal`. Operators
  // re-enable rich per-deploy by setting `PRIOR_CALL_RECAP_RICH_DEPTH_ENABLED=true`
  // ONCE the sanitiser is in place. This is the same kill-switch pattern
  // as gate 1 above.
  //
  // Logged once per (callerId, playbookId, day) via the existing audit
  // pattern so we can see how often the degrade fires across the fleet.
  const depth: PriorCallRecapDepth =
    requestedDepth === "rich" &&
    process.env.PRIOR_CALL_RECAP_RICH_DEPTH_ENABLED !== "true"
      ? "standard"
      : requestedDepth;
  if (depth !== requestedDepth) {
    console.log(
      "[prior-call-recap/degrade] rich → standard (sanitiser not yet enabled)",
      {
        callerId: opts.callerId,
        playbookId: opts.playbookId ?? null,
        currentCallId: opts.currentCallId ?? null,
      },
    );
  }

  // `minimal` depth is documented as "no AI call". Short-circuit before
  // running the allowlist / cap queries.
  if (depth === "minimal") return null;

  const playbookId = opts.playbookId ?? null;
  if (!playbookId) return null;

  // Gate 3 — allowlist. Absent row AND empty array both block (safe default).
  const allowlistCheck = await checkAllowlist(prisma, playbookId);
  if (!allowlistCheck.allowed) {
    await maybeWriteOncePerDayAudit(
      prisma,
      PRIOR_CALL_RECAP_ACTIONS.allowlistEmpty,
      playbookId,
      { cause: allowlistCheck.cause, depth },
      opts.now ?? new Date(),
    );
    return null;
  }

  // Gate 4 — daily cap. Use the same clamp the AI-surface handler uses.
  const requestedCap = recapCfg.dailyCap ?? PRIOR_CALL_RECAP_DAILY_CAP_DEFAULT;
  const cap = Math.min(Math.max(0, requestedCap), PRIOR_CALL_RECAP_DAILY_CAP_MAX);
  const usedToday = await countSynthesisUsageToday(prisma, playbookId, opts.now ?? new Date());
  if (usedToday >= cap) {
    await prisma.auditLog.create({
      data: {
        action: PRIOR_CALL_RECAP_ACTIONS.capExceeded,
        entityType: "Playbook",
        entityId: playbookId,
        metadata: { playbookId, dailyCap: cap, usedToday, depth },
      },
    });
    return null;
  }

  // Gate 5 — cache read. Existing ComposedPrompt for this triggerSession
  // with a matching depth → reuse text (no AI call, no audit row).
  // #1344 Slice 4 — walk via Call.sessionId to find the parent Session
  // for the cache key; the legacy `triggerCallId` column is gone.
  if (opts.currentCallId) {
    const callRow = await prisma.call.findUnique({
      where: { id: opts.currentCallId },
      select: { sessionId: true },
    });
    if (callRow?.sessionId) {
      const cached = await readCachedRecap(prisma, {
        callerId: opts.callerId,
        triggerSessionId: callRow.sessionId,
        playbookId,
        depth,
      });
      if (cached) {
        return { ...cached, cachedHit: true };
      }
    }
  }

  // Gate 6 — synthesize.
  const callerName = await fetchCallerFirstName(prisma, opts.callerId);
  const transcript =
    depth === "rich" && templated.lastCallId
      ? await fetchTranscript(prisma, templated.lastCallId)
      : null;

  const result = await synthesizePriorCallRecap({
    feedback: templated,
    depth,
    callerName,
    transcript: transcript ? transcript.slice(0, RICH_TRANSCRIPT_SLICE_LIMIT) : null,
    callId: opts.currentCallId ?? undefined,
    callerId: opts.callerId,
    playbookId,
  });

  // Audit log — every synthesis (cache-miss).
  await prisma.auditLog.create({
    data: {
      action: PRIOR_CALL_RECAP_ACTIONS.synthesized,
      entityType: "Call",
      entityId: opts.currentCallId ?? "",
      metadata: {
        callId: opts.currentCallId ?? null,
        depth,
        playbookId,
        cachedHit: false,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        outputText: result.text,
      },
    },
  });

  return {
    depth,
    text: result.text,
    cachedAt: (opts.now ?? new Date()).toISOString(),
    cachedHit: false,
  };
}

interface AllowlistResult {
  allowed: boolean;
  cause?: "row-absent" | "empty-array" | "not-in-list";
}

async function checkAllowlist(
  prisma: PrismaForLoader,
  playbookId: string,
): Promise<AllowlistResult> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: PRIOR_CALL_RECAP_ALLOWLIST_KEY },
    select: { value: true },
  });
  if (!row) return { allowed: false, cause: "row-absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return { allowed: false, cause: "empty-array" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { allowed: false, cause: "empty-array" };
  }
  if (!parsed.includes(playbookId)) {
    return { allowed: false, cause: "not-in-list" };
  }
  return { allowed: true };
}

async function countSynthesisUsageToday(
  prisma: PrismaForLoader,
  playbookId: string,
  now: Date,
): Promise<number> {
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await prisma.usageEvent.findMany({
    where: {
      sourceOp: PRIOR_CALL_RECAP_SOURCE_OP,
      createdAt: { gte: startOfUtcDay },
    },
    select: { metadata: true },
  });
  return rows.filter((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    return md.playbookId === playbookId;
  }).length;
}

interface CachedRecapKey {
  callerId: string;
  triggerSessionId: string;
  playbookId: string;
  depth: PriorCallRecapDepth;
}

async function readCachedRecap(
  prisma: PrismaForLoader,
  key: CachedRecapKey,
): Promise<PriorCallRecapCacheEntry | null> {
  const row = await prisma.composedPrompt.findFirst({
    where: {
      callerId: key.callerId,
      triggerSessionId: key.triggerSessionId,
      playbookId: key.playbookId,
    },
    orderBy: { composedAt: "desc" },
    select: { recapSynthesisCache: true },
  });
  if (!row?.recapSynthesisCache) return null;
  const cache = row.recapSynthesisCache as unknown as PriorCallRecapCacheEntry;
  if (
    !cache ||
    typeof cache !== "object" ||
    cache.depth !== key.depth ||
    typeof cache.text !== "string"
  ) {
    return null;
  }
  return cache;
}

async function maybeWriteOncePerDayAudit(
  prisma: PrismaForLoader,
  action: string,
  playbookId: string,
  metadata: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const existing = await prisma.auditLog.findFirst({
    where: {
      action,
      entityType: "Playbook",
      entityId: playbookId,
      createdAt: { gte: startOfUtcDay },
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.auditLog.create({
    data: {
      action,
      entityType: "Playbook",
      entityId: playbookId,
      metadata: { playbookId, ...metadata },
    },
  });
}

async function fetchCallerFirstName(
  prisma: PrismaForLoader,
  callerId: string,
): Promise<string | null> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { name: true },
  });
  if (!caller?.name) return null;
  return caller.name.split(/\s+/)[0] ?? null;
}

async function fetchTranscript(
  prisma: PrismaForLoader,
  callId: string,
): Promise<string | null> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { transcript: true },
  });
  return call?.transcript ?? null;
}

// =============================================================
// Helpers
// =============================================================

/**
 * Format a relative time like "yesterday", "3 days ago", "2 weeks ago".
 *
 * Uses Intl.RelativeTimeFormat so localisation hooks are in place; the
 * caller-facing copy is still produced via deterministic template strings
 * (see {@link buildSummary}) for predictable test assertions.
 */
export function formatRelativeTime(then: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diffMs = then.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Same calendar bucket: "today" / "yesterday" — Intl.RelativeTimeFormat with
  // numeric:"auto" handles those words for diffDays === 0 and -1.
  if (Math.abs(diffDays) < 7) {
    return rtf.format(diffDays, "day");
  }
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return rtf.format(diffWeeks, "week");
  }
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, "month");
  }
  const diffYears = Math.round(diffDays / 365);
  return rtf.format(diffYears, "year");
}

/**
 * Format a 0–1 score as a one-decimal value out of 9 — matches the IELTS-style
 * band the tutor speaks in. Bounded to [0, 9] for safety.
 */
function formatScoreOutOf9(score: number): string {
  const bounded = Math.max(0, Math.min(1, score));
  const banded = Math.round(bounded * 9 * 10) / 10;
  return `${banded.toFixed(1)}/9`;
}

function buildSummary(args: {
  relativeTime: string;
  weakestParameterName: string | null;
  weakestParameterScore: number | null;
  overallScore: number | null;
}): string {
  const { relativeTime, weakestParameterName, weakestParameterScore, overallScore } = args;

  if (weakestParameterName !== null && weakestParameterScore !== null) {
    return (
      `On your last attempt ${relativeTime}, your weakest area was ` +
      `${weakestParameterName} (${formatScoreOutOf9(weakestParameterScore)}).`
    );
  }
  if (overallScore !== null) {
    return `On your last attempt ${relativeTime}, your overall score was ${formatScoreOutOf9(overallScore)}.`;
  }
  return `On your last attempt ${relativeTime}, no specific weaknesses were flagged.`;
}
