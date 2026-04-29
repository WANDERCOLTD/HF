"use client";

/**
 * Session Flow Editor — writable variant of the Timeline.
 *
 * Same BEFORE / DURING / AFTER structure as SessionFlowTimeline (#223),
 * but each row that supports editing has an [Edit ▸] button that opens
 * a side drawer with a small form. Saves via PUT /api/courses/[courseId]/session-flow.
 *
 * Drawers ship one at a time. Initial set: Sessions (course mode picker).
 * Subsequent commits add NPS picker, KC delivery mode, etc.
 *
 * @see SessionFlowTimeline.tsx
 * @see app/api/courses/[courseId]/session-flow/route.ts
 */

import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Minus,
  Sparkles,
  GraduationCap,
  ClipboardCheck,
  MessageSquare,
  ThumbsUp,
  Settings2,
  ChevronRight,
  Target,
  HelpCircle,
  Pencil,
  X,
  AlertTriangle,
} from "lucide-react";
import type {
  SessionFlowResolved,
  JourneyStop,
  OnboardingPhase,
  SessionFlowConfig,
} from "@/lib/types/json-fields";
import {
  sourceLabel,
  kcSummary,
  isPreTest,
  isMidTest,
  isPostTest,
  stopSummary,
  formatTrigger,
} from "./timeline-helpers";
import "./session-flow-timeline.css";
import "./session-flow-editor.css";

// ── Types ──────────────────────────────────────────────

type ApiResponse = {
  ok: true;
  sessionFlow: SessionFlowResolved;
  mode: "continuous" | "structured";
  teachingMode: string | null;
  sessionCount: number | null;
  courseName: string;
} | { ok: false; error: string };

type Status = "enabled" | "disabled" | "default";

interface RowSpec {
  id: string;
  icon: React.ReactNode;
  label: string;
  summary: string;
  status: Status;
  details: { label: string; value: React.ReactNode }[] | null;
  editable: boolean;
}

type DrawerKind = null | "mode";

export type SessionFlowEditorProps = {
  courseId: string;
};

// ── Component ──────────────────────────────────────────────

