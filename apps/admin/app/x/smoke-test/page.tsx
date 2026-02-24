"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Circle,
  RotateCcw,
  Clock,
  Copy,
  Check,
  ClipboardList,
  Bug,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import "./smoke-test.css";

// ── Checklist definition ──────────────────────────────

type CheckStatus = "pass" | "fail" | "skip" | "untested";

type CheckItem = {
  id: string;
  label: string;
  path?: string;
  hint?: string;
};

type CheckGroup = {
  id: string;
  title: string;
  items: CheckItem[];
};

const SMOKE_CHECKLIST: CheckGroup[] = [
  {
    id: "auth",
    title: "Authentication",
    items: [
      { id: "auth-login", label: "Login with email/password", path: "/login", hint: "Verify redirect to /x after login" },
      { id: "auth-logout", label: "Logout and redirect", hint: "Account menu → Sign Out → lands on /login" },
      { id: "auth-forgot", label: "Forgot password flow", path: "/forgot-password", hint: "Enter email → verify email sent" },
    ],
  },
  {
    id: "nav",
    title: "Navigation & Layout",
    items: [
      { id: "nav-sidebar", label: "Sidebar loads with all sections", path: "/x", hint: "All nav items visible for your role" },
      { id: "nav-breadcrumbs", label: "Breadcrumbs work on nested pages", hint: "Click into Domain → Course → verify breadcrumb trail" },
      { id: "nav-mobile", label: "Responsive layout (resize to mobile)", hint: "Sidebar collapses, content reflows" },
      { id: "nav-cmdk", label: "Cmd+K command palette opens", hint: "Press Cmd+K → search works" },
    ],
  },
  {
    id: "domains",
    title: "Institutions / Domains",
    items: [
      { id: "dom-list", label: "Domains page loads", path: "/x/domains", hint: "Cards render, no blank page" },
      { id: "dom-detail", label: "Click into a domain → detail loads", hint: "Tabs visible: Overview, Courses, etc." },
      { id: "dom-onboard", label: "Onboarding tab shows readiness checks", hint: "Green/amber/red indicators" },
    ],
  },
  {
    id: "courses",
    title: "Courses / Subjects",
    items: [
      { id: "course-list", label: "Subjects page loads", path: "/x/subjects", hint: "Grid of course cards" },
      { id: "course-detail", label: "Click into a subject → detail loads", hint: "Lessons, content, settings visible" },
      { id: "course-content", label: "Materials tab shows uploaded content", hint: "Files listed with trust levels" },
    ],
  },
  {
    id: "callers",
    title: "Callers / Learners",
    items: [
      { id: "caller-list", label: "Callers page loads", path: "/x/callers", hint: "Table/cards with caller data" },
      { id: "caller-detail", label: "Click into a caller → 4 tabs load", hint: "Calls, Profile, Assess, Artifacts" },
      { id: "caller-calls", label: "Calls tab shows call history", hint: "Transcripts, timestamps, duration" },
      { id: "caller-profile", label: "Profile tab shows learner data", hint: "Memory, personality, parameters" },
    ],
  },
  {
    id: "sim",
    title: "Call Simulator",
    items: [
      { id: "sim-open", label: "Simulator page loads", path: "/x/sim", hint: "Caller picker, chat panel" },
      { id: "sim-select", label: "Select a caller → prompt renders", hint: "System prompt visible in panel" },
      { id: "sim-chat", label: "Send a message → AI responds", hint: "Streaming response, no errors" },
    ],
  },
  {
    id: "wizards",
    title: "Wizards & Setup Flows",
    items: [
      { id: "wiz-quick", label: "Community loads", path: "/x/quick-launch", hint: "Phase machine starts" },
      { id: "wiz-demonstrate", label: "Demonstrate wizard loads", path: "/x/demonstrate", hint: "Steps render in order" },
      { id: "wiz-teach", label: "Teach wizard loads", path: "/x/teach", hint: "Steps render in order" },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline & Analysis",
    items: [
      { id: "pipe-page", label: "Pipeline page loads", path: "/x/pipeline", hint: "Run history visible" },
      { id: "pipe-run", label: "Click a run → inspector shows stages", hint: "EXTRACT → AGGREGATE → etc." },
    ],
  },
  {
    id: "content",
    title: "Content & Knowledge",
    items: [
      { id: "content-explorer", label: "Content Explorer loads", path: "/x/content-explorer", hint: "Hierarchy tree renders" },
      { id: "content-sources", label: "Materials page loads", path: "/x/content-sources", hint: "Upload panel, file list" },
      { id: "content-specs", label: "Specs page loads", path: "/x/specs", hint: "Spec cards with roles, versions" },
    ],
  },
  {
    id: "admin",
    title: "Admin & Settings",
    items: [
      { id: "admin-settings", label: "Settings page loads", path: "/x/settings", hint: "All panels render" },
      { id: "admin-users", label: "Users page loads", path: "/x/users", hint: "User table with roles" },
      { id: "admin-metering", label: "Metering page loads", path: "/x/metering", hint: "Cost data, charts" },
      { id: "admin-layers", label: "Identity Layers page loads", path: "/x/layers", hint: "Base + overlay specs" },
    ],
  },
  {
    id: "infra",
    title: "Infrastructure",
    items: [
      { id: "infra-health", label: "Health endpoint responds", path: "/api/health", hint: "Returns 200 OK" },
      { id: "infra-ready", label: "Readiness endpoint responds", path: "/api/ready", hint: "Returns 200 with checks" },
      { id: "infra-env", label: "Environment indicator correct", hint: "Blue stripe (DEV), purple (TEST), or none (PROD)" },
      { id: "infra-bug", label: "Bug Reporter opens from status bar", hint: "Click bug icon → panel expands" },
    ],
  },
];

const ALL_ITEMS = SMOKE_CHECKLIST.flatMap((g) => g.items);
const TOTAL = ALL_ITEMS.length;

// ── Storage ───────────────────────────────────────────

type RunResult = Record<string, { status: CheckStatus; note?: string; ts: number }>;
type SmokeRun = { id: string; startedAt: number; completedAt?: number; results: RunResult; env: string };

const STORAGE_KEY = "hf.smokeTest";

function loadRuns(): SmokeRun[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRuns(runs: SmokeRun[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

// ── Component ─────────────────────────────────────────

export default function SmokeTestPage() {
  const [runs, setRuns] = useState<SmokeRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    const loaded = loadRuns();
    setRuns(loaded);
    if (loaded.length > 0) {
      setActiveRunId(loaded[0].id);
    }
  }, []);

  const activeRun = runs.find((r) => r.id === activeRunId) || null;

  const persist = useCallback(
    (updater: (prev: SmokeRun[]) => SmokeRun[]) => {
      setRuns((prev) => {
        const next = updater(prev);
        saveRuns(next);
        return next;
      });
    },
    [],
  );

  // ── Actions ──

  const startNewRun = () => {
    const env =
      typeof window !== "undefined"
        ? window.location.hostname.includes("dev.")
          ? "DEV"
          : window.location.hostname.includes("test.")
            ? "TEST"
            : window.location.hostname.includes("lab.")
              ? "PROD"
              : "LOCAL"
        : "UNKNOWN";

    const run: SmokeRun = {
      id: `run-${Date.now()}`,
      startedAt: Date.now(),
      results: {},
      env,
    };
    persist((prev) => [run, ...prev.slice(0, 9)]); // keep last 10
    setActiveRunId(run.id);
  };

  const setStatus = (itemId: string, status: CheckStatus) => {
    if (!activeRunId) return;
    persist((prev) =>
      prev.map((r) =>
        r.id === activeRunId
          ? { ...r, results: { ...r.results, [itemId]: { ...r.results[itemId], status, ts: Date.now() } } }
          : r,
      ),
    );
  };

  const setNote = (itemId: string, note: string) => {
    if (!activeRunId) return;
    persist((prev) =>
      prev.map((r) =>
        r.id === activeRunId
          ? {
              ...r,
              results: {
                ...r.results,
                [itemId]: { ...r.results[itemId], status: r.results[itemId]?.status || "untested", note, ts: Date.now() },
              },
            }
          : r,
      ),
    );
  };

  const completeRun = () => {
    if (!activeRunId) return;
    persist((prev) =>
      prev.map((r) => (r.id === activeRunId ? { ...r, completedAt: Date.now() } : r)),
    );
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── Stats ──

  const stats = activeRun
    ? {
        pass: ALL_ITEMS.filter((i) => activeRun.results[i.id]?.status === "pass").length,
        fail: ALL_ITEMS.filter((i) => activeRun.results[i.id]?.status === "fail").length,
        skip: ALL_ITEMS.filter((i) => activeRun.results[i.id]?.status === "skip").length,
        untested: ALL_ITEMS.filter((i) => !activeRun.results[i.id] || activeRun.results[i.id]?.status === "untested").length,
      }
    : { pass: 0, fail: 0, skip: 0, untested: TOTAL };

  // ── Export for Claude Code ──

  const exportForClaude = () => {
    if (!activeRun) return "";
    const lines = [
      `## Smoke Test Report — ${activeRun.env} (${new Date(activeRun.startedAt).toLocaleString()})`,
      `**Results:** ${stats.pass} pass, ${stats.fail} fail, ${stats.skip} skipped, ${stats.untested} untested`,
      "",
    ];

    // Only include failures and notes
    const failures = ALL_ITEMS.filter((i) => activeRun.results[i.id]?.status === "fail");
    if (failures.length > 0) {
      lines.push("### Failures");
      for (const item of failures) {
        const r = activeRun.results[item.id];
        lines.push(`- **${item.label}**${item.path ? ` (${item.path})` : ""}`);
        if (r?.note) lines.push(`  - Note: ${r.note}`);
      }
      lines.push("");
    }

    const withNotes = ALL_ITEMS.filter(
      (i) => activeRun.results[i.id]?.note && activeRun.results[i.id]?.status !== "fail",
    );
    if (withNotes.length > 0) {
      lines.push("### Notes");
      for (const item of withNotes) {
        const r = activeRun.results[item.id];
        lines.push(`- **${item.label}** (${r.status}): ${r.note}`);
      }
    }

    return lines.join("\n");
  };

  // ── Render ──

  const statusIcon = (status: CheckStatus, size = 18) => {
    switch (status) {
      case "pass":
        return <CheckCircle2 size={size} className="st-icon-pass" />;
      case "fail":
        return <XCircle size={size} className="st-icon-fail" />;
      case "skip":
        return <Circle size={size} className="st-icon-skip" />;
      default:
        return <Circle size={size} className="st-icon-untested" />;
    }
  };

  return (
    <div className="st-page">
      {/* Header */}
      <div className="st-header">
        <div className="st-header-left">
          <ClipboardList size={24} className="st-header-icon" />
          <div>
            <h1 className="hf-page-title">Smoke Test</h1>
            <p className="hf-page-subtitle">{TOTAL} checks across {SMOKE_CHECKLIST.length} areas</p>
          </div>
        </div>
        <div className="st-header-actions">
          {activeRun && !activeRun.completedAt && (
            <button className="hf-btn hf-btn-secondary" onClick={completeRun}>
              <Check size={14} /> Mark Complete
            </button>
          )}
          <button className="hf-btn hf-btn-primary" onClick={startNewRun}>
            <RotateCcw size={14} /> New Run
          </button>
        </div>
      </div>

      {/* Run selector + stats */}
      {runs.length > 0 && (
        <div className="st-run-bar">
          <div className="st-run-selector">
            <select
              value={activeRunId || ""}
              onChange={(e) => setActiveRunId(e.target.value)}
              className="hf-input st-run-select"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.env} — {new Date(r.startedAt).toLocaleString()}
                  {r.completedAt ? " (done)" : " (in progress)"}
                </option>
              ))}
            </select>
          </div>
          {activeRun && (
            <div className="st-stats">
              <span className="st-stat st-stat-pass">{stats.pass} pass</span>
              <span className="st-stat st-stat-fail">{stats.fail} fail</span>
              <span className="st-stat st-stat-skip">{stats.skip} skip</span>
              <span className="st-stat st-stat-untested">{stats.untested} untested</span>
              <button
                className="st-copy-btn"
                onClick={() => copy(exportForClaude())}
                title="Copy failures + notes for Claude Code"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy for Claude"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* No run state */}
      {!activeRun && (
        <div className="hf-card st-empty">
          <ClipboardList size={40} className="st-empty-icon" />
          <p className="st-empty-text">Start a new smoke test run to begin checking</p>
          <button className="hf-btn hf-btn-primary" onClick={startNewRun}>
            <RotateCcw size={14} /> Start First Run
          </button>
        </div>
      )}

      {/* Checklist */}
      {activeRun && (
        <div className="st-checklist">
          {SMOKE_CHECKLIST.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            const groupStats = {
              pass: group.items.filter((i) => activeRun.results[i.id]?.status === "pass").length,
              fail: group.items.filter((i) => activeRun.results[i.id]?.status === "fail").length,
              total: group.items.length,
            };
            const allDone = groupStats.pass + groupStats.fail === groupStats.total;

            return (
              <div key={group.id} className="hf-card st-group">
                <button className="st-group-header" onClick={() => toggleGroup(group.id)}>
                  <div className="st-group-header-left">
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    <span className="st-group-title">{group.title}</span>
                  </div>
                  <div className="st-group-badges">
                    {groupStats.fail > 0 && (
                      <span className="st-badge st-badge-fail">{groupStats.fail} fail</span>
                    )}
                    <span className={`st-badge ${allDone ? "st-badge-done" : "st-badge-count"}`}>
                      {groupStats.pass}/{groupStats.total}
                    </span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="st-group-items">
                    {group.items.map((item) => {
                      const result = activeRun.results[item.id];
                      const status: CheckStatus = result?.status || "untested";
                      const isEditing = noteEditing === item.id;

                      return (
                        <div key={item.id} className={`st-item ${status !== "untested" ? `st-item-${status}` : ""}`}>
                          <div className="st-item-main">
                            <div className="st-item-left">
                              {statusIcon(status)}
                              <div className="st-item-text">
                                <span className="st-item-label">{item.label}</span>
                                {item.hint && (
                                  <span className="st-item-hint">{item.hint}</span>
                                )}
                                {result?.note && !isEditing && (
                                  <span
                                    className="st-item-note"
                                    onClick={() => {
                                      setNoteEditing(item.id);
                                      setNoteText(result.note || "");
                                    }}
                                  >
                                    <Bug size={11} /> {result.note}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="st-item-actions">
                              {item.path && (
                                <a
                                  href={item.path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="st-link-btn"
                                  title={`Open ${item.path}`}
                                >
                                  <ExternalLink size={13} />
                                </a>
                              )}
                              <button
                                className={`st-status-btn ${status === "pass" ? "st-status-btn-active-pass" : ""}`}
                                onClick={() => setStatus(item.id, status === "pass" ? "untested" : "pass")}
                                title="Pass"
                              >
                                <CheckCircle2 size={15} />
                              </button>
                              <button
                                className={`st-status-btn ${status === "fail" ? "st-status-btn-active-fail" : ""}`}
                                onClick={() => setStatus(item.id, status === "fail" ? "untested" : "fail")}
                                title="Fail"
                              >
                                <XCircle size={15} />
                              </button>
                              <button
                                className={`st-status-btn ${status === "skip" ? "st-status-btn-active-skip" : ""}`}
                                onClick={() => setStatus(item.id, status === "skip" ? "untested" : "skip")}
                                title="Skip"
                              >
                                <Circle size={15} />
                              </button>
                              <button
                                className="st-status-btn"
                                onClick={() => {
                                  if (isEditing) {
                                    setNoteEditing(null);
                                  } else {
                                    setNoteEditing(item.id);
                                    setNoteText(result?.note || "");
                                  }
                                }}
                                title="Add note"
                              >
                                <Bug size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Inline note editor */}
                          {isEditing && (
                            <div className="st-note-editor">
                              <input
                                type="text"
                                className="hf-input st-note-input"
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Describe the issue (paste bug reporter diagnosis here)..."
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    setNote(item.id, noteText);
                                    setNoteEditing(null);
                                  }
                                  if (e.key === "Escape") setNoteEditing(null);
                                }}
                              />
                              <button
                                className="hf-btn hf-btn-primary st-note-save"
                                onClick={() => {
                                  setNote(item.id, noteText);
                                  setNoteEditing(null);
                                }}
                              >
                                Save
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Workflow reminder */}
      <div className="hf-card st-workflow">
        <h3 className="hf-section-title">Testing Workflow</h3>
        <ol className="st-workflow-list">
          <li><strong>New Run</strong> — Click &quot;New Run&quot; to start. Environment auto-detected.</li>
          <li><strong>Walk each area</strong> — Click the link icon to open the page, then mark pass/fail.</li>
          <li><strong>On failure</strong> — Use the in-app Bug Reporter for AI diagnosis, then click the bug icon to paste the note.</li>
          <li><strong>Copy for Claude</strong> — Hit &quot;Copy for Claude&quot; to get all failures + notes as markdown. Paste to Claude Code with <code>/fix</code>.</li>
          <li><strong>After fixes</strong> — Re-test failed items in a new run or flip them to pass.</li>
        </ol>
      </div>
    </div>
  );
}
