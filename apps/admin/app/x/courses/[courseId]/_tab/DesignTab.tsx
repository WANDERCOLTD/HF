"use client";

/**
 * DesignTab — DesignerShell wiring for the course Design tab.
 *
 * S4 of #1555 shipped this as an unrouted scaffold. #1607 (Epic #1606
 * A.1 firstCallMode renderer) wired it into the live Design tab via
 * `CourseDesignTab.tsx`, with a header-banner entry-point chip.
 * #1623 (B.13) extends it to thread `onSelectSection` down to
 * `PreviewLens` so the existing chat-bubble click handlers ALSO
 * trigger the Inspector for 5 hand-wired sections (intake / welcome /
 * onboarding / offboarding / nps), and fetches the session-flow data
 * the new section renderers need.
 *
 * Side-effect: importing the preview-renderers barrel triggers all
 * `registerPreviewRenderer()` calls at module load, before the Inspector
 * attempts a lookup.
 */

import { createElement, useCallback, useEffect, useMemo, useState } from "react";

import {
  DesignerShell,
  getPreviewRenderer,
  useDesignerSelection,
} from "@/components/shared/designer-shell";
import "@/components/shared/preview-renderers";
import type { SessionFlowData } from "@/components/shared/preview-renderers";
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

/** Sections whose data comes from the session-flow API (B.13). */
const SESSION_FLOW_SECTIONS = new Set<ComposeSectionKey>([
  "intake",
  "welcome",
  "onboarding",
  "offboarding",
  "nps",
]);

function resolveRendererData(
  selectedKey: ComposeSectionKey,
  pbConfig: PlaybookConfig,
  sessionFlow: SessionFlowData | null,
): unknown {
  if (selectedKey === "firstCallMode") {
    return { firstCallMode: pbConfig.firstCallMode };
  }
  if (SESSION_FLOW_SECTIONS.has(selectedKey)) {
    return { sessionFlow };
  }
  return undefined;
}

export function DesignTab({ courseId, playbookConfig }: DesignTabProps) {
  const { selectedKey, setSelectedKey } = useDesignerSelection();
  const [sessionFlow, setSessionFlow] = useState<SessionFlowData | null>(null);
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

  // Fetch session-flow once on mount — feeds the 5 new B.13 renderers.
  // PreviewLens fetches the same endpoint independently; that duplication
  // is acceptable for V1 and can be deduped via lifted state in a
  // follow-on cleanup.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseId}/session-flow`)
      .then((res) => res.json())
      .then((j: { ok: boolean; sessionFlow?: SessionFlowData }) => {
        if (!cancelled && j.ok && j.sessionFlow) {
          setSessionFlow(j.sessionFlow);
        }
      })
      .catch(() => {
        // Renderer handles the null state gracefully — no need to surface
        // the error in the Inspector slot.
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const inspectorNode = useMemo(() => {
    if (!selectedKey) return null;
    const renderer = getPreviewRenderer(selectedKey);
    if (!renderer) return null;
    return createElement(renderer, {
      data: resolveRendererData(selectedKey, pbConfig, sessionFlow),
      selection: { selectedKey },
    });
  }, [selectedKey, pbConfig, sessionFlow]);

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
