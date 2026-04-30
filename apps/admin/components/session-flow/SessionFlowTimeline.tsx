"use client";

/**
 * Session Flow Timeline — read-only view of a course's resolved Session Flow.
 *
 * Renders BEFORE / DURING / AFTER sections from /api/courses/[courseId]/session-flow.
 * Rows are click-expandable to surface full details (phase lists, MCQ pool size,
 * trigger conditions, etc.). No edit affordances in this story (#223). The
 * editor variant lives in #225.
 *
 * @see docs/decisions/2026-04-29-session-flow-canonical-model.md
 */

import { useEffect, useState } from "react";
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
} from "lucide-react";
import type {
  SessionFlowResolved,
  JourneyStop,
  OnboardingPhase,
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

// ── Types ──────────────────────────────────────────────

type SessionFlowApiResponse = {
  ok: true;
  sessionFlow: SessionFlowResolved;
  mode: "continuous" | "structured";
  teachingMode: string | null;
  sessionCount: number | null;
  courseName: string;
} | { ok: false; error: string };

export type SessionFlowTimelineProps = {
  courseId: string;
};

type Status = "enabled" | "disabled" | "default";

interface DetailEntry {
  label: string;
  value: React.ReactNode;
}

interface RowSpec {
  id: string;
  icon: React.ReactNode;
  label: string;
  summary: string;
  status: Status;
  details: DetailEntry[] | null;
}

// ── Component ──────────────────────────────────────────────

export function SessionFlowTimeline({ courseId }: SessionFlowTimelineProps) {
  const [data, setData] = useState<SessionFlowApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Synchronous setState in effect is the standard fetch-on-mount pattern
    // used elsewhere in the admin (CourseDetail, etc.) — disable for parity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/session-flow`)
      .then(r => r.json() as Promise<SessionFlowApiResponse>)
      .then(json => {
        if (cancelled) return;
        if (!json.ok) setError(json.error || "Failed to load Session Flow");
        else setData(json);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

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
    },
    {
      id: "welcome-message",
      icon: <MessageSquare size={16} />,
      label: "Welcome message",
      summary: sessionFlow.welcomeMessage ? truncate(sessionFlow.welcomeMessage, 60) : "Generic fallback",
      status: sessionFlow.welcomeMessage ? "enabled" : "default",
      details: welcomeMessageDetails(sessionFlow),
    },
    {
      id: "goals",
      icon: <Target size={16} />,
      label: "Goals question",
      summary: "First call asks learner about their goals",
      status: sessionFlow.intake.goals.enabled ? "enabled" : "disabled",
      details: null,
    },
    {
      id: "about-you",
      icon: <HelpCircle size={16} />,
      label: "About You",
      summary: "Motivation + confidence check",
      status: sessionFlow.intake.aboutYou.enabled ? "enabled" : "disabled",
      details: null,
    },
    {
      id: "knowledge-check",
      icon: <ClipboardCheck size={16} />,
      label: "Knowledge Check",
      summary: kcSummary(sessionFlow.intake.knowledgeCheck),
      status: sessionFlow.intake.knowledgeCheck.enabled ? "enabled" : "disabled",
      details: knowledgeCheckDetails(sessionFlow),
    },
    {
      id: "ai-intro-call",
      icon: <Sparkles size={16} />,
      label: "AI Intro Call",
      summary: "Separate intro session before teaching starts",
      status: sessionFlow.intake.aiIntroCall.enabled ? "enabled" : "disabled",
      details: null,
    },
    ...sessionFlow.stops.filter(isPreTest).map((s): RowSpec => ({
      id: s.id,
      icon: <ClipboardCheck size={16} />,
      label: "Pre-test",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
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
    },
    ...sessionFlow.stops.filter(isMidTest).map((s): RowSpec => ({
      id: s.id,
      icon: <ClipboardCheck size={16} />,
      label: "Mid-test",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
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
    })),
    ...sessionFlow.stops.filter(s => s.kind === "nps").map((s): RowSpec => ({
      id: s.id,
      icon: <ThumbsUp size={16} />,
      label: "NPS",
      summary: stopSummary(s),
      status: "enabled",
      details: stopDetails(s),
    })),
    {
      id: "offboarding",
      icon: <Minus size={16} />,
      label: "Offboarding",
      summary: `${sessionFlow.offboarding.phases.length} phases · trigger after ${sessionFlow.offboarding.triggerAfterCalls} calls`,
      status: sessionFlow.offboarding.phases.length > 0 ? "enabled" : "default",
      details: offboardingDetails(sessionFlow),
    },
  ];

  const toggleRow = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  return (
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

      <Section title="BEFORE" rows={before} expandedId={expandedId} onToggle={toggleRow} />
      <Section title="DURING" rows={during} expandedId={expandedId} onToggle={toggleRow} />
      <Section title="AFTER" rows={after} expandedId={expandedId} onToggle={toggleRow} />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Section({
  title,
  rows,
  expandedId,
  onToggle,
}: {
  title: string;
  rows: RowSpec[];
  expandedId: string | null;
  onToggle: (id: string) => void;
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
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  expanded,
  onToggle,
}: {
  row: RowSpec;
  expanded: boolean;
  onToggle: () => void;
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
        className="sft-row-head"
        onClick={expandable ? onToggle : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={expandable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      >
        <span className="sft-row-icon">{statusIcon(row.status, row.icon)}</span>
        <span className="sft-row-label">{row.label}</span>
        <span className="sft-row-summary">{row.summary}</span>
        <span className={`sft-row-badge sft-row-badge--${row.status}`}>{statusLabel(row.status)}</span>
        <span className="sft-row-chevron">
          {expandable ? <ChevronRight size={14} /> : <span style={{ width: 14, display: "inline-block" }} />}
        </span>
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

// ── Detail builders ──────────────────────────────────────────────

function onboardingDetails(sf: SessionFlowResolved): DetailEntry[] {
  const phases = sf.onboarding.phases;
  return [
    { label: "Source", value: sourceLabel(sf.source.onboarding) },
    { label: "Phase count", value: String(phases.length) },
    {
      label: "Phases",
      value: phases.length > 0 ? <PhaseChips phases={phases} /> : "(none)",
    },
  ];
}

function welcomeMessageDetails(sf: SessionFlowResolved): DetailEntry[] | null {
  if (!sf.welcomeMessage) {
    return [{ label: "Source", value: "generic fallback (no playbook or domain message set)" }];
  }
  return [
    { label: "Source", value: sf.source.welcomeMessage },
    { label: "Full text", value: sf.welcomeMessage },
  ];
}

function knowledgeCheckDetails(sf: SessionFlowResolved): DetailEntry[] | null {
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

function stopDetails(stop: JourneyStop): DetailEntry[] {
  const out: DetailEntry[] = [
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
): DetailEntry[] {
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

function offboardingDetails(sf: SessionFlowResolved): DetailEntry[] {
  return [
    { label: "Trigger after", value: `${sf.offboarding.triggerAfterCalls} calls` },
    { label: "Phase count", value: String(sf.offboarding.phases.length) },
    {
      label: "Phases",
      value: sf.offboarding.phases.length > 0 ? <PhaseChips phases={sf.offboarding.phases} /> : "(none)",
    },
    ...(sf.offboarding.bannerMessage
      ? [{ label: "Banner", value: sf.offboarding.bannerMessage } as DetailEntry]
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

// ── Helpers ──────────────────────────────────────────────

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
