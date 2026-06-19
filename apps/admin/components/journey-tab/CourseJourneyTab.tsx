"use client";

/**
 * CourseJourneyTab — Phase 4 of epic #1675, extended in Slice C (#1721),
 * pruned in P4 of epic #1850.
 *
 * The new first tab on the Course Design page. Tri-pane shape:
 *   - LH: 7 Journey-owned buckets (filtered against
 *     `BUCKETS_BY_TAB.journey`) grouped under G1..G7 visual section
 *     headers — G4 and G7 collapse to nothing because all their
 *     buckets moved to Teaching / Scoring in P0
 *   - Canvas: existing `<PreviewLens>` mounted read-only inline + multi-
 *     pulse + pick-strip
 *   - RH: `<JourneyInspectorPanel>` stacks ALL settings in the selected
 *     bucket; mixed-scope buckets split into Course/Module sub-groups
 *
 * Bubble click → derive every bucket touching the section. If 1 →
 * select. If 2+ → select the first chronologically AND render the pick-
 * strip above the canvas so the educator can switch buckets without
 * scrolling the LH.
 *
 * Phase P3b (#1850): when the click resolves to a bucket owned by a
 * different Course Detail tab (e.g. operator clicks a Teaching-owned
 * `priorCallFeedback` bubble while on Journey), the Inspector renders
 * a `<CrossTabHintCard>` offering to jump there. With the P4 LH pruning,
 * Teaching / Scoring / Voice buckets are no longer reachable via the LH
 * — the hint card is the only on-tab affordance for those settings.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import { CrossTabHintCard } from "@/components/shared/CrossTabHintCard";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { ComposeSectionKey } from "@/lib/compose";
import {
  BUCKETS_BY_TAB,
  TAB_LABELS,
  type CourseDetailTabId,
} from "@/lib/journey/buckets-by-tab";
import { bucketToTab } from "@/lib/journey/bucket-to-tab";
import { getBucketsForSection } from "@/lib/journey/bucket-relations";
import { JOURNEY_MENU_ITEMS_BY_ID } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";

import { CommandPalette } from "./CommandPalette";
import { JourneyInspectorPanel } from "./JourneyInspectorPanel";
import { JourneyLhMenu } from "./JourneyLhMenu";
import { PreviewLocatorHint } from "./PreviewLocatorHint";
import "./journey-tab.css";
import { useBubblePulse } from "./use-bubble-pulse";
import { useJourneySelection } from "./use-journey-selection";

interface CrossTabHint {
  bucketId: JourneyMenuBucketId;
  bucketLabel: string;
  owningTab: CourseDetailTabId;
  owningTabLabel: string;
}

interface CourseJourneyTabProps {
  courseId: string;
  playbookConfig: Record<string, unknown> | null;
  /** Parent-provided tab switcher (Phase P3b). When set, a cross-tab
   *  hint card's primary button calls this with the owning tab id +
   *  the bucket id so the destination tab can seed its Inspector. */
  onTabSwitch?: (
    tabId: CourseDetailTabId,
    options: { selectedBucket: JourneyMenuBucketId },
  ) => void;
}

const CURRENT_TAB: CourseDetailTabId = "journey";

function isJourneyBucket(b: JourneyMenuBucketId): boolean {
  return BUCKETS_BY_TAB.journey.includes(b);
}

