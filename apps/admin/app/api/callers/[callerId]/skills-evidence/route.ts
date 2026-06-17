/**
 * @api GET /api/callers/[callerId]/skills-evidence
 *
 * Per-learner sibling to `/api/courses/[courseId]/skills-evidence` (PR #1576).
 * Returns the most recent N `BehaviorMeasurement.evidence` excerpts per
 * skill for ONE learner across all their calls.
 *
 * Powers SP4-B Attainment tab's per-skill evidence expand: educator clicks
 * a skill row → sees 3 most-recent transcript excerpts the AI tutor cited
 * when scoring that learner on that skill.
 *
 * Auth: VIEWER + path-param scope guard. STUDENT may read OWN data only
 * via `studentAllowedToReadCaller` (mirrors `snapshot/route.ts:30-32`).
 * OPERATOR+ may read any caller.
 *
 * Resolves the learner's playbook via the most-recent `CallerPlaybook`
 * enrolment, then runs the same per-skill bounded query as the cohort
 * route but filtered to `call.callerId = ?`. Hard limit cap of 10 keeps
 * fanout bounded.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";
import {
  parseSegmentKey,
  segmentKeyLabel,
  SEGMENT_KEY_NAMESPACE,
} from "@/lib/pipeline/segment-key-namespace";

export interface CallerSkillEvidenceItem {
  callId: string;
  measuredAt: string;
  score: number;
  confidence: number;
  excerpts: string[];
  // Wave A2 — score-provenance fields lifted from the sibling CallScore
  // row via (callId, parameterId). Surfaces what ProgressTab v1's
  // ScoresSection used to show in its score-detail expander, so the
  // Attainment Evidence Panel can replace it before that legacy tab
  // retires. All optional — legacy paths (mock engine, manual scoring)
  // may not have CallScore rows or may leave individual fields null.
  reasoning: string | null;
  analysisSpecName: string | null;
  hasLearnerEvidence: boolean | null;
  evidenceQuality: number | null;
  scoredBy: string | null;
}

/**
 * #1887 Slice 1 — per-segment cell for the AttainmentTab expansion.
 *
 * One row per distinct `segmentKey` produced for this (callerId, parameterId)
 * across all the learner's calls. `null` segmentKey means the whole-call
 * score (overall). Namespace prefix (`text:` / `phase:`) drives the
 * provenance chip via {@link parseSegmentKey}.
 *
 * `band` is the latest score (0..1) observed for that segment.
 * `durationSeconds` is the duration of the most-recent segment occurrence
 * — surfaced in the cell tooltip so educators see "from Part 2 monologue
 * (90s)" rather than just "from Part 2".
 */
export interface CallerSkillSegmentCell {
  segmentKey: string | null;
  /** Namespace classification — drives the chip + tooltip wording. */
  namespace: "text" | "phase" | "mixed" | "legacy" | "overall";
  /** Human label — `"Overall"` for null segmentKey; otherwise `segmentKeyLabel(segmentKey)`. */
  label: string;
  band: number;
  /** Most-recent call this segment was scored against. */
  callId: string;
  measuredAt: string;
  /** Most-recent segment duration (seconds) if Call surfaced it; null otherwise. */
  durationSeconds: number | null;
}

export interface CallerSkillEvidenceRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  evidence: CallerSkillEvidenceItem[];
  /**
   * #1887 Slice 1 — per-segment cells for the AttainmentTab matrix.
   * Sorted by `label` so column order is deterministic across renders.
   * Empty array when the learner has no segmented scoring for this skill
   * (a brand-new caller, or a course that doesn't emit segmentKeys).
   */
  segments: CallerSkillSegmentCell[];
}

