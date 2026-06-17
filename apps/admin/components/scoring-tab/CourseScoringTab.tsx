"use client";

/**
 * CourseScoringTab — Track C P1 of the Journey-Design tab refactor (epic #1850).
 *
 * Mounts the tri-pane DesignerShell with the 2 scoring buckets in the
 * LH (I_scoring, K_between_calls).
 *
 * P1 (this PR): the Inspector slot mounts the real `JourneyInspectorPanel`
 * — same component the Journey + Teaching tabs use. The ScoringLhMenu
 * already filters by `BUCKETS_BY_TAB.scoring`, so the educator can only
 * navigate to buckets intended for this tab; the Inspector then renders
 * the bucket's settings via `getSettingsForBucket(bucketId)`. Mirror of
 * `CourseTeachingTab.tsx`.
 *
 * P3b (#1850 cross-tab hints): when a Preview-lens bubble click maps to
 * a bucket owned by a different tab, the Inspector renders a
 * `<CrossTabHintCard>` instead of staying empty. Wired via
 * `useCrossTabHint` + the `onTabSwitch` parent callback.
 */

import { useCallback, useEffect, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { CrossTabHintCard } from "@/components/shared/CrossTabHintCard";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { CourseDetailTabId } from "@/lib/journey/buckets-by-tab";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";
import { useCrossTabHint } from "@/lib/journey/use-cross-tab-hint";

import { ScoringLhMenu } from "./ScoringLhMenu";

interface CourseScoringTabProps {
  courseId: string;
  playbookConfig: Record<string, unknown> | null;
  /** Parent-provided tab switcher. Phase P3b — invoked by the
   *  cross-tab hint card's primary button. Optional for backwards
   *  compatibility; when omitted the hint card renders without a
   *  jump button. */
  onTabSwitch?: (
    tabId: CourseDetailTabId,
    options: { selectedBucket: JourneyMenuBucketId },
  ) => void;
  /** URL `?selectedBucket=` param. When present and in scope, seeds
   *  the Inspector selection on mount. */
  selectedBucketParam?: string | null;
}

export function CourseScoringTab({
  courseId,
  playbookConfig,
  onTabSwitch,
  selectedBucketParam = null,
}: CourseScoringTabProps) {
  const {
    selectedId,
    setSelectedId,
    crossTabHint,
    handlePreviewSelect,
    jumpToOwningTab,
  } = useCrossTabHint({
    currentTab: "scoring",
    selectedBucketParam,
    onTabSwitch:
      onTabSwitch ??
      // No parent wiring — degrade to no-op; the card still renders
      // but the jump button is inert. Pre-P3b sites preserve behaviour.
      (() => {}),
  });
  // Tab-local override of the parent's playbookConfig — mirrors the
  // Journey + Teaching tabs' stale-read cure. Refetched after each save
  // via the provider's `onCompoundSaved` callback.
  const [localConfig, setLocalConfig] = useState<
    Record<string, unknown> | null
  >(playbookConfig);
  useEffect(() => {
    setLocalConfig(playbookConfig);
  }, [playbookConfig]);
  const refetchPlaybookConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/playbooks/${courseId}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok?: boolean;
        playbook?: { config?: Record<string, unknown> | null };
      };
      if (body.ok && body.playbook) {
        setLocalConfig(body.playbook.config ?? null);
      }
    } catch {
      // Best-effort — see CourseTeachingTab.tsx for the rationale.
    }
  }, [courseId]);

  const handleLhSelect = useCallback(
    (next: JourneyMenuBucketId | null) => {
      setSelectedId(next);
    },
    [setSelectedId],
  );

  return (
    <JourneySettingMutatorProvider
      courseId={courseId}
      playbookConfig={localConfig}
      onCompoundSaved={refetchPlaybookConfig}
    >
      <DesignerShell
        nav={
          <ScoringLhMenu
            courseId={courseId}
            selectedId={selectedId}
            onSelect={handleLhSelect}
          />
        }
        canvas={
          <PreviewLens
            courseId={courseId}
            onSelectSection={handlePreviewSelect}
            suppressSidetray
          />
        }
        inspector={
          crossTabHint ? (
            <CrossTabHintCard
              bucketLabel={crossTabHint.bucketLabel}
              owningTabLabel={crossTabHint.owningTabLabel}
              onJump={jumpToOwningTab}
            />
          ) : (
            <JourneyInspectorPanel selectedBucketId={selectedId} />
          )
        }
      />
    </JourneySettingMutatorProvider>
  );
}
