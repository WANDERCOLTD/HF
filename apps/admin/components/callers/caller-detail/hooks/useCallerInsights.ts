"use client";

import { useMemo } from "react";
import type { CallerData, CallScore, Goal, Call } from "../types";
import {
  computeMomentum as computeMomentumShared,
  computeCallStreak as computeCallStreakShared,
  MASTERY_THRESHOLD,
  ADVANCE_THRESHOLD,
  ATTENTION_THRESHOLD,
} from "@/lib/caller-utils";

// ─── Insight Types ───────────────────────────────────────────

export type ModuleInsight = {
  id: string;
  name: string;
  mastery: number; // 0-1
  status: "mastered" | "in_progress" | "not_started" | "needs_attention";
  skillsTotal?: number;
  skillsMastered?: number;
};

export type TargetInsight = {
  name: string;
  current: number; // 0-1
  target: number;  // 0-1
  trend: "up" | "down" | "stable";
  met: boolean;
};

export type FocusArea = {
  type: "needs_attention" | "ready_to_advance";
  moduleName: string;
  mastery: number;
  reason: string;
  recommendation: string;
};

export type Achievement = {
  icon: string;
  label: string;
  value: string;
};

export type CallerInsights = {
  // Progress Stack layers
  goals: {
    items: Goal[];
    overallProgress: number; // 0-1
    count: number;
  };
  courses: {
    modules: ModuleInsight[];
    totalModules: number;
    completedModules: number;
    overallMastery: number; // 0-1
  };
  learnings: {
    totalLOs: number;
    masteredLOs: number;
    recentlyMastered: string[];
    inProgress: string[];
  };
  targets: TargetInsight[];
  // Computed signals
  focusAreas: FocusArea[];
  achievements: Achievement[];
  momentum: "accelerating" | "steady" | "slowing" | "new";
  callStreak: number;
  lastCallDaysAgo: number | null;
  totalCalls: number;
  // Person insights
  topMemories: { key: string; value: string }[];
  personalityTraits: { label: string; value: number }[];
};

// ─── Computation ─────────────────────────────────────────────