export function CourseJourneyTab({
  courseId,
  playbookConfig,
  onTabSwitch,
}: CourseJourneyTabProps) {
  const selection = useJourneySelection();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickStripSection, setPickStripSection] = useState<ComposeSectionKey | null>(null);
  const [crossTabHint, setCrossTabHint] = useState<CrossTabHint | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  // Tab-local override of the parent's playbookConfig. Seeded from the
  // prop on mount/prop-change; replaced after each save via the
  // `onCompoundSaved` callback below. This is the cure for the
  // stale-read class — without it, the Inspector + "Edit as JSON"
  // modal kept reading from the parent's `detail.config` snapshot
  // that page.tsx only refetched on route change.
  const [localConfig, setLocalConfig] = useState<
    Record<string, unknown> | null
  >(playbookConfig);
  // Slice 2 grey-out epic — monotonic counter bumped on every Inspector
  // save. Passed through to <PreviewLens composeNonce={...}> so the
  // middle pane re-composes automatically when the right-hand Inspector
  // writes. Replaces the manual "Refresh preview" round-trip operators
  // had to do after every toggle.
  const [composeNonce, setComposeNonce] = useState<number>(0);
  useEffect(() => {
    setLocalConfig(playbookConfig);
  }, [playbookConfig]);
  const refetchPlaybookConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/playbooks/${courseId}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok?: boolean;
        playbook?: { config?: Record<string, unknown> | null };
      };
      if (body.ok && body.playbook) {
        setLocalConfig(body.playbook.config ?? null);
      }
    } catch {
      // Refetch is best-effort — the parent will still pick up the new
      // value on the next route change. Don't surface the network error
      // here; the save itself already succeeded.
    }
    // Bump the preview nonce regardless of refetch success — the save
    // already landed on the server, so the preview is now stale even if
    // our local snapshot didn't update.
    setComposeNonce((n) => n + 1);
  }, [courseId]);

  // Slice C — multi-pulse over all bucket sections.
  useBubblePulse(canvasRef, selection.bucketId);

  // Slice 9 grey-out epic — interaction tick counter. Bumped on every
  // bucket / preview click regardless of whether the selection actually
  // changed. JourneyInspectorPanel + the middle-pane bubble pulse listen
  // to this so clicking the same bucket / divider twice still gives
  // visible feedback. Without this, React skips the bucket-change effect
  // when the value is unchanged.
  const [interactionTick, setInteractionTick] = useState<number>(0);
  const bump = useCallback(() => setInteractionTick((n) => n + 1), []);

  // Slice 8 grey-out epic — RHS Inspector row click closes the
  // tri-pane signal: pulse + scroll the matching middle-pane bubble
  // (looked up via `[data-setting-id=<id>]` injected at bubble emit).
  // Also write the selection so the RHS row itself stays highlighted.
  const handleInspectorRowFocus = useCallback(
    (settingId: string) => {
      // Always bump — same row re-click should re-pulse the middle bubble.
      bump();
      if (selection.focusedSettingId === settingId) return;
      // Slice 10 grey-out epic — when the requested setting lives in a
      // DIFFERENT bucket (e.g. RelevanceWrapper's "Enable {parent} first"
      // chip on a gated-off control whose parent owns a different bucket
      // — like intakeAiIntroCall gated by firstCallMode), switch the
      // bucket to the owner so the educator lands on the parent control,
      // not an empty Inspector view.
      const owner = JOURNEY_SETTINGS_BY_ID[settingId];
      const nextBucket = owner?.menuGroupKey ?? selection.bucketId;
      selection.setBucketId(nextBucket, settingId);
    },
    [selection, bump],
  );

  // Pulse + scroll the middle-pane bubble matching the focused setting.
  // Runs on every focusedSettingId change AND every interactionTick bump
  // (so re-clicking the same row still re-pulses). One-shot 1.5s.
  useEffect(() => {
    const settingId = selection.focusedSettingId;
    if (!settingId) return;
    const root = canvasRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-setting-id="${settingId}"]`,
    );
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const offscreen = rect.top < rootRect.top || rect.bottom > rootRect.bottom;
    if (offscreen) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Toggle class via remove → reflow → add so same-id re-click
    // restarts the CSS animation.
    el.classList.remove("hf-preview-bubble-focus");
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetWidth;
    el.classList.add("hf-preview-bubble-focus");
    const timer = window.setTimeout(() => {
      el.classList.remove("hf-preview-bubble-focus");
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [selection.focusedSettingId, interactionTick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cmd+K hit → setting id. Find its owning bucket + select. Clear the
  // pick-strip in the same step (palette nav is a fresh user intent).
  // Voice settings (registered under N_voice via Slice C follow-on) are
  // found in VOICE_SETTINGS_BY_ID — the same bucket select navigates to
  // them within the Journey tab; their Settings-tab home is preserved.
  const handlePaletteSelect = useCallback(
    (settingId: string) => {
      const owner =
        JOURNEY_SETTINGS_BY_ID[settingId] ?? VOICE_SETTINGS_BY_ID[settingId];
      if (owner?.menuGroupKey) {
        selection.setBucketId(owner.menuGroupKey);
        setPickStripSection(null);
        setCrossTabHint(null);
      }
    },
    [selection],
  );

  // LH bucket click — clear pick-strip + hint in the same step.
  const handleLhSelect = useCallback(
    (next: typeof selection.bucketId) => {
      selection.setBucketId(next);
      setPickStripSection(null);
      setCrossTabHint(null);
      bump();
    },
    [selection, bump],
  );

  // Bubble click in PreviewLens → derive bucket(s). If any in-tab →
  // select first chronologically + set pick-strip when N≥2. If NONE
  // in-tab (cross-tab scenario) → surface the hint card for the first
  // bucket chronologically and clear the LH selection.
  const handlePreviewSectionSelect = useCallback(
    (section: ComposeSectionKey | null, settingId?: string) => {
      if (!section) {
        setPickStripSection(null);
        setCrossTabHint(null);
        return;
      }
      const buckets = getBucketsForSection(section);
      if (buckets.length === 0) {
        setPickStripSection(null);
        setCrossTabHint(null);
        return;
      }
      const inTab = buckets.filter(isJourneyBucket);
      if (inTab.length > 0) {
        // Slice 4 grey-out epic — when the bubble unambiguously maps to a
        // specific contract id, pass it as the second arg so the
        // Inspector can scroll+highlight that row. Bucket clicks without
        // a setting id stay on the bucket-level focus path.
        selection.setBucketId(inTab[0], settingId ?? null);
        setPickStripSection(inTab.length >= 2 ? section : null);
        setCrossTabHint(null);
        bump();
        return;
      }
      // Cross-tab: pick the first bucket chronologically and offer to
      // jump to its owning tab.
      const owner = buckets[0];
      const owningTab = bucketToTab(owner);
      if (!owningTab) {
        setPickStripSection(null);
        setCrossTabHint(null);
        return;
      }
      const meta = JOURNEY_MENU_ITEMS_BY_ID[owner];
      setPickStripSection(null);
      setCrossTabHint({
        bucketId: owner,
        bucketLabel: meta?.label ?? owner,
        owningTab,
        owningTabLabel: TAB_LABELS[owningTab],
      });
    },
    [selection],
  );

  const handleJump = useCallback(() => {
    if (!crossTabHint) return;
    onTabSwitch?.(crossTabHint.owningTab, {
      selectedBucket: crossTabHint.bucketId,
    });
    setCrossTabHint(null);
  }, [crossTabHint, onTabSwitch]);

  return (
    <JourneySettingMutatorProvider
      courseId={courseId}
      playbookConfig={localConfig}
      onCompoundSaved={refetchPlaybookConfig}
    >
      <div
        ref={rootRef}
        className="hf-journey-tab"
        data-testid="hf-journey-tab"
      >
        <aside
          className="hf-journey-pane"
          aria-label="Journey navigation"
        >
          <JourneyLhMenu
            selectedBucketId={selection.bucketId}
            onSelectBucket={handleLhSelect}
            filters={selection.filters}
            onToggleFilter={selection.toggleFilter}
          />
        </aside>
        <main ref={canvasRef} className="hf-journey-pane hf-journey-canvas">
          <PreviewLocatorHint
            selectedBucketId={selection.bucketId}
            pickStripSection={pickStripSection}
            onSelectBucket={handleLhSelect}
          />
          <PreviewLens
            courseId={courseId}
            onSelectSection={handlePreviewSectionSelect}
            composeNonce={composeNonce}
            suppressSidetray
          />
        </main>
        <aside
          className="hf-journey-pane hf-journey-inspector"
          aria-label="Inspector"
        >
          {/* Mark CURRENT_TAB usage explicit for future tab-aware checks */}
          {CURRENT_TAB && crossTabHint ? (
            <CrossTabHintCard
              bucketLabel={crossTabHint.bucketLabel}
              owningTabLabel={crossTabHint.owningTabLabel}
              onJump={handleJump}
            />
          ) : (
            <JourneyInspectorPanel
              selectedBucketId={selection.bucketId}
              focusedSettingId={selection.focusedSettingId}
              onRowFocus={handleInspectorRowFocus}
              interactionTick={interactionTick}
            />
          )}
        </aside>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onSelect={handlePaletteSelect}
        />
      </div>
    </JourneySettingMutatorProvider>
  );
}
