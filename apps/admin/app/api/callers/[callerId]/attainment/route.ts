/**
 * @api GET /api/callers/[callerId]/attainment
 *
 * Unified per-learner "where they are right now" read for the SP4-A
 * Attainment tab. Returns the four parallel state stores in one call:
 *
 *   - Skill EMA bands (`CallerTarget.currentScore` per skill_* parameter,
 *     banded via `scoreToTier` + the playbook's `skillTierMapping` —
 *     cascade-resolved via the `mastery-policy` family from PR #1571)
 *   - LO mastery (`CallerAttribute lo_mastery:{moduleSlug}:{loRef}` — the
 *     monotonic ratchet) PLUS the `useFreshMastery` fork: when the
 *     playbook is in mock-exam mode the read switches to
 *     `Call.scratchMastery` per-call instead
 *   - Per-module mastery rollup (`CallerModuleProgress.mastery`)
 *   - Goal progress (`Goal.progress` + structured `progressMetrics.progress`
 *     evidence — preserves tier / band / callId / at so the UI can render
 *     the "Last call: …" trail without a second round-trip)
 *
 * Sprint 4 SP4-A. Sister of:
 *   - `/api/callers/[callerId]/skills-evidence` (per-skill evidence trail)
 *   - `/api/courses/[courseId]/skills-cohort-heatmap` (cohort aggregation)
 *
 * Auth: VIEWER + path-param scope. STUDENT may read OWN data only
 * (`studentAllowedToReadCaller`); OPERATOR+ may read any caller. Locked
 * decision per the master epic #1577 (Attainment is STUDENT-readable,
 * Adaptations is OPERATOR+ only).
 *
 * Single-load: the response carries everything the tab needs for first
 * render. Section-level reads happen via the sibling routes if the
 * learner navigates deeper (skills-evidence, future LO drill, etc.).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";
import { isUseFreshMastery } from "@/lib/curriculum/playbook-mastery-config";
import { getSkillTierMapping, scoreToTier } from "@/lib/goals/track-progress";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import { MEASUREMENT_SENTINEL_SPEC_IDS } from "@/lib/measurement/write-call-score";
import {
  computeTalkTimeStats,
  evaluateTalkTimeBudgets,
  type TalkTimeStats,
  type TalkTimeEvaluation,
} from "@/lib/voice/talk-time-stats";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { PlaybookCurriculumRole } from "@prisma/client";

export interface AttainmentSkillBand {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  /** 0–1; null when the learner has no CallerTarget yet (`awaiting evidence`). */
  currentScore: number | null;
  targetValue: number;
  callsUsed: number;
  tier: string;
  bandLabel: number | null;
  /** True when `currentScore > targetValue` — surfaces the ABOVE_TARGET visual. */
  exceedsTarget: boolean;
  /**
   * #2140 (S5 of #2135) — true when prosody-consumer wrote ≥1 `CallScore`
   * row for this parameter on any of the caller's recent calls (last
   * `PROSODY_LOOKBACK_CALLS`). Detected via the `PROSODY` sentinel
   * `analysisSpecId` (`MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY`) — the
   * canonical lineage marker for prosody-derived scores. Pure
   * observability flag; no PII, no scoring metadata, no operator-only
   * fields. Surfaced as a "+ prosody" chip in `AttainmentTab`'s
   * `SkillBandsSection`. False when no prosody envelope ever fired or
   * when the consumer doesn't write to this parameter.
   */
  prosodyContributed: boolean;
}

export interface AttainmentGoalTrail {
  /** Up to N most-recent evidence excerpts (transcript fragments captured
   *  at extraction time). */
  excerpts: string[];
  /** Total number of evidence entries on this goal (may exceed `excerpts.length`). */
  totalCount: number;
  /** When the goal was first extracted. */
  firstNoticedAt: string | null;
  /** When the goal was most recently mentioned. */
  lastMentionedAt: string | null;
  /** Source call where the goal was first extracted. */
  sourceCallId: string | null;
  /** Most recent call where the goal was mentioned. */
  lastMentionedCallId: string | null;
  /** How many times this goal has been mentioned across calls. */
  mentionCount: number;
  /** EXPLICIT (caller said it directly) vs INFERRED (AI deduced). */
  extractionMethod: string | null;
  /** AI confidence at extraction time (0–1). */
  confidence: number | null;
}

