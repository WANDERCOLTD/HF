"use client";

/**
 * Preview lens — Slice 3 of epic #1263 (chat-bubble revision).
 *
 * Renders an Educator view + Engineer view of what the learner will
 * experience on Call 1. The Educator view now uses WhatsApp-style chat
 * bubbles (matching the SimChat + ChatSurvey UI the learner actually
 * sees) — one transcript that walks pre-call survey questions first,
 * then a "Call 1 begins" divider, then the AI's opening + first
 * teaching turn. Each bubble is a clickable deep-link to the lens that
 * controls it.
 *
 * Lazy compose — the `<ConsoleShell>` only mounts this component when
 * the Preview lens is active, so `useEffect` on mount fires the
 * dry-run-prompt POST exactly once on first visit. StrictMode guard
 * via `useRef` prevents double-fire.
 *
 * Closes #1268. Refs epic #1263.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, RefreshCw, FileSearch, AlertCircle, Edit3 } from "lucide-react";
import "./preview-lens.css";

interface PreviewLensProps {
  courseId: string;
}

interface SessionFlowResp {
  ok: boolean;
  sessionFlow?: {
    intake: {
      goals: { enabled: boolean };
      aboutYou: { enabled: boolean };
      knowledgeCheck: { enabled: boolean; deliveryMode?: "mcq" | "socratic" };
      aiIntroCall: { enabled: boolean };
    };
    onboarding: { phases: Array<{ phase: string; duration?: string; goals?: string[] }> };
    welcomeMessage: string | null;
    offboarding: { phases: Array<{ phase: string }>; triggerAfterCalls?: number };
    stops: Array<{ id: string; kind: string; trigger?: { type: string; threshold?: number; count?: number } }>;
  };
  courseName?: string;
  error?: string;
}

interface DryRunResp {
  ok: boolean;
  promptSummary?: string;
  metadata?: {
    sectionsActivated: string[];
    sectionsSkipped: string[];
    activationReasons: Record<string, string>;
    loadTimeMs: number;
    transformTimeMs: number;
    identitySpec: string | null;
    playbooksUsed: string[];
    memoriesCount: number;
    behaviorTargetsCount: number;
  };
  error?: string;
}

type ViewMode = "educator" | "engineer";

export function PreviewLens({ courseId }: PreviewLensProps): React.ReactElement {
  const [mode, setMode] = useState<ViewMode>("educator");
  const [flow, setFlow] = useState<SessionFlowResp | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastComposedAt, setLastComposedAt] = useState<number | null>(null);
  const composedOnceRef = useRef(false);

  const compose = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flowRes, dryRes] = await Promise.all([
        fetch(`/api/courses/${courseId}/session-flow`),
        fetch(`/api/courses/${courseId}/dry-run-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSequence: 1 }),
        }),
      ]);
      const flowJson = (await flowRes.json()) as SessionFlowResp;
      const dryJson = (await dryRes.json()) as DryRunResp;
      if (!flowJson.ok) throw new Error(flowJson.error || "session-flow fetch failed");
      if (!dryJson.ok) throw new Error(dryJson.error || "dry-run-prompt failed");
      setFlow(flowJson);
      setDryRun(dryJson);
      setLastComposedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (composedOnceRef.current) return;
    composedOnceRef.current = true;
    void compose();
  }, [compose]);

  const transcript = useMemo(() => buildTranscript(flow), [flow]);

  return (
    <div className="hf-preview-lens">
      <header className="hf-preview-lens-header">
        <div className="hf-preview-lens-title">
          <Eye size={14} />
          <span>Preview — Call 1</span>
        </div>
        <div className="hf-preview-lens-toolbar">
          <button
            type="button"
            className={`hf-pill ${mode === "educator" ? "hf-pill-primary" : ""}`}
            onClick={() => setMode("educator")}
          >
            Educator
          </button>
          <button
            type="button"
            className={`hf-pill ${mode === "engineer" ? "hf-pill-primary" : ""}`}
            onClick={() => setMode("engineer")}
          >
            Engineer
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-secondary hf-btn-sm"
            onClick={compose}
            disabled={loading}
            title="Recompose now"
          >
            <RefreshCw size={12} />
            <span>{loading ? "Composing…" : "Regenerate"}</span>
          </button>
        </div>
      </header>

      {lastComposedAt && (
        <p className="hf-preview-lens-meta">
          Last composed {new Date(lastComposedAt).toLocaleTimeString()}.
          Click any bubble to jump to the lens that controls it.
        </p>
      )}

      {error && (
        <div className="hf-banner hf-banner-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && !flow && (
        <div className="hf-preview-lens-loading">
          <div className="hf-spinner" /> <span>Composing call 1 preview…</span>
        </div>
      )}

      {!loading && flow && mode === "educator" && (
        <EducatorView transcript={transcript} courseId={courseId} />
      )}

      {!loading && dryRun && mode === "engineer" && (
        <EngineerView data={dryRun} />
      )}
    </div>
  );
}

// ── Transcript model ───────────────────────────────────────────

type Side = "bot" | "user";

interface PreviewBubble {
  side: Side;
  /** True when this bubble represents config that's missing/disabled — rendered ghosted. */
  ghost?: boolean;
  /** Visible bubble copy. */
  text: string;
  /** Optional caption above bubble (e.g., "Goals question"). */
  caption?: string;
  /** Lens id to deep-link to when the bubble is clicked. */
  lens: string;
  /** Educator-facing label for the deep-link affordance. */
  lensLabel: string;
}