export function useCallerInsights(data: CallerData | null): CallerInsights | null {
  return useMemo(() => {
    if (!data) return null;

    // ── Goals ────────────────────────────────────────────
    const goals = data.goals || [];
    const activeGoals = goals.filter((g) => g.status !== "COMPLETED" && g.status !== "ABANDONED");
    const goalProgress = activeGoals.length > 0
      ? activeGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / activeGoals.length
      : 0;

    // ── Courses (Module Progress) ────────────────────────
    const curriculum = data.curriculum;
    const modules: ModuleInsight[] = (curriculum?.modules || []).map((m) => {
      const mastery = m.mastery || 0;
      let status: ModuleInsight["status"];
      if (mastery >= MASTERY_THRESHOLD) status = "mastered";
      else if (mastery > 0) status = mastery < ATTENTION_THRESHOLD ? "needs_attention" : "in_progress";
      else status = "not_started";
      return {
        id: m.id,
        name: m.name,
        mastery,
        status,
        sequence: m.sequence,
      };
    }).sort((a, b) => (a as any).sequence - (b as any).sequence);

    const completedModules = modules.filter((m) => m.status === "mastered").length;
    const overallMastery = modules.length > 0
      ? modules.reduce((sum, m) => sum + m.mastery, 0) / modules.length
      : curriculum?.estimatedProgress || 0;

    // ── Learnings (LO-level — approximated from module data for now) ──
    // TODO: When TOPIC_MASTERED artifacts exist (TODO #16), use real LO data
    const totalLOs = (data.counts.curriculumModules || modules.length) * 4; // estimate ~4 LOs per module
    const masteredLOs = Math.round(overallMastery * totalLOs);

    // ── Targets (from CallerTargets) ─────────────────────
    const callerTargets = data.callerTargets || [];
    const targets: TargetInsight[] = callerTargets.map((t: any) => {
      const current = t.currentValue ?? 0;
      const target = t.targetValue ?? 0.7;
      // Determine trend from recent scores
      const trend: TargetInsight["trend"] = t.trend === "improving" ? "up"
        : t.trend === "declining" ? "down" : "stable";
      return {
        name: t.parameterName || t.parameter?.name || "Unknown",
        current,
        target,
        trend,
        met: current >= target,
      };
    });

    // ── Focus Areas ──────────────────────────────────────
    const focusAreas: FocusArea[] = [];
    for (const mod of modules) {
      if (mod.status === "needs_attention") {
        focusAreas.push({
          type: "needs_attention",
          moduleName: mod.name,
          mastery: mod.mastery,
          reason: `${Math.round(mod.mastery * 100)}% mastery`,
          recommendation: "Needs more practice",
        });
      } else if (mod.mastery >= ADVANCE_THRESHOLD && mod.status !== "mastered") {
        focusAreas.push({
          type: "ready_to_advance",
          moduleName: mod.name,
          mastery: mod.mastery,
          reason: `${Math.round(mod.mastery * 100)}% mastery — ready to advance`,
          recommendation: "Move to next topic",
        });
      }
    }

    // ── Achievements ─────────────────────────────────────
    const achievements: Achievement[] = [];
    // Streak
    const streak = computeCallStreakShared(data.calls.map((c) => c.createdAt));
    if (streak >= 3) {
      achievements.push({ icon: "🔥", label: `${streak}-lesson streak`, value: "" });
    }
    // Mastered modules
    for (const mod of modules.filter((m) => m.status === "mastered")) {
      achievements.push({ icon: "⭐", label: `${mod.name} mastered`, value: "" });
    }
    // Total calls
    if (data.counts.calls >= 5) {
      achievements.push({ icon: "💬", label: `${data.counts.calls} lessons total`, value: "" });
    }
    // Memories count
    if (data.counts.memories >= 10) {
      achievements.push({ icon: "🧠", label: `${data.counts.memories} things remembered`, value: "" });
    }

    // ── Momentum ─────────────────────────────────────────
    const momentum = computeMomentumShared(data.calls.map((c) => c.createdAt));

    // ── Call recency ─────────────────────────────────────
    const sortedCalls = [...(data.calls || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastCallDaysAgo = sortedCalls.length > 0
      ? Math.floor((Date.now() - new Date(sortedCalls[0].createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // ── Top memories ─────────────────────────────────────
    const topMemories = (data.memorySummary?.keyFacts || [])
      .slice(0, 5)
      .map((f) => ({ key: f.key, value: f.value }));

    // Add preferences
    if (data.memorySummary?.preferences) {
      for (const [key, value] of Object.entries(data.memorySummary.preferences).slice(0, 3)) {
        if (!topMemories.some((m) => m.key === key)) {
          topMemories.push({ key, value });
        }
      }
    }

    // ── Personality traits ───────────────────────────────
    const personalityTraits: { label: string; value: number }[] = [];
    if (data.personality?.parameterValues) {
      for (const [key, value] of Object.entries(data.personality.parameterValues).slice(0, 6)) {
        if (typeof value === "number") {
          personalityTraits.push({ label: key, value });
        }
      }
    }

    return {
      goals: { items: activeGoals, overallProgress: goalProgress, count: activeGoals.length },
      courses: { modules, totalModules: modules.length, completedModules, overallMastery },
      learnings: { totalLOs, masteredLOs, recentlyMastered: [], inProgress: [] },
      targets,
      focusAreas,
      achievements,
      momentum,
      callStreak: streak,
      lastCallDaysAgo,
      totalCalls: data.counts.calls,
      topMemories,
      personalityTraits,
    };
  }, [data]);
}

// Helpers moved to lib/caller-utils.ts — shared between roster (list) and detail (lens) views.
