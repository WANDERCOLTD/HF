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
 * template and the content-trust freshness renderer.
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
  FreshnessWarning,
  GoalType,
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
        goalTypesInUse,
      ),
      selection: { selectedKey },
    });
  }, [selectedKey, pbConfig, sessionFlow, contentTrust, goalTypesInUse]);

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