export interface AttainmentGoal {
  id: string;
  ref: string | null;
  name: string;
  type: string;
  status: string;
  progress: number;
  /** `progressStrategy` resolves to one of: lo_rollup / skill_ema /
   *  assessment_readiness / connect_warmth_avg / manual_only. Shown on
   *  the UI so the educator knows "this goal is driven by per-skill EMA". */
  strategy: string | null;
  /** Evidence trail synthesised from `Goal.progressMetrics`. `null` when
   *  no metrics row exists (e.g. manually-created goal with no extraction
   *  history). The trail uses the shape written by `extract-goals.ts`:
   *  `{evidence: string[], extractionMethod, confidence, sourceCallId,
   *  extractedAt, lastMentionedAt, lastMentionedCallId, mentionCount}`. */
  trail: AttainmentGoalTrail | null;
}

export interface AttainmentModuleProgress {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  /** 0-1 rollup of per-LO mastery in this module. */
  mastery: number;
  status: string;
  attemptsCount: number;
  /**
   * #1703 Theme 9 — count of incomplete attempts on this module. Incremented
   * by `markModuleIncomplete()` when a Session ends below the module's
   * `minSpeakingSec` threshold OR with outcome GHOST/FAILED. Surfaced in
   * the AttainmentTab ModulesSection as a chip when > 0 — Epic #1700
   * missing-surface sweep (surface 3 of 3).
   */
  incompleteAttempts: number;
  /** True when the caller is on a `useFreshMastery: true` playbook —
   *  per-LO mastery for THIS playbook lives on `Call.scratchMastery`
   *  per-call, NOT this `mastery` field. Drives the UI's per-section
   *  branch. */
  freshMasteryActive: boolean;
}

/**
 * #1747 follow-on — most-recent call's talk-time telemetry. Surfaces the
 * yellow chip in AttainmentTab when the most recent VOICE_CALL / SIM_CALL
 * exceeded `Playbook.config.talkTimeBudgets` (or defaults). `null` when
 * the caller has no recent transcript-bearing session.
 *
 * Read-side only — the durable emission is the AppLog
 * `voice.talk_time.over_budget` from endSession.
 */
export interface AttainmentRecentCallTalkTime {
  sessionId: string;
  kind: string;
  startedAt: string;
  evaluation: TalkTimeEvaluation;
  stats: TalkTimeStats;
}

/** One captured profile field (#1704 Theme 10). Sourced from
 *  `CallerAttribute` rows under scope "PROFILE" / `profile:*` keys. */
export interface AttainmentProfileField {
  /** Namespaced key, e.g. "profile:targetBand". */
  key: string;
  /** Humanised label derived from the key, e.g. "Target Band". */
  label: string;
  /** Display string of the captured value. */
  value: string;
  confidence: number;
}

export interface AttainmentResponse {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  /** True when the playbook has `useFreshMastery: true` (Exam Assessment).
   *  Mastery + LO sections in the UI must branch on this. */
  useFreshMastery: boolean;
  skillBands: AttainmentSkillBand[];
  modules: AttainmentModuleProgress[];
  goals: AttainmentGoal[];
  /** #1747 follow-on — null when no recent voice/sim session with transcript. */
  recentCallTalkTime: AttainmentRecentCallTalkTime | null;
  /** Captured learner-profile fields for tester review (#1704). */
  profile: AttainmentProfileField[];
  empty: boolean;
}

/** Max number of evidence excerpts surfaced in the trail. Older entries
 *  are truncated; `totalCount` reports the full length. */
const GOAL_TRAIL_MAX_EXCERPTS = 4;

/**
 * #2140 (S5 of #2135) — lookback window for the prosody-contribution probe.
 * Bounded so the per-skill chip detection stays O(N_skills × 10 calls) rather
 * than walking the caller's full `CallScore` history. Matches the rough
 * "recent" window the AttainmentTab evidence list shows.
 */