interface PreviewDivider {
  kind: "divider";
  label: string;
}

interface PreviewStopNote {
  kind: "stop-note";
  text: string;
  lens: string;
}

type PreviewItem =
  | ({ kind: "bubble" } & PreviewBubble)
  | PreviewDivider
  | PreviewStopNote;

function buildTranscript(flow: SessionFlowResp | null): PreviewItem[] {
  if (!flow?.sessionFlow) return [];
  const sf = flow.sessionFlow;
  const items: PreviewItem[] = [];

  // ── Pre-call survey (intake questions) ──
  // If any intake toggle is on, those run BEFORE call 1 (or in the first
  // discovery phase, depending on delivery). Render them as a survey-style
  // pre-call chat.
  const anyIntake =
    sf.intake.goals.enabled
    || sf.intake.aboutYou.enabled
    || (sf.intake.knowledgeCheck.enabled && (sf.intake.knowledgeCheck.deliveryMode ?? "mcq") === "mcq");

  if (anyIntake) {
    items.push({ kind: "divider", label: "Pre-call survey" });

    if (sf.intake.goals.enabled) {
      items.push({
        kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit Goals",
        caption: "Goals question",
        text: "What would you most like to get out of this course?",
      });
      items.push({
        kind: "bubble", side: "user", lens: "intake", lensLabel: "Edit Goals", ghost: true,
        text: "(learner's response will go here)",
      });
    } else {
      items.push({
        kind: "bubble", side: "bot", lens: "intake", lensLabel: "Enable Goals", ghost: true,
        caption: "Goals question — OFF",
        text: "(no goals question — learner will not be asked about course goals)",
      });
    }

    if (sf.intake.aboutYou.enabled) {
      items.push({
        kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit About You",
        caption: "About You",
        text: "On a scale of 1–5, how confident do you feel about this topic?",
      });
      items.push({
        kind: "bubble", side: "user", lens: "intake", lensLabel: "Edit About You", ghost: true,
        text: "(confidence rating + optional motivation text)",
      });
    } else {
      items.push({
        kind: "bubble", side: "bot", lens: "intake", lensLabel: "Enable About You", ghost: true,
        caption: "About You — OFF",
        text: "(no confidence + motivation prompt)",
      });
    }

    if (sf.intake.knowledgeCheck.enabled) {
      const mode = sf.intake.knowledgeCheck.deliveryMode || "mcq";
      if (mode === "mcq") {
        items.push({
          kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit Knowledge Check",
          caption: "Knowledge Check — MCQ batch (5 questions)",
          text: "Question 1 of 5: …",
        });
        items.push({
          kind: "bubble", side: "user", lens: "intake", lensLabel: "Edit Knowledge Check", ghost: true,
          text: "(learner answers each MCQ)",
        });
      }
      // Socratic mode delivers inside the call's discovery phase, so it shows
      // in the call section below, not here.
    }
  }

  // ── Call 1 begins ──
  items.push({ kind: "divider", label: "Call 1 begins" });

  // Welcome / first-line greeting
  if (sf.welcomeMessage) {
    items.push({
      kind: "bubble", side: "bot", lens: "welcome", lensLabel: "Edit Welcome",
      caption: "Welcome message",
      text: sf.welcomeMessage,
    });
  } else {
    items.push({
      kind: "bubble", side: "bot", lens: "welcome", lensLabel: "Edit Welcome", ghost: true,
      caption: "Welcome message — using generic fallback",
      text: "(domain-level or generic greeting — set a course-specific welcome to personalise the opener)",
    });
  }

  // Onboarding phases / discovery
  if (sf.onboarding.phases.length > 0) {
    const firstPhase = sf.onboarding.phases[0];
    items.push({
      kind: "bubble", side: "bot", lens: "onboarding", lensLabel: "Edit Onboarding",
      caption: `Phase 1 of ${sf.onboarding.phases.length} — ${firstPhase.phase}`,
      text: firstPhase.goals?.[0] || `(first onboarding phase: ${firstPhase.phase})`,
    });
    if (sf.onboarding.phases.length > 1) {
      items.push({
        kind: "bubble", side: "bot", lens: "onboarding", lensLabel: "Edit Onboarding",
        caption: `Then phases: ${sf.onboarding.phases.slice(1).map(p => p.phase).join(" → ")}`,
        text: "(walks through the remaining phases before the first teaching segment)",
      });
    }
  } else {
    items.push({
      kind: "bubble", side: "bot", lens: "onboarding", lensLabel: "Add Onboarding phases", ghost: true,
      caption: "No onboarding phases configured",
      text: "(falls back to INIT-001 default phases)",
    });
  }

  // Socratic knowledge check probe — fires during discovery if enabled
  if (sf.intake.knowledgeCheck.enabled && (sf.intake.knowledgeCheck.deliveryMode ?? "mcq") === "socratic") {
    items.push({
      kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit Knowledge Check",
      caption: "Knowledge Check — Socratic probe (in-call)",
      text: "What do you already know about this topic?",
    });
    items.push({
      kind: "bubble", side: "user", lens: "intake", lensLabel: "Edit Knowledge Check", ghost: true,
      text: "(open answer — AI probes deeper)",
    });
  }

  // First teaching turn — link to Preview's own Engineer view
  items.push({
    kind: "bubble", side: "bot", lens: "preview", lensLabel: "See full prompt (Engineer)",
    caption: "First teaching turn",
    text: "(the first module's opening — see the Engineer view for the composed prompt)",
  });

  // ── Stops / NPS that fire downstream ──
  const npsStop = sf.stops.find(s => s.kind === "nps");
  if (npsStop?.trigger) {
    const t = npsStop.trigger;
    let trigger = "";
    if (t.type === "mastery_reached" && t.threshold) {
      trigger = `mastery ≥ ${Math.round(t.threshold * 100)}%`;
    } else if (t.type === "session_count" && t.count) {
      trigger = `after ${t.count} sessions`;
    } else {
      trigger = t.type;
    }
    items.push({ kind: "stop-note", text: `NPS survey fires when ${trigger}.`, lens: "stops" });
  }

  return items;
}

