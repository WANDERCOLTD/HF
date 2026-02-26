"use client";

import { useState, useEffect, useMemo } from "react";
import type { RosterCaller } from "@/app/api/callers/roster/route";
import { triageSortRank, type TriageCategory } from "@/lib/caller-utils";

type ActiveCall = { callId: string; callerId: string };

type SortKey = "triage" | "name" | "mastery" | "calls" | "lastCall";
type SortDir = "asc" | "desc";

export type RosterFilters = {
  search: string;
  triageFilter: TriageCategory | "all" | "in_call";
  classroomFilter: string;
  sortKey: SortKey;
  sortDir: SortDir;
};

export type RosterSummary = {
  total: number;
  active: number;
  attention: number;
  advancing: number;
  inactive: number;
  newCount: number;
  inCall: number;
  avgMastery: number | null;
};

export function useRosterData(institutionId?: string | null) {
  const [roster, setRoster] = useState<RosterCaller[]>([]);
  const [activeCalls, setActiveCalls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<RosterFilters>({
    search: "",
    triageFilter: "all",
    classroomFilter: "all",
    sortKey: "triage",
    sortDir: "asc",
  });

  // Fetch roster + active calls in parallel
  useEffect(() => {
    setLoading(true);
    setError(null);

    const instQuery = institutionId ? `?institutionId=${institutionId}` : "";
    const activeCallsQuery = institutionId ? `?institutionId=${institutionId}` : "";

    Promise.all([
      fetch(`/api/callers/roster${instQuery}`).then((r) => r.json()),
      fetch(`/api/educator/active-calls${activeCallsQuery}`).then((r) => r.json()).catch(() => ({ ok: false })),
    ])
      .then(([rosterRes, callsRes]) => {
        if (rosterRes?.ok) {
          setRoster(rosterRes.roster);
        } else {
          setError(rosterRes?.error || "Failed to load roster");
        }
        if (callsRes?.ok) {
          const map = new Map<string, string>();
          for (const c of callsRes.activeCalls as ActiveCall[]) {
            if (c.callerId) map.set(c.callerId, c.callId);
          }
          setActiveCalls(map);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [institutionId]);

  // Classrooms for filter dropdown
  const classrooms = useMemo(() => {
    const names = new Map<string, string>(); // id -> name
    for (const c of roster) {
      if (c.classroom) names.set(c.classroom.id, c.classroom.name);
    }
    return Array.from(names.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster]);

  // Summary counts
  const summary: RosterSummary = useMemo(() => {
    const inCallCount = activeCalls.size;
    let attention = 0, advancing = 0, active = 0, inactive = 0, newCount = 0;
    let masterySum = 0, masteryCount = 0;

    for (const c of roster) {
      switch (c.triage) {
        case "attention": attention++; break;
        case "advancing": advancing++; break;
        case "active": active++; break;
        case "inactive": inactive++; break;
        case "new": newCount++; break;
      }
      if (c.mastery !== null) {
        masterySum += c.mastery;
        masteryCount++;
      }
    }

    return {
      total: roster.length,
      active,
      attention,
      advancing,
      inactive,
      newCount,
      inCall: inCallCount,
      avgMastery: masteryCount > 0 ? masterySum / masteryCount : null,
    };
  }, [roster, activeCalls]);

  // Filtered + sorted
  const processed = useMemo(() => {
    let list = [...roster];

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q) ||
          c.classroom?.name.toLowerCase().includes(q) ||
          c.currentModule?.toLowerCase().includes(q)
      );
    }

    // Triage filter
    if (filters.triageFilter !== "all") {
      if (filters.triageFilter === "in_call") {
        list = list.filter((c) => activeCalls.has(c.id));
      } else {
        list = list.filter((c) => c.triage === filters.triageFilter);
      }
    }

    // Classroom filter
    if (filters.classroomFilter !== "all") {
      if (filters.classroomFilter === "unassigned") {
        list = list.filter((c) => !c.classroom);
      } else {
        list = list.filter((c) => c.classroom?.id === filters.classroomFilter);
      }
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      switch (filters.sortKey) {
        case "triage":
          cmp = triageSortRank(a.triage) - triageSortRank(b.triage);
          if (cmp === 0) cmp = (a.name ?? "").localeCompare(b.name ?? "");
          break;
        case "name":
          cmp = (a.name ?? "").localeCompare(b.name ?? "");
          break;
        case "mastery":
          cmp = (a.mastery ?? -1) - (b.mastery ?? -1);
          break;
        case "calls":
          cmp = a.totalCalls - b.totalCalls;
          break;
        case "lastCall": {
          const at = a.lastCallAt ? new Date(a.lastCallAt).getTime() : 0;
          const bt = b.lastCallAt ? new Date(b.lastCallAt).getTime() : 0;
          cmp = at - bt;
          break;
        }
      }
      return filters.sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [roster, activeCalls, filters]);

  const refresh = () => {
    setLoading(true);
    const instQuery = institutionId ? `?institutionId=${institutionId}` : "";
    fetch(`/api/callers/roster${instQuery}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok) setRoster(res.roster);
      })
      .finally(() => setLoading(false));
  };

  return {
    roster: processed,
    allRoster: roster,
    activeCalls,
    summary,
    classrooms,
    filters,
    setFilters,
    loading,
    error,
    refresh,
  };
}
