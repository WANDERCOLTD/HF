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
 * No cross-tab hint surface: `BUCKETS_BY_TAB.modules = []`, so no
 * Preview bubble can ever resolve to a Modules-owned bucket. The
 * Modules tab no longer mounts a PreviewLens (PR #2120/#2121 replaced
 * the canvas Preview with the SIM-shell `ModulesPreviewLens`), so the
 * `useCrossTabHint` branch never fired and has been removed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";
import type { PlaybookConfig } from "@/lib/types/json-fields";

import { ModuleEditor, type ModuleEditorRow } from "./ModuleEditor";
import { ModulesLhPicker } from "./ModulesLhPicker";
import { ModulesPreviewLens } from "./PreviewLens";
import "./modules-tab.css";

type ModuleRow = ModuleEditorRow;

interface CourseModulesTabProps {
  courseId: string;
  /** From `PlaybookConfig.lessonPlanMode`. The continuous-course empty
   *  state fires ONLY when BOTH `courseStyle === "continuous"` AND
   *  `playbookConfig.modules.length === 0`. A course can have
   *  `lessonPlanMode` unset (parent-fork casts to `"continuous"`) AND
   *  still carry authored modules in `Playbook.config.modules` —
   *  e.g. IELTS Speaking Practice ships 5 modules with no
   *  `lessonPlanMode` flag. In that case modules-present overrides
   *  the empty state; the operator sees their authored modules. */
  courseStyle?: string;
  /** Full PlaybookConfig — threaded through to ModuleInspectorPanel so
   *  it can derive the editor-facing CourseShape (P3d, #1850). Also
   *  read here to count `config.modules.length` for the empty-state
   *  gate (see `courseStyle` above). Optional; legacy callers without
   *  it fall back to the binary courseStyle and exam-only G8 entries
   *  render as `out-of-shape`. */
  playbookConfig?: Record<string, unknown> | null;
}

export function CourseModulesTab({
  courseId,
  courseStyle,
  playbookConfig,
}: CourseModulesTabProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);

  // P3d (#1850) — cast once at the boundary; ModuleInspectorPanel
  // consumes the typed shape and falls back to "continuous" when null.
  // Hoisted above the continuous-course early return to keep hook order
  // stable across renders (react-hooks/rules-of-hooks). Also drives the
  // `authoredModuleCount` gate that overrides the continuous empty
  // state when the playbook still carries authored modules.
  const typedPlaybookConfig = useMemo<PlaybookConfig | null>(
    () =>
      playbookConfig === null || playbookConfig === undefined
        ? null
        : (playbookConfig as unknown as PlaybookConfig),
    [playbookConfig],
  );

  // When `lessonPlanMode` is unset, the parent-fork casts `courseStyle`
  // to `"continuous"` — but the playbook may still carry authored
  // modules (e.g. IELTS Speaking Practice ships 5 modules with no
  // `lessonPlanMode`). The empty-state should only render when BOTH
  // gates hold: continuous courseStyle AND no authored modules. When
  // modules are present, we still fetch and show them so the operator
  // can tune what they authored.
  const authoredModuleCount = typedPlaybookConfig?.modules?.length ?? 0;
  const showContinuousEmpty =
    courseStyle === "continuous" && authoredModuleCount === 0;

  // Mirror the LH picker fetch so the Inspector can read each module's
  // `settings` sub-object without a second round-trip. The LH picker
  // owns its own fetch (it renders without waiting on the parent), and
  // this one feeds the Inspector — both target the same dedicated
  // /modules route so the cache will collapse them. `reloadKey` bumps
  // after each save so the Inspector reflects persisted state. Skip
  // the fetch only when the empty-state is about to fire (continuous
  // AND zero authored modules) — otherwise authored modules need to
  // hydrate the Inspector regardless of `lessonPlanMode`.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!courseId || showContinuousEmpty) {
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
  }, [courseId, showContinuousEmpty, reloadKey]);

  const handleSaved = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  if (showContinuousEmpty) {
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
  // G8 fields into a 360px sticky panel. The RH pane mounts the
  // ModulesPreviewLens (SIM-shell preview, #2206 U5 of #2185) so the
  // operator can validate per-module behaviour against the learner view.
  return (
    <DesignerShell
      nav={
        <ModulesLhPicker
          courseId={courseId}
          selectedModuleId={selectedModuleId}
          onSelect={setSelectedModuleId}
        />
      }
      // When a module is selected, the LH selection has no impact on the
      // Preview (which is course-wide until the module-scoped variant
      // ships — see TODO below). Same rationale as the cross-cutting
      // dim in the bucket-driven tabs: refocus the operator on the RHS
      // ModuleInspectorPanel.
      canvasClassName={
        selectedModuleId !== null ? "hf-designer-canvas-dim" : undefined
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
        <ModulesPreviewLens
          courseId={courseId}
          selectedModule={selectedModule}
        />
      }
    />
  );
}
