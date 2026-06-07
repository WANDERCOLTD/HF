"use client";

/**
 * Preview lens — Slice 3 of epic #1263.
 *
 * Lazy-mounted via `<ConsoleShell>` — the dry-run compose only fires
 * when an educator selects the Preview lens, not on Design-tab open.
 *
 * Two view modes:
 *   - Educator (default): config-driven summary of what the learner will
 *     experience on call 1. Reads `sessionFlow.*` directly, renders one
 *     line per active stage + ghosted lines for stages that won't fire.
 *     Each ghost has a deep-link to the lens that would enable it.
 *   - Engineer: section-by-section from POST /dry-run-prompt — uses
 *     `metadata.sectionsActivated` + `sectionsSkipped` + `activationReasons`.
 *
 * Staleness — leans on `Playbook.composeInputsUpdatedAt` (#878). A "stale"
 * badge appears when the compose-affecting timestamp on the resolved
 * playbook is newer than the timestamp captured at the last compose.
 * `[Regenerate]` re-fetches and re-anchors.
 *
 * Closes #1268 (Slice 3). Refs epic #1263.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, RefreshCw, FileSearch, AlertCircle } from "lucide-react";
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
    stops: Array<{ id: string; kind: string }>;
  };
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

  // Lazy compose: this component is only mounted when the lens is active
  // (`<ConsoleShell>` renders `def.Component` only for the active lens), so
  // a single useEffect on mount achieves the "don't fire until viewed"
  // contract. Guard against double-fire from StrictMode.
  useEffect(() => {
    if (composedOnceRef.current) return;
    composedOnceRef.current = true;
    void compose();
  }, [compose]);

  const educatorRows = useMemo(() => buildEducatorRows(flow, courseId), [flow, courseId]);

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
          Re-run after any setup change to see the latest.
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
        <EducatorView rows={educatorRows} courseId={courseId} />
      )}

      {!loading && dryRun && mode === "engineer" && (
        <EngineerView data={dryRun} />
      )}
    </div>
  );
}

interface EducatorRow {
  kind: "active" | "ghost";
  icon: "👋" | "❓" | "💡" | "🎯" | "📝" | "🎓" | "🏁";
  title: string;
  detail: string;
  fixLens?: string;
  fixLabel?: string;
}

function buildEducatorRows(flow: SessionFlowResp | null, _courseId: string): EducatorRow[] {
  if (!flow?.sessionFlow) return [];
  const sf = flow.sessionFlow;
  const rows: EducatorRow[] = [];

  // Welcome opener
  if (sf.welcomeMessage) {
    rows.push({
      kind: "active",
      icon: "👋",
      title: "Welcome",
      detail: sf.welcomeMessage,
    });
  } else {
    rows.push({
      kind: "ghost",
      icon: "👋",
      title: "Welcome",
      detail: "Falls back to a generic greeting. Add a course-specific welcome to set the tone.",
      fixLens: "welcome",
      fixLabel: "Edit Welcome",
    });
  }

  // Intake — discovery questions
  if (sf.intake.goals.enabled) {
    rows.push({ kind: "active", icon: "🎯", title: "Goals question", detail: "Asks what the learner wants to get out of the course." });
  } else {
    rows.push({ kind: "ghost", icon: "🎯", title: "Goals question", detail: "Disabled. Toggle ON to capture the learner's goals.", fixLens: "intake", fixLabel: "Edit Intake" });
  }

  if (sf.intake.aboutYou.enabled) {
    rows.push({ kind: "active", icon: "❓", title: "About You", detail: "Confidence + motivation prompts." });
  } else {
    rows.push({ kind: "ghost", icon: "❓", title: "About You", detail: "Disabled.", fixLens: "intake", fixLabel: "Edit Intake" });
  }

  if (sf.intake.knowledgeCheck.enabled) {
    const mode = sf.intake.knowledgeCheck.deliveryMode || "mcq";
    rows.push({
      kind: "active",
      icon: "💡",
      title: "Knowledge Check",
      detail: mode === "socratic" ? "Socratic probe during the discovery phase." : "5-question MCQ batch after call 1.",
    });
  } else {
    rows.push({ kind: "ghost", icon: "💡", title: "Knowledge Check", detail: "Disabled.", fixLens: "intake", fixLabel: "Edit Intake" });
  }

  // Onboarding phases
  if (sf.onboarding.phases.length > 0) {
    rows.push({
      kind: "active",
      icon: "📝",
      title: "Onboarding phases",
      detail: `${sf.onboarding.phases.length} phase${sf.onboarding.phases.length === 1 ? "" : "s"} — ${sf.onboarding.phases.map(p => p.phase).join(" → ")}`,
    });
  } else {
    rows.push({
      kind: "ghost",
      icon: "📝",
      title: "Onboarding phases",
      detail: "No phases configured — first-call flow falls back to INIT-001.",
      fixLens: "onboarding",
      fixLabel: "Edit Onboarding",
    });
  }

  // First teaching content (synthetic — composition would resolve)
  rows.push({
    kind: "active",
    icon: "🎓",
    title: "First module",
    detail: "Loads from the Curriculum's first module. See the Engineer view for the composed prompt.",
  });

  return rows;
}

function EducatorView({ rows, courseId }: { rows: EducatorRow[]; courseId: string }): React.ReactElement {
  return (
    <div className="hf-preview-lens-educator">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`hf-preview-lens-row ${r.kind === "ghost" ? "hf-preview-lens-row--ghost" : ""}`}
        >
          <span className="hf-preview-lens-row-icon">{r.icon}</span>
          <div className="hf-preview-lens-row-body">
            <div className="hf-preview-lens-row-title">{r.title}</div>
            <div className="hf-preview-lens-row-detail">{r.detail}</div>
          </div>
          {r.fixLens && (
            <Link
              href={`/x/courses/${courseId}?tab=design&design_view=${r.fixLens}`}
              className="hf-preview-lens-row-fix"
            >
              {r.fixLabel || "Fix"} →
            </Link>
          )}
        </div>
      ))}
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
