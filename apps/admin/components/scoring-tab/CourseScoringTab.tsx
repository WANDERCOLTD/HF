"use client";

/**
 * CourseScoringTab — Track C P0 shell of the Journey-Design tab refactor.
 *
 * Mounts the tri-pane DesignerShell with the 2 scoring buckets in the
 * LH (I_scoring, K_between_calls).
 *
 * This is a SHELL — Inspector slot is a placeholder until P1 wires the
 * actual `JourneyInspectorPanel` (or the per-tab variant TBD).
 */

import { useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

import { ScoringLhMenu } from "./ScoringLhMenu";

interface CourseScoringTabProps {
  courseId: string;
  playbookConfig?: Record<string, unknown> | null;
}

export function CourseScoringTab({
  courseId,
  playbookConfig,
}: CourseScoringTabProps) {
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
          <ScoringLhMenu
            courseId={courseId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
        canvas={<PreviewLens courseId={courseId} suppressSidetray />}
        inspector={
          selectedId ? (
            // TODO(P1): replace placeholder with the bucket-aware
            // JourneyInspectorPanel (or a Scoring-tab variant). For
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
