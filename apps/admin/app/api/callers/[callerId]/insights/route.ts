/**
 * @api GET /api/callers/[callerId]/insights
 * @tieredVisibility — strips recommendation + reason from focus areas
 *                     at the redacted tier. STUDENT sees module type +
 *                     mastery only (#1922, epic #1915).
 *
 * Computed signals for the Snapshot v3 tab — Wave B of the legacy-tab
 * retirement plan. Lifts the server-side equivalent of
 * `useCallerInsights` (in `components/callers/caller-detail/hooks/`)
 * for the three blocks Snapshot needs: Momentum, Achievements, Focus
 * areas. Plus the supporting counts (callStreak, lastCallDaysAgo,
 * totalCalls).
 *
 * Server computation chosen over client re-derivation because
 * Snapshot doesn't have the underlying CallerData payload available —
 * its existing sibling fetches (/attainment, /personality, /memories,
 * etc.) are scoped tighter. Letting the server own this keeps the
 * client payload flat.
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`).
 * Same STUDENT-readable contract as the rest of the Snapshot tab
 * routes.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { visibilityTierForRole } from "@/lib/rbac/visibility";
import { redactInsightsForTier } from "@/lib/rbac/policies/insights";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import {
  computeMomentum,
  computeCallStreak,
  MASTERY_THRESHOLD,
  ADVANCE_THRESHOLD,
  ATTENTION_THRESHOLD,
} from "@/lib/caller-utils";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface FocusAreaEntry {
  type: "needs_attention" | "ready_to_advance";
  moduleId: string;
  moduleName: string;
  mastery: number;
  reason: string;
  recommendation: string;
}

export interface AchievementEntry {
  icon: string;
  label: string;
  value: string;
}

export interface CallerInsightsResponse {
  ok: boolean;
  callerId: string;
  /** "new" when no calls yet, otherwise based on call cadence */
  momentum: "accelerating" | "steady" | "slowing" | "new";
  callStreak: number;
  lastCallDaysAgo: number | null;
  totalCalls: number;
  focusAreas: FocusAreaEntry[];
  achievements: AchievementEntry[];
}

const MAX_CALL_HISTORY = 60;
const MAX_FOCUS_AREAS = 6;
const STREAK_THRESHOLD = 3;
const CALL_COUNT_THRESHOLD = 5;
const MEMORIES_THRESHOLD = 10;

type ModuleStatus = "mastered" | "in_progress" | "not_started" | "needs_attention";

function masteryToStatus(mastery: number): ModuleStatus {
  if (mastery >= MASTERY_THRESHOLD) return "mastered";
  if (mastery > 0) return mastery < ATTENTION_THRESHOLD ? "needs_attention" : "in_progress";
  return "not_started";
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ callerId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await context.params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const viewerTier = visibilityTierForRole(auth.session.user.role);

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 },
    );
  }

  // Module-progress reads are only meaningful on structured courses
  // (#1252 / #1259 — CONTINUOUS courses have no module-progress
  // semantic). Resolve the active playbook's config first; if not
  // structured, skip the CallerModuleProgress query entirely.
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: { playbook: { select: { config: true } } },
  });
  const playbookConfig = (enrollment?.playbook?.config ??
    null) as PlaybookConfig | null;
  const courseStyle = getCourseStyle(playbookConfig);

  const [callRows, totalCalls, memoriesCount] = await Promise.all([
    prisma.call.findMany({
      where: { callerId, endedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: MAX_CALL_HISTORY,
      select: { createdAt: true },
    }),
    prisma.call.count({ where: { callerId, endedAt: { not: null } } }),
    prisma.callerMemory.count({
      where: { callerId, supersededById: null },
    }),
  ]);

  // CallerModuleProgress only has semantic meaning on structured
  // courses (#1252 / #1259). The hf-pipeline ESLint rule requires
  // an explicit if-block guard; CONTINUOUS courses get an empty list.
  type ModuleRow = {
    moduleId: string;
    mastery: number | null;
    module: { id: string; title: string; sortOrder: number } | null;
  };
  let moduleRows: ModuleRow[] = [];
  if (courseStyle === "structured") {
    moduleRows = await prisma.callerModuleProgress.findMany({
      where: { callerId },
      orderBy: { module: { sortOrder: "asc" } },
      select: {
        moduleId: true,
        mastery: true,
        module: { select: { id: true, title: true, sortOrder: true } },
      },
    });
  }

  const callDates = callRows.map((c) => c.createdAt);
  const momentum = callDates.length === 0 ? ("new" as const) : computeMomentum(callDates);
  const callStreak = computeCallStreak(callDates);

  const lastCallDaysAgo =
    callDates.length === 0
      ? null
      : Math.floor(
          (Date.now() - callDates[0].getTime()) / (1000 * 60 * 60 * 24),
        );

  // ── Focus areas (needs_attention + ready_to_advance per module) ──
  const focusAreas: FocusAreaEntry[] = [];
  for (const row of moduleRows) {
    const mastery = row.mastery ?? 0;
    const status = masteryToStatus(mastery);
    const moduleName = row.module?.title ?? row.moduleId;
    if (status === "needs_attention") {
      focusAreas.push({
        type: "needs_attention",
        moduleId: row.moduleId,
        moduleName,
        mastery,
        reason: `${Math.round(mastery * 100)}% mastery`,
        recommendation: "Needs more practice",
      });
    } else if (mastery >= ADVANCE_THRESHOLD && status !== "mastered") {
      focusAreas.push({
        type: "ready_to_advance",
        moduleId: row.moduleId,
        moduleName,
        mastery,
        reason: `${Math.round(mastery * 100)}% mastery — ready to advance`,
        recommendation: "Move to next topic",
      });
    }
    if (focusAreas.length >= MAX_FOCUS_AREAS) break;
  }

  // ── Achievements (streak / mastered modules / total calls / memory threshold) ──
  const achievements: AchievementEntry[] = [];
  if (callStreak >= STREAK_THRESHOLD) {
    achievements.push({
      icon: "🔥",
      label: `${callStreak}-lesson streak`,
      value: "",
    });
  }
  for (const row of moduleRows) {
    const mastery = row.mastery ?? 0;
    if (mastery >= MASTERY_THRESHOLD) {
      const name = row.module?.title ?? row.moduleId;
      achievements.push({ icon: "⭐", label: `${name} mastered`, value: "" });
    }
  }
  if (totalCalls >= CALL_COUNT_THRESHOLD) {
    achievements.push({
      icon: "💬",
      label: `${totalCalls} lessons total`,
      value: "",
    });
  }
  if (memoriesCount >= MEMORIES_THRESHOLD) {
    achievements.push({
      icon: "🧠",
      label: `${memoriesCount} things remembered`,
      value: "",
    });
  }

  const response: CallerInsightsResponse = {
    ok: true,
    callerId,
    momentum,
    callStreak,
    lastCallDaysAgo,
    totalCalls,
    focusAreas,
    achievements,
  };
  return NextResponse.json(redactInsightsForTier(response, viewerTier));
}
