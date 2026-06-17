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
 * Read side (this PR): mounts JourneyField primitives against the
 * selected module's `settings` object — the dedicated
 * `/api/courses/:courseId/modules` route returns each module's full
 * settings sub-tree.
 *
 * Write side (deferred → `TODO(module-mutator)`): the existing journey-
 * setting PATCH route's storage-path applier
 * (`lib/journey/storage-path-applier.ts::applyAtPath`) only handles
 * arrays at the FINAL segment of the path (`sessionFlow.stops[]`). G8
 * settings have a MID-path array (`config.modules[].settings.<key>`)
 * which the applier doesn't traverse correctly today. Wiring a real
 * mutator requires either (a) extending `applyAtPath` to walk mid-path
 * arrays with `selectorValue`, or (b) a dedicated module-scope PATCH
 * route. Both are out of scope for P3 — the read-side visibility win is
 * shippable without it, so the stub mutator surfaces a toast and the
 * follow-on lands the writer.
 *
 * Parallels the CourseTeachingTab → JourneyInspectorPanel relationship,
 * but the per-module data model justifies a separate panel rather than
 * extending JourneyInspectorPanel with a module-scope mode (the
 * mutator-provider context writes to `Playbook.config.*`, not to
 * `Playbook.config.modules[i].settings.*`).
 */

import { JourneyField } from "@/components/journey-controls";
import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import type {
  JourneySettingContract,
  StoragePathStruct,
} from "@/lib/journey/setting-contracts";
import type { AuthoredModuleSettings } from "@/lib/types/json-fields";

interface ModuleInspectorPanelProps {
  selectedModuleId: string | null;
  /** The selected module's label — used in the panel header. */
  selectedModuleLabel?: string | null;
  /** The selected module's G8 settings sub-object (from
   *  `/api/courses/:courseId/modules` → `modules[].settings`).
   *  Undefined or empty → all fields render with default values. */
  settings: Partial<AuthoredModuleSettings> | null;
  /** Fired on a save attempt against a G8 field. P3 hooks this to a
   *  stub that surfaces the "module-mutator pending" message; once
   *  the writer lands, this becomes the real mutator. */
  onSaveAttempt: (
    settingId: string,
    next: unknown,
  ) => Promise<void> | void;
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

export function ModuleInspectorPanel({
  selectedModuleId,
  selectedModuleLabel,
  settings,
  onSaveAttempt,
}: ModuleInspectorPanelProps) {
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

      <div className="hf-banner hf-banner-info" role="status">
        Read-only preview. The module-scope writer ships in a follow-on
        — saves here surface a notice instead of persisting.
      </div>

      <div className="hf-journey-inspector-stack">
        {G8_SETTINGS.map((contract) => {
          const key = lastSegmentOfStoragePath(contract);
          const value = key ? moduleSettings[key] : undefined;
          return (
            <div
              key={contract.id}
              className="hf-journey-inspector-row"
              data-testid={`hf-module-inspector-row-${contract.id}`}
            >
              <JourneyField
                contract={contract}
                value={value}
                options={contract.options}
                onSave={(next) =>
                  Promise.resolve(onSaveAttempt(contract.id, next))
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
