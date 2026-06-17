"use client";

/**
 * ModuleInspectorPanel — Phase P3 of the Course Detail tab refactor (epic #1850).
 *
 * Per-module Inspector for the Modules tab. Mirrors `JourneyInspectorPanel`
 * in shape (filter → stack → JourneyField primitives) but scopes by
 * `selectedModuleId` instead of `selectedBucketId`. The G8 entries
 * (`group === "G8"`, `scope === "module"`) live at
 * `Playbook.config.modules[].settings.*` keyed by `arrayKey: "id"`,
 * NOT on the top-level `Playbook.config` like other Journey settings.
 *
 * Read side: mounts JourneyField primitives against the selected
 * module's `settings` object — the dedicated `/api/courses/:courseId/modules`
 * route returns each module's full settings sub-tree.
 *
 * Write side (P3c, #1850): saves go through the existing
 * `/api/courses/:courseId/journey-setting` PATCH route. P3c extended
 * the route's body to accept an `arraySelector` field — the selector
 * VALUE for contracts whose storagePath has `arrayKey` without a fixed
 * `selectorValue` — and extended `lib/journey/storage-path-applier.ts`
 * to walk mid-path arrays (`config.modules[].settings.<key>`). The
 * Inspector threads `selectedModuleId` through as `arraySelector` so
 * the route resolves the right `modules[]` element.
 *
 * Parallels the CourseTeachingTab → JourneyInspectorPanel relationship,
 * but the per-module data model justifies a separate panel rather than
 * extending JourneyInspectorPanel with a module-scope mode (the
 * mutator-provider context writes to `Playbook.config.*`, not to
 * `Playbook.config.modules[i].settings.*`).
 */

import { useCallback, useMemo } from "react";

import { JourneyField } from "@/components/journey-controls";
import { RelevanceWrapper } from "@/components/journey-controls/RelevanceWrapper";
import { getCourseShape } from "@/lib/journey/course-shape";
import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type {
  CourseShape,
  JourneySettingContract,
  StoragePathStruct,
} from "@/lib/journey/setting-contracts";
import type {
  AuthoredModuleSettings,
  PlaybookConfig,
} from "@/lib/types/json-fields";

interface ModuleInspectorPanelProps {
  /** Course id — passed to the PATCH route URL. */
  courseId: string;
  selectedModuleId: string | null;
  /** The selected module's label — used in the panel header. */
  selectedModuleLabel?: string | null;
  /** The selected module's G8 settings sub-object (from
   *  `/api/courses/:courseId/modules` → `modules[].settings`).
   *  Undefined or empty → all fields render with default values. */
  settings: Partial<AuthoredModuleSettings> | null;
  /** The course's full PlaybookConfig — used by `getCourseShape` to
   *  decide which G8 entries apply to this course shape. Optional so
   *  consumers that haven't threaded it through (yet) keep working;
   *  when omitted the helper short-circuits to "continuous" and the
   *  exam-only entries render as `out-of-shape`. P3d (#1850). */
  playbookConfig?: PlaybookConfig | null;
  /** Optional hook fired after every successful save. Parent uses it
   *  to refetch the module list so the Inspector reflects persisted
   *  state on subsequent renders. */
  onSaved?: () => void;
}

/** Pull the final segment from a G8 storagePath
 *  (`config.modules[].settings.questionTarget` → `"questionTarget"`)
 *  so the read can hit the right key in the module's settings sub-tree. */
function lastSegmentOfStoragePath(contract: JourneySettingContract): string {
  const sp = contract.storagePath;
  const path = typeof sp === "string" ? sp : (sp as StoragePathStruct).path;
  const segments = path.split(".").map((s) => s.replace(/\[\]$/, ""));
  return segments[segments.length - 1] ?? "";
}

/** All G8 entries declared in the registry. Scope-guard avoids leaking
 *  non-module Inspector rows in if the registry ever gains G8 entries
 *  with a different scope. */
const G8_SETTINGS: readonly JourneySettingContract[] = JOURNEY_SETTINGS.filter(
  (c) => c.group === "G8" && c.scope === "module",
);

/** P3d (#1850) — true when the contract declares an `appliesTo` set
 *  that excludes the current `courseShape`. Show-don't-hide: the row
 *  remains in the DOM but is wrapped in `RelevanceWrapper state="out-of-shape"`.
 *  Contracts that don't declare `appliesTo` apply to all shapes. */
function isOutOfShape(
  contract: JourneySettingContract,
  courseShape: CourseShape,
): boolean {
  if (!contract.appliesTo || contract.appliesTo.length === 0) return false;
  return !contract.appliesTo.includes(courseShape);
}

