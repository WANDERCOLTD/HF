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
 *
 * Slice 4 grey-out epic: when `focusedSettingId` is non-null, the panel
 * scrolls + briefly highlights the row matching that contract id.
 * Triggered by Preview bubble clicks via
 * `useJourneySelection.setBucketId(b, settingId)`.
 */

import { useEffect, useRef } from "react";

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
import { WriteGateLockChip } from "./WriteGateLockChip";
import { resolveValueAtPath } from "./resolve-value-at-path";

interface JourneyInspectorPanelProps {
  selectedBucketId: JourneyMenuBucketId | null;
  /** Slice 4 — when set, scroll + briefly highlight the row for this
   *  setting id. Cleared on next bucket-only click. */
  focusedSettingId?: string | null;
}

function SettingsStack({
  settings,
  focusedSettingId,
}: {
  settings: readonly JourneySettingContract[];
  focusedSettingId?: string | null;
}) {
  const ctx = useJourneySetting();
  return (
    <div className="hf-journey-inspector-stack">
      {settings.map((contract) => {
        const value = resolveValueAtPath(
          ctx.playbookConfig ?? null,
          contract.storagePath,
        );
        const isFocused = focusedSettingId === contract.id;
        return (
          <FocusableRow key={contract.id} isFocused={isFocused} settingId={contract.id}>
            <CascadeTraceBreadcrumb contract={contract} />
            <WriteGateLockChip contract={contract} />
            <JourneyField
              contract={contract}
              value={value}
              options={contract.options}
              onSave={(next) => ctx.saveSetting(contract.id, next)}
            />
            <div className="hf-journey-inspector-actions">
              <EditAsJsonButton contract={contract} value={value} />
            </div>
          </FocusableRow>
        );
      })}
    </div>
  );
}

/** Wrapper that scrolls into view + briefly pulses when isFocused goes true.
 *  Triggered by Preview bubble click → setBucketId(b, settingId). */
function FocusableRow({
  isFocused,
  settingId,
  children,
}: {
  isFocused: boolean;
  settingId: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isFocused) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("hf-journey-inspector-row-focus");
    const timer = window.setTimeout(() => {
      el.classList.remove("hf-journey-inspector-row-focus");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [isFocused]);
  return (
    <div
      ref={ref}
      className="hf-journey-inspector-row"
      data-testid={`hf-journey-inspector-row-${settingId}`}
    >
      {children}
    </div>
  );
}

export function JourneyInspectorPanel({
  selectedBucketId,
  focusedSettingId,
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
            <SettingsStack settings={course} focusedSettingId={focusedSettingId} />
          </div>
          <div
            className="hf-journey-inspector-subgroup"
            data-testid={`hf-journey-subgroup-module-${selectedBucketId}`}
          >
            <div className="hf-category-label">This module</div>
            <SettingsStack settings={moduleScope} focusedSettingId={focusedSettingId} />
          </div>
        </>
      ) : (
        <SettingsStack settings={all} focusedSettingId={focusedSettingId} />
      )}
    </div>
  );
}
