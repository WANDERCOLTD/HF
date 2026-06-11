"use client";

/**
 * Preview lens — Slice 3 of epic #1263 (chat-bubble revision +
 * sidetray edit, 2026-06-07).
 *
 * Renders an Educator view + Engineer view of what the learner will
 * experience on Call 1. The Educator view uses WhatsApp-style chat
 * bubbles that match SimChat + ChatSurvey UI. Clicking a bubble or
 * section heading opens a slide-in sidetray with the matching lens
 * editor — the educator can tweak goals/welcome/phases/NPS without
 * losing the preview, and on close Preview re-fetches so the bubble
 * reflects the new value immediately.
 *
 * (The sidetray pattern was previously retired from inside lenses
 * (Slice 1 cleanup) — that decision stands for in-lens editing. The
 * Preview-side sidetray is a different concern: it's overlay editing
 * from a higher-level summary view, not from inside the editor.)
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
import { Eye, RefreshCw, FileSearch, AlertCircle, Edit3, X } from "lucide-react";
import {
  SessionFlowEditor,
  type SessionFlowLens,
} from "@/components/session-flow/SessionFlowEditor";
import { ModuleVisibilitySettings } from "@/components/course-design/ModuleVisibilitySettings";
import "./preview-lens.css";
import { emptyOnboardingBubble } from "./empty-onboarding-bubble";
import { LayerBadge } from "@/components/cascade/LayerBadge";
import { CascadeInspectorTray } from "@/components/cascade/CascadeInspectorTray";
import { getArchetypeLabel } from "@/lib/domain/generate-identity";
import type { Effective, Layer } from "@/lib/cascade/layer-types";
import { substituteGreetingTokens } from "@/lib/prompt/composition/defaults/substitute-greeting-tokens";

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
    /** #1403 — Greeting lens additions surfaced to the preview transcript. */
    firstCallCourseIntro: string | null;
    firstCallWaitForAck: "none" | "any_response" | "greeting_words";
    offboarding: { phases: Array<{ phase: string }>; triggerAfterCalls?: number };
    stops: Array<{ id: string; kind: string; trigger?: { type: string; threshold?: number; count?: number } }>;
    /** Provenance — which layer of the cascade supplied each section's
     *  value. Used by the empty-state copy below (#1418) to distinguish
     *  "explicitly disabled" from "never configured / using INIT-001". */
    source?: {
      intake?: "new-shape" | "legacy-welcome" | "defaults";
      onboarding?: "new-shape" | "playbook-legacy" | "domain" | "init001";
      stops?: "new-shape" | "synthesized-from-legacy";
      offboarding?: "new-shape" | "playbook-legacy" | "defaults";
      welcomeMessage?: "playbook" | "domain" | "generic";
      firstCallCourseIntro?: "playbook" | "none";
      firstCallWaitForAck?: "playbook" | "default";
    };
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
    /** #1472 — which cascade layer sourced the identity-spec (SYSTEM/DOMAIN/PLAYBOOK). */
    identitySpecSource?: "SYSTEM" | "DOMAIN" | "PLAYBOOK" | null;
    /** #1472 — base archetype slug ("TUT-001"); map to a label via `getArchetypeLabel`. */
    identitySpecExtendsAgent?: string | null;
    playbooksUsed: string[];
    memoriesCount: number;
    behaviorTargetsCount: number;
  };
  error?: string;
}

type ViewMode = "educator" | "engineer";

/** Sidetray lens map — which SessionFlowEditor section to mount per
 *  Preview lens id. Used both for direct lens ids and for bubble lens
 *  hints (e.g. a Goals bubble points at the Intake lens). */
const SIDETRAY_LENS_MAP: Record<string, SessionFlowLens> = {
  intake: "intake",
  onboarding: "onboarding",
  stops: "stops",
  offboarding: "offboarding",
  welcome: "welcome",
  // #1405 — clicking the "First teaching turn" bubble opens the
  // module-visibility editor sidetray (instead of dead-linking to the
  // Engineer view).
  moduleVisibility: "moduleVisibility",
};