export interface CallerSkillEvidenceResponse {
  callerId: string;
  playbookId: string | null;
  limit: number;
  rows: CallerSkillEvidenceRow[];
  empty: boolean;
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const { callerId } = await params;

  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  // STUDENT may read own data only; OPERATOR+ passes through.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Most-recent enrolment is the playbook scope. If the learner is on
  // multiple, callers can pass `?playbookId=...` to disambiguate.
  const requestedPlaybookId = url.searchParams.get("playbookId");
  const enrolment = requestedPlaybookId
    ? await prisma.callerPlaybook.findFirst({
        where: { callerId, playbookId: requestedPlaybookId },
        select: { playbookId: true },
      })
    : await prisma.callerPlaybook.findFirst({
        where: { callerId },
        select: { playbookId: true },
        orderBy: { createdAt: "desc" },
      });

  if (!enrolment) {
    const response: CallerSkillEvidenceResponse = {
      callerId,
      playbookId: null,
      limit,
      rows: [],
      empty: true,
    };
    return NextResponse.json(response);
  }

  const playbookId = enrolment.playbookId;
  const skills = await resolveAllSkillsForPlaybook(playbookId);
  if (skills.length === 0) {
    return NextResponse.json({
      callerId,
      playbookId,
      limit,
      rows: [],
      empty: true,
    } satisfies CallerSkillEvidenceResponse);
  }

  const parameters = await prisma.parameter.findMany({
    where: { parameterId: { in: skills.map((s) => s.parameterId) } },
    select: { parameterId: true, name: true },
  });
  const paramName = new Map(parameters.map((p) => [p.parameterId, p.name]));

  // Per-skill bounded fetch — uses @@index([parameterId]) + @@index([measuredAt]).
  // N skills × 1 indexed seek = small even when called repeatedly.
  // Wave A2 — also pulls the sibling CallScore row for each
  // (callId, parameterId) so the Evidence Panel can render reasoning +
  // analysisSpec provenance + #566 hasLearnerEvidence/evidenceQuality
  // badges in place of the now-retiring ProgressTab v1 ScoresSection.
  const rows: CallerSkillEvidenceRow[] = await Promise.all(
    skills.map(async (s) => {
      const measurements = await prisma.behaviorMeasurement.findMany({
        where: {
          parameterId: s.parameterId,
          call: { callerId },
        },
        select: {
          actualValue: true,
          confidence: true,
          evidence: true,
          measuredAt: true,
          callId: true,
        },
        orderBy: { measuredAt: "desc" },
        take: limit,
      });
      const callIds = measurements.map((m) => m.callId);
      // #1887 Slice 1 — per-call CallScore for the evidence list (legacy
      // shape) PLUS a wider per-segment fetch across ALL the learner's
      // calls for this parameter so the AttainmentTab matrix can render
      // every (criterion × segment) cell, not just cells that happen to
      // appear in the top-3 most-recent measurements.
      //
      // Both queries are bounded — `callIds` is at most `limit` (default 3,
      // max 10) for the per-call join, and the per-segment query is bounded
      // by the per-caller call count for this parameter (a single learner
      // session emits a few segmented rows; cohort cap keeps this small).
      const callScores =
        callIds.length === 0
          ? []
          : await prisma.callScore.findMany({
              where: {
                callId: { in: callIds },
                parameterId: s.parameterId,
              },
              select: {
                callId: true,
                reasoning: true,
                hasLearnerEvidence: true,
                evidenceQuality: true,
                scoredBy: true,
                segmentKey: true,
                analysisSpecId: true,
                analysisSpec: { select: { name: true } },
              },
            });
      // Per-segment cells for this skill across every call this caller has
      // for this parameter. We pick the most-recent score per segmentKey.
      const segmentScores = await prisma.callScore.findMany({
        where: {
          parameterId: s.parameterId,
          call: { callerId },
        },
        select: {
          callId: true,
          score: true,
          segmentKey: true,
          call: { select: { createdAt: true } },
        },
        orderBy: { call: { createdAt: "desc" } },
      });
      const scoreByCall = new Map(callScores.map((cs) => [cs.callId, cs]));
      return {
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName: paramName.get(s.parameterId) ?? s.parameterId,
        evidence: measurements.map((m) => {
          const cs = scoreByCall.get(m.callId);
          return {
            callId: m.callId,
            measuredAt: m.measuredAt.toISOString(),
            score: m.actualValue,
            confidence: m.confidence,
            excerpts: m.evidence,
            reasoning: cs?.reasoning ?? null,
            analysisSpecName: cs?.analysisSpec?.name ?? null,
            hasLearnerEvidence: cs?.hasLearnerEvidence ?? null,
            evidenceQuality: cs?.evidenceQuality ?? null,
            scoredBy: cs?.scoredBy ?? null,
          };
        }),
        segments: buildSegmentCells(segmentScores),
      };
    }),
  );

