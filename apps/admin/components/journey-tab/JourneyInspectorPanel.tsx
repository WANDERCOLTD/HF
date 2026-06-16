"use client";

/**
 * JourneyInspectorPanel — Phase 4 Slice C of epic #1675 (#1721).
 *
 * Right-hand pane of the Journey tri-pane. Receives a bucketId (NOT a
 * settingId — Slice C changed the LH from 45 settings to 13 buckets).
 * Stacks ALL settings in the bucket, each as a <JourneyField>. Mixed-
 * scope buckets (course + module) render nested sub-groups.
 *
 * The bucket model encodes session-moment intent — clicking
 * "C_teaching_style" exposes 7 settings together because the educator
 * thinking "how does the tutor teach" wants them all in one place.
 */

import { JourneyField } from "@/components/journey-controls";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import {
  getSettingsForBucket,
  splitBucketByScope,
} from "@/lib/journey/bucket-relations";
import { JOURNEY_MENU_ITEMS_BY_ID } from "@/lib/journey/menu-items";
import type {
  JourneyMenuBucketId,
  JourneySettingContract,
} from "@/lib/journey/setting-contracts";

import { CascadeTraceBreadcrumb } from "./CascadeTraceBreadcrumb";
import { EditAsJsonButton } from "./EditAsJsonButton";
import { resolveValueAtPath } from "./resolve-value-at-path";

interface JourneyInspectorPanelProps {
  selectedBucketId: JourneyMenuBucketId | null;
}

function SettingsStack({
  settings,
}: {
  settings: readonly JourneySettingContract[];
}) {
  const ctx = useJourneySetting();
  return (
    <div className="hf-journey-inspector-stack">
      {settings.map((contract) => {
        const value = resolveValueAtPath(
          ctx.playbookConfig ?? null,
          contract.storagePath,
        );
        return (
          <div
            key={contract.id}
            className="hf-journey-inspector-row"
            data-testid={`hf-journey-inspector-row-${contract.id}`}
          >
            <CascadeTraceBreadcrumb contract={contract} />
            <JourneyField
              contract={contract}
              value={value}
              options={contract.options}
              onSave={(next) => ctx.saveSetting(contract.id, next)}
            />
            <div className="hf-journey-inspector-actions">
              <EditAsJsonButton contract={contract} value={value} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function JourneyInspectorPanel({
  selectedBucketId,
}: JourneyInspectorPanelProps) {
  if (!selectedBucketId) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid="hf-journey-inspector-empty"
      >
        Select a bucket from the left menu to edit its settings.
      </div>
    );
  }

  const bucket = JOURNEY_MENU_ITEMS_BY_ID[selectedBucketId];
  if (!bucket) {
    return (
      <div className="hf-journey-inspector-empty">
        Unknown bucket: <code>{selectedBucketId}</code>
      </div>
    );
  }

  const all = getSettingsForBucket(selectedBucketId);
  if (all.length === 0) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid={`hf-journey-inspector-empty-bucket-${selectedBucketId}`}
      >
        <div className="hf-section-title">{bucket.label}</div>
        <p>
          {bucket.emptyReservation
            ? bucket.emptyReservation.note
            : "No settings in this bucket yet."}
        </p>
        {bucket.emptyReservation ? (
          <a
            className="hf-link"
            href="https://github.com/WANDERCOLTD/HF/issues/1700"
            target="_blank"
            rel="noreferrer"
          >
            Track on IELTS epic #1700 (Theme {bucket.emptyReservation.ieltsTheme}) →
          </a>
        ) : null}
      </div>
    );
  }

  const { course, module: moduleScope } = splitBucketByScope(selectedBucketId);
  const hasMixedScope = course.length > 0 && moduleScope.length > 0;

  return (
    <div data-testid={`hf-journey-inspector-bucket-${selectedBucketId}`}>
      <div className="hf-journey-bucket-header">
        <h3 className="hf-section-title">{bucket.label}</h3>
        <p className="hf-section-desc">{bucket.caption}</p>
      </div>

      {hasMixedScope ? (
        <>
          <div
            className="hf-journey-inspector-subgroup"
            data-testid={`hf-journey-subgroup-course-${selectedBucketId}`}
          >
            <div className="hf-category-label">Course defaults</div>
            <SettingsStack settings={course} />
          </div>
          <div
            className="hf-journey-inspector-subgroup"
            data-testid={`hf-journey-subgroup-module-${selectedBucketId}`}
          >
            <div className="hf-category-label">This module</div>
            <SettingsStack settings={moduleScope} />
          </div>
        </>
      ) : (
        <SettingsStack settings={all} />
      )}
    </div>
  );
}