const PROSODY_LOOKBACK_CALLS = 10;

/**
 * Synthesise an `AttainmentGoalTrail` from the JSON in `Goal.progressMetrics`.
 *
 * The shape that ships today is written by `lib/goals/extract-goals.ts`:
 *
 *   {
 *     extractionMethod: "EXPLICIT" | "INFERRED",
 *     confidence: 0..1,
 *     evidence: string[],
 *     sourceCallId: "call-…",
 *     extractedAt: ISO date,
 *     // — appended on subsequent mentions —
 *     lastMentionedCallId: "call-…",
 *     lastMentionedAt: ISO date,
 *     mentionCount: number,
 *   }
 *
 * Returns null when the metrics are absent / unparseable, so the UI can
 * branch cleanly on "no evidence yet".
 */
function buildGoalTrail(
  metrics: unknown,
): AttainmentGoalTrail | null {
  if (!metrics || typeof metrics !== "object") return null;
  const m = metrics as Record<string, unknown>;
  const rawEvidence = Array.isArray(m.evidence)
    ? (m.evidence.filter((e) => typeof e === "string") as string[])
    : [];
  const sourceCallId =
    typeof m.sourceCallId === "string" ? m.sourceCallId : null;
  const lastMentionedCallId =
    typeof m.lastMentionedCallId === "string" ? m.lastMentionedCallId : null;
  const firstNoticedAt =
    typeof m.extractedAt === "string" ? m.extractedAt : null;
  const lastMentionedAt =
    typeof m.lastMentionedAt === "string"
      ? m.lastMentionedAt
      : firstNoticedAt;
  const mentionCount =
    typeof m.mentionCount === "number"
      ? m.mentionCount
      : rawEvidence.length || 0;
  const extractionMethod =
    typeof m.extractionMethod === "string" ? m.extractionMethod : null;
  const confidence =
    typeof m.confidence === "number" ? m.confidence : null;

  // Surface zero excerpts → null trail unless we have at least one signal
  // (a callId or timestamp) so the UI can still render "Mentioned once,
  // no excerpt captured".
  if (
    rawEvidence.length === 0 &&
    !sourceCallId &&
    !lastMentionedCallId &&
    !firstNoticedAt
  ) {
    return null;
  }

  // Newest-first; the writer appends in chronological order so we reverse.
  const excerptsNewestFirst = [...rawEvidence].reverse().slice(
    0,
    GOAL_TRAIL_MAX_EXCERPTS,
  );

  return {
    excerpts: excerptsNewestFirst,
    totalCount: rawEvidence.length,
    firstNoticedAt,
    lastMentionedAt,
    sourceCallId,
    lastMentionedCallId,
    mentionCount,
    extractionMethod,
    confidence,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;

  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!caller) {
    return NextResponse.json({ error: "Caller not found" }, { status: 404 });
  }

  // Most-recent enrolment is the playbook scope — same convention as
  // skills-evidence + lo-progress. Multi-playbook learners can pass
  // `?playbookId=...` later (out of scope for SP4-A shell).
  const enrolment = await prisma.callerPlaybook.findFirst({
    where: { callerId },
    select: {
      playbookId: true,
      playbook: { select: { id: true, name: true, config: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!enrolment) {
    return NextResponse.json({
      callerId,
      callerName: caller.name,
      playbookId: null,
      playbookName: null,
      useFreshMastery: false,
      skillBands: [],
      modules: [],
      goals: [],
      recentCallTalkTime: null,
      profile: [],
      empty: true,
    } satisfies AttainmentResponse);
  }

  const playbookId = enrolment.playbookId;
  const playbookName = enrolment.playbook?.name ?? null;
  const playbookConfig = (enrolment.playbook?.config ?? null) as PlaybookConfig | null;
  const courseStyle = getCourseStyle(playbookConfig);
  const useFreshMastery = await isUseFreshMastery(playbookId);

  // ── Skill bands ──────────────────────────────────────────────────────────
  const skills = await resolveAllSkillsForPlaybook(playbookId);
  const tierMapping = await getSkillTierMapping(playbookId);

  const skillBands: AttainmentSkillBand[] = [];
  if (skills.length > 0) {
    const parameterIds = skills.map((s) => s.parameterId);
    const callerTargets = await prisma.callerTarget.findMany({
      where: { callerId, parameterId: { in: parameterIds } },
      select: {
        parameterId: true,
        currentScore: true,
        targetValue: true,
        callsUsed: true,
      },
    });
    const targetByParam = new Map(
      callerTargets.map((t) => [t.parameterId, t]),
    );
    const parameters = await prisma.parameter.findMany({
      where: { parameterId: { in: parameterIds } },
      select: { parameterId: true, name: true },
    });
    const nameByParam = new Map(parameters.map((p) => [p.parameterId, p.name]));

    // #2140 (S5 of #2135) — detect which of these skill parameters had
    // prosody-consumer contribution on a recent call. The lineage marker
    // is `analysisSpecId === MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY` per
    // the canonical chokepoint in `lib/measurement/write-call-score.ts`.
    // Bounded by the most-recent N call ids so this stays O(N_skills × 10).
    const recentCalls = await prisma.call.findMany({
      where: { callerId },
      orderBy: { createdAt: "desc" },
      take: PROSODY_LOOKBACK_CALLS,
      select: { id: true },
    });
    const prosodyContributingParams = new Set<string>();
    if (recentCalls.length > 0) {
      const recentCallIds = recentCalls.map((c) => c.id);
      const prosodyScores = await prisma.callScore.findMany({
        where: {
          callId: { in: recentCallIds },
          parameterId: { in: parameterIds },
          analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
        },
        select: { parameterId: true },
      });
      for (const s of prosodyScores) {
        prosodyContributingParams.add(s.parameterId);
      }
    }

    for (const s of skills) {
      const t = targetByParam.get(s.parameterId);
      const score = t?.currentScore ?? null;
      const callsUsed = t?.callsUsed ?? 0;
      const targetValue = t?.targetValue ?? s.targetValue;

      let tier = "awaiting_evidence";
      let bandLabel: number | null = null;
      let exceedsTarget = false;
      if (score != null && callsUsed > 0) {
        const banded = scoreToTier(score, tierMapping);
        tier = banded.tier.toLowerCase();
        bandLabel = banded.band ?? null;
        exceedsTarget = score > targetValue;
      }

      skillBands.push({
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: nameByParam.get(s.parameterId) ?? s.parameterId,
        currentScore: score,
        targetValue,
        callsUsed,
        tier,
        bandLabel,
        exceedsTarget,
        prosodyContributed: prosodyContributingParams.has(s.parameterId),
      });
    }
  }

  // ── Module mastery rollup ────────────────────────────────────────────────
  // CONTINUOUS courses have no module-progress semantic (#1252 / #1259).
  // Guard via getCourseStyle so the per-module rollup query only fires for
  // structured playbooks.
  let modules: AttainmentModuleProgress[] = [];
  if (courseStyle === "structured") {
    const moduleProgressRows = await prisma.callerModuleProgress.findMany({
      where: { callerId },
      include: {
        module: {
          select: {
            id: true,
            slug: true,
            title: true,
            curriculum: {
              select: {
                playbookLinks: {
                  where: { playbookId, role: PlaybookCurriculumRole.primary },
                  select: { playbookId: true },
                },
              },
            },
          },
        },
      },
    });
    // Filter to modules in THIS playbook only (canonical join via
    // PlaybookCurriculum primary, mirrors resolveLearningObjective in
    // lib/goals/track-progress.ts).
    modules = moduleProgressRows
      .filter((m) => (m.module?.curriculum?.playbookLinks ?? []).length > 0)
      .map((m) => ({
        moduleId: m.moduleId,
        moduleSlug: m.module.slug,
        moduleTitle: m.module.title,
        mastery: m.mastery,
        status: m.status,
        attemptsCount: m.callCount ?? 0,
        incompleteAttempts: m.incompleteAttempts ?? 0,
        freshMasteryActive: useFreshMastery,
      }));
  }

  // ── Goals ────────────────────────────────────────────────────────────────
  const goalRows = await prisma.goal.findMany({
    where: { callerId, playbookId },
    select: {
      id: true,
      ref: true,
      name: true,
      type: true,
      status: true,
      progress: true,
      progressStrategy: true,
      progressMetrics: true,
    },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });

  const goals: AttainmentGoal[] = goalRows.map((g) => ({
    id: g.id,
    ref: g.ref,
    name: g.name,
    type: g.type,
    status: g.status,
    progress: g.progress,
    strategy: g.progressStrategy,
    trail: buildGoalTrail(g.progressMetrics),
  }));

  // ── #1747 follow-on — most-recent call's talk-time telemetry ──────────────
  // Reads the most recent VOICE_CALL / SIM_CALL Session for this caller that
  // has a transcript, computes stats lazily, evaluates against the playbook's
  // `talkTimeBudgets` (falls back to defaults). Returns null when there's no
  // qualifying session. Best-effort — any compute failure returns null
  // rather than failing the whole Attainment response.
  const recentCallTalkTime = await loadRecentCallTalkTime(callerId, playbookId);

  // ── Learner profile (#1704 Theme 10) ──────────────────────────────────────
  // Captured profile fields live on `CallerAttribute` under scope "PROFILE"
  // (isolated from `curriculum:*` mastery, which is scope = specSlug). STUDENT
  // cross-caller reads are already blocked by `studentAllowedToReadCaller`
  // above — this read is path-scoped to the authorised `callerId`.
  const profileRows = await prisma.callerAttribute.findMany({
    where: { callerId, scope: "PROFILE", key: { startsWith: "profile:" } },
    select: { key: true, jsonValue: true, confidence: true },
    orderBy: { key: "asc" },
  });
  const profile: AttainmentProfileField[] = profileRows.map((r) => {
    const j = (r.jsonValue ?? {}) as { value?: unknown };
    const slug = r.key.replace(/^profile:/, "");
    const label = slug
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
    return {
      key: r.key,
      label,
      value: j.value != null ? String(j.value) : "—",
      confidence: r.confidence,
    };
  });

  return NextResponse.json({
    callerId,
    callerName: caller.name,
    playbookId,
    playbookName,
    useFreshMastery,
    skillBands,
    modules,
    goals,
    recentCallTalkTime,
    profile,
    empty:
      skills.length === 0 &&
      modules.length === 0 &&
      goals.length === 0 &&
      profile.length === 0,
  } satisfies AttainmentResponse);
}

/**
 * Fetch the most recent voice/sim Session with a transcript and compute
 * talk-time telemetry. Returns null on any miss (no session, empty
 * transcript, compute failure). Best-effort — does NOT throw.
 */
async function loadRecentCallTalkTime(
  callerId: string,
  playbookId: string | null,
): Promise<AttainmentRecentCallTalkTime | null> {
  if (!playbookId) return null;
  try {
    const session = await prisma.session.findFirst({
      where: {
        callerId,
        kind: { in: ["VOICE_CALL", "SIM_CALL"] },
        call: { is: { transcript: { not: "" } } },
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        kind: true,
        startedAt: true,
        call: { select: { transcript: true } },
      },
    });
    if (!session?.call?.transcript) return null;

    const stats = computeTalkTimeStats(session.call.transcript);
    if (stats.tutorTurnCount === 0 && stats.learnerTurnCount === 0) {
      return null;
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { config: true },
    });
    const budgets =
      (playbook?.config as PlaybookConfig | null)?.talkTimeBudgets ?? null;
    const evaluation = evaluateTalkTimeBudgets(stats, budgets);

    return {
      sessionId: session.id,
      kind: session.kind,
      startedAt: session.startedAt.toISOString(),
      evaluation,
      stats,
    };
  } catch (err) {
    console.error(
      `[attainment] talk-time read failed for caller ${callerId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
