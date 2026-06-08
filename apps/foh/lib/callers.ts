// ---------------------------------------------------------------------------
// Caller view model + pure helpers.
//
// Mirrors HF's RosterCaller (apps/admin/app/api/callers/roster/route.ts).
// Momentum / TriageCategory unions are copied verbatim from
// apps/admin/lib/caller-utils.ts so FOH renders HF's real vocabulary.
// ---------------------------------------------------------------------------

export type Momentum = "accelerating" | "steady" | "slowing" | "new";
export type TriageCategory =
  | "attention"
  | "advancing"
  | "active"
  | "inactive"
  | "new";

export interface CallerSummary {
  id: string;
  name: string;
  email: string | null;
  totalCalls: number;
  lastCallAt: string | null;
  recentCallDates: string[];
  /** 0–1 average mastery. */
  mastery: number | null;
  completedModules: number;
  totalModules: number;
  currentModule: string | null;
  momentum: Momentum;
  triage: TriageCategory;
}

export interface CallersResponse {
  live: boolean;
  source: string;
  callers: CallerSummary[];
  note?: string;
}

/** Map an HF RosterCaller row → CallerSummary (used by the live proxy). */
export function reshapeRoster(roster: any[]): CallerSummary[] {
  return (roster ?? []).map((c) => ({
    id: c.id,
    name: c.name ?? "Unnamed caller",
    email: c.email ?? null,
    totalCalls: c.totalCalls ?? 0,
    lastCallAt: c.lastCallAt ?? null,
    recentCallDates: c.recentCallDates ?? [],
    mastery: c.mastery ?? null,
    completedModules: c.completedModules ?? 0,
    totalModules: c.totalModules ?? 0,
    currentModule: c.currentModule ?? null,
    momentum: (c.momentum ?? "new") as Momentum,
    triage: (c.triage ?? "new") as TriageCategory,
  }));
}

export function masteryPct(c: CallerSummary): number {
  return Math.round((c.mastery ?? 0) * 100);
}

export interface CallerHighlights {
  totalCallers: number;
  totalCalls: number;
  avgMasteryPct: number;
  mostActive: CallerSummary | null;
  topMastery: CallerSummary | null;
  needsAttention: number;
}

/** Derive the top-of-dashboard highlights from a roster. Pure + tested. */
export function callerHighlights(callers: CallerSummary[]): CallerHighlights {
  if (callers.length === 0) {
    return {
      totalCallers: 0,
      totalCalls: 0,
      avgMasteryPct: 0,
      mostActive: null,
      topMastery: null,
      needsAttention: 0,
    };
  }
  const totalCalls = callers.reduce((sum, c) => sum + c.totalCalls, 0);
  const avgMastery =
    callers.reduce((sum, c) => sum + (c.mastery ?? 0), 0) / callers.length;
  const mostActive = callers.reduce((a, b) =>
    b.totalCalls > a.totalCalls ? b : a,
  );
  const topMastery = callers.reduce((a, b) =>
    (b.mastery ?? 0) > (a.mastery ?? 0) ? b : a,
  );
  return {
    totalCallers: callers.length,
    totalCalls,
    avgMasteryPct: Math.round(avgMastery * 100),
    mostActive,
    topMastery,
    needsAttention: callers.filter((c) => c.triage === "attention").length,
  };
}

export const MOMENTUM_LABEL: Record<Momentum, string> = {
  accelerating: "↑ Accelerating",
  steady: "→ Steady",
  slowing: "↓ Slowing",
  new: "✦ New",
};

export const TRIAGE: Record<TriageCategory, { label: string; color: string }> = {
  attention: { label: "Needs attention", color: "var(--band-poor)" },
  advancing: { label: "Advancing", color: "var(--band-high)" },
  active: { label: "Active", color: "var(--band-mid)" },
  inactive: { label: "Inactive", color: "var(--text-tertiary)" },
  new: { label: "New", color: "var(--text-secondary)" },
};

// Representative roster, shaped exactly to RosterCaller. Served until a DEV
// login is configured (see lib/hf.ts fetchRosterLive + app/api/callers).
export const SAMPLE_ROSTER: CallerSummary[] = [
  { id: "c1", name: "Amelia Hughes", email: "amelia.h@example.com", totalCalls: 24, lastCallAt: "2026-06-07T09:12:00Z", recentCallDates: ["3 Jun", "5 Jun", "6 Jun", "7 Jun"], mastery: 0.82, completedModules: 7, totalModules: 9, currentModule: "Part 3 — Discussion", momentum: "accelerating", triage: "advancing" },
  { id: "c2", name: "Daniel Okonkwo", email: "d.okonkwo@example.com", totalCalls: 31, lastCallAt: "2026-06-08T08:40:00Z", recentCallDates: ["4 Jun", "5 Jun", "7 Jun", "8 Jun"], mastery: 0.74, completedModules: 6, totalModules: 9, currentModule: "Part 2 — Cue Card", momentum: "steady", triage: "active" },
  { id: "c3", name: "Priya Nair", email: "priya.nair@example.com", totalCalls: 9, lastCallAt: "2026-05-30T14:05:00Z", recentCallDates: ["26 May", "28 May", "30 May"], mastery: 0.41, completedModules: 2, totalModules: 9, currentModule: "Part 1 — General", momentum: "slowing", triage: "attention" },
  { id: "c4", name: "Marco Rossi", email: "marco.rossi@example.com", totalCalls: 18, lastCallAt: "2026-06-06T16:20:00Z", recentCallDates: ["1 Jun", "3 Jun", "6 Jun"], mastery: 0.68, completedModules: 5, totalModules: 9, currentModule: "Part 2 — Cue Card", momentum: "accelerating", triage: "advancing" },
  { id: "c5", name: "Sofia Almeida", email: "sofia.a@example.com", totalCalls: 3, lastCallAt: "2026-06-02T11:00:00Z", recentCallDates: ["31 May", "2 Jun"], mastery: 0.22, completedModules: 0, totalModules: 9, currentModule: "Part 1 — General", momentum: "new", triage: "new" },
  { id: "c6", name: "Ravi Patel", email: "ravi.patel@example.com", totalCalls: 14, lastCallAt: "2026-05-21T10:30:00Z", recentCallDates: ["17 May", "19 May", "21 May"], mastery: 0.55, completedModules: 4, totalModules: 9, currentModule: "Part 3 — Discussion", momentum: "slowing", triage: "inactive" },
  { id: "c7", name: "Chloe Bennett", email: "chloe.b@example.com", totalCalls: 27, lastCallAt: "2026-06-08T07:15:00Z", recentCallDates: ["5 Jun", "6 Jun", "7 Jun", "8 Jun"], mastery: 0.89, completedModules: 8, totalModules: 9, currentModule: "Full Mock", momentum: "accelerating", triage: "advancing" },
];
