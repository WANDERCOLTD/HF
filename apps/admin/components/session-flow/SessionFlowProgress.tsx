"use client";

/**
 * Session Flow Progress — Caller-page variant of the Timeline component.
 *
 * Renders the same BEFORE / DURING / AFTER timeline a Course page shows,
 * but each row is annotated with the learner's actual state:
 *   ✓ completed (with captured value)
 *   🔄 in progress
 *   ⏱ not yet (with trigger condition)
 *   ⊘ skipped
 *   — not applicable
 *
 * Reads /api/callers/[callerId]/session-flow-progress which returns the
 * resolved Session Flow plus per-stop progress derived from
 * OnboardingSession + Call rows + CallerAttribute records.
 *
 * @see SessionFlowTimeline.tsx
 * @see app/api/callers/[callerId]/session-flow-progress/route.ts
 */

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  RefreshCcw,
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
  isPreTest,
  isMidTest,
  isPostTest,
  formatTrigger,
} from "./timeline-helpers";
import "./session-flow-timeline.css";
import "./session-flow-progress.css";

// ── Types ──────────────────────────────────────────────

interface CallerProgress {
  callCount: number;
  masteryPct: number;
  totalTps: number;
  mastered: number;
  onboardingComplete: boolean;
  stops: {
    preTestCompleted: boolean;
    welcomeCompleted: boolean;
    postSurveyCompleted: boolean;
  };
  capturedValues: {
    goalText?: string | null;
    confidence?: string | null;
    priorKnowledge?: string | null;
    npsScore?: number | null;
  };
}

type ProgressApiResponse = {
  ok: true;
  sessionFlow: SessionFlowResolved;
  mode: "continuous" | "structured";
  teachingMode: string | null;
  sessionCount: number | null;
  courseId: string;
  courseName: string;
  progress: CallerProgress;
} | { ok: false; error: string };

type LearnerStatus = "completed" | "in-progress" | "not-yet" | "skipped" | "n-a";

interface RowSpec {
  id: string;
  icon: React.ReactNode;
  label: string;
  primary: string;
  status: LearnerStatus;
  details: { label: string; value: React.ReactNode }[] | null;
}

export type SessionFlowProgressProps = {
  callerId: string;
};

// ── Component ──────────────────────────────────────────────

