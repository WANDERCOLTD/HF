"use client";

/**
 * DesignTab — DesignerShell wiring for the course Design tab.
 *
 * S4 of #1555 shipped this as an unrouted scaffold. #1607 (Epic #1606
 * A.1 firstCallMode renderer) wires it into the live Design tab via
 * `CourseDesignTab.tsx`, and gives the Inspector slot a real first
 * renderer to mount.
 *
 * Responsibilities:
 *   - Own the `DesignerShell` three-slot layout for the live Design tab
 *   - Track section selection via `useDesignerSelection`
 *   - Render a header-banner entry point chip for `firstCallMode` (no
 *     canvas bubble exists for `kind: "config"` sections in PreviewLens
 *     today; this chip is the smoke-test entry point). Click to open the
 *     Inspector; click again to close.
 *   - Resolve per-section `data` for the Inspector renderer. Today: only
 *     `firstCallMode` is wired (from `playbookConfig.firstCallMode`).
 *     Group B (epic #1606 story #13) will add the rest as it migrates
 *     PreviewLens's inline sections into the registry.
 *
 * Side-effect: importing the preview-renderers barrel triggers all
 * `registerPreviewRenderer()` calls at module load, before the Inspector
 * attempts a lookup.
 */

import { createElement, useMemo } from "react";

import {
  DesignerShell,
  getPreviewRenderer,
  useDesignerSelection,
} from "@/components/shared/designer-shell";
import "@/components/shared/preview-renderers";
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

function resolveRendererData(
  selectedKey: ComposeSectionKey,
  pbConfig: PlaybookConfig,
): unknown {
  if (selectedKey === "firstCallMode") {
    return { firstCallMode: pbConfig.firstCallMode };
  }
  return undefined;
}

export function DesignTab({ courseId, playbookConfig }: DesignTabProps) {
  const { selectedKey, setSelectedKey } = useDesignerSelection();
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

  const inspectorNode = useMemo(() => {
    if (!selectedKey) return null;
    const renderer = getPreviewRenderer(selectedKey);
    if (!renderer) return null;
    return createElement(renderer, {
      data: resolveRendererData(selectedKey, pbConfig),
      selection: { selectedKey },
    });
  }, [selectedKey, pbConfig]);

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
        />
      }
      inspector={inspectorNode}
      headerBanner={headerBanner}
    />
  );
}
