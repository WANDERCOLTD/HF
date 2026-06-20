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
 *
 * P3b (#1850 cross-tab hints): the Modules tab has zero entries in
 * `BUCKETS_BY_TAB.modules` — every Preview bubble click resolves to a
 * bucket owned by another tab. The Inspector renders a
 * `<CrossTabHintCard>` in place of the per-module panel whenever the
 * hint state is set; clearing the hint (jumping or selecting a module)
 * restores the per-module Inspector.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { CrossTabHintCard } from "@/components/shared/CrossTabHintCard";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { CourseDetailTabId } from "@/lib/journey/buckets-by-tab";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";
import { useCrossTabHint } from "@/lib/journey/use-cross-tab-hint";
import type { PlaybookConfig } from "@/lib/types/json-fields";

import { ModuleEditor, type ModuleEditorRow } from "./ModuleEditor";
import { ModulesLhPicker } from "./ModulesLhPicker";
import "./modules-tab.css";

type ModuleRow = ModuleEditorRow;

interface CourseModulesTabProps {
  courseId: string;
  /** From `PlaybookConfig.lessonPlanMode`. `"continuous"` (or missing) →
   *  modules don't apply; we show the empty state instead of the picker. */
  courseStyle?: string;
  /** Parent-provided tab switcher. Phase P3b. */
  onTabSwitch?: (
    tabId: CourseDetailTabId,
    options: { selectedBucket: JourneyMenuBucketId },
  ) => void;
  /** Full PlaybookConfig — threaded through to ModuleInspectorPanel so
   *  it can derive the editor-facing CourseShape (P3d, #1850). Optional;
   *  legacy callers without it fall back to the binary courseStyle and
   *  exam-only G8 entries render as `out-of-shape`. */
  playbookConfig?: Record<string, unknown> | null;
}

export function CourseModulesTab({
  courseId,
  courseStyle,
  onTabSwitch,
  playbookConfig,
}: CourseModulesTabProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const { crossTabHint, jumpToOwningTab } =
    useCrossTabHint({
      currentTab: "modules",
      selectedBucketParam: null, // modules tab doesn't seed from URL
      onTabSwitch: onTabSwitch ?? (() => {}),
    });

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

  // P3d (#1850) — cast once at the boundary; ModuleInspectorPanel
  // consumes the typed shape and falls back to "continuous" when null.
  // Hoisted above the continuous-course early return to keep hook order
  // stable across renders (react-hooks/rules-of-hooks).
  const typedPlaybookConfig = useMemo<PlaybookConfig | null>(
    () =>
      playbookConfig === null || playbookConfig === undefined
        ? null
        : (playbookConfig as unknown as PlaybookConfig),
    [playbookConfig],
  );

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

  // Bi-pane shape: LH module picker + canvas as the editor. The Inspector
  // column from the prior tri-pane is folded into the canvas as the HOW
  // card so the operator works in one wide column rather than squeezing
  // G8 fields into a 360px sticky panel. The Preview pane is removed
  // because the Modules tab tunes per-module behaviour — the course-wide
  // Preview never reflected the LH selection. Cross-tab hints retain the
  // RH Inspector slot when a Preview-lens bubble click in a sibling tab
  // surfaces here.
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
        <ModuleEditor
          courseId={courseId}
          selectedModuleId={selectedModuleId}
          selectedModule={selectedModule}
          playbookConfig={typedPlaybookConfig}
          onSaved={handleSaved}
        />
      }
      inspector={
        crossTabHint ? (
          <CrossTabHintCard
            bucketLabel={crossTabHint.bucketLabel}
            owningTabLabel={crossTabHint.owningTabLabel}
            onJump={jumpToOwningTab}
          />
        ) : null
      }
    />
  );
}
