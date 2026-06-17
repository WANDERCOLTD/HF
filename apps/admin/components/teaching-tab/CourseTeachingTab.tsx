"use client";

/**
 * CourseTeachingTab — Track C P1 of the Journey-Design tab refactor (epic #1850).
 *
 * Mounts the tri-pane DesignerShell with the 4 teaching buckets in the
 * LH (C_teaching_style, E_learner_visual, F_stall_recovery, J_feedback).
 *
 * P1 (this PR): the Inspector slot mounts the real `JourneyInspectorPanel`
 * — the same component the Journey tab uses (see
 * `components/journey-tab/CourseJourneyTab.tsx`). The Inspector reads its
 * stack of settings via `getSettingsForBucket(bucketId)`, which is
 * bucket-scoped — clicking a Teaching bucket only ever exposes settings
 * in that bucket. The TeachingLhMenu already filters by
 * `BUCKETS_BY_TAB.teaching`, so the educator can only navigate to buckets
 * intended for this tab. No per-tab Inspector variant needed.
 *
 * Like the Journey tab, the tab seeds a local copy of `playbookConfig` so
 * the Inspector + EditAsJsonButton read freshly-saved state without
 * waiting on a parent route change. After a save, the provider's
 * `onCompoundSaved` callback refetches `/api/playbooks/<id>` and replaces
 * the local snapshot.
 */

import { useCallback, useEffect, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

import { TeachingLhMenu } from "./TeachingLhMenu";

interface CourseTeachingTabProps {
  courseId: string;
  playbookConfig: Record<string, unknown> | null;
}

export function CourseTeachingTab({
  courseId,
  playbookConfig,
}: CourseTeachingTabProps) {
  const [selectedId, setSelectedId] = useState<JourneyMenuBucketId | null>(
    null,
  );
  // Tab-local override of the parent's playbookConfig — mirrors the
  // Journey tab's stale-read cure (CourseJourneyTab.tsx). Seeded from
  // the prop on mount/prop-change; replaced after each save via the
  // provider's `onCompoundSaved` callback below.
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
      // Best-effort — the parent will pick up the new value on next
      // route change. Don't surface the network error; the save itself
      // already succeeded.
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
          <TeachingLhMenu
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