export function SessionFlowEditor({ courseId }: SessionFlowEditorProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/session-flow`)
      .then(r => r.json() as Promise<ApiResponse>)
      .then(json => {
        if (!json.ok) setError(json.error);
        else setData(json);
        setLoading(false);
      })
      .catch(err => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [courseId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const onUpdated = (next: ApiResponse) => {
    setData(next);
    setDrawer(null);
  };

  if (loading) return <div className="sft-loading">Loading Session Flow…</div>;
  if (error) return <div className="sft-error">Could not load Session Flow: {error}</div>;
  if (!data || !data.ok) return null;

  const { sessionFlow, mode, teachingMode, sessionCount } = data;

  const before: RowSpec[] = [
    {
      id: "onboarding",
      icon: <Sparkles size={16} />,
      label: "Onboarding",
      summary: `${sessionFlow.onboarding.phases.length} phases · source: ${sourceLabel(sessionFlow.source.onboarding)}`,
      status: "enabled",
      details: onboardingDetails(sessionFlow),
      editable: false,
    },
    {
      id: "welcome-message",
      icon: <MessageSquare size={16} />,
      label: "Welcome message",
      summary: sessionFlow.welcomeMessage ? truncate(sessionFlow.welcomeMessage, 60) : "Generic fallback",
      status: sessionFlow.welcomeMessage ? "enabled" : "default",
      details: welcomeMessageDetails(sessionFlow),
      editable: false,
    },
    rowToggle("goals", "Goals question", "First call asks learner about their goals", sessionFlow.intake.goals.enabled, <Target size={16} />),
    rowToggle("about-you", "About You", "Motivation + confidence check", sessionFlow.intake.aboutYou.enabled, <HelpCircle size={16} />),
    {
      id: "knowledge-check",
      icon: <ClipboardCheck size={16} />,
      label: "Knowledge Check",
      summary: kcSummary(sessionFlow.intake.knowledgeCheck),
      status: sessionFlow.intake.knowledgeCheck.enabled ? "enabled" : "disabled",
      details: knowledgeCheckDetails(sessionFlow),
      editable: false,
    },
    rowToggle("ai-intro-call", "AI Intro Call", "Separate intro session before teaching", sessionFlow.intake.aiIntroCall.enabled, <Sparkles size={16} />),
    ...sessionFlow.stops.filter(isPreTest).map((s): RowSpec => ({
      id: s.id,
      icon: <ClipboardCheck size={16} />,
      label: "Pre-test",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
      editable: false,
    })),
  ];

  const during: RowSpec[] = [
    {
      id: "sessions",
      icon: <GraduationCap size={16} />,
      label: "Sessions",
      summary: mode === "continuous"
        ? "Scheduler-driven, no fixed count"
        : `${sessionCount ?? "?"} session${sessionCount === 1 ? "" : "s"} (structured)`,
      status: "default",
      details: sessionsDetails(mode, teachingMode, sessionCount),
      editable: true,
    },
    ...sessionFlow.stops.filter(isMidTest).map((s): RowSpec => ({
      id: s.id,
      icon: <ClipboardCheck size={16} />,
      label: "Mid-test",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
      editable: false,
    })),
  ];

  const after: RowSpec[] = [
    ...sessionFlow.stops.filter(isPostTest).map((s): RowSpec => ({
      id: s.id,
      icon: <ClipboardCheck size={16} />,
      label: "Post-test",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
      editable: false,
    })),
    ...sessionFlow.stops.filter(s => s.kind === "nps").map((s): RowSpec => ({
      id: s.id,
      icon: <ThumbsUp size={16} />,
      label: "NPS",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
      editable: false,
    })),
    {
      id: "offboarding",
      icon: <Minus size={16} />,
      label: "Offboarding",
      summary: `${sessionFlow.offboarding.phases.length} phases · trigger after ${sessionFlow.offboarding.triggerAfterCalls} calls`,
      status: sessionFlow.offboarding.phases.length > 0 ? "enabled" : "default",
      details: offboardingDetails(sessionFlow),
      editable: false,
    },
  ];

  const handleEdit = (rowId: string) => {
    if (rowId === "sessions") setDrawer("mode");
  };

  const toggleRow = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  return (
    <>
      <div className="sft">
        <header className="sft-header">
          <div className="sft-header-title">
            <Settings2 size={16} />
            <span>Session Flow</span>
          </div>
          <div className="sft-header-meta">
            <span className="sft-pill">Mode: {mode}</span>
            {teachingMode && <span className="sft-pill">Type: {teachingMode}</span>}
          </div>
        </header>

        <Section title="BEFORE" rows={before} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} />
        <Section title="DURING" rows={during} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} />
        <Section title="AFTER" rows={after} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} />
      </div>

      {drawer === "mode" && (
        <ModeDrawer
          courseId={courseId}
          currentMode={mode}
          sessionCount={sessionCount}
          onClose={() => setDrawer(null)}
          onSaved={onUpdated}
        />
      )}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Section({
  title, rows, expandedId, onToggle, onEdit,
}: {
  title: string;
  rows: RowSpec[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div className="sft-section">
      <h3 className="sft-section-title">{title}</h3>
      <ul className="sft-rows">
        {rows.map(row => (
          <Row
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            onToggle={() => onToggle(row.id)}
            onEdit={() => onEdit(row.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  row, expanded, onToggle, onEdit,
}: {
  row: RowSpec;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const expandable = !!row.details && row.details.length > 0;
  const classes = [
    "sft-row",
    `sft-row--${row.status}`,
    expandable ? "sft-row--expandable" : "",
    expanded ? "sft-row--expanded" : "",
  ].filter(Boolean).join(" ");

  return (
    <li className={classes}>
      <div
        className="sft-row-head sfe-row-head"
        onClick={expandable ? onToggle : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={expandable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <span className="sft-row-icon">{statusIcon(row.status, row.icon)}</span>
        <span className="sft-row-label">{row.label}</span>
        <span className="sft-row-summary">{row.summary}</span>
        <span className={`sft-row-badge sft-row-badge--${row.status}`}>{statusLabel(row.status)}</span>
        {row.editable ? (
          <button
            className="sfe-edit-btn"
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title="Edit"
          >
            <Pencil size={12} /> <span>Edit</span>
          </button>
        ) : (
          <span className="sft-row-chevron">
            {expandable ? <ChevronRight size={14} /> : <span style={{ width: 14, display: "inline-block" }} />}
          </span>
        )}
      </div>
      {expanded && row.details && (
        <div className="sft-row-body">
          <ul className="sft-detail-list">
            {row.details.map((d, i) => (
              <li key={i} className="sft-detail-row">
                <span className="sft-detail-key">{d.label}</span>
                <span className="sft-detail-value">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

// ── Mode picker drawer ──────────────────────────────────────────────

function ModeDrawer({
  courseId, currentMode, sessionCount, onClose, onSaved,
}: {
  courseId: string;
  currentMode: "continuous" | "structured";
  sessionCount: number | null;
  onClose: () => void;
  onSaved: (next: ApiResponse) => void;
}) {
  const [picked, setPicked] = useState<"continuous" | "structured">(currentMode);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = picked !== currentMode;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/session-flow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonPlanMode: picked }),
      });
      const json = await res.json() as ApiResponse;
      if (!json.ok) {
        setErr(json.error);
      } else {
        onSaved(json);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="Course mode" onClose={onClose}>
      <p className="sfe-drawer-desc">
        Pick how this course paces sessions. Changing this on a live course
        affects how learners progress.
      </p>

      <div className="sfe-radio-group">
        <ModeOption
          value="continuous"
          checked={picked === "continuous"}
          onSelect={() => setPicked("continuous")}
          title="Continuous"
          subtitle="Scheduler picks per-call content. No fixed session count."
          hint="Best for: ongoing skill practice, conversation, no exam date."
        />
        <ModeOption
          value="structured"
          checked={picked === "structured"}
          onSelect={() => setPicked("structured")}
          title="Structured"
          subtitle={`Pre-authored rail · ${sessionCount ?? "?"} session${sessionCount === 1 ? "" : "s"}.`}
          hint="Best for: exam-prep, syllabus coverage, fixed cohort cycles."
        />
      </div>

      {dirty && (
        <div className="sfe-warning">
          <AlertTriangle size={14} />
          <span>
            {picked === "structured"
              ? "Switching to Structured may need a generated lesson-plan rail. Without one, learners fall through to plain teaching with no auto-include stops."
              : "Switching to Continuous makes the existing lesson-plan rail irrelevant — the scheduler takes over per-call selection."}
          </span>
        </div>
      )}

      {err && <div className="sfe-error">Save failed: {err}</div>}

      <footer className="sfe-drawer-footer">
        <button type="button" className="sfe-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="sfe-btn-primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save mode"}
        </button>
      </footer>
    </Drawer>
  );
}

function ModeOption({
  value, checked, onSelect, title, subtitle, hint,
}: {
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  hint: string;
}) {
  return (
    <label className={`sfe-radio ${checked ? "sfe-radio--checked" : ""}`}>
      <input type="radio" name="mode" value={value} checked={checked} onChange={onSelect} />
      <span className="sfe-radio-body">
        <span className="sfe-radio-title">{title}</span>
        <span className="sfe-radio-subtitle">{subtitle}</span>
        <span className="sfe-radio-hint">{hint}</span>
      </span>
    </label>
  );
}

function Drawer({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="sfe-backdrop" onClick={onClose} />
      <aside className="sfe-drawer" role="dialog" aria-label={title}>
        <header className="sfe-drawer-header">
          <h2 className="sfe-drawer-title">{title}</h2>
          <button type="button" className="sfe-icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="sfe-drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────

function rowToggle(id: string, label: string, summary: string, enabled: boolean, icon: React.ReactNode): RowSpec {
  return {
    id,
    icon,
    label,
    summary,
    status: enabled ? "enabled" : "disabled",
    details: null,
    editable: false,
  };
}

function onboardingDetails(sf: SessionFlowResolved) {
  return [
    { label: "Source", value: sourceLabel(sf.source.onboarding) },
    { label: "Phase count", value: String(sf.onboarding.phases.length) },
    {
      label: "Phases",
      value: sf.onboarding.phases.length > 0 ? <PhaseChips phases={sf.onboarding.phases} /> : "(none)",
    },
  ];
}

function welcomeMessageDetails(sf: SessionFlowResolved) {
  if (!sf.welcomeMessage) {
    return [{ label: "Source", value: "generic fallback (no playbook or domain message set)" }];
  }
  return [
    { label: "Source", value: sf.source.welcomeMessage },
    { label: "Full text", value: sf.welcomeMessage },
  ];
}

function knowledgeCheckDetails(sf: SessionFlowResolved) {
  const kc = sf.intake.knowledgeCheck;
  if (!kc.enabled) return [{ label: "State", value: "Disabled — no in-call probe, no MCQ pre-test" }];
  const mode = kc.deliveryMode ?? "mcq";
  return [
    { label: "Delivery mode", value: mode === "mcq" ? "MCQ batch (post Call 1)" : "Socratic probe (in Call 1)" },
    {
      label: "Behaviour",
      value: mode === "mcq"
        ? "Learner sees a 5-question multiple-choice baseline after their first call ends."
        : "AI asks open prior-knowledge questions during the discovery phase of the first call.",
    },
  ];
}

function stopDetails(stop: JourneyStop) {
  const out: { label: string; value: React.ReactNode }[] = [
    { label: "Trigger", value: formatTrigger(stop.trigger) },
    { label: "Delivery", value: stop.delivery.mode },
    { label: "Status", value: stop.enabled ? "Enabled" : "Disabled" },
  ];
  if (stop.payload && "source" in stop.payload && stop.payload.source === "mcq-pool") {
    out.push({ label: "Question count", value: String(stop.payload.count) });
    out.push({ label: "Pool source", value: "Generated from extracted curriculum (Bloom or PIRLS)" });
  }
  return out;
}

function sessionsDetails(
  mode: "continuous" | "structured",
  teachingMode: string | null,
  sessionCount: number | null,
) {
  return [
    { label: "Mode", value: mode },
    { label: "Teaching mode", value: teachingMode ?? "(default)" },
    {
      label: "Pacing",
      value: mode === "continuous"
        ? "Scheduler picks per-call content and ordering. No fixed session count."
        : `${sessionCount ?? "?"} sessions, pre-authored rail. applyAutoIncludeStops handles position-anchored stops.`,
    },
  ];
}

function offboardingDetails(sf: SessionFlowResolved) {
  return [
    { label: "Trigger after", value: `${sf.offboarding.triggerAfterCalls} calls` },
    { label: "Phase count", value: String(sf.offboarding.phases.length) },
    {
      label: "Phases",
      value: sf.offboarding.phases.length > 0 ? <PhaseChips phases={sf.offboarding.phases} /> : "(none)",
    },
    ...(sf.offboarding.bannerMessage
      ? [{ label: "Banner", value: sf.offboarding.bannerMessage }]
      : []),
  ];
}

function PhaseChips({ phases }: { phases: OnboardingPhase[] }) {
  return (
    <span className="sft-phase-chips">
      {phases.map((p, i) => (
        <span key={i} className="sft-phase-chip">
          <span className="sft-phase-chip-num">{i + 1}</span>
          <span>{p.phase}</span>
          {p.duration && <span className="sft-phase-chip-num">· {p.duration}</span>}
        </span>
      ))}
    </span>
  );
}

function statusIcon(status: Status, fallback: React.ReactNode): React.ReactNode {
  if (status === "enabled") return <CheckCircle2 size={16} />;
  if (status === "disabled") return <XCircle size={16} />;
  return fallback;
}

function statusLabel(status: Status): string {
  if (status === "enabled") return "ON";
  if (status === "disabled") return "OFF";
  return "—";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Suppress unused-warnings for SessionFlowConfig (re-exported for future use).
export type { SessionFlowConfig };