export function SessionFlowProgress({ callerId }: SessionFlowProgressProps) {
  const [data, setData] = useState<ProgressApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Standard fetch-on-mount pattern — see SessionFlowTimeline for matching note.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/callers/${callerId}/session-flow-progress`)
      .then(r => r.json() as Promise<ProgressApiResponse>)
      .then(json => {
        if (cancelled) return;
        if (!json.ok) setError(json.error);
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
  }, [callerId]);

  if (loading) return <div className="sft-loading">Loading Session Flow progress…</div>;
  if (error) return <div className="sft-error">Could not load progress: {error}</div>;
  if (!data || !data.ok) return null;

  const { sessionFlow, mode, teachingMode, sessionCount, courseName, progress } = data;

  const before: RowSpec[] = [
    rowOnboarding(sessionFlow, progress),
    rowWelcomeMessage(sessionFlow),
    rowGoals(sessionFlow, progress),
    rowAboutYou(sessionFlow, progress),
    rowKnowledgeCheck(sessionFlow, progress),
    rowAiIntroCall(sessionFlow),
    ...sessionFlow.stops.filter(isPreTest).map(s => rowPreTest(s, progress)),
  ];

  const during: RowSpec[] = [
    rowSessions(mode, teachingMode, sessionCount, progress),
    ...sessionFlow.stops.filter(isMidTest).map(s => rowAssessmentStop(s, "Mid-test", progress)),
  ];

  const after: RowSpec[] = [
    ...sessionFlow.stops.filter(isPostTest).map(s => rowAssessmentStop(s, "Post-test", progress)),
    ...sessionFlow.stops.filter(s => s.kind === "nps").map(s => rowNps(s, progress)),
    rowOffboarding(sessionFlow, progress),
  ];

  const toggle = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  return (
    <div className="sft">
      <header className="sft-header">
        <div className="sft-header-title">
          <Settings2 size={16} />
          <span>Session Flow — {courseName}</span>
        </div>
        <div className="sft-header-meta">
          <span className="sft-pill">Mode: {mode}</span>
          {teachingMode && <span className="sft-pill">Type: {teachingMode}</span>}
          <span className="sft-pill sfp-pill-progress">{progress.callCount} call{progress.callCount === 1 ? "" : "s"} · {progress.masteryPct}%</span>
        </div>
      </header>

      <Section title="BEFORE" rows={before} expandedId={expandedId} onToggle={toggle} />
      <Section title="DURING" rows={during} expandedId={expandedId} onToggle={toggle} />
      <Section title="AFTER" rows={after} expandedId={expandedId} onToggle={toggle} />
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
          <Row key={row.id} row={row} expanded={expandedId === row.id} onToggle={() => onToggle(row.id)} />
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
    `sfp-row--${row.status}`,
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
        <span className="sft-row-summary">{row.primary}</span>
        <span className={`sft-row-badge sfp-row-badge--${row.status}`}>{statusLabel(row.status)}</span>
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

// ── Row builders ──────────────────────────────────────────────

function rowOnboarding(sf: SessionFlowResolved, p: CallerProgress): RowSpec {
  const status: LearnerStatus = p.onboardingComplete ? "completed" : (p.callCount === 0 ? "in-progress" : "completed");
  return {
    id: "onboarding",
    icon: <Sparkles size={16} />,
    label: "Onboarding",
    primary: p.onboardingComplete ? "Completed" : "In progress",
    status,
    details: [
      { label: "Source", value: sourceLabel(sf.source.onboarding) },
      { label: "Phase count", value: String(sf.onboarding.phases.length) },
      ...(sf.onboarding.phases.length > 0
        ? [{ label: "Phases", value: <PhaseChips phases={sf.onboarding.phases} /> }]
        : []),
      { label: "Status", value: p.onboardingComplete ? "Complete" : "Not yet complete" },
    ],
  };
}

function rowWelcomeMessage(sf: SessionFlowResolved): RowSpec {
  return {
    id: "welcome-message",
    icon: <MessageSquare size={16} />,
    label: "Welcome message",
    primary: sf.welcomeMessage ?? "Generic fallback",
    status: sf.welcomeMessage ? "completed" : "n-a",
    details: sf.welcomeMessage ? [
      { label: "Source", value: sf.source.welcomeMessage },
      { label: "Full text", value: sf.welcomeMessage },
    ] : null,
  };
}

function rowGoals(sf: SessionFlowResolved, p: CallerProgress): RowSpec {
  const enabled = sf.intake.goals.enabled;
  const value = p.capturedValues.goalText;
  const status: LearnerStatus = !enabled ? "n-a" : value ? "completed" : "not-yet";
  return {
    id: "goals",
    icon: <Target size={16} />,
    label: "Goals question",
    primary: !enabled ? "Disabled by educator" : (value ? `"${truncate(value, 80)}"` : "Not yet captured"),
    status,
    details: value ? [
      { label: "Captured", value: `"${value}"` },
    ] : null,
  };
}

function rowAboutYou(sf: SessionFlowResolved, p: CallerProgress): RowSpec {
  const enabled = sf.intake.aboutYou.enabled;
  const conf = p.capturedValues.confidence;
  const status: LearnerStatus = !enabled ? "n-a" : (conf ? "completed" : "not-yet");
  return {
    id: "about-you",
    icon: <HelpCircle size={16} />,
    label: "About You",
    primary: !enabled ? "Disabled by educator" : (conf ? `Confidence: ${conf}` : "Not yet captured"),
    status,
    details: conf ? [
      { label: "Confidence", value: conf },
      ...(p.capturedValues.priorKnowledge ? [{ label: "Prior knowledge", value: p.capturedValues.priorKnowledge }] : []),
    ] : null,
  };
}

function rowKnowledgeCheck(sf: SessionFlowResolved, p: CallerProgress): RowSpec {
  const kc = sf.intake.knowledgeCheck;
  if (!kc.enabled) {
    return {
      id: "knowledge-check",
      icon: <ClipboardCheck size={16} />,
      label: "Knowledge Check",
      primary: "Disabled by educator",
      status: "n-a",
      details: null,
    };
  }
  const mode = kc.deliveryMode ?? "mcq";
  const status: LearnerStatus = p.stops.preTestCompleted ? "completed" : "not-yet";
  return {
    id: "knowledge-check",
    icon: <ClipboardCheck size={16} />,
    label: "Knowledge Check",
    primary: status === "completed" ? `Submitted (${mode})` : `Not yet · ${mode}`,
    status,
    details: [
      { label: "Delivery mode", value: mode === "mcq" ? "MCQ batch" : "Socratic probe" },
      { label: "State", value: status === "completed" ? "Submitted" : "Awaiting learner" },
    ],
  };
}

function rowAiIntroCall(sf: SessionFlowResolved): RowSpec {
  return {
    id: "ai-intro-call",
    icon: <Sparkles size={16} />,
    label: "AI Intro Call",
    primary: sf.intake.aiIntroCall.enabled ? "Configured" : "Disabled by educator",
    status: sf.intake.aiIntroCall.enabled ? "in-progress" : "n-a",
    details: null,
  };
}

function rowPreTest(stop: JourneyStop, p: CallerProgress): RowSpec {
  const completed = p.stops.preTestCompleted;
  return {
    id: stop.id,
    icon: <ClipboardCheck size={16} />,
    label: "Pre-test",
    primary: completed ? "Submitted" : `Fires ${formatTrigger(stop.trigger)}`,
    status: completed ? "completed" : "not-yet",
    details: stopDetails(stop, completed ? "Submitted" : "Awaiting"),
  };
}

function rowSessions(
  mode: "continuous" | "structured",
  teachingMode: string | null,
  sessionCount: number | null,
  p: CallerProgress,
): RowSpec {
  const primary = mode === "continuous"
    ? `${p.callCount} calls · ${p.masteryPct}% mastered (${p.mastered}/${p.totalTps})`
    : `Call ${p.callCount} of ${sessionCount ?? "?"} · ${p.masteryPct}% mastered`;
  return {
    id: "sessions",
    icon: <GraduationCap size={16} />,
    label: "Sessions",
    primary,
    status: "in-progress",
    details: [
      { label: "Mode", value: mode },
      { label: "Teaching mode", value: teachingMode ?? "(default)" },
      { label: "Calls completed", value: String(p.callCount) },
      { label: "Mastery", value: `${p.masteryPct}% (${p.mastered}/${p.totalTps} TPs)` },
    ],
  };
}

function rowAssessmentStop(stop: JourneyStop, label: string, p: CallerProgress): RowSpec {
  // Both mid- and post-tests share the post survey scope marker today; if
  // post-survey submitted we treat the post-test as completed.
  const completed = p.stops.postSurveyCompleted;
  return {
    id: stop.id,
    icon: <ClipboardCheck size={16} />,
    label,
    primary: completed ? "Submitted" : `Fires ${formatTrigger(stop.trigger)}`,
    status: completed ? "completed" : "not-yet",
    details: stopDetails(stop, completed ? "Submitted" : "Awaiting"),
  };
}

function rowNps(stop: JourneyStop, p: CallerProgress): RowSpec {
  const completed = p.stops.postSurveyCompleted;
  const score = p.capturedValues.npsScore;
  return {
    id: stop.id,
    icon: <ThumbsUp size={16} />,
    label: "NPS",
    primary: completed
      ? (score !== null && score !== undefined ? `Submitted · score ${score}/10` : "Submitted")
      : `Fires ${formatTrigger(stop.trigger)}`,
    status: completed ? "completed" : "not-yet",
    details: [
      { label: "Trigger", value: formatTrigger(stop.trigger) },
      ...(score !== null && score !== undefined ? [{ label: "Score", value: `${score}/10` }] : []),
      { label: "State", value: completed ? "Submitted" : "Awaiting trigger" },
    ],
  };
}

function rowOffboarding(sf: SessionFlowResolved, p: CallerProgress): RowSpec {
  const triggered = p.callCount >= sf.offboarding.triggerAfterCalls;
  return {
    id: "offboarding",
    icon: <Minus size={16} />,
    label: "Offboarding",
    primary: triggered
      ? "Triggered (post-course)"
      : `Fires after ${sf.offboarding.triggerAfterCalls} calls (${p.callCount} so far)`,
    status: triggered ? "in-progress" : "not-yet",
    details: [
      { label: "Trigger after", value: `${sf.offboarding.triggerAfterCalls} calls` },
      { label: "Calls so far", value: String(p.callCount) },
      { label: "Phases", value: sf.offboarding.phases.length > 0 ? <PhaseChips phases={sf.offboarding.phases} /> : "(none)" },
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────

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

function stopDetails(stop: JourneyStop, stateLabel: string): { label: string; value: React.ReactNode }[] {
  const out: { label: string; value: React.ReactNode }[] = [
    { label: "Trigger", value: formatTrigger(stop.trigger) },
    { label: "Delivery", value: stop.delivery.mode },
    { label: "State", value: stateLabel },
  ];
  if (stop.payload && "source" in stop.payload && stop.payload.source === "mcq-pool") {
    out.push({ label: "Question count", value: String(stop.payload.count) });
  }
  return out;
}

function statusIcon(status: LearnerStatus, fallback: React.ReactNode): React.ReactNode {
  switch (status) {
    case "completed": return <CheckCircle2 size={16} />;
    case "in-progress": return <RefreshCcw size={16} />;
    case "not-yet": return <Clock size={16} />;
    case "skipped": return <XCircle size={16} />;
    case "n-a": return fallback;
  }
}

function statusLabel(status: LearnerStatus): string {
  switch (status) {
    case "completed": return "DONE";
    case "in-progress": return "NOW";
    case "not-yet": return "WAIT";
    case "skipped": return "SKIP";
    case "n-a": return "—";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
