"use client";

/**
 * CourseTeachingTab — Track C P0 shell of the Journey-Design tab refactor.
 *
 * Mounts the tri-pane DesignerShell with the 4 teaching buckets in the
 * LH (C_teaching_style, E_learner_visual, F_stall_recovery, J_feedback).
 *
 * This is a SHELL — Inspector slot is a placeholder until P1 wires the
 * actual `JourneyInspectorPanel` (or the per-tab variant TBD). The canvas
 * is the existing `<PreviewLens>` so educators see real prompt content
 * underneath while we iterate on the menus.
 */

import { useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

import { TeachingLhMenu } from "./TeachingLhMenu";

interface CourseTeachingTabProps {
  courseId: string;
  playbookConfig?: Record<string, unknown> | null;
}

export function CourseTeachingTab({
  courseId,
  playbookConfig,
}: CourseTeachingTabProps) {
  const [selectedId, setSelectedId] = useState<JourneyMenuBucketId | null>(
    null,
  );

  return (
    <JourneySettingMutatorProvider
      courseId={courseId}
      playbookConfig={playbookConfig ?? null}
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
        inspector={
          selectedId ? (
            // TODO(P1): replace placeholder with the bucket-aware
            // JourneyInspectorPanel (or a Teaching-tab variant). For
            // now the panel just confirms the selection wired through.
            <div className="hf-card hf-card-compact">
              Inspector slot — wires up post-P0. Selected bucket:{" "}
              <code>{selectedId}</code>.
            </div>
          ) : null
        }
      />
    </JourneySettingMutatorProvider>
  );
}
