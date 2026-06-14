"use client";

/**
 * DesignTab — DesignerShell wiring for the course Design tab.
 *
 * S4 of #1555 shipped this as an unrouted scaffold. #1607 (A.1) wired
 * it into the live Design tab via `CourseDesignTab.tsx`, with a
 * header-banner entry-point chip. #1623 (B.13) threaded
 * `onSelectSection` down to `PreviewLens` so the existing chat-bubble
 * click handlers ALSO trigger the Inspector for the 5 hand-wired
 * sections. #1628 (A.2) added the modePolicy chip. #1634 (A.4 + A.8)
 * closes out the Inspector pattern with the goal-adaptation guidance
 * template and the content-trust freshness renderer. #1643 + #1645
 * (Group A.5) added conversationArtifacts + memoryDeltas chips for
 * caller-scoped composer sections — both fetched from per-course
 * preview routes that sample the most-recent active learner.
 *
 * Side-effect: importing the preview-renderers barrel triggers all
 * `registerPreviewRenderer()` calls at module load, before the
 * Inspector attempts a lookup.
 */

import { createElement, useCallback, useEffect, useMemo, useState } from "react";

import {
  DesignerShell,
  getPreviewRenderer,
  useDesignerSelection,
} from "@/components/shared/designer-shell";
import "@/components/shared/preview-renderers";
import type {
  ConversationArtifactsRendererData,
  FreshnessWarning,
  GoalType,
  MemoryDeltasRendererData,
  SessionFlowData,
} from "@/components/shared/preview-renderers";
import type { ComposeSectionKey } from "@/lib/compose";
import type { PlaybookConfig } from "@/lib/types/json-fields";

import { CourseDesignConsole } from "../_components/CourseDesignConsole";

interface DesignTabProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
}

const FIRST_CALL_MODE_LABEL: Record<
  "onboarding" | "teach_immediately" | "baseline_assessment",
  string
> = {
  onboarding: "Onboarding (default)",
  teach_immediately: "Teach Immediately",
  baseline_assessment: "Baseline Assessment",
};

const SESSION_FLOW_SECTIONS = new Set<ComposeSectionKey>([
  "intake",
  "welcome",
  "onboarding",
  "offboarding",
  "nps",
]);

interface ContentTrustData {
  warnings: FreshnessWarning[];
  sourceCount: number;
}

function resolveRendererData(
  selectedKey: ComposeSectionKey,
  pbConfig: PlaybookConfig,
  sessionFlow: SessionFlowData | null,
  contentTrust: ContentTrustData | null,
  conversationArtifacts: ConversationArtifactsRendererData | null,
  memoryDeltas: MemoryDeltasRendererData | null,
  goalTypesInUse: GoalType[] | undefined,
): unknown {
  if (selectedKey === "firstCallMode") {
    return { firstCallMode: pbConfig.firstCallMode };
  }
  if (selectedKey === "modePolicy") {
    return {
      teachingMode: pbConfig.teachingMode,
      useFreshMastery: (pbConfig as { useFreshMastery?: boolean })
        .useFreshMastery,
      maxMasteryTier: (pbConfig as { maxMasteryTier?: string }).maxMasteryTier,
    };
  }
  if (selectedKey === "instructions") {
    return { goalTypesInUse };
  }
  if (selectedKey === "contentTrust") {
    return contentTrust ?? { warnings: [], sourceCount: 0 };
  }
  if (selectedKey === "conversationArtifacts") {
    return (
      conversationArtifacts ?? {
        loading: true,
        hasArtifacts: false,
        lastCallId: null,
        lastCallAt: null,
        artifacts: [],
      }
    );
  }
  if (selectedKey === "memoryDeltas") {
    return (
      memoryDeltas ?? {
        loading: true,
        hasDeltas: false,
        priorCallId: null,
        priorPriorCallId: null,
        added: [],
        updated: [],
      }
    );
  }
  if (SESSION_FLOW_SECTIONS.has(selectedKey)) {
    return { sessionFlow };
  }
  return undefined;
}

