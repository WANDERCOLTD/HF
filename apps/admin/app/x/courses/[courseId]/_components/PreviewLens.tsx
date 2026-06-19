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
import { Eye, RefreshCw, FileSearch, AlertCircle, Edit3, X, Star, Clapperboard, Trash2 } from "lucide-react";
import { useChatContext } from "@/contexts/ChatContext";
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
import type { DemoAnnotation, DemoScript } from "@/lib/types/json-fields";
import type { ComposeSectionKey } from "@/lib/compose";

/** Map from PreviewLens sidetray lens id → `ComposeSectionKey`.
 *  Originally for #1623 Renderers v2 B.13 (5 sections). Extended in the
 *  Slice C3 follow-on (#1738) to cover `moduleVisibility` → `modulesGate`
 *  so the Journey-tab bucket pulse + bubble-click navigation reach
 *  every lens emitted by PreviewLens. The `stops` lens currently
 *  surfaces the NPS prompt — map to `nps`.
 *
 *  When adding a new lens key, also add a row here. The map is the
 *  bridge between the PreviewLens emission and the Journey tab's
 *  bucket model — gaps cause silent "click does nothing" UX. */
export const SIDETRAY_LENS_TO_SECTION: Partial<Record<string, ComposeSectionKey>> = {
  intake: "intake",
  onboarding: "onboarding",
  offboarding: "offboarding",
  welcome: "welcome",
  stops: "nps",
  moduleVisibility: "modulesGate",
};

/** Slice 4 grey-out epic — derives a specific contract id from a
 *  bubble's `lensLabel`. Used by the bubble click handler to pass a
 *  setting-focus id alongside the section, so the Journey Inspector
 *  scrolls + briefly highlights the matching row instead of just
 *  changing buckets.
 *
 *  Conservative on purpose: only labels with a clear 1:1 mapping land
 *  in this table. Ambiguous labels (e.g. "Edit Intake (toggle questions
 *  on/off)" — covers 3 toggles) fall through and the click still works
 *  via the section→bucket path.
 *
 *  When adding a new bubble emit, also add a row here if its lensLabel
 *  is unambiguous. */
export const LENS_LABEL_TO_SETTING_ID: Partial<Record<string, string>> = {
  "Edit Goals": "intakeGoals",
  "Enable Goals": "intakeGoals",
  "Edit About You": "intakeAboutYou",
  "Enable About You": "intakeAboutYou",
  "Edit Knowledge Check": "intakeKnowledgeCheck",
  "Enable Knowledge Check": "intakeKnowledgeCheck",
  "Edit AI Intro Call": "intakeAiIntroCall",
  "Enable AI Intro Call": "intakeAiIntroCall",
  "Edit Greeting": "welcomeMessage",
  "Edit Onboarding": "onboardingFlowPhases",
};

interface PreviewLensProps {
  courseId: string;
  /** #1623 — Renderers v2 B.13. Optional. When supplied, PreviewLens
   *  ALSO fires this callback alongside its existing `openSidetray`
   *  flow on bubble click, so the Designer Inspector can render a
   *  section-summary alongside the live edit sidetray. Pure addition
   *  — no behaviour change when prop omitted (today's mount path).
   *
   *  Slice 4 grey-out epic: second arg is the specific setting id when
   *  the clicked bubble maps unambiguously to a single contract
   *  (`LENS_LABEL_TO_SETTING_ID`); undefined otherwise. Consumers can
   *  use it to scroll/highlight the matching row. */
  onSelectSection?: (section: ComposeSectionKey | null, settingId?: string) => void;
  /** Journey tab Phase 4 — when true, suppress the legacy click-to-edit
   *  sidetray and route bubble clicks only through `onSelectSection`
   *  (which the Journey tab uses to mount editors in the Inspector pane).
   *  Default false preserves the existing Design-tab behaviour. */
  suppressSidetray?: boolean;
  /** Slice 2 of the journey grey-out epic — monotonically-increasing
   *  counter bumped by the parent on every Inspector save. PreviewLens
   *  re-composes when this value changes, so the middle pane stays in
   *  sync with the right-hand Inspector without an explicit Refresh
   *  click. Default 0; the first non-zero bump triggers the first
   *  re-fetch after the initial mount. */
  composeNonce?: number;
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

export function PreviewLens({ courseId, onSelectSection, suppressSidetray = false, composeNonce = 0 }: PreviewLensProps): React.ReactElement {
  const { demoAnnotationsVisible } = useChatContext();
  const [mode, setMode] = useState<ViewMode>("educator");
  const [flow, setFlow] = useState<SessionFlowResp | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastComposedAt, setLastComposedAt] = useState<number | null>(null);
  const [sidetrayLens, setSidetrayLens] = useState<SessionFlowLens | null>(null);
  // #1493 — Preview annotations. `demoScript` is operator-only metadata,
  // NEVER forwarded to prompt composition. Loaded alongside session-flow
  // on first paint; opens the annotation editor sidetray on bubble click.
  const [demoScript, setDemoScript] = useState<DemoScript>({ annotations: [] });
  const [annotationEdit, setAnnotationEdit] = useState<{
    bubbleRef: string;
    existing: DemoAnnotation | null;
  } | null>(null);
  // Slice 2 grey-out epic — last composeNonce we ran against. The mount
  // useEffect re-fires `compose()` whenever the incoming nonce moves past
  // this stored value, but stays inert on a StrictMode double-mount with
  // the same nonce. Initialised to -1 so the first paint (nonce=0)
  // composes exactly once.
  const lastComposedNonceRef = useRef<number>(-1);

