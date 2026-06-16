"use client";

/**
 * CourseJourneyTab — Phase 4 of epic #1675, extended in Slice C (#1721).
 *
 * The new first tab on the Course Design page. Tri-pane shape:
 *   - LH: 13 buckets grouped under G1..G7 visual section headers
 *   - Canvas: existing `<PreviewLens>` mounted read-only inline + multi-
 *     pulse + pick-strip
 *   - RH: `<JourneyInspectorPanel>` stacks ALL settings in the selected
 *     bucket; mixed-scope buckets split into Course/Module sub-groups
 *
 * Bubble click → derive every bucket touching the section. If 1 →
 * select. If 2+ → select the first chronologically AND render the pick-
 * strip above the canvas so the educator can switch buckets without
 * scrolling the LH.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { ComposeSectionKey } from "@/lib/compose";
import { getBucketsForSection } from "@/lib/journey/bucket-relations";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";

import { CommandPalette } from "./CommandPalette";
import { JourneyInspectorPanel } from "./JourneyInspectorPanel";
import { JourneyLhMenu } from "./JourneyLhMenu";
import { PreviewLocatorHint } from "./PreviewLocatorHint";
import "./journey-tab.css";
import { useBubblePulse } from "./use-bubble-pulse";
import { useJourneySelection } from "./use-journey-selection";

interface CourseJourneyTabProps {
  courseId: string;
  playbookConfig: Record<string, unknown> | null;
}

export function CourseJourneyTab({
  courseId,
  playbookConfig,
}: CourseJourneyTabProps) {
  const selection = useJourneySelection();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickStripSection, setPickStripSection] = useState<ComposeSectionKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);

  // Slice C — multi-pulse over all bucket sections.
  useBubblePulse(canvasRef, selection.bucketId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cmd+K hit → setting id. Find its owning bucket + select. Clear the
  // pick-strip in the same step (palette nav is a fresh user intent).
  const handlePaletteSelect = useCallback(
    (settingId: string) => {
      const owner = JOURNEY_SETTINGS_BY_ID[settingId];
      if (owner?.menuGroupKey) {
        selection.setBucketId(owner.menuGroupKey);
        setPickStripSection(null);
      }
    },
    [selection],
  );

  // LH bucket click — clear pick-strip in the same step.
  const handleLhSelect = useCallback(
    (next: typeof selection.bucketId) => {
      selection.setBucketId(next);
      setPickStripSection(null);
    },
    [selection],
  );

  // Bubble click in PreviewLens → derive bucket(s) → select first
  // chronologically AND set pick-strip when N≥2.
  const handlePreviewSectionSelect = useCallback(
    (section: ComposeSectionKey | null) => {
      if (!section) {
        setPickStripSection(null);
        return;
      }
      const buckets = getBucketsForSection(section);
      if (buckets.length === 0) {
        setPickStripSection(null);
        return;
      }
      // Always select the first chronologically — the strip is for
      // changing the choice, not forcing one.
      selection.setBucketId(buckets[0]);
      setPickStripSection(buckets.length >= 2 ? section : null);
    },
    [selection],
  );

  return (
    <JourneySettingMutatorProvider
      courseId={courseId}
      playbookConfig={playbookConfig}
    >
      <div
        ref={rootRef}
        className="hf-journey-tab"
        data-testid="hf-journey-tab"
      >
        <aside
          className="hf-journey-pane"
          aria-label="Journey navigation"
        >
          <JourneyLhMenu
            selectedBucketId={selection.bucketId}
            onSelectBucket={handleLhSelect}
            filter={selection.filter}
            onFilterChange={selection.setFilter}
          />
        </aside>
        <main ref={canvasRef} className="hf-journey-pane hf-journey-canvas">
          <PreviewLocatorHint
            selectedBucketId={selection.bucketId}
            pickStripSection={pickStripSection}
            onSelectBucket={handleLhSelect}
          />
          <PreviewLens
            courseId={courseId}
            onSelectSection={handlePreviewSectionSelect}
            suppressSidetray
          />
        </main>
        <aside
          className="hf-journey-pane hf-journey-inspector"
          aria-label="Inspector"
        >
          <JourneyInspectorPanel selectedBucketId={selection.bucketId} />
        </aside>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onSelect={handlePaletteSelect}
        />
      </div>
    </JourneySettingMutatorProvider>
  );
}
