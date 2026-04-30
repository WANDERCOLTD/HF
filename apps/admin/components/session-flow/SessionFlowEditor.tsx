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
  NpsConfig,
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
import { OnboardingEditor } from "@/components/shared/OnboardingEditor";
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
  domainId: string | null;
  domainName: string | null;
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
  /** When set, the badge becomes an interactive Apple-style toggle. */
  toggle?: {
    on: boolean;
    onChange: (next: boolean) => void;
  };
}

type DrawerKind = null | "mode" | "kc-delivery" | "nps" | "welcome-msg" | "onboarding-phases" | "offboarding-phases";

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
  const [savingToggle, setSavingToggle] = useState<string | null>(null);

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

  /**
   * Toggle one intake flag. Sends the FULL intake object so the resolver
   * doesn't drop sibling toggles during merge.
   */
  /**
   * Toggle NPS enabled flag. Lives at top-level pbConfig.nps, not inside
   * sessionFlow — the runtime delivery path reads it directly.
   */
  const toggleNps = useCallback(
    async (next: boolean, rowId: string) => {
      if (!data || !data.ok) return;
      // Find the existing NPS shape from the synthesised stop. The resolver
      // exposes nps via stops[id="nps"]; reconstruct trigger + threshold.
      const npsStop = data.sessionFlow.stops.find(s => s.id === "nps");
      const currentTrigger = npsStop && npsStop.trigger.type === "session_count"
        ? "session_count" as const
        : "mastery" as const;
      const currentThreshold = (npsStop && (npsStop.trigger.type === "session_count"
        ? npsStop.trigger.count
        : npsStop.trigger.type === "mastery_reached"
          ? npsStop.trigger.threshold
          : 80)) ?? 80;
      const nextNps: NpsConfig = {
        enabled: next,
        trigger: currentTrigger,
        threshold: currentThreshold,
      };
      setSavingToggle(rowId);
      try {
        const res = await fetch(`/api/courses/${courseId}/session-flow`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nps: nextNps }),
        });
        const json = (await res.json()) as ApiResponse;
        if (!json.ok) setError(json.error);
        else setData(json);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSavingToggle(null);
      }
    },
    [data, courseId],
  );

  const toggleIntake = useCallback(
    async (key: "goals" | "aboutYou" | "knowledgeCheck" | "aiIntroCall", next: boolean, rowId: string) => {
      if (!data || !data.ok) return;
      const currentIntake = data.sessionFlow.intake;
      const updatedIntake = {
        goals: { enabled: currentIntake.goals.enabled },
        aboutYou: { enabled: currentIntake.aboutYou.enabled },
        knowledgeCheck: {
          enabled: currentIntake.knowledgeCheck.enabled,
          deliveryMode: currentIntake.knowledgeCheck.deliveryMode ?? "mcq" as const,
        },
        aiIntroCall: { enabled: currentIntake.aiIntroCall.enabled },
      };
      if (key === "knowledgeCheck") {
        updatedIntake.knowledgeCheck.enabled = next;
      } else {
        updatedIntake[key].enabled = next;
      }

      // Optimistic update — flip immediately so the UI feels instant.
      const optimistic: ApiResponse = {
        ...data,
        sessionFlow: {
          ...data.sessionFlow,
          intake: { ...data.sessionFlow.intake, [key]: { ...data.sessionFlow.intake[key], enabled: next } },
        },
      };
      setData(optimistic);
      setSavingToggle(rowId);

      try {
        const res = await fetch(`/api/courses/${courseId}/session-flow`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionFlow: { intake: updatedIntake } }),
        });
        const json = (await res.json()) as ApiResponse;
        if (!json.ok) {
          setError(json.error);
          // Roll back on failure.
          setData(data);
        } else {
          setData(json);
        }
      } catch (e) {
        setError((e as Error).message);
        setData(data);
      } finally {
        setSavingToggle(null);
      }
    },
    [data, courseId],
  );

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
      editable: true,
    },
    {
      id: "welcome-message",
      icon: <MessageSquare size={16} />,
      label: "Welcome message",
      summary: sessionFlow.welcomeMessage ? truncate(sessionFlow.welcomeMessage, 60) : "Generic fallback",
      status: sessionFlow.welcomeMessage ? "enabled" : "default",
      details: welcomeMessageDetails(sessionFlow),
      editable: true,
    },
    {
      id: "goals",
      icon: <Target size={16} />,
      label: "Goals question",
      summary: "First call asks learner about their goals",
      status: sessionFlow.intake.goals.enabled ? "enabled" : "disabled",
      details: [
        { label: "Captures", value: "Open answer about what the learner wants to get out of the course." },
        { label: "Stored as", value: "CallerAttribute scope=PRE key=goal_text" },
        { label: "Used by", value: "AI prompt context — referenced in greeting + adaptive guidance." },
      ],
      editable: false,
      toggle: {
        on: sessionFlow.intake.goals.enabled,
        onChange: (next) => toggleIntake("goals", next, "goals"),
      },
    },
    {
      id: "about-you",
      icon: <HelpCircle size={16} />,
      label: "About You",
      summary: "Motivation + confidence check",
      status: sessionFlow.intake.aboutYou.enabled ? "enabled" : "disabled",
      details: [
        { label: "Captures", value: "Confidence (1–5), prior knowledge level, optional motivation text." },
        { label: "Stored as", value: "CallerAttribute scope=PRE key=confidence / prior_knowledge / concern_text" },
        { label: "Used by", value: "Personalisation — adjusts pace, scaffolding, and tone." },
      ],
      editable: false,
      toggle: {
        on: sessionFlow.intake.aboutYou.enabled,
        onChange: (next) => toggleIntake("aboutYou", next, "about-you"),
      },
    },
    {
      id: "knowledge-check",
      icon: <ClipboardCheck size={16} />,
      label: "Knowledge Check",
      summary: kcSummary(sessionFlow.intake.knowledgeCheck),
      status: sessionFlow.intake.knowledgeCheck.enabled ? "enabled" : "disabled",
      details: knowledgeCheckDetails(sessionFlow),
      editable: sessionFlow.intake.knowledgeCheck.enabled,
      toggle: {
        on: sessionFlow.intake.knowledgeCheck.enabled,
        onChange: (next) => toggleIntake("knowledgeCheck", next, "knowledge-check"),
      },
    },
    {
      id: "ai-intro-call",
      icon: <Sparkles size={16} />,
      label: "AI Intro Call",
      summary: "Separate intro session before teaching",
      status: sessionFlow.intake.aiIntroCall.enabled ? "enabled" : "disabled",
      details: [
        { label: "Behaviour", value: "Runs a short warm-up call before any curriculum content. The learner meets the AI tutor first, no quizzing or teaching." },
        { label: "When to use", value: "Anxious or first-time learners; courses where rapport matters more than pacing." },
        { label: "Status", value: "Configurable; runtime delivery in development." },
      ],
      editable: false,
      toggle: {
        on: sessionFlow.intake.aiIntroCall.enabled,
        onChange: (next) => toggleIntake("aiIntroCall", next, "ai-intro-call"),
      },
    },
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
    npsRow(sessionFlow, toggleNps),
    {
      id: "offboarding",
      icon: <Minus size={16} />,
      label: "Offboarding",
      summary: `${sessionFlow.offboarding.phases.length} phases · trigger after ${sessionFlow.offboarding.triggerAfterCalls} calls`,
      status: sessionFlow.offboarding.phases.length > 0 ? "enabled" : "default",
      details: offboardingDetails(sessionFlow),
      editable: true,
    },
  ];

  const handleEdit = (rowId: string) => {
    if (rowId === "sessions") setDrawer("mode");
    else if (rowId === "knowledge-check") setDrawer("kc-delivery");
    else if (rowId === "nps") setDrawer("nps");
    else if (rowId === "welcome-message") setDrawer("welcome-msg");
    else if (rowId === "onboarding") setDrawer("onboarding-phases");
    else if (rowId === "offboarding") setDrawer("offboarding-phases");
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

        <Section title="BEFORE" rows={before} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} savingToggle={savingToggle} />
        <Section title="DURING" rows={during} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} savingToggle={savingToggle} />
        <Section title="AFTER" rows={after} expandedId={expandedId} onToggle={toggleRow} onEdit={handleEdit} savingToggle={savingToggle} />
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
      {drawer === "kc-delivery" && (
        <KcDeliveryDrawer
          courseId={courseId}
          sessionFlow={sessionFlow}
          onClose={() => setDrawer(null)}
          onSaved={onUpdated}
        />
      )}
      {drawer === "nps" && (
        <NpsDrawer
          courseId={courseId}
          sessionFlow={sessionFlow}
          onClose={() => setDrawer(null)}
          onSaved={onUpdated}
        />
      )}
      {drawer === "welcome-msg" && (
        <WelcomeMessageDrawer
          courseId={courseId}
          current={sessionFlow.welcomeMessage ?? ""}
          onClose={() => setDrawer(null)}
          onSaved={onUpdated}
        />
      )}
      {drawer === "onboarding-phases" && data.domainId && (
        <PhaseListDrawer
          title="Onboarding flow phases"
          courseId={courseId}
          domainId={data.domainId}
          domainName={data.domainName}
          mode="onboarding"
          onClose={() => { setDrawer(null); refetch(); }}
        />
      )}
      {drawer === "offboarding-phases" && data.domainId && (
        <PhaseListDrawer
          title="Offboarding flow phases"
          courseId={courseId}
          domainId={data.domainId}
          domainName={data.domainName}
          mode="offboarding"
          onClose={() => { setDrawer(null); refetch(); }}
        />
      )}
    </>
  );
}

