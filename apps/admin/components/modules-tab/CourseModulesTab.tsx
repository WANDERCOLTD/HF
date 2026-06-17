"use client";

/**
 * CourseModulesTab — Track C P3 of the Journey-Design tab refactor (epic #1850).
 *
 * Modules-tab does NOT use bucket-filtered nav like Teaching / Scoring /
 * Journey — its scope is per-AuthoredModule (G8). The LH is a module
 * picker; the Inspector hosts module-scoped settings.
 *
 * P3 wires the real per-module Inspector (`ModuleInspectorPanel`) and
 * the dedicated `/api/courses/:courseId/modules` route. P3c (#1850)
 * lit up the write side — the Inspector PATCHes through the shared
 * `/api/courses/:courseId/journey-setting` route with `arraySelector:
 * selectedModuleId` so the storage-path applier resolves the right
 * `config.modules[]` element. Saves refresh the local module list so
 * the Inspector reflects persisted state on subsequent renders.
 *
 * Continuous-course empty state: continuous courses have no authored
 * modules — they pull from a topic pool. We render an explanation
 * rather than an empty picker.
 */

import { useCallback, useEffect, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { AuthoredModuleSettings } from "@/lib/types/json-fields";

import { ModuleInspectorPanel } from "./ModuleInspectorPanel";
import { ModulesLhPicker } from "./ModulesLhPicker";

interface ModuleRow {
  id: string;
  label: string;
  settings?: Partial<AuthoredModuleSettings>;
}

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
  const [modules, setModules] = useState<ModuleRow[]>([]);

  // Mirror the LH picker fetch so the Inspector can read each module's
  // `settings` sub-object without a second round-trip. The LH picker
  // owns its own fetch (it renders without waiting on the parent), and
  // this one feeds the Inspector — both target the same dedicated
  // /modules route so the cache will collapse them. `reloadKey` bumps
  // after each save so the Inspector reflects persisted state.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!courseId || courseStyle === "continuous") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset list on course/style change, matches sibling ModulesLhPicker pattern
      setModules([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/courses/${courseId}/modules`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.modules)) {
          setModules(data.modules as ModuleRow[]);
        } else {
          setModules([]);
        }
      })
      .catch(() => {
        if (!cancelled) setModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, courseStyle, reloadKey]);

  const handleSaved = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

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

  const selectedModule =
    selectedModuleId !== null
      ? (modules.find((m) => m.id === selectedModuleId) ?? null)
      : null;

  return (
    <DesignerShell
      nav={
        <ModulesLhPicker
          courseId={courseId}
          selectedModuleId={selectedModuleId}
          onSelect={setSelectedModuleId}
        />
      }
      canvas={
        <>
          {/* TODO(preview-scope): extend PreviewLens to accept ?moduleId
              scope so the canvas previews the module-scoped lesson when
              one is selected. P3 ships the course-wide preview only. */}
          {selectedModuleId ? (
            <div className="hf-banner hf-banner-info" role="status">
              Showing course-wide preview. Module-scoped preview lands in
              a follow-on.
            </div>
          ) : null}
          <PreviewLens courseId={courseId} suppressSidetray />
        </>
      }
      inspector={
        <ModuleInspectorPanel
          courseId={courseId}
          selectedModuleId={selectedModuleId}
          selectedModuleLabel={selectedModule?.label ?? null}
          settings={selectedModule?.settings ?? null}
          onSaved={handleSaved}
        />
      }
    />
  );
}
