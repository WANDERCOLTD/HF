"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTerminology } from "@/contexts/TerminologyContext";
import { ChevronUp, ChevronDown } from "lucide-react";

interface Student {
  id: string;
  name: string;
  email: string | null;
  classroom: { id: string; name: string } | null;
  classrooms?: { id: string; name: string }[];
  totalCalls: number;
  lastCallAt: string | null;
  joinedAt: string;
}

interface ActiveCall {
  callId: string;
  callerId: string;
}

type SortKey = "name" | "classroom" | "calls" | "lastCall" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "moderate" | "inactive" | "not_started";

function getStatus(s: Student, threeDaysAgo: number, sevenDaysAgo: number) {
  if (!s.lastCallAt) return { label: "Not started", color: "var(--text-muted)", rank: 4 };
  const t = new Date(s.lastCallAt).getTime();
  if (t > threeDaysAgo) return { label: "Active", color: "var(--status-success-text)", rank: 1 };
  if (t > sevenDaysAgo) return { label: "3-7 days ago", color: "var(--status-warning-text)", rank: 2 };
  return { label: "Inactive 7d+", color: "var(--status-error-text)", rank: 3 };
}

const STATUS_FILTERS: [StatusFilter, string][] = [
  ["all", "All"],
  ["active", "Active"],
  ["moderate", "3-7 days"],
  ["inactive", "Inactive 7d+"],
  ["not_started", "Not started"],
];