// ── Views ──────────────────────────────────────────────────────

function EducatorView({ transcript, courseId }: { transcript: PreviewItem[]; courseId: string }): React.ReactElement {
  if (transcript.length === 0) {
    return <p className="hf-text-muted">Nothing configured yet — see Engineer view for raw compose state.</p>;
  }
  return (
    <div className="hf-preview-chat">
      {transcript.map((item, i) => {
        if (item.kind === "divider") {
          return (
            <div key={i} className="hf-preview-divider" aria-label={item.label}>
              <span>{item.label}</span>
            </div>
          );
        }
        if (item.kind === "stop-note") {
          return (
            <Link
              key={i}
              href={`/x/courses/${courseId}?tab=design&design_view=${item.lens}`}
              className="hf-preview-stop-note"
            >
              <AlertCircle size={12} />
              <span>{item.text}</span>
              <span className="hf-preview-stop-note-edit">Edit Stops →</span>
            </Link>
          );
        }
        return (
          <BubbleRow
            key={i}
            bubble={item}
            courseId={courseId}
          />
        );
      })}
    </div>
  );
}

function BubbleRow({
  bubble, courseId,
}: {
  bubble: { kind: "bubble" } & PreviewBubble;
  courseId: string;
}): React.ReactElement {
  const href = `/x/courses/${courseId}?tab=design&design_view=${bubble.lens}`;
  const wrapClasses = [
    "hf-preview-bubble-row",
    bubble.side === "user" ? "hf-preview-bubble-row--user" : "hf-preview-bubble-row--bot",
    bubble.ghost ? "hf-preview-bubble-row--ghost" : "",
  ].filter(Boolean).join(" ");
  const bubbleClasses = [
    "hf-preview-bubble",
    bubble.side === "user" ? "hf-preview-bubble--user" : "hf-preview-bubble--bot",
    bubble.ghost ? "hf-preview-bubble--ghost" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={wrapClasses}>
      {bubble.caption && (
        <div className="hf-preview-bubble-caption">{bubble.caption}</div>
      )}
      <Link href={href} className={bubbleClasses} title={bubble.lensLabel}>
        <span className="hf-preview-bubble-text">{bubble.text}</span>
        <span className="hf-preview-bubble-edit">
          <Edit3 size={11} />
          <span>{bubble.lensLabel}</span>
        </span>
      </Link>
    </div>
  );
}