  const compose = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flowRes, dryRes, demoRes] = await Promise.all([
        fetch(`/api/courses/${courseId}/session-flow`),
        fetch(`/api/courses/${courseId}/dry-run-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSequence: 1 }),
        }),
        fetch(`/api/courses/${courseId}/demo-script`),
      ]);
      const flowJson = (await flowRes.json()) as SessionFlowResp;
      const dryJson = (await dryRes.json()) as DryRunResp;
      if (!flowJson.ok) throw new Error(flowJson.error || "session-flow fetch failed");
      if (!dryJson.ok) throw new Error(dryJson.error || "dry-run-prompt failed");
      setFlow(flowJson);
      setDryRun(dryJson);
      setLastComposedAt(Date.now());
      // Best-effort — annotations are operator decoration, never block paint.
      if (demoRes.ok) {
        const demoJson = (await demoRes.json()) as {
          ok: boolean;
          demoScript?: DemoScript;
        };
        if (demoJson.ok && demoJson.demoScript) {
          setDemoScript(demoJson.demoScript);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (lastComposedNonceRef.current === composeNonce) return;
    lastComposedNonceRef.current = composeNonce;
    void compose();
  }, [compose, composeNonce]);

  const openSidetray = useCallback((lensId: string, lensLabel?: string) => {
    const mapped = SIDETRAY_LENS_MAP[lensId];
    // Journey tab (Phase 4) suppresses the sidetray so the educator
    // doesn't see two overlapping editors — the bubble click routes
    // only through the Inspector pane via onSelectSection.
    if (mapped && !suppressSidetray) setSidetrayLens(mapped);
    // #1623 — Designer Inspector hook. The sidetray (edit affordance)
    // and the Inspector (preview-summary surface) are independent: the
    // sidetray stays the educator's "tweak this" entry; the Inspector
    // mirrors which section was last clicked for the Designer rail.
    // Slice 4 grey-out epic — when the bubble's lensLabel maps to a
    // specific contract id, also pass it to the Inspector so it can
    // scroll/highlight that row.
    if (onSelectSection) {
      const section = SIDETRAY_LENS_TO_SECTION[lensId];
      const settingId = lensLabel ? LENS_LABEL_TO_SETTING_ID[lensLabel] : undefined;
      if (section) onSelectSection(section, settingId);
    }
  }, [onSelectSection, suppressSidetray]);

  const closeSidetray = useCallback(() => {
    setSidetrayLens(null);
    // Re-fetch so the bubbles reflect any save inside the sidetray.
    void compose();
  }, [compose]);

  const openAnnotation = useCallback(
    (bubbleRef: string) => {
      const existing =
        demoScript.annotations.find((a) => a.bubbleRef === bubbleRef) ?? null;
      setAnnotationEdit({ bubbleRef, existing });
    },
    [demoScript],
  );

  const closeAnnotation = useCallback(() => {
    setAnnotationEdit(null);
  }, []);

  const onAnnotationSaved = useCallback(
    (next: DemoAnnotation) => {
      setDemoScript((prev) => {
        const existing = prev.annotations.findIndex(
          (a) => a.bubbleRef === next.bubbleRef,
        );
        const annotations = [...prev.annotations];
        if (existing === -1) annotations.push(next);
        else annotations[existing] = next;
        return { annotations };
      });
      setAnnotationEdit(null);
    },
    [],
  );

  const onAnnotationDeleted = useCallback((bubbleRef: string) => {
    setDemoScript((prev) => ({
      annotations: prev.annotations.filter((a) => a.bubbleRef !== bubbleRef),
    }));
    setAnnotationEdit(null);
  }, []);

  const transcript = useMemo(() => buildTranscript(flow), [flow]);

  // R1 mitigation — warn when stored bubbleRefs don't match any current
  // bubble. The annotation isn't lost (it's still persisted) but the
  // sticky note silently detaches; the warning surfaces the divergence.
  //
  // Visibility honours the Demo-tab Eye/EyeOff toggle from ChatContext:
  // when off, the map is empty so no sticky notes render and the
  // bubble's "Add demo note" affordance stays available for editing
  // (clicking it still opens the editor — operator can re-show after).
  const annotationsByRef = useMemo(() => {
    const map = new Map<string, DemoAnnotation>();
    if (!demoAnnotationsVisible) return map;
    for (const a of demoScript.annotations) map.set(a.bubbleRef, a);
    return map;
  }, [demoScript, demoAnnotationsVisible]);

  const transcriptRefs = useMemo(() => {
    const set = new Set<string>();
    let bubbleIdx = 0;
    for (const item of transcript) {
      if (item.kind === "bubble") {
        set.add(derivePreviewBubbleRef(item, bubbleIdx));
        bubbleIdx += 1;
      }
    }
    return set;
  }, [transcript]);

  const detachedRefs = useMemo(() => {
    return demoScript.annotations
      .filter((a) => !transcriptRefs.has(a.bubbleRef))
      .map((a) => a.bubbleRef);
  }, [demoScript, transcriptRefs]);

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

      {!loading && flow && mode === "educator" && detachedRefs.length > 0 && (
        <div
          className="hf-banner hf-banner-warning"
          data-testid="hf-preview-annotation-detached-warning"
        >
          <AlertCircle size={14} />
          <span>
            {detachedRefs.length} demo annotation
            {detachedRefs.length === 1 ? "" : "s"} no longer matches any bubble
            (session-flow likely reordered). They are still saved but won&apos;t
            render until you re-attach or delete them.
          </span>
        </div>
      )}

      {!loading && flow && mode === "educator" && (
        <>
          <IdentityHeader meta={dryRun?.metadata} courseId={courseId} />
          <EducatorView
            transcript={transcript}
            courseId={courseId}
            onOpenSidetray={openSidetray}
            annotationsByRef={annotationsByRef}
            onOpenAnnotation={openAnnotation}
          />
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

      {annotationEdit && (
        <AnnotationEditSidetray
          courseId={courseId}
          bubbleRef={annotationEdit.bubbleRef}
          existing={annotationEdit.existing}
          onClose={closeAnnotation}
          onSaved={onAnnotationSaved}
          onDeleted={onAnnotationDeleted}
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

/**
 * Strategy A from #1493 R1 — derive a stable per-bubble ref from
 * `lens + caption + side + positional-index`. Cheap; reorders detach the
 * annotation (we warn at load time when a stored bubbleRef does not match
 * any current bubble).
 *
 * Exported so vitests can pin determinism. The slug treatment lowercases
 * + ASCII-collapses non-alphanumeric runs into single `-` so a caption
 * tweak like "Goals question" → "Goals question " does NOT detach the
 * annotation. Truncated to 60 chars to keep DB keys readable.
 */
export function derivePreviewBubbleRef(
  item: { kind: "bubble" } & PreviewBubble,
  positionalIndex: number,
): string {
  const slugCaption = (item.caption ?? item.text ?? "no-caption")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${item.lens}__${item.side}__${slugCaption}__${positionalIndex}`;
}

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
      } else {
        // Slice 3 grey-out epic — socratic mode bubble was previously
        // emitted on Call 1 itself, not in the intake block. Surface a
        // ghost placeholder here so the educator can see the toggle is
        // on and where its delivery lands.
        items.push({
          kind: "bubble", side: "bot", lens: "intake", lensLabel: "Edit Knowledge Check", ghost: true,
          caption: "Knowledge Check — Socratic probe (delivered in Call 1)",
          text: "(2-3 probing questions, scored as confidence signals)",
        });
      }
    } else {
      // Slice 3 grey-out epic — show the OFF state as a muted bubble for
      // visual parity with goals / aboutYou.
      items.push({
        kind: "bubble", side: "bot", lens: "intake", lensLabel: "Enable Knowledge Check", ghost: true,
        caption: "Knowledge Check — OFF",
        text: "(no knowledge probe at sign-up)",
      });
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
    // Slice 3 grey-out epic — render a muted bubble (instead of just a
    // divider) so the educator sees AI Intro Call exists as a configurable
    // surface, even when off. The bubble caption mirrors the Inspector's
    // grey-out chip text when the contract is gatedBy a parent setting.
    items.push({
      kind: "divider",
      label: "AI Intro Call — OFF",
      lens: "intake",
      lensLabel: "Enable AI Intro Call",
    });
    items.push({
      kind: "bubble", side: "bot", lens: "intake", lensLabel: "Enable AI Intro Call", ghost: true,
      caption: "AI Intro Call — OFF",
      text: "(no pre-Call-1 warm-up — learner goes straight into Call 1)",
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
  transcript, courseId, onOpenSidetray, annotationsByRef, onOpenAnnotation,
}: {
  transcript: PreviewItem[];
  courseId: string;
  onOpenSidetray: (lensId: string, lensLabel?: string) => void;
  annotationsByRef: Map<string, DemoAnnotation>;
  onOpenAnnotation: (bubbleRef: string) => void;
}): React.ReactElement {
  if (transcript.length === 0) {
    return <p className="hf-text-muted">Nothing configured yet — see Engineer view for raw compose state.</p>;
  }
  // Sticky-note refs are stamped over BUBBLE items only — positional
  // index is the running count of bubbles seen so far, not the transcript
  // map index (which includes dividers + stop-notes). Pre-compute the
  // mapping so the render loop is reassignment-free.
  const bubblePositionByMapIndex = new Map<number, number>();
  {
    let bubbleIdx = -1;
    transcript.forEach((item, i) => {
      if (item.kind === "bubble") {
        bubbleIdx += 1;
        bubblePositionByMapIndex.set(i, bubbleIdx);
      }
    });
  }
  return (
    <div className="hf-preview-chat">
      {transcript.map((item, i) => {
        if (item.kind === "divider") {
          const inSidetray = item.lens && SIDETRAY_LENS_MAP[item.lens];
          // #1698 — divider also carries the section tag so e.g. the
          // PRE-CALL SURVEY heading pulses when intake is selected.
          const sectionKey = item.lens ? SIDETRAY_LENS_TO_SECTION[item.lens] : undefined;
          if (inSidetray) {
            return (
              <button
                key={i}
                type="button"
                className="hf-preview-divider hf-preview-divider--link"
                aria-label={item.lensLabel || item.label}
                title={item.lensLabel || item.label}
                data-compose-section={sectionKey ?? undefined}
                onClick={() => item.lens && onOpenSidetray(item.lens, item.lensLabel)}
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
                data-compose-section={sectionKey ?? undefined}
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
                onClick={() => onOpenSidetray(item.lens, "Edit Stops")}
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
        const positionalIndex = bubblePositionByMapIndex.get(i) ?? 0;
        const bubbleRef = derivePreviewBubbleRef(item, positionalIndex);
        return (
          <BubbleRow
            key={i}
            bubble={item}
            courseId={courseId}
            onOpenSidetray={onOpenSidetray}
            bubbleRef={bubbleRef}
            annotation={annotationsByRef.get(bubbleRef) ?? null}
            onOpenAnnotation={onOpenAnnotation}
          />
        );
      })}
    </div>
  );
}

function BubbleRow({
  bubble, courseId, onOpenSidetray, bubbleRef, annotation, onOpenAnnotation,
}: {
  bubble: { kind: "bubble" } & PreviewBubble;
  courseId: string;
  onOpenSidetray: (lensId: string, lensLabel?: string) => void;
  bubbleRef: string;
  annotation: DemoAnnotation | null;
  onOpenAnnotation: (bubbleRef: string) => void;
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
  const annotateLabel = annotation
    ? "Edit demo annotation"
    : "Add demo annotation";

  // #1698 — tag the bubble wrap with the ComposeSectionKey so the
  // Journey tab can query the DOM and pulse the matching bubble when
  // the Inspector selects a setting that owns this section.
  const sectionKey = SIDETRAY_LENS_TO_SECTION[bubble.lens];

  return (
    <div
      className={wrapClasses}
      data-bubble-ref={bubbleRef}
      data-compose-section={sectionKey ?? undefined}
    >
      {bubble.caption && (
        <div className="hf-preview-bubble-caption">{bubble.caption}</div>
      )}
      {/* Primary click = edit the lens (the educator's main job).
          Secondary row below carries the demo-note affordance (presenter use). */}
      {inSidetray ? (
        <button
          type="button"
          className={bubbleClasses}
          title={bubble.lensLabel}
          aria-label={bubble.lensLabel}
          onClick={() => onOpenSidetray(bubble.lens, bubble.lensLabel)}
        >
          <span className="hf-preview-bubble-text">{bubble.text}</span>
          <span className="hf-preview-bubble-edit">
            <Edit3 size={11} />
            <span>{bubble.lensLabel}</span>
          </span>
        </button>
      ) : (
        <Link
          href={`/x/courses/${courseId}?tab=design&design_view=${bubble.lens}`}
          className={bubbleClasses}
          title={bubble.lensLabel}
          aria-label={bubble.lensLabel}
        >
          <span className="hf-preview-bubble-text">{bubble.text}</span>
          <span className="hf-preview-bubble-edit">
            <Edit3 size={11} />
            <span>{bubble.lensLabel}</span>
          </span>
        </Link>
      )}
      <div className="hf-preview-bubble-lens-actions">
        <button
          type="button"
          className="hf-preview-bubble-lens-link"
          onClick={() => onOpenAnnotation(bubbleRef)}
          title={annotateLabel}
        >
          <Clapperboard size={11} />
          <span>{annotation ? "Edit demo note" : "Add demo note"}</span>
        </button>
      </div>
      {annotation && (
        <AnnotationStickyNote
          annotation={annotation}
          onClick={() => onOpenAnnotation(bubbleRef)}
        />
      )}
    </div>
  );
}

/**
 * Rendered alongside a Preview bubble when an annotation exists. Click
 * re-opens the annotation editor sidetray pre-filled with current values.
 * `isWowMoment: true` flips the gold-border + star variant.
 */
function AnnotationStickyNote({
  annotation, onClick,
}: {
  annotation: DemoAnnotation;
  onClick: () => void;
}): React.ReactElement {
  const cls = [
    "hf-preview-sticky-note",
    annotation.isWowMoment ? "hf-preview-sticky-note--wow-moment" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={
        annotation.isWowMoment
          ? "Wow moment — edit demo annotation"
          : "Edit demo annotation"
      }
      data-testid={
        annotation.isWowMoment
          ? "hf-preview-sticky-note--wow"
          : "hf-preview-sticky-note"
      }
    >
      {annotation.isWowMoment && (
        <Star
          size={12}
          className="hf-preview-sticky-note-star"
          fill="var(--login-gold)"
        />
      )}
      <span className="hf-preview-sticky-note-text">
        {annotation.presenterNote || (
          <span className="hf-text-muted">(empty note)</span>
        )}
      </span>
      {annotation.durationSecOnStep !== undefined && (
        <span className="hf-preview-sticky-note-duration">
          {annotation.durationSecOnStep}s
        </span>
      )}
    </button>
  );
}

/**
 * Slide-in annotation editor opened from a Preview bubble click (#1493).
 * Distinct from `PreviewEditSidetray` above — that one mounts a
 * `SessionFlowEditor` to tune lens configuration; this one only mutates
 * `Playbook.config.demoScript.annotations[]` and never touches compose
 * inputs.
 */
function AnnotationEditSidetray({
  courseId, bubbleRef, existing, onClose, onSaved, onDeleted,
}: {
  courseId: string;
  bubbleRef: string;
  existing: DemoAnnotation | null;
  onClose: () => void;
  onSaved: (next: DemoAnnotation) => void;
  onDeleted: (bubbleRef: string) => void;
}): React.ReactElement {
  const [presenterNote, setPresenterNote] = useState(existing?.presenterNote ?? "");
  const [isWowMoment, setIsWowMoment] = useState(existing?.isWowMoment ?? false);
  const [duration, setDuration] = useState<string>(
    existing?.durationSecOnStep !== undefined
      ? String(existing.durationSecOnStep)
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useCallback(async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const parsedDuration = duration.trim() === ""
        ? undefined
        : Number.parseInt(duration, 10);
      if (parsedDuration !== undefined && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
        throw new Error("Duration must be a positive whole number of seconds.");
      }
      const res = await fetch(`/api/courses/${courseId}/demo-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bubbleRef,
          presenterNote,
          isWowMoment,
          ...(parsedDuration !== undefined
            ? { durationSecOnStep: parsedDuration }
            : {}),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        annotation?: DemoAnnotation;
        error?: string;
      };
      if (!json.ok || !json.annotation) {
        throw new Error(json.error || "Failed to save annotation");
      }
      onSaved(json.annotation);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [bubbleRef, courseId, duration, isWowMoment, onSaved, presenterNote]);

  const remove = useCallback(async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/courses/${courseId}/demo-script/${encodeURIComponent(bubbleRef)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error || "Failed to delete annotation");
      onDeleted(bubbleRef);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [bubbleRef, courseId, onDeleted]);

  return (
    <>
      <div
        className="hf-preview-annotation-sidetray-backdrop"
        onClick={onClose}
      />
      <aside
        className="hf-preview-annotation-sidetray"
        role="dialog"
        aria-label="Demo annotation editor"
        data-testid="hf-preview-annotation-sidetray"
      >
        <header className="hf-preview-annotation-sidetray-header">
          <h2>
            <Clapperboard size={14} aria-hidden />
            <span>{existing ? "Edit demo annotation" : "Add demo annotation"}</span>
          </h2>
          <button
            type="button"
            className="hf-preview-sidetray-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>
        <div className="hf-preview-annotation-sidetray-body">
          <p className="hf-text-muted hf-preview-annotation-help">
            Demo annotations are operator-only metadata. They never reach the
            learner, never appear in the composed prompt, and never affect
            scoring.
          </p>

          <label className="hf-label" htmlFor="hf-preview-annotation-note">
            Presenter note
          </label>
          <textarea
            id="hf-preview-annotation-note"
            className="hf-input"
            rows={5}
            value={presenterNote}
            onChange={(e) => setPresenterNote(e.target.value)}
            placeholder="What to say while this bubble is on screen…"
            data-testid="hf-preview-annotation-note-input"
          />

          <label className="hf-preview-annotation-toggle">
            <input
              type="checkbox"
              checked={isWowMoment}
              onChange={(e) => setIsWowMoment(e.target.checked)}
              data-testid="hf-preview-annotation-wow-toggle"
            />
            <Star size={14} aria-hidden />
            <span>Mark as wow moment (highlights this step)</span>
          </label>

          <label className="hf-label" htmlFor="hf-preview-annotation-duration">
            Dwell duration (seconds, optional)
          </label>
          <input
            id="hf-preview-annotation-duration"
            type="number"
            inputMode="numeric"
            min={1}
            className="hf-input hf-preview-annotation-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="e.g. 30"
            data-testid="hf-preview-annotation-duration-input"
          />

          {saveError && (
            <div className="hf-banner hf-banner-error">
              <AlertCircle size={14} />
              <span>{saveError}</span>
            </div>
          )}
        </div>
        <footer className="hf-preview-annotation-sidetray-footer">
          {existing && (
            <button
              type="button"
              className="hf-btn hf-btn-destructive"
              onClick={remove}
              disabled={busy}
              data-testid="hf-preview-annotation-delete"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
          <button
            type="button"
            className="hf-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={save}
            disabled={busy}
            data-testid="hf-preview-annotation-save"
          >
            {busy ? "Saving…" : "Save annotation"}
          </button>
        </footer>
      </aside>
    </>
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