const SIDETRAY_TITLES: Record<SessionFlowLens, string> = {
  intake: "Intake — pre-call questions",
  onboarding: "Onboarding — first-call phases",
  stops: "Session Stops — pre/mid/post-test, NPS",
  offboarding: "Offboarding — end-of-course phases",
  // #1403 — was "Welcome message"; lens now consolidates welcome +
  // course intro + ack-gate, so the title carries the full surface name.
  welcome: "Greeting — first call opener",
  moduleVisibility: "Module visibility — when modules get named",
};

export function PreviewLens({ courseId }: PreviewLensProps): React.ReactElement {
  const [mode, setMode] = useState<ViewMode>("educator");
  const [flow, setFlow] = useState<SessionFlowResp | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastComposedAt, setLastComposedAt] = useState<number | null>(null);
  const [sidetrayLens, setSidetrayLens] = useState<SessionFlowLens | null>(null);
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

  const openSidetray = useCallback((lensId: string) => {
    const mapped = SIDETRAY_LENS_MAP[lensId];
    if (mapped) setSidetrayLens(mapped);
  }, []);

  const closeSidetray = useCallback(() => {
    setSidetrayLens(null);
    // Re-fetch so the bubbles reflect any save inside the sidetray.
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
            className="hf-btn hf-btn-primary"
            onClick={compose}
            disabled={loading}
            title="Re-fetch session-flow + dry-run to see the latest config"
          >
            <RefreshCw size={14} />
            <span>{loading ? "Composing…" : "Refresh preview"}</span>
          </button>
        </div>
      </header>

      {lastComposedAt && (
        <p className="hf-preview-lens-meta">
          Last composed {new Date(lastComposedAt).toLocaleTimeString()}.
          Click any bubble or section heading to edit it in a side panel — the preview
          re-fetches when you close.
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
        <>
          <IdentityHeader meta={dryRun?.metadata} courseId={courseId} />
          <EducatorView transcript={transcript} courseId={courseId} onOpenSidetray={openSidetray} />
        </>
      )}

      {!loading && dryRun && mode === "engineer" && (
        <EngineerView data={dryRun} />
      )}

      {sidetrayLens && (
        <PreviewEditSidetray
          courseId={courseId}
          lens={sidetrayLens}
          onClose={closeSidetray}
        />
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
  /** When set, the divider becomes a clickable deep-link to the lens
   *  that controls the whole section (e.g. Pre-call survey → Intake). */
  lens?: string;
  lensLabel?: string;
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

  const anyIntake =
    sf.intake.goals.enabled
    || sf.intake.aboutYou.enabled
    || (sf.intake.knowledgeCheck.enabled && (sf.intake.knowledgeCheck.deliveryMode ?? "mcq") === "mcq");

  if (anyIntake) {
    items.push({
      kind: "divider",
      label: "Pre-call survey",
      lens: "intake",
      lensLabel: "Edit Intake (toggle questions on/off)",
    });

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
      const m = sf.intake.knowledgeCheck.deliveryMode || "mcq";
      if (m === "mcq") {
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
    }
  }

  if (sf.intake.aiIntroCall.enabled) {
    items.push({
      kind: "divider",
      label: "AI Intro Call (separate session)",
      lens: "intake",
      lensLabel: "Edit Intake (toggle AI Intro Call)",
    });
    items.push({
      kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit AI Intro Call",
      caption: "AI Intro Call — opening",
      text: "Hey! I'm your AI tutor. Before we dive into the course, let's have a quick warm-up chat so we can get to know each other.",
    });
    items.push({
      kind: "bubble", side: "user", lens: "intake", lensLabel: "Edit AI Intro Call", ghost: true,
      text: "(learner responds — warm-up rapport, no quizzing or teaching)",
    });
    items.push({
      kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit AI Intro Call",
      text: "Great, thanks for chatting. Looking forward to our first lesson!",
    });
  } else {
    items.push({
      kind: "divider",
      label: "AI Intro Call — OFF",
      lens: "intake",
      lensLabel: "Enable AI Intro Call",
    });
  }

  items.push({ kind: "divider", label: "Call 1 begins" });

  // #1403 — Greeting flow. Three bubbles cohere into one editable lens
  // (`welcome` SIDETRAY_LENS_MAP target). All bubbles route through the
  // Greeting sidetray so the educator can edit the three fields together.
  //
  // Token-preview seed values for {firstName} ("Alex") + {courseName}
  // (flow.courseName) mirror the GreetingDrawer preview so the educator
  // sees identical text in both surfaces.
  const previewFirstName = "Alex";
  const previewCourseName = flow.courseName ?? null;
  if (sf.welcomeMessage) {
    const resolved = substituteGreetingTokens({
      template: sf.welcomeMessage,
      firstName: previewFirstName,
      courseName: previewCourseName,
    });
    items.push({
      kind: "bubble", side: "bot", lens: "welcome", lensLabel: "Edit Greeting",
      caption: "Welcome — literal opener",
      text: resolved,
    });
  } else {
    items.push({
      kind: "bubble", side: "bot", lens: "welcome", lensLabel: "Edit Greeting", ghost: true,
      caption: "Welcome message — using generic fallback",
      text: "(domain-level or generic greeting — set a course-specific welcome to personalise the opener)",
    });
  }

  // Ack-gate ghost bubble — shows where the AI pauses for the learner.
  if (sf.firstCallWaitForAck === "any_response") {
    items.push({
      kind: "bubble", side: "user", lens: "welcome", lensLabel: "Edit Greeting", ghost: true,
      caption: "Learner acknowledges (any response)",
      text: "(AI waits for any reply before continuing)",
    });
  } else if (sf.firstCallWaitForAck === "greeting_words") {
    items.push({
      kind: "bubble", side: "user", lens: "welcome", lensLabel: "Edit Greeting", ghost: true,
      caption: "Learner acknowledges (greeting word)",
      text: "(AI waits for hi / hello / yes / yeah / ...)",
    });
  }

  // Course-intro bubble — shown only when the educator authored one.
  if (sf.firstCallCourseIntro) {
    const resolvedIntro = substituteGreetingTokens({
      template: sf.firstCallCourseIntro,
      firstName: previewFirstName,
      courseName: previewCourseName,
    });
    items.push({
      kind: "bubble", side: "bot", lens: "welcome", lensLabel: "Edit Greeting",
      caption: "Course intro — literal",
      text: resolvedIntro,
    });
  }

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
    // #1418 — distinguish "explicitly disabled" from "never configured".
    // Pre-fix both states landed here with the same INIT-001 fallback
    // copy; the resolver's `source` carries the distinction.
    const bubble = emptyOnboardingBubble(sf.source?.onboarding);
    items.push({
      kind: "bubble", side: "bot", lens: "onboarding",
      lensLabel: bubble.lensLabel,
      ghost: true,
      caption: bubble.caption,
      text: bubble.text,
    });
  }

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

  // #1405 — the "First teaching turn" bubble is the module-naming surface
  // operators care about. Route it to the moduleVisibility sidetray so a
  // click lands directly on the radio group.
  items.push({
    kind: "bubble", side: "bot", lens: "moduleVisibility", lensLabel: "Edit module visibility",
    caption: "First teaching turn",
    text: "(the first module's opening — see the Engineer view for the composed prompt)",
  });

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

function EducatorView({
  transcript, courseId, onOpenSidetray,
}: {
  transcript: PreviewItem[];
  courseId: string;
  onOpenSidetray: (lensId: string) => void;
}): React.ReactElement {
  if (transcript.length === 0) {
    return <p className="hf-text-muted">Nothing configured yet — see Engineer view for raw compose state.</p>;
  }
  return (
    <div className="hf-preview-chat">
      {transcript.map((item, i) => {
        if (item.kind === "divider") {
          const inSidetray = item.lens && SIDETRAY_LENS_MAP[item.lens];
          if (inSidetray) {
            return (
              <button
                key={i}
                type="button"
                className="hf-preview-divider hf-preview-divider--link"
                aria-label={item.lensLabel || item.label}
                title={item.lensLabel || item.label}
                onClick={() => item.lens && onOpenSidetray(item.lens)}
              >
                <span>{item.label}</span>
                <span className="hf-preview-divider-edit">
                  <Edit3 size={11} />
                  <span>{item.lensLabel || "Edit"}</span>
                </span>
              </button>
            );
          }
          if (item.lens) {
            return (
              <Link
                key={i}
                href={`/x/courses/${courseId}?tab=design&design_view=${item.lens}`}
                className="hf-preview-divider hf-preview-divider--link"
                aria-label={item.lensLabel || item.label}
                title={item.lensLabel || item.label}
              >
                <span>{item.label}</span>
                <span className="hf-preview-divider-edit">
                  <Edit3 size={11} />
                  <span>{item.lensLabel || "Edit"}</span>
                </span>
              </Link>
            );
          }
          return (
            <div key={i} className="hf-preview-divider" aria-label={item.label}>
              <span>{item.label}</span>
            </div>
          );
        }
        if (item.kind === "stop-note") {
          const inSidetray = SIDETRAY_LENS_MAP[item.lens];
          if (inSidetray) {
            return (
              <button
                key={i}
                type="button"
                className="hf-preview-stop-note"
                onClick={() => onOpenSidetray(item.lens)}
              >
                <AlertCircle size={12} />
                <span>{item.text}</span>
                <span className="hf-preview-stop-note-edit">Edit Stops →</span>
              </button>
            );
          }
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
            onOpenSidetray={onOpenSidetray}
          />
        );
      })}
    </div>
  );
}

function BubbleRow({
  bubble, courseId, onOpenSidetray,
}: {
  bubble: { kind: "bubble" } & PreviewBubble;
  courseId: string;
  onOpenSidetray: (lensId: string) => void;
}): React.ReactElement {
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

  const inSidetray = SIDETRAY_LENS_MAP[bubble.lens];

  const body = (
    <>
      <span className="hf-preview-bubble-text">{bubble.text}</span>
      <span className="hf-preview-bubble-edit">
        <Edit3 size={11} />
        <span>{bubble.lensLabel}</span>
      </span>
    </>
  );

  return (
    <div className={wrapClasses}>
      {bubble.caption && (
        <div className="hf-preview-bubble-caption">{bubble.caption}</div>
      )}
      {inSidetray ? (
        <button
          type="button"
          className={bubbleClasses}
          title={bubble.lensLabel}
          onClick={() => onOpenSidetray(bubble.lens)}
        >
          {body}
        </button>
      ) : (
        <Link
          href={`/x/courses/${courseId}?tab=design&design_view=${bubble.lens}`}
          className={bubbleClasses}
          title={bubble.lensLabel}
        >
          {body}
        </Link>
      )}
    </div>
  );
}

// ── Edit sidetray ──────────────────────────────────────────────

function PreviewEditSidetray({
  courseId, lens, onClose,
}: {
  courseId: string;
  lens: SessionFlowLens;
  onClose: () => void;
}): React.ReactElement {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="hf-preview-sidetray-backdrop" onClick={onClose} />
      <aside className="hf-preview-sidetray" role="dialog" aria-label={SIDETRAY_TITLES[lens]}>
        <header className="hf-preview-sidetray-header">
          <h2>{SIDETRAY_TITLES[lens]}</h2>
          <button
            type="button"
            className="hf-preview-sidetray-close"
            onClick={onClose}
            title="Close (Esc) — Preview will refresh"
          >
            <X size={16} />
          </button>
        </header>
        <div className="hf-preview-sidetray-body">
          {lens === "moduleVisibility" ? (
            // #1405 — module-visibility lens is config-only; no journey
            // rows to render. Mount its dedicated component directly.
            <ModuleVisibilitySettings courseId={courseId} />
          ) : (
            <SessionFlowEditor courseId={courseId} activeSection={lens} />
          )}
        </div>
        <footer className="hf-preview-sidetray-footer">
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={onClose}
          >
            Done — refresh preview
          </button>
        </footer>
      </aside>
    </>
  );
}

function EngineerView({ data }: { data: DryRunResp }): React.ReactElement {
  const meta = data.metadata;
  if (!meta) return <p className="hf-text-muted">No metadata returned.</p>;
  // #1472 — append the cascade source layer so the Engineer view exposes
  // provenance without expanding into a separate badge surface.
  const identityWithSource = meta.identitySpec
    ? `${meta.identitySpec}${meta.identitySpecSource ? ` (${meta.identitySpecSource})` : ""}`
    : "—";
  return (
    <div className="hf-preview-lens-engineer">
      <div className="hf-preview-lens-engineer-stats">
        <Stat label="Activated" value={meta.sectionsActivated.length} />
        <Stat label="Skipped" value={meta.sectionsSkipped.length} />
        <Stat label="Identity" value={identityWithSource} />
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

// ── Identity header (#1472) ─────────────────────────────────────────────
// Cascade-honest persona row shown above the Educator transcript. Reads
// `identitySpec` (name) + `identitySpecSource` + `identitySpecExtendsAgent`
// from the dry-run metadata, synthesizes an `Effective<string>` envelope
// so `<LayerBadge>` can render the source layer, and opens
// `<CascadeInspectorTray>` on inspect.

/**
 * Synthesizes a single-layer envelope for the identity cascade so the
 * badge renders honestly without re-querying `/api/cascade/resolve` on
 * mount. The tray fetches the full 6-layer chain itself when opened.
 */
export function identitySpecEnvelope(
  source: Layer | null | undefined,
  name: string | null,
): Effective<string | null> {
  if (!source || !name) {
    return {
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    };
  }
  return {
    value: name,
    source,
    layers: [
      {
        layer: source,
        scopeId: null,
        scopeLabel: scopeLabelForLayer(source),
        value: name,
        setAt: null,
        setBy: null,
      },
    ],
    isInherited: source !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

function scopeLabelForLayer(layer: Layer): string {
  switch (layer) {
    case "PLAYBOOK":
      return "Course";
    case "DOMAIN":
      return "Domain";
    case "SYSTEM":
      return "System default";
    case "CALLER":
      return "Caller";
    case "SEGMENT":
      return "Segment";
    case "CALL":
      return "Call";
  }
}

export function identityCaption(
  source: "SYSTEM" | "DOMAIN" | "PLAYBOOK" | null | undefined,
  archetypeSlug: string | null | undefined,
): string {
  const label = getArchetypeLabel(archetypeSlug);
  if (!source) return `Persona: ${label}`;
  const layer = source === "PLAYBOOK"
    ? "Course"
    : source === "DOMAIN"
      ? "Domain"
      : "System default";
  const base = `Persona: ${label} from ${layer}`;
  if (source === "SYSTEM") return `${base} (no override at Course/Domain)`;
  return base;
}

function IdentityHeader({
  meta,
  courseId,
}: {
  meta: DryRunResp["metadata"];
  courseId: string;
}): React.ReactElement | null {
  const [inspecting, setInspecting] = useState(false);
  if (!meta) return null;

  const envelope = identitySpecEnvelope(
    meta.identitySpecSource ?? null,
    meta.identitySpec,
  );
  const caption = identityCaption(meta.identitySpecSource ?? null, meta.identitySpecExtendsAgent);

  // Ghosted fallback row when there's no identity at all.
  if (!meta.identitySpec) {
    return (
      <div
        className="hf-preview-lens-identity"
        data-testid="hf-preview-identity-empty"
      >
        <span className="hf-text-muted">No persona configured — system default will be used.</span>
      </div>
    );
  }

  return (
    <div
      className="hf-preview-lens-identity"
      data-testid="hf-preview-identity-row"
    >
      <LayerBadge
        envelope={envelope}
        hideSubtitle
        onInspect={() => setInspecting(true)}
        ariaLabel={`Identity spec source: ${meta.identitySpecSource ?? "unknown"}`}
      />
      <span
        className="hf-preview-lens-identity-caption"
        data-testid="hf-preview-identity-caption"
      >
        {caption}
      </span>
      {inspecting ? (
        <CascadeInspectorTray
          knobKey="identitySpecId"
          knobLabel="Identity spec"
          scopeChain={{ playbookId: courseId }}
          currentEditScope="PLAYBOOK"
          onClose={() => setInspecting(false)}
        />
      ) : null}
    </div>
  );
}
