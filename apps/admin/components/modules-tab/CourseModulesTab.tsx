"use client";

/**
 * CourseModulesTab — Track C P0 shell of the Journey-Design tab refactor.
 *
 * Modules-tab does NOT use bucket-filtered nav like Teaching / Scoring /
 * Journey — its scope is per-AuthoredModule (G8). The LH is a module
 * picker; the Inspector eventually hosts module-scoped settings.
 *
 * Continuous-course empty state: continuous courses have no authored
 * modules — they pull from a topic pool. We render an explanation
 * rather than an empty picker.
 */

import { useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";

import { ModulesLhPicker } from "./ModulesLhPicker";

interface CourseModulesTabProps {
  courseId: string;
  /** From `PlaybookConfig.lessonPlanMode`. `"continuous"` (or missing) →
   *  modules don't apply; we show the empty state instead of the picker. */
  courseStyle?: string;
}

export function CourseModulesTab({
  courseId,
  courseStyle,
}: CourseModulesTabProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  if (courseStyle === "continuous") {
    return (
      <div className="hf-empty">
        <h2 className="hf-section-title">No modules</h2>
        <p className="hf-section-desc">
          Continuous courses don&apos;t have authored modules. Modules are how
          structured courses organise content; continuous courses pull from a
          topic pool instead.{" "}
          <a href="/x/help/glossary#course-style" className="hf-link">
            Learn more
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <DesignerShell
      nav={
        <ModulesLhPicker
          courseId={courseId}
          selectedModuleId={selectedModuleId}
          onSelect={setSelectedModuleId}
        />
      }
      // TODO(preview-scope): extend PreviewLens to accept ?moduleId scope
      // so the canvas can preview the module-scoped lesson when one is
      // selected. For now we render the course-wide preview.
      canvas={<PreviewLens courseId={courseId} suppressSidetray />}
      inspector={
        selectedModuleId ? (
          // TODO(P1): replace placeholder with the per-module settings
          // editor (G8 module-scoped knobs — cue cards, prep timers,
          // completion gates).
          <div className="hf-card hf-card-compact">
            Module settings inspector — wires up post-P0. Selected module:{" "}
            <code>{selectedModuleId}</code>.
          </div>
        ) : null
      }
    />
  );
}