function EngineerView({ data }: { data: DryRunResp }): React.ReactElement {
  const meta = data.metadata;
  if (!meta) return <p className="hf-text-muted">No metadata returned.</p>;
  return (
    <div className="hf-preview-lens-engineer">
      <div className="hf-preview-lens-engineer-stats">
        <Stat label="Activated" value={meta.sectionsActivated.length} />
        <Stat label="Skipped" value={meta.sectionsSkipped.length} />
        <Stat label="Identity" value={meta.identitySpec ?? "—"} />
        <Stat label="Memories" value={meta.memoriesCount} />
        <Stat label="Targets" value={meta.behaviorTargetsCount} />
      </div>

      <section className="hf-preview-lens-engineer-section">
        <h4>
          <FileSearch size={12} /> Activated sections ({meta.sectionsActivated.length})
        </h4>
        <ul className="hf-preview-lens-engineer-list">
          {meta.sectionsActivated.map((s) => (
            <li key={s}>
              <code>{s}</code>
              <span className="hf-preview-lens-engineer-reason">
                {meta.activationReasons[s] || "ok"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="hf-preview-lens-engineer-section">
        <h4>
          <AlertCircle size={12} /> Skipped sections ({meta.sectionsSkipped.length})
        </h4>
        {meta.sectionsSkipped.length === 0 ? (
          <p className="hf-text-muted">None — every section composed.</p>
        ) : (
          <ul className="hf-preview-lens-engineer-list">
            {meta.sectionsSkipped.map((s) => (
              <li key={s} className="hf-preview-lens-engineer-skipped">
                <code>{s}</code>
                <span className="hf-preview-lens-engineer-reason">
                  {meta.activationReasons[s] || "no reason given"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.promptSummary && (
        <section className="hf-preview-lens-engineer-section">
          <h4>Prompt summary</h4>
          <pre className="hf-preview-lens-engineer-summary">{data.promptSummary}</pre>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="hf-preview-lens-stat">
      <div className="hf-preview-lens-stat-value">{value}</div>
      <div className="hf-preview-lens-stat-label">{label}</div>
    </div>
  );
}