export function DesignTab({ courseId, playbookConfig }: DesignTabProps) {
  const { selectedKey, setSelectedKey } = useDesignerSelection();
  const [sessionFlow, setSessionFlow] = useState<SessionFlowData | null>(null);
  const [contentTrust, setContentTrust] = useState<ContentTrustData | null>(
    null,
  );
  const [conversationArtifacts, setConversationArtifacts] =
    useState<ConversationArtifactsRendererData | null>(null);
  const [memoryDeltas, setMemoryDeltas] =
    useState<MemoryDeltasRendererData | null>(null);
  const pbConfig = useMemo(
    () => (playbookConfig ?? {}) as PlaybookConfig,
    [playbookConfig],
  );
  const firstCallMode = pbConfig.firstCallMode;
  const firstCallModeLabel =
    firstCallMode === undefined
      ? "Onboarding (default — unset)"
      : FIRST_CALL_MODE_LABEL[firstCallMode];
  const firstCallModeSelected = selectedKey === "firstCallMode";
  const teachingMode = pbConfig.teachingMode;
  const modePolicyLabel =
    teachingMode === undefined ? "default" : teachingMode;
  const modePolicySelected = selectedKey === "modePolicy";
  const instructionsSelected = selectedKey === "instructions";
  const contentTrustSelected = selectedKey === "contentTrust";
  const conversationArtifactsSelected = selectedKey === "conversationArtifacts";
  const memoryDeltasSelected = selectedKey === "memoryDeltas";

  // A.4: Goal types currently in use on this course. The playbook config
  // doesn't carry this directly today — read it from session-flow OR
  // skip dimming when unknown. For V1 we surface ALL types at full
  // strength; the dimming logic is wired but inactive until a future
  // story plumbs `goals.types[]` through the API.
  const goalTypesInUse = undefined;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseId}/session-flow`)
      .then((res) => res.json())
      .then((j: { ok: boolean; sessionFlow?: SessionFlowData }) => {
        if (!cancelled && j.ok && j.sessionFlow) {
          setSessionFlow(j.sessionFlow);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // A.8: content-trust freshness. Fires on mount alongside session-flow;
  // the renderer handles the null state.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseId}/content-trust`)
      .then((res) => res.json())
      .then((j: { ok: boolean; warnings: FreshnessWarning[]; sourceCount: number }) => {
        if (!cancelled && j.ok) {
          setContentTrust({
            warnings: j.warnings ?? [],
            sourceCount: j.sourceCount ?? 0,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // #1643 (A.5): conversation-artifacts preview. Caller-scoped data
  // sampled from the course's most-recent active enrollment. The
  // renderer handles loading + null-caller + empty + populated states.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseId}/conversation-artifacts-preview`)
      .then((res) => res.json())
      .then(
        (j: {
          ok: boolean;
          previewCallerName: string | null;
          data: {
            hasArtifacts: boolean;
            lastCallId: string | null;
            lastCallAt: string | null;
            artifacts: ConversationArtifactsRendererData["artifacts"];
          };
        }) => {
          if (!cancelled && j.ok) {
            setConversationArtifacts({
              loading: false,
              previewCallerName: j.previewCallerName,
              hasArtifacts: j.data.hasArtifacts,
              lastCallId: j.data.lastCallId,
              lastCallAt: j.data.lastCallAt,
              totalCount: j.data.artifacts.length,
              artifacts: j.data.artifacts,
            });
          }
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // #1645 (A.5): memory-deltas preview. Caller-scoped data sampled
  // from the course's most-recent active enrollment. Renderer handles
  // loading + null-caller + Call 1 + empty + populated states.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseId}/memory-deltas-preview`)
      .then((res) => res.json())
      .then(
        (j: {
          ok: boolean;
          previewCallerName: string | null;
          data: {
            hasDeltas: boolean;
            priorCallId: string | null;
            priorPriorCallId: string | null;
            added: MemoryDeltasRendererData["added"];
            updated: MemoryDeltasRendererData["updated"];
          };
        }) => {
          if (!cancelled && j.ok) {
            setMemoryDeltas({
              loading: false,
              previewCallerName: j.previewCallerName,
              hasDeltas: j.data.hasDeltas,
              priorCallId: j.data.priorCallId,
              priorPriorCallId: j.data.priorPriorCallId,
              added: j.data.added,
              updated: j.data.updated,
            });
          }
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const inspectorNode = useMemo(() => {
    if (!selectedKey) return null;
    const renderer = getPreviewRenderer(selectedKey);
    if (!renderer) return null;
    return createElement(renderer, {
      data: resolveRendererData(
        selectedKey,
        pbConfig,
        sessionFlow,
        contentTrust,
        conversationArtifacts,
        memoryDeltas,
        goalTypesInUse,
      ),
      selection: { selectedKey },
    });
  }, [
    selectedKey,
    pbConfig,
    sessionFlow,
    contentTrust,
    conversationArtifacts,
    memoryDeltas,
    goalTypesInUse,
  ]);

  const onSelectSection = useCallback(
    (section: ComposeSectionKey | null) => {
      setSelectedKey((prev) => (prev === section ? null : section));
    },
    [setSelectedKey],
  );

  const headerBanner = (
    <div className="hf-chip-row" data-testid="hf-designer-entry-points">
      <button
        type="button"
        className={`hf-chip ${firstCallModeSelected ? "hf-chip-selected" : ""}`}
        aria-pressed={firstCallModeSelected}
        onClick={() =>
          setSelectedKey(firstCallModeSelected ? null : "firstCallMode")
        }
      >
        <span className="hf-category-label">Call 1 mode:</span>{" "}
        {firstCallModeLabel}
      </button>
      <button
        type="button"
        className={`hf-chip ${modePolicySelected ? "hf-chip-selected" : ""}`}
        aria-pressed={modePolicySelected}
        onClick={() =>
          setSelectedKey(modePolicySelected ? null : "modePolicy")
        }
      >
        <span className="hf-category-label">Mode policy:</span>{" "}
        {modePolicyLabel}
      </button>
      <button
        type="button"
        className={`hf-chip ${instructionsSelected ? "hf-chip-selected" : ""}`}
        aria-pressed={instructionsSelected}
        onClick={() =>
          setSelectedKey(instructionsSelected ? null : "instructions")
        }
      >
        <span className="hf-category-label">Guidance template</span>
      </button>
      <button
        type="button"
        className={`hf-chip ${contentTrustSelected ? "hf-chip-selected" : ""}`}
        aria-pressed={contentTrustSelected}
        onClick={() =>
          setSelectedKey(contentTrustSelected ? null : "contentTrust")
        }
      >
        <span className="hf-category-label">Content trust:</span>{" "}
        {contentTrust === null
          ? "loading…"
          : contentTrust.sourceCount === 0
            ? "no sources"
            : contentTrust.warnings.length === 0
              ? "all fresh"
              : `${contentTrust.warnings.length} warning${
                  contentTrust.warnings.length === 1 ? "" : "s"
                }`}
      </button>
      <button
        type="button"
        className={`hf-chip ${conversationArtifactsSelected ? "hf-chip-selected" : ""}`}
        aria-pressed={conversationArtifactsSelected}
        onClick={() =>
          setSelectedKey(
            conversationArtifactsSelected ? null : "conversationArtifacts",
          )
        }
      >
        <span className="hf-category-label">Artifacts:</span>{" "}
        {conversationArtifacts === null
          ? "loading…"
          : conversationArtifacts.previewCallerName === null
            ? "no learners"
            : !conversationArtifacts.hasArtifacts
              ? "none from last call"
              : `${conversationArtifacts.totalCount ?? conversationArtifacts.artifacts.length} from last call`}
      </button>
      <button
        type="button"
        className={`hf-chip ${memoryDeltasSelected ? "hf-chip-selected" : ""}`}
        aria-pressed={memoryDeltasSelected}
        onClick={() =>
          setSelectedKey(memoryDeltasSelected ? null : "memoryDeltas")
        }
      >
        <span className="hf-category-label">Memory deltas:</span>{" "}
        {memoryDeltas === null
          ? "loading…"
          : memoryDeltas.previewCallerName === null
            ? "no learners"
            : !memoryDeltas.hasDeltas
              ? "none since last call"
              : `${memoryDeltas.added.length}+ / ${memoryDeltas.updated.length}↑`}
      </button>
    </div>
  );

  return (
    <DesignerShell
      nav={null}
      canvas={
        <CourseDesignConsole
          courseId={courseId}
          playbookConfig={playbookConfig}
          onSelectSection={onSelectSection}
        />
      }
      inspector={inspectorNode}
      headerBanner={headerBanner}
    />
  );
}