// ── Phase list drawer (#225 part 4) ──────────────────────────────────────────

function PhaseListDrawer({
  title, courseId, domainId, domainName, mode, onClose,
}: {
  title: string;
  courseId: string;
  domainId: string;
  domainName: string | null;
  mode: "onboarding" | "offboarding";
  onClose: () => void;
}) {
  return (
    <Drawer title={title} onClose={onClose}>
      <p className="sfe-drawer-desc">
        Drag phases to reorder. Click a phase to edit its goals, duration, content, and survey steps.
        Changes save automatically — close when done.
      </p>
      <div className="sfe-phase-host">
        <OnboardingEditor
          courseId={courseId}
          domainId={domainId}
          domainName={domainName}
          isOperator
          compact
          mode={mode}
        />
      </div>
      <footer className="sfe-drawer-footer">
        <button type="button" className="sfe-btn-primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Drawer>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Section({
  title, rows, expandedId, onToggle, onEdit, savingToggle,
}: {
  title: string;
  rows: RowSpec[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  savingToggle: string | null;
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
            saving={savingToggle === row.id}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  row, expanded, onToggle, onEdit, saving,
}: {
  row: RowSpec;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  saving: boolean;
}) {
  const expandable = !!row.details && row.details.length > 0;
  const classes = [
    "sft-row",
    `sft-row--${row.status}`,
    expandable ? "sft-row--expandable" : "",
    expanded ? "sft-row--expanded" : "",
  ].filter(Boolean).join(" ");

  // The status column shows either the Apple toggle or the static badge.
  // The action column shows the Edit button, an expand chevron, or empty.
  const statusControl = row.toggle ? (
    <Toggle on={row.toggle.on} onChange={row.toggle.onChange} saving={saving} ariaLabel={row.label} />
  ) : (
    <span className={`sft-row-badge sft-row-badge--${row.status}`}>{statusLabel(row.status)}</span>
  );
  const actionControl = row.editable ? (
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
  );

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
        {statusControl}
        {actionControl}
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

// ── Apple-style toggle ──────────────────────────────────────────────

function Toggle({
  on, onChange, saving, ariaLabel,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  saving: boolean;
  ariaLabel: string;
}) {
  const classes = [
    "sfe-toggle",
    on ? "sfe-toggle--on" : "",
    saving ? "sfe-toggle--saving" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={classes}
      onClick={(e) => {
        e.stopPropagation();
        if (saving) return;
        onChange(!on);
      }}
      disabled={saving}
    >
      <span className="sfe-toggle-knob" />
    </button>
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

// ── KC delivery mode drawer ──────────────────────────────────────────────

function KcDeliveryDrawer({
  courseId, sessionFlow, onClose, onSaved,
}: {
  courseId: string;
  sessionFlow: SessionFlowResolved;
  onClose: () => void;
  onSaved: (next: ApiResponse) => void;
}) {
  const current = sessionFlow.intake.knowledgeCheck.deliveryMode ?? "mcq";
  const [picked, setPicked] = useState<"mcq" | "socratic">(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = picked !== current;

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const updatedIntake = {
        goals: { enabled: sessionFlow.intake.goals.enabled },
        aboutYou: { enabled: sessionFlow.intake.aboutYou.enabled },
        knowledgeCheck: {
          enabled: sessionFlow.intake.knowledgeCheck.enabled,
          deliveryMode: picked,
        },
        aiIntroCall: { enabled: sessionFlow.intake.aiIntroCall.enabled },
      };
      const res = await fetch(`/api/courses/${courseId}/session-flow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionFlow: { intake: updatedIntake } }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) setErr(json.error);
      else onSaved(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="Knowledge Check delivery" onClose={onClose}>
      <p className="sfe-drawer-desc">
        Choose how the educator probes prior knowledge in the first call. One mode only — no double-quizzing.
      </p>
      <div className="sfe-radio-group">
        <ModeOption
          value="mcq"
          checked={picked === "mcq"}
          onSelect={() => setPicked("mcq")}
          title="MCQ batch"
          subtitle="5 multiple-choice questions delivered after the first call ends."
          hint="Best for: knowledge subjects with measurable answers (history, science, languages with vocab)."
        />
        <ModeOption
          value="socratic"
          checked={picked === "socratic"}
          onSelect={() => setPicked("socratic")}
          title="Socratic probe"
          subtitle="AI asks open prior-knowledge questions during the discovery phase of the first call."
          hint="Best for: comprehension, reflection, courses where conversational depth matters more than score."
        />
      </div>
      {err && <div className="sfe-error">Save failed: {err}</div>}
      <footer className="sfe-drawer-footer">
        <button type="button" className="sfe-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sfe-btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save delivery mode"}
        </button>
      </footer>
    </Drawer>
  );
}

// ── NPS drawer ──────────────────────────────────────────────

function NpsDrawer({
  courseId, sessionFlow, onClose, onSaved,
}: {
  courseId: string;
  sessionFlow: SessionFlowResolved;
  onClose: () => void;
  onSaved: (next: ApiResponse) => void;
}) {
  const stop = sessionFlow.stops.find(s => s.kind === "nps");
  const initialEnabled = !!stop;
  const initialTrigger: "mastery" | "session_count" =
    stop?.trigger.type === "session_count" ? "session_count" : "mastery";
  const initialThreshold =
    stop?.trigger.type === "session_count"
      ? stop.trigger.count
      : stop?.trigger.type === "mastery_reached"
        ? stop.trigger.threshold
        : 80;

  const [enabled, setEnabled] = useState(initialEnabled);
  const [trigger, setTrigger] = useState<"mastery" | "session_count">(initialTrigger);
  const [threshold, setThreshold] = useState<number>(initialThreshold);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    enabled !== initialEnabled
    || trigger !== initialTrigger
    || threshold !== initialThreshold;

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const nextNps: NpsConfig = { enabled, trigger, threshold };
      const res = await fetch(`/api/courses/${courseId}/session-flow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nps: nextNps }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) setErr(json.error);
      else onSaved(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="NPS satisfaction survey" onClose={onClose}>
      <p className="sfe-drawer-desc">
        Pick when the post-course NPS survey fires. Mastery triggers respect the learner&rsquo;s actual progress; session count triggers fire on a fixed call number.
      </p>

      <label className="sfe-field">
        <span className="sfe-field-label">Enabled</span>
        <Toggle on={enabled} onChange={setEnabled} saving={false} ariaLabel="NPS enabled" />
      </label>

      <fieldset className="sfe-fieldset" disabled={!enabled}>
        <legend className="sfe-field-label">Trigger</legend>
        <div className="sfe-radio-group">
          <ModeOption
            value="mastery"
            checked={trigger === "mastery"}
            onSelect={() => setTrigger("mastery")}
            title="Mastery threshold"
            subtitle="Fire when the learner reaches this mastery percentage."
            hint="Default 80%. Higher = wait longer; lower = ask earlier."
          />
          <ModeOption
            value="session_count"
            checked={trigger === "session_count"}
            onSelect={() => setTrigger("session_count")}
            title="Session count"
            subtitle="Fire after the learner completes this many calls."
            hint="Use when course length matters more than mastery (e.g. trial cohorts)."
          />
        </div>

        <label className="sfe-field">
          <span className="sfe-field-label">
            {trigger === "mastery" ? "Mastery threshold (%)" : "Session count"}
          </span>
          <input
            className="sfe-input-num"
            type="number"
            min={1}
            max={trigger === "mastery" ? 100 : 100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
          />
        </label>
      </fieldset>

      {err && <div className="sfe-error">Save failed: {err}</div>}
      <footer className="sfe-drawer-footer">
        <button type="button" className="sfe-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sfe-btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save NPS"}
        </button>
      </footer>
    </Drawer>
  );
}

// ── Welcome message drawer ──────────────────────────────────────────────

function WelcomeMessageDrawer({
  courseId, current, onClose, onSaved,
}: {
  courseId: string;
  current: string;
  onClose: () => void;
  onSaved: (next: ApiResponse) => void;
}) {
  const [text, setText] = useState(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = text !== current;
  const trimmed = text.trim();

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/session-flow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage: trimmed.length > 0 ? trimmed : null }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) setErr(json.error);
      else onSaved(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="Welcome message" onClose={onClose}>
      <p className="sfe-drawer-desc">
        First-line greeting the AI uses on the learner&rsquo;s first call. Leave blank to fall back to the domain default or a generic greeting.
      </p>
      <label className="sfe-field">
        <span className="sfe-field-label">Message</span>
        <textarea
          className="sfe-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Welcome to the course! Let's get started…"
        />
        <span className="sfe-field-hint">{text.length} / 500 characters</span>
      </label>
      {err && <div className="sfe-error">Save failed: {err}</div>}
      <footer className="sfe-drawer-footer">
        <button type="button" className="sfe-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sfe-btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : (trimmed.length === 0 && current.length > 0 ? "Clear message" : "Save message")}
        </button>
      </footer>
    </Drawer>
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

function npsRow(
  sf: SessionFlowResolved,
  toggle: (next: boolean, rowId: string) => void,
): RowSpec {
  const stop = sf.stops.find(s => s.kind === "nps");
  const enabled = !!stop;
  return {
    id: "nps",
    icon: <ThumbsUp size={16} />,
    label: "NPS",
    summary: enabled && stop ? stopSummary(stop) : "Disabled — no end-of-course satisfaction survey",
    status: enabled ? "enabled" : "disabled",
    details: enabled && stop ? stopDetails(stop) : [
      { label: "State", value: "Disabled — toggle ON to configure trigger and threshold." },
    ],
    editable: enabled,
    toggle: {
      on: enabled,
      onChange: (next) => toggle(next, "nps"),
    },
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