export default function StudentsPage() {
  const searchParams = useSearchParams();
  const institutionId = searchParams.get("institutionId");
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCalls, setActiveCalls] = useState<Map<string, string>>(new Map());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [classroomFilter, setClassroomFilter] = useState<string>("all");
  const { plural, lower, lowerPlural } = useTerminology();

  useEffect(() => {
    const instQuery = institutionId ? `?institutionId=${institutionId}` : "";
    Promise.all([
      fetch(`/api/educator/students${instQuery}`).then((r) => r.json()),
      fetch(`/api/educator/active-calls${instQuery}`).then((r) => r.json()),
    ])
      .then(([studentsRes, callsRes]: [{ ok: boolean; students: Student[] }, { ok: boolean; activeCalls: ActiveCall[] }]) => {
        if (studentsRes?.ok) setStudents(studentsRes.students);
        if (callsRes?.ok) {
          const map = new Map<string, string>();
          for (const c of callsRes.activeCalls) {
            if (c.callerId) map.set(c.callerId, c.callId);
          }
          setActiveCalls(map);
        }
      })
      .finally(() => setLoading(false));
  }, [institutionId]);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  const classroomNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of students) {
      if (s.classroom) names.add(s.classroom.name);
    }
    return Array.from(names).sort();
  }, [students]);

  const processed = useMemo(() => {
    let list = [...students];

    if (statusFilter !== "all") {
      list = list.filter((s) => {
        const st = getStatus(s, threeDaysAgo, sevenDaysAgo);
        if (statusFilter === "active") return st.rank === 1;
        if (statusFilter === "moderate") return st.rank === 2;
        if (statusFilter === "inactive") return st.rank === 3;
        if (statusFilter === "not_started") return st.rank === 4;
        return true;
      });
    }

    if (classroomFilter !== "all") {
      if (classroomFilter === "unassigned") {
        list = list.filter((s) => !s.classroom);
      } else {
        list = list.filter((s) => s.classroom?.name === classroomFilter);
      }
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.classroom?.name.toLowerCase().includes(q) ||
          (!s.classroom && "unassigned".includes(q))
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "classroom":
          cmp = (a.classroom?.name ?? "zzz").localeCompare(b.classroom?.name ?? "zzz");
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
        case "status": {
          const ar = getStatus(a, threeDaysAgo, sevenDaysAgo).rank;
          const br = getStatus(b, threeDaysAgo, sevenDaysAgo).rank;
          cmp = ar - br;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [students, statusFilter, classroomFilter, search, sortKey, sortDir, threeDaysAgo, sevenDaysAgo]);

  const statusCounts = useMemo(() => {
    const counts = { all: students.length, active: 0, moderate: 0, inactive: 0, not_started: 0 };
    for (const s of students) {
      const st = getStatus(s, threeDaysAgo, sevenDaysAgo);
      if (st.rank === 1) counts.active++;
      else if (st.rank === 2) counts.moderate++;
      else if (st.rank === 3) counts.inactive++;
      else counts.not_started++;
    }
    return counts;
  }, [students, threeDaysAgo, sevenDaysAgo]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "calls" || key === "lastCall" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (loading) {
    return (
      <div style={{ padding: 32 }}>
        <div className="hf-spinner" />
      </div>
    );
  }

  const hasUnassigned = students.some((s) => !s.classroom);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 className="hf-page-title" style={{ marginBottom: 4 }}>
            {plural("caller")}
          </h1>
          <p className="hf-page-subtitle">
            {students.length} {students.length !== 1 ? lowerPlural("caller") : lower("caller")}
            {hasUnassigned && (
              <> &middot; {students.filter((s) => !s.classroom).length} unassigned</>
            )}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${lowerPlural("caller")}...`}
          className="hf-input"
          style={{ width: 240 }}
        />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {STATUS_FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`hf-filter-pill${statusFilter === key ? " hf-filter-pill-active" : ""}`}
            onClick={() => setStatusFilter(key)}
          >
            {label}
            <span style={{ opacity: 0.7 }}>{statusCounts[key]}</span>
          </button>
        ))}

        {classroomNames.length > 1 && (
          <>
            <span style={{ width: 1, height: 20, background: "var(--border-default)" }} />
            <select
              value={classroomFilter}
              onChange={(e) => setClassroomFilter(e.target.value)}
              className="hf-filter-pill"
              style={{ appearance: "auto", paddingRight: 20 }}
            >
              <option value="all">All classrooms</option>
              {classroomNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              {hasUnassigned && <option value="unassigned">Unassigned</option>}
            </select>
          </>
        )}
      </div>

      {/* Table */}
      {processed.length === 0 ? (
        <div className="hf-empty" style={{ padding: "40px 20px" }}>
          {search || statusFilter !== "all" || classroomFilter !== "all"
            ? `No ${lowerPlural("caller")} match your filters.`
            : `No ${lowerPlural("caller")} yet. Invite them via your ${lowerPlural("cohort")}.`}
        </div>
      ) : (
        <div className="hf-table-container" style={{ background: "var(--surface-primary)" }}>
          {/* Header */}
          <div className="students-table-grid students-table-header">
            <div className={`hf-th-sort${sortKey === "name" ? " hf-th-sort-active" : ""}`} onClick={() => handleSort("name")}>
              Name <SortIcon col="name" />
            </div>
            <div className={`hf-th-sort${sortKey === "classroom" ? " hf-th-sort-active" : ""}`} onClick={() => handleSort("classroom")}>
              Classroom <SortIcon col="classroom" />
            </div>
            <div className={`hf-th-sort${sortKey === "calls" ? " hf-th-sort-active" : ""}`} onClick={() => handleSort("calls")} style={{ justifyContent: "center" }}>
              Calls <SortIcon col="calls" />
            </div>
            <div className={`hf-th-sort${sortKey === "lastCall" ? " hf-th-sort-active" : ""}`} onClick={() => handleSort("lastCall")}>
              Last Call <SortIcon col="lastCall" />
            </div>
            <div className={`hf-th-sort${sortKey === "status" ? " hf-th-sort-active" : ""}`} onClick={() => handleSort("status")}>
              Status <SortIcon col="status" />
            </div>
          </div>

          {/* Rows */}
          {processed.map((s) => {
            const status = getStatus(s, threeDaysAgo, sevenDaysAgo);
            const inCallId = activeCalls.get(s.id);

            return (
              <div key={s.id} className="students-table-grid hf-table-row" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <div>
                  <Link href={`/x/educator/students/${s.id}`} style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", textDecoration: "none" }}>
                    {s.name}
                  </Link>
                </div>

                <div>
                  {s.classroom ? (
                    <Link href={`/x/educator/classrooms/${s.classroom.id}`} className="hf-badge hf-badge-muted" style={{ textDecoration: "none", fontSize: 12 }}>
                      {s.classroom.name}
                    </Link>
                  ) : (
                    <span className="hf-badge hf-badge-warning" style={{ fontSize: 12 }}>Unassigned</span>
                  )}
                </div>

                <div style={{ textAlign: "center", fontSize: 14, color: "var(--text-secondary)" }}>
                  {s.totalCalls}
                </div>

                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {s.lastCallAt
                    ? new Date(s.lastCallAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                    : "—"}
                </div>

                <div>
                  {inCallId ? (
                    <Link
                      href={`/x/educator/observe/${inCallId}`}
                      className="hf-badge hf-badge-success"
                      style={{ textDecoration: "none", fontSize: 12, fontWeight: 600, gap: 6, border: "1px solid var(--status-success-border)" }}
                    >
                      <span className="students-status-dot" style={{ background: "var(--status-success-text)", animation: "pulse 2s infinite" }} />
                      In Call — Observe
                    </Link>
                  ) : (
                    <span className="students-status-inline" style={{ color: status.color }}>
                      <span className="students-status-dot" style={{ background: status.color }} />
                      {status.label}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
