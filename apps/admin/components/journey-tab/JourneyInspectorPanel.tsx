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
import { RelevanceWrapper } from "@/components/journey-controls/RelevanceWrapper";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import { useEffectiveValue } from "@/lib/cascade/use-effective-value";
import {
  getSettingsForBucket,
  splitBucketByScope,
} from "@/lib/journey/bucket-relations";
import { computeRelevanceState } from "@/lib/journey/compute-relevance-state";
import { JOURNEY_MENU_ITEMS_BY_ID } from "@/lib/journey/menu-items";
import {
  PRODUCER_ONLY_DESTINATION_LABEL,
  getProducerOnlyEntry,
} from "@/lib/journey/producer-only-registry";
import { JOURNEY_SETTINGS, JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";
import type {
  JourneyMenuBucketId,
  JourneySettingContract,
} from "@/lib/journey/setting-contracts";

import { CascadeTraceBreadcrumb } from "./CascadeTraceBreadcrumb";
import { ConflictWarningChip } from "./ConflictWarningChip";
import { EditAsJsonButton } from "./EditAsJsonButton";
import { WriteGateLockChip } from "./WriteGateLockChip";
import { resolveValueAtPath } from "./resolve-value-at-path";

interface JourneyInspectorPanelProps {
  selectedBucketId: JourneyMenuBucketId | null;
  /** Slice 4 — when set, scroll + briefly highlight the row for this
   *  setting id. Cleared on next bucket-only click. */
  focusedSettingId?: string | null;
  /** Slice 8 — fires when the educator clicks an Inspector row.
   *  CourseJourneyTab uses this to set `focusedSettingId` (which then
   *  drives the middle-pane bubble pulse), closing the RHS → MIDDLE
   *  cross-pane signal the prior slices already established the other
   *  way around. */
  onRowFocus?: (settingId: string) => void;
  /** Slice 9 — interaction tick. CourseJourneyTab bumps this on every
   *  LH bucket click + Preview bubble click. The bucket-pulse effect
   *  uses it so clicking the same bucket / divider TWICE still gives
   *  visible feedback (instead of the React-skips-effect-on-unchanged
   *  value behaviour). */
  interactionTick?: number;
  /** #2243 — when true, drop `scope: "module"` contracts from the
   *  rendered bucket. The Teaching tab passes this because it has no
   *  `arraySelector` context — without a selected module the array-
   *  keyed read path resolves to null and the array editor renders
   *  "No entries yet" against the operator's eyes. Per-module authoring
   *  is the Modules tab's job; Teaching is a tuner per the
   *  `project_modules_tab_tuner_not_authoring` memory. */
  excludeModuleScope?: boolean;
}

function SettingsStack({
  settings,
  focusedSettingId,
  onRowFocus,
}: {
  settings: readonly JourneySettingContract[];
  focusedSettingId?: string | null;
  onRowFocus?: (settingId: string) => void;
}) {
  return (
    <div className="hf-journey-inspector-stack">
      {settings.map((contract) => (
        <SettingRow
          key={contract.id}
          contract={contract}
          isFocused={focusedSettingId === contract.id}
          onRowFocus={onRowFocus}
        />
      ))}
    </div>
  );
}

/** Single row in the Inspector. Lifts each contract into its own
 *  component so we can call `useEffectiveValue` per row (Slice 11) —
 *  the field's bound value now falls back to the cascade-resolved
 *  effective value when the playbook level is null, so educators see
 *  the inherited Domain/System value instead of an empty input. */
function SettingRow({
  contract,
  isFocused,
  onRowFocus,
}: {
  contract: JourneySettingContract;
  isFocused: boolean;
  onRowFocus?: (settingId: string) => void;
}) {
  const ctx = useJourneySetting();
  const localValue = resolveValueAtPath(
    ctx.playbookConfig ?? null,
    contract.storagePath,
  );
  const knobKey = contract.cascadeKnobKey ?? contract.id;
  const { envelope, unresolvable } = useEffectiveValue<unknown>(
    knobKey,
    { courseId: ctx.courseId },
  );
  // Effective value: prefer the playbook-local value (so an empty
  // explicit override of "" still wins over a Domain cascade); fall
  // back to the cascade envelope when local is null/undefined AND the
  // knob is registered in the cascade resolver; otherwise show empty
  // (the field's own primitive handles the "" → placeholder transition).
  const hasLocal = localValue !== null && localValue !== undefined && localValue !== "";
  const value = hasLocal
    ? localValue
    : (!unresolvable && envelope ? envelope.value : localValue);
  const relevance = computeRelevanceState({
    setting: contract,
    playbookConfig: (ctx.playbookConfig ?? {}) as Parameters<typeof computeRelevanceState>[0]["playbookConfig"],
    courseShape: "structured",
    effectiveValue: { layer: "course", value },
    registry: JOURNEY_SETTINGS,
  });
  const parent = relevance.parentId
    ? JOURNEY_SETTINGS_BY_ID[relevance.parentId]
    : undefined;
  return (
    <FocusableRow
      isFocused={isFocused}
      settingId={contract.id}
      onRowClick={onRowFocus}
    >
      <CascadeTraceBreadcrumb contract={contract} />
      <WriteGateLockChip contract={contract} />
      <ProducerOnlyBadge settingId={contract.id} />
      {/* Story #2105 — non-blocking conflict warning. Mounts above the
       *  RelevanceWrapper so the chip is visible even when the field is
       *  also inherited / auto-derived (the wrapper itself treats
       *  `conflicted` as render-bare to preserve the editable contract). */}
      {relevance.state === "conflicted" && relevance.conflictsWithId ? (
        <ConflictWarningChip
          conflictsWithId={relevance.conflictsWithId}
          resolution={relevance.reason ?? ""}
          peerLabel={relevance.parentLabel}
          onJumpToPeer={onRowFocus}
          ownerSettingId={contract.id}
        />
      ) : null}
      <RelevanceWrapper
        state={relevance.state}
        reason={relevance.reason}
        parentSettingId={relevance.parentId}
        parentSettingLabel={parent?.educatorLabel ?? relevance.parentLabel}
        layerOrigin={relevance.layerOrigin}
        onJumpToParent={
          onRowFocus
            ? (settingId: string) => onRowFocus(settingId)
            : undefined
        }
      >
        <JourneyField
          contract={contract}
          value={value}
          options={contract.options}
          onSave={(next) => ctx.saveSetting(contract.id, next)}
          disabled={relevance.state === "gated-off" || relevance.state === "out-of-shape"}
        />
      </RelevanceWrapper>
      <div className="hf-journey-inspector-actions">
        <EditAsJsonButton contract={contract} value={value} />
      </div>
    </FocusableRow>
  );
}

/** Slice 15 grey-out epic — "🚫 Not yet active" chip rendered above any
 *  Inspector row whose contract id is in `PRODUCER_ONLY_CONTRACTS`. Tells
 *  the educator the value WILL save successfully but no runtime consumer
 *  reads it today. Disappears automatically when the consumer ships
 *  (remove the id from the registry). */
function ProducerOnlyBadge({ settingId }: { settingId: string }) {
  const entry = getProducerOnlyEntry(settingId);
  if (!entry) return null;
  return (
    <div
      className="hf-producer-only-chip"
      data-testid={`hf-producer-only-${settingId}`}
      title={entry.note}
    >
      <span aria-hidden className="hf-producer-only-chip-icon">🚫</span>
      <span className="hf-producer-only-chip-text">
        Not yet active —{" "}
        <span className="hf-producer-only-chip-dest">
          {PRODUCER_ONLY_DESTINATION_LABEL[entry.destinedFor]}
        </span>{" "}
        pending
      </span>
    </div>
  );
}

/** Wrapper that scrolls into view + briefly pulses when isFocused goes true.
 *  Triggered by Preview bubble click → setBucketId(b, settingId). Slice 8
 *  also forwards click events up so the parent can fire the reverse
 *  RHS → MIDDLE pane signal. */
function FocusableRow({
  isFocused,
  settingId,
  onRowClick,
  children,
}: {
  isFocused: boolean;
  settingId: string;
  onRowClick?: (settingId: string) => void;
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
      onMouseDown={onRowClick ? () => onRowClick(settingId) : undefined}
    >
      {children}
    </div>
  );
}

export function JourneyInspectorPanel({
  selectedBucketId,
  focusedSettingId,
  onRowFocus,
  interactionTick,
  excludeModuleScope,
}: JourneyInspectorPanelProps) {
  // Slice 6 grey-out epic — LH bucket click glow. When bucketId changes,
  // accent-pulse the whole Inspector area for ~900ms so the operator
  // sees that the right-hand pane retargeted, mirroring the persistent
  // middle-pane bubble pulse from `useBubblePulse`. Slice 9: also fires
  // on every interactionTick bump so re-clicking the same bucket /
  // divider re-pulses.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedBucketId) return;
    const el = wrapperRef.current;
    if (!el) return;
    el.classList.remove("hf-journey-inspector-bucket-pulse");
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetWidth; // force reflow so the CSS animation restarts
    el.classList.add("hf-journey-inspector-bucket-pulse");
    const timer = window.setTimeout(() => {
      el.classList.remove("hf-journey-inspector-bucket-pulse");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [selectedBucketId, interactionTick]);

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
  // #2243 — when `excludeModuleScope` is true (Teaching tab), drop the
  // module subgroup entirely. Module-scoped contracts use array-keyed
  // storagePaths that need a `selectedModuleId` arraySelector; Teaching
  // tab can't supply one, so the read path resolves to null and the
  // array-editor primitive renders "No entries yet" (the observed bug).
  // Per-module authoring lives in the Modules tab; Teaching is a tuner.
  const visibleAll = excludeModuleScope ? course : all;
  const hasMixedScope =
    !excludeModuleScope && course.length > 0 && moduleScope.length > 0;

  // The visible course-only subset may now be empty even when the bucket
  // has settings — surface the same empty state we use for empty buckets
  // so the operator sees the bucket label and a hint instead of a blank
  // pane.
  if (visibleAll.length === 0) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid={`hf-journey-inspector-module-only-${selectedBucketId}`}
      >
        <div className="hf-section-title">{bucket.label}</div>
        <p>
          Per-module settings for this bucket are edited in the Modules tab.
          Select a module there to edit its settings.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      data-testid={`hf-journey-inspector-bucket-${selectedBucketId}`}
    >
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
            <SettingsStack
              settings={course}
              focusedSettingId={focusedSettingId}
              onRowFocus={onRowFocus}
            />
          </div>
          <div
            className="hf-journey-inspector-subgroup"
            data-testid={`hf-journey-subgroup-module-${selectedBucketId}`}
          >
            <div className="hf-category-label">This module</div>
            <SettingsStack
              settings={moduleScope}
              focusedSettingId={focusedSettingId}
              onRowFocus={onRowFocus}
            />
          </div>
        </>
      ) : (
        <SettingsStack
          settings={visibleAll}
          focusedSettingId={focusedSettingId}
          onRowFocus={onRowFocus}
        />
      )}
    </div>
  );
}
