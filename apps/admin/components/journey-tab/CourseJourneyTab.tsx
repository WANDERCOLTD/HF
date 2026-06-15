"use client";

/**
 * CourseJourneyTab — Phase 4 of epic #1675 (story #1697).
 *
 * The new first tab on the Course Design page. Tri-pane shape:
 *   - LH: 7 group accordions + phase filter chips
 *   - Canvas: existing `<PreviewLens>` mounted read-only inline
 *   - RH: `<JourneyInspectorPanel>` mounting the selected setting's
 *         JourneyField primitive
 *
 * Slice A scope: structural mount + selection routing. Bidirectional
 * Preview↔Inspector hover/click sync is Slice B (#TBD). Cmd+K + edit-
 * as-JSON + cascade-trace breadcrumbs land in Phase 5.
 */

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

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

  return (
    <JourneySettingMutatorProvider
      courseId={courseId}
      playbookConfig={playbookConfig}
    >
      <div className="hf-journey-tab" data-testid="hf-journey-tab">
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
          <PreviewLens courseId={courseId} />
        </main>
        <aside
          className="hf-journey-pane hf-journey-inspector"
          aria-label="Inspector"
        >
          <JourneyInspectorPanel selectedSettingId={selection.settingId} />
        </aside>
      </div>
    </JourneySettingMutatorProvider>
  );
}
