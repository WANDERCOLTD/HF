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
 */

import { useCallback, useEffect, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

import { ScoringLhMenu } from "./ScoringLhMenu";

interface CourseScoringTabProps {
  courseId: string;
  playbookConfig: Record<string, unknown> | null;
}

export function CourseScoringTab({
  courseId,
  playbookConfig,
}: CourseScoringTabProps) {
  const [selectedId, setSelectedId] = useState<JourneyMenuBucketId | null>(
    null,
  );
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
            onSelect={setSelectedId}
          />
        }
        canvas={<PreviewLens courseId={courseId} suppressSidetray />}
        inspector={<JourneyInspectorPanel selectedBucketId={selectedId} />}
      />
    </JourneySettingMutatorProvider>
  );
}