/** Educator-facing explainer chip text for the `out-of-shape` overlay.
 *  Reads the contract's allowed shapes to render "Exam courses use … —
 *  this is a Structured course" rather than a generic "doesn't apply". */
function outOfShapeReason(
  contract: JourneySettingContract,
  courseShape: CourseShape,
): string {
  const allowed = (contract.appliesTo ?? []) as readonly CourseShape[];
  const allowedLabel = allowed.map(shapeLabel).join(" or ");
  const currentLabel = shapeLabel(courseShape);
  return `${allowedLabel} courses use ${contract.educatorLabel.toLowerCase()} — this is a ${currentLabel} course`;
}

/** Short title-cased label for the chip — keeps the message educator-friendly. */
function shapeLabel(shape: CourseShape): string {
  switch (shape) {
    case "structured":
      return "Structured";
    case "continuous":
      return "Continuous";
    case "exam":
      return "Exam";
    default:
      return shape;
  }
}

export function ModuleInspectorPanel({
  courseId,
  selectedModuleId,
  selectedModuleLabel,
  settings,
  playbookConfig,
  onSaved,
}: ModuleInspectorPanelProps) {
  // P3d (#1850) — derive the editor-facing course shape so we can
  // dim G8 entries whose `appliesTo` excludes this course's shape
  // (e.g. IELTS cue-card pool on a non-exam structured course).
  // Memoised because PlaybookConfig is a large object that's stable
  // between renders within a tab session.
  const courseShape: CourseShape = useMemo(
    () => getCourseShape(playbookConfig ?? null),
    [playbookConfig],
  );
  // Module-scope mutator — P3c (#1850). Threads `selectedModuleId`
  // through as the per-call `arraySelector` so the existing
  // `/journey-setting` PATCH route resolves the right
  // `config.modules[]` element. Inline rather than via
  // `useJourneySettingMutator` because that hook's body shape is
  // `{ settingId, value }` only — G8 needs the extra `arraySelector`
  // field, and threading it through the shared hook would change the
  // surface for every Journey/Teaching/Scoring caller.
  const handleSave = useCallback(
    async (settingId: string, value: unknown) => {
      if (!courseId) {
        throw new Error("ModuleInspectorPanel: courseId is required");
      }
      if (!selectedModuleId) {
        throw new Error("ModuleInspectorPanel: selectedModuleId is required");
      }
      const res = await fetch(
        `/api/courses/${courseId}/journey-setting`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            settingId,
            value,
            arraySelector: selectedModuleId,
          }),
        },
      );
      if (!res.ok) {
        type ErrBody = { ok?: boolean; error?: string; code?: string };
        let body: ErrBody | null = null;
        try {
          body = (await res.json()) as ErrBody;
        } catch {
          body = null;
        }
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onSaved?.();
    },
    [courseId, selectedModuleId, onSaved],
  );

  if (!selectedModuleId) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid="hf-module-inspector-empty"
      >
        Select a module from the left to edit its settings.
      </div>
    );
  }

  if (G8_SETTINGS.length === 0) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid="hf-module-inspector-no-settings"
      >
        No module-scoped settings registered yet.
      </div>
    );
  }

  const moduleSettings = (settings ?? {}) as Record<string, unknown>;

  return (
    <div
      data-testid={`hf-module-inspector-${selectedModuleId}`}
    >
      <div className="hf-journey-bucket-header">
        <h3 className="hf-section-title">
          {selectedModuleLabel ?? selectedModuleId}
        </h3>
        <p className="hf-section-desc">
          Module-scoped settings (G8). These keys live on this module
          only — other modules in the same course read their own values.
        </p>
      </div>

      <div className="hf-journey-inspector-stack">
        {G8_SETTINGS.map((contract) => {
          const key = lastSegmentOfStoragePath(contract);
          const value = key ? moduleSettings[key] : undefined;
          const outOfShape = isOutOfShape(contract, courseShape);
          const field = (
            <JourneyField
              contract={contract}
              value={value}
              options={contract.options}
              onSave={(next) => handleSave(contract.id, next)}
            />
          );
          return (
            <div
              key={contract.id}
              className="hf-journey-inspector-row"
              data-testid={`hf-module-inspector-row-${contract.id}`}
              data-relevance-state={outOfShape ? "out-of-shape" : "active"}
            >
              {outOfShape ? (
                <RelevanceWrapper
                  state="out-of-shape"
                  reason={outOfShapeReason(contract, courseShape)}
                >
                  {field}
                </RelevanceWrapper>
              ) : (
                field
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