  return NextResponse.json({
    callerId,
    playbookId,
    limit,
    rows,
    empty: false,
  } satisfies CallerSkillEvidenceResponse);
}

/**
 * #1887 Slice 1 — fold a `(segmentKey, score, callId, startedAt)[]` stream
 * (ordered most-recent-first) into one cell per distinct segment LABEL.
 *
 * Two segmentKeys that humanise to the same label (e.g. `text:part1` and
 * `phase:p1` both → "Part 1") are merged into ONE cell so the matrix
 * doesn't show two columns for the same conceptual segment. When both
 * namespaces contribute, the cell's namespace is `"mixed"` — the chip
 * surfaces that the band reflects both text + audio evidence.
 *
 * Within a single label-bucket:
 *   - First seen segmentKey wins (most-recent score per logical segment).
 *   - If a later row carries a DIFFERENT namespace at the same label, the
 *     cell flips to `"mixed"` (but band stays as the first-seen value —
 *     we don't average; the chip signals provenance, the band is single-source).
 *
 * Rules:
 *   - `null` segmentKey → `namespace = "overall"`, `label = "Overall"`.
 *   - Prefixed keys (`text:` / `phase:`) → namespace from {@link parseSegmentKey},
 *     label from {@link segmentKeyLabel}.
 *   - Unprefixed non-null keys → `namespace = "legacy"`, label = raw bare.
 *   - Output is sorted by `label` so column order is deterministic.
 *
 * NO HARDCODING — `text:` / `phase:` literals come from
 * `SEGMENT_KEY_NAMESPACE` constants, never inline strings.
 */
function buildSegmentCells(
  scores: Array<{
    callId: string;
    score?: number;
    segmentKey?: string | null;
    call?: { createdAt: Date | null } | null;
  }>,
): CallerSkillSegmentCell[] {
  const byLabel = new Map<string, CallerSkillSegmentCell>();
  for (const row of scores) {
    const measuredAtSrc = row.call?.createdAt ?? new Date(0);
    const measuredAtIso = measuredAtSrc.toISOString();
    // Defensive: row may lack a score (legacy data, mock drift). Skip
    // those — they can't render a band cell.
    if (typeof row.score !== "number") continue;
    const segmentKey = row.segmentKey ?? null;

    const label = segmentKey === null ? "Overall" : segmentKeyLabel(segmentKey);
    const namespace: CallerSkillSegmentCell["namespace"] =
      segmentKey === null
        ? "overall"
        : (() => {
            const parsed = parseSegmentKey(segmentKey);
            if (parsed.namespace === SEGMENT_KEY_NAMESPACE.TEXT) return "text";
            if (parsed.namespace === SEGMENT_KEY_NAMESPACE.PHASE) return "phase";
            return "legacy";
          })();

    const existing = byLabel.get(label);
    if (!existing) {
      byLabel.set(label, {
        segmentKey,
        namespace,
        label,
        band: row.score,
        callId: row.callId,
        measuredAt: measuredAtIso,
        durationSeconds: null,
      });
      continue;
    }
    // Already have a cell for this label. If the incoming namespace
    // differs, flip the chip to "mixed" — both writers contributed to
    // this Part. The band stays as the first-seen (most-recent) value.
    if (existing.namespace !== namespace && existing.namespace !== "mixed") {
      existing.namespace = "mixed";
    }
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}
