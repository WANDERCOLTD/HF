"use client";

/**
 * CourseJourneyTab — Phase 4 + Phase 5 of epic #1675.
 *
 * The new first tab on the Course Design page. Tri-pane shape:
 *   - LH: 7 group accordions + phase filter chips
 *   - Canvas: existing `<PreviewLens>` mounted read-only inline
 *   - RH: `<JourneyInspectorPanel>` mounting the selected setting's
 *         JourneyField primitive + cascade trace + Edit-as-JSON
 *
 * Cmd+K opens the CommandPalette (Phase 5). Listener is scoped to the
 * tab root via `keydown` capture; Phase 5 Slice B will hoist it to
 * page-level for cross-tab activation.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { ComposeSectionKey } from "@/lib/compose";
import { getSettingsForSection } from "@/lib/journey/section-staleness-bridge";

import { CommandPalette } from "./CommandPalette";
import { JourneyInspectorPanel } from "./JourneyInspectorPanel";
import { JourneyLhMenu } from "./JourneyLhMenu";
import "./journey-tab.css";
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Cmd+K (mac) / Ctrl+K (win/linux) opens the palette. Scoped to
  // window since the palette is a modal overlay; Phase 5 Slice B will
  // make this an explicit per-tab listener.
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

  const handlePaletteSelect = useCallback(
    (id: string) => selection.setSettingId(id),
    [selection],
  );

  // Bubble click in PreviewLens → mount the first matching setting in
  // the Inspector pane. Replaces the legacy click-to-edit sidetray
  // (which we also suppress on PreviewLens below) so the educator
  // never sees two overlapping editors.
  const handlePreviewSectionSelect = useCallback(
    (section: ComposeSectionKey | null) => {
      if (!section) {
        selection.setSettingId(null);
        return;
      }
      const settings = getSettingsForSection(section);
      const first = settings[0];
      if (first) selection.setSettingId(first.id);
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
            selectedSettingId={selection.settingId}
            onSelectSetting={selection.setSettingId}
            filter={selection.filter}
            onFilterChange={selection.setFilter}
          />
        </aside>
        <main className="hf-journey-pane hf-journey-canvas">
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
          <JourneyInspectorPanel selectedSettingId={selection.settingId} />
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
