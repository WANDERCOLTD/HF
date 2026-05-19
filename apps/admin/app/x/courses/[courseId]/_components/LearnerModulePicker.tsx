"use client";

/**
 * LearnerModulePicker — read-only render of the learner-facing module picker.
 *
 * Adapts layout based on `lessonPlanMode`:
 *   - "continuous" (or unknown) → free tile grid
 *   - "structured"             → sequenced rail
 *
 * Per the v2.2 IELTS spec ("tutor advises but never gates") and Issue #236:
 *   - Prerequisites are surfaced as advisory hints, never as gates
 *   - Session-terminal modules show an "Ends session" badge
 *   - Voice band-readout shown only when true (Mock pattern)
 *   - Learner-selectable=false modules are hidden from the picker
 *
 * Mounted today as a *preview* inside the Authored Modules admin panel
 * (PR4 of #236) so educators can see what learners will see. Reused later
 * when wired into the learner portal — same component, same data.
 */

import { useCallback, useMemo, useState } from "react";
import {
  GraduationCap,
  Mic,
  Pencil,
  Layers,
  CircleDot,
  CircleDashed,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  Circle,
  Sparkles,
  Lock,
} from "lucide-react";
import type { AuthoredModule } from "@/lib/types/json-fields";
import {
  PrereqsSoftWarningModal,
  type UnmetPrereq,
} from "./PrereqsSoftWarningModal";
import { PrereqsHardLockModal } from "./PrereqsHardLockModal";

export type PickerLayout = "tiles" | "rail";

interface LearnerModulePickerProps {
  modules: AuthoredModule[];
  /** "continuous" → tiles, "structured" → rail. Null defaults to tiles. */
  lessonPlanMode: "structured" | "continuous" | null;
  /**
   * If supplied, these IDs are treated as completed. Tiles for `frequency: once`
   * modules in this set are hidden; tiles for repeatable modules surface in
   * the "Completed" section. Rail cards get a "Done" badge.
   */
  completedModuleIds?: string[];
  /**
   * If supplied, these IDs are treated as in-progress. Tiles in this set
   * surface in the "In progress" section; rail cards get an "In progress"
   * pill alongside the existing "Done" badge. Empty/omitted with no
   * completed data = no progress sections (single ungrouped grid).
   */
  inProgressModuleIds?: string[];
  /**
   * If supplied, the picker calls this on tile/row activation. When omitted
   * (preview mode), tiles render as `<div>` rather than `<button>` and the
   * "Start" affordance is hidden.
   */
  onSelect?: (moduleId: string) => void;
  /**
   * #495 Slice 4.3 — id of the single module the system recommends the
   * learner attempt next. Source of truth is the import-modules endpoint
   * (top-level `recommendedModuleId`). When set, the matching tile/rail
   * card renders a prominent "Recommended next" badge in its top-LEFT
   * corner (the per-module status badge remains in the top-RIGHT). The
   * recommendation is advisory only — every learner-selectable module
   * stays clickable. Null / undefined hides the badge entirely.
   */
  recommendedModuleId?: string | null;
  /**
   * #495 Slice 4.3 — human-readable reason from `recommendNextModule()`:
   * "next-in-sequence" | "weakest-not-mastered" | "first-unstarted" |
   * "interleave-review". Surfaced as the badge's tooltip via `title=`.
   */
  recommendedReason?: string | null;
  /**
   * #495 Slice 4.5/4.6 — when `false` (default), clicking a module whose
   * prereqs aren't all MASTERED triggers a soft-warning modal before the
   * picker calls `onSelect` (Slice 4.5). When `true`, the picker hard-
   * locks the tile: clicking opens a dismiss-only modal that points the
   * learner at the unmet prereqs, and the tile itself renders a quiet
   * lock badge + desaturate so it's obvious the click did something
   * (Slice 4.6). The recommended-next badge is suppressed for any
   * locked tile so the two affordances never contradict each other.
   *
   * Source of truth is the import-modules endpoint's top-level
   * `strictPrerequisites` field (mirrors
   * `Playbook.config.strictPrerequisites` via `readCourseFlags`).
   */
  strictPrerequisites?: boolean;
}

export function LearnerModulePicker({
  modules,
  lessonPlanMode,
  completedModuleIds = [],
  inProgressModuleIds = [],
  onSelect,
  recommendedModuleId = null,
  recommendedReason = null,
  strictPrerequisites = false,
}: LearnerModulePickerProps) {
  // #495 Slice 4.5 — pending pick whose prereqs aren't all mastered. When
  // set, the soft-warning modal renders; "Continue anyway" forwards to
  // the parent's `onSelect`, "Cancel" / Escape / backdrop click drops it.
  const [pendingSoftWarn, setPendingSoftWarn] = useState<{
    module: AuthoredModule;
    unmetPrereqs: UnmetPrereq[];
  } | null>(null);

  // #495 Slice 4.6 — pending pick blocked by hard-lock (strict mode +
  // unmet prereqs). The hard-lock modal renders with a single dismiss
  // button; onSelect is never forwarded.
  const [pendingHardLock, setPendingHardLock] = useState<{
    module: AuthoredModule;
    unmetPrereqs: UnmetPrereq[];
  } | null>(null);

  // Index modules by id so we can resolve unmet prereq slugs → friendly
  // titles for the modal's bulleted list without prop-drilling.
  const modulesById = useMemo(() => {
    const map = new Map<string, AuthoredModule>();
    for (const m of modules) map.set(m.id, m);
    return map;
  }, [modules]);

  const completed = useMemo(() => new Set(completedModuleIds), [completedModuleIds]);
  const inProgress = useMemo(() => new Set(inProgressModuleIds), [inProgressModuleIds]);

  // Pre-compute the set of locked module ids — modules whose prereqs
  // aren't all MASTERED while the course runs in strict mode. Drives
  // the tile-level lock badge + desaturate (Slice 4.6) AND suppresses
  // the recommended-next badge on the same tile so the two affordances
  // never contradict each other. Empty set when `strictPrerequisites`
  // is false → tiles stay un-decorated and Slice 4.5's soft-warning
  // path is untouched.
  const lockedModuleIds = useMemo(() => {
    if (!strictPrerequisites) return new Set<string>();
    const locked = new Set<string>();
    for (const m of modules) {
      const unmet = computeUnmetPrereqs(m, modulesById);
      if (unmet.length > 0) locked.add(m.id);
    }
    return locked;
  }, [strictPrerequisites, modules, modulesById]);

  // Wrap the parent's onSelect: when prereqs are unmet, intercept the
  // click. Strict mode → hard-lock modal (Slice 4.6, dismiss-only).
  // Lenient mode → soft-warning modal (Slice 4.5, "Continue anyway"
  // forwards). No unmet prereqs → fall through immediately. Mastery is
  // the gate, not mere completion — `progress.status === "MASTERED"`
  // matches the picker's existing vocabulary (Slice 4.2) and the
  // recommender's policy (#494 Slice 2.5).
  const handlePick = useCallback(
    (moduleId: string) => {
      if (!onSelect) return;
      const mod = modulesById.get(moduleId);
      if (!mod) {
        onSelect(moduleId);
        return;
      }
      const unmet = computeUnmetPrereqs(mod, modulesById);
      if (unmet.length === 0) {
        onSelect(moduleId);
        return;
      }
      if (strictPrerequisites) {
        setPendingHardLock({ module: mod, unmetPrereqs: unmet });
        return;
      }
      setPendingSoftWarn({ module: mod, unmetPrereqs: unmet });
    },
    [onSelect, modulesById, strictPrerequisites],
  );

  const handleSoftWarnContinue = useCallback(() => {
    if (!pendingSoftWarn || !onSelect) {
      setPendingSoftWarn(null);
      return;
    }
    const id = pendingSoftWarn.module.id;
    setPendingSoftWarn(null);
    onSelect(id);
  }, [pendingSoftWarn, onSelect]);

  const handleSoftWarnCancel = useCallback(() => {
    setPendingSoftWarn(null);
  }, []);

  const handleHardLockDismiss = useCallback(() => {
    setPendingHardLock(null);
  }, []);

  const visible = modules.filter((m) => m.learnerSelectable !== false);
  if (visible.length === 0) {
    return (
      <div className="hf-empty learner-picker__empty">
        <p className="hf-text-sm hf-text-muted">
          No learner-selectable modules. Make at least one module
          <code> learnerSelectable: true</code> to populate the picker.
        </p>
      </div>
    );
  }

  const layout: PickerLayout = lessonPlanMode === "structured" ? "rail" : "tiles";
  // Layouts always see the wrapped handler when an onSelect is supplied
  // — keeps the preview path (no onSelect → div tiles) intact.
  const layoutOnSelect = onSelect ? handlePick : undefined;

  return (
    <div className={`learner-picker learner-picker--${layout}`}>
      {layout === "rail" ? (
        <RailLayout
          modules={visible}
          completed={completed}
          inProgress={inProgress}
          onSelect={layoutOnSelect}
          recommendedModuleId={recommendedModuleId}
          recommendedReason={recommendedReason}
          lockedModuleIds={lockedModuleIds}
        />
      ) : (
        <TilesLayout
          modules={visible}
          completed={completed}
          inProgress={inProgress}
          onSelect={layoutOnSelect}
          recommendedModuleId={recommendedModuleId}
          recommendedReason={recommendedReason}
          lockedModuleIds={lockedModuleIds}
        />
      )}
      {pendingSoftWarn && (
        <PrereqsSoftWarningModal
          module={pendingSoftWarn.module}
          unmetPrereqs={pendingSoftWarn.unmetPrereqs}
          onContinue={handleSoftWarnContinue}
          onCancel={handleSoftWarnCancel}
        />
      )}
      {pendingHardLock && (
        <PrereqsHardLockModal
          module={pendingHardLock.module}
          unmetPrereqs={pendingHardLock.unmetPrereqs}
          onDismiss={handleHardLockDismiss}
        />
      )}
    </div>
  );
}

/**
 * Compute prereqs that aren't yet MASTERED for the candidate module.
 * Unknown slugs (a prereq pointing at a module no longer in the list)
 * are skipped — we'd rather drop a stale reference than block on a
 * phantom. Used by the click-intercept in `handlePick` (slice 4.5).
 */
function computeUnmetPrereqs(
  candidate: AuthoredModule,
  modulesById: Map<string, AuthoredModule>,
): UnmetPrereq[] {
  const prereqs = Array.isArray(candidate.prerequisites)
    ? candidate.prerequisites
    : [];
  const unmet: UnmetPrereq[] = [];
  for (const slug of prereqs) {
    const ref = modulesById.get(slug);
    if (!ref) continue; // stale slug — silently skip
    if (ref.progress?.status === "MASTERED") continue;
    unmet.push({ slug, title: ref.label });
  }
  return unmet;
}

// ── Tile layout (continuous) ───────────────────────────────────────

function TilesLayout({
  modules,
  completed,
  inProgress,
  onSelect,
  recommendedModuleId,
  recommendedReason,
  lockedModuleIds,
}: {
  modules: AuthoredModule[];
  completed: Set<string>;
  inProgress: Set<string>;
  onSelect?: (id: string) => void;
  recommendedModuleId: string | null;
  recommendedReason: string | null;
  lockedModuleIds: Set<string>;
}) {
  // Hide `frequency: once` modules already completed (e.g. Baseline).
  // Repeatable + completed stays visible so learners can retake.
  const eligible = modules.filter(
    (m) => !(m.frequency === "once" && completed.has(m.id)),
  );

  // No progress data → single ungrouped grid (preserves pre-Slice-3 layout).
  const hasProgressData = inProgress.size > 0 || completed.size > 0;
  if (!hasProgressData) {
    return (
      <div className="learner-picker__tiles">
        {eligible.map((m) => (
          <Tile
            key={m.id}
            mod={m}
            inProgress={false}
            completed={false}
            onSelect={onSelect}
            isRecommended={m.id === recommendedModuleId}
            recommendedReason={recommendedReason}
            isLocked={lockedModuleIds.has(m.id)}
          />
        ))}
      </div>
    );
  }

  const inProgressMods = eligible.filter((m) => inProgress.has(m.id));
  const completedMods = eligible.filter(
    (m) => completed.has(m.id) && !inProgress.has(m.id),
  );
  const upNextMods = eligible.filter(
    (m) => !inProgress.has(m.id) && !completed.has(m.id),
  );

  return (
    <>
      {upNextMods.length > 0 && (
        <Section title="Up next">
          {upNextMods.map((m) => (
            <Tile
              key={m.id}
              mod={m}
              inProgress={false}
              completed={false}
              onSelect={onSelect}
              isRecommended={m.id === recommendedModuleId}
              recommendedReason={recommendedReason}
              isLocked={lockedModuleIds.has(m.id)}
            />
          ))}
        </Section>
      )}
      {inProgressMods.length > 0 && (
        <Section title="In progress">
          {inProgressMods.map((m) => (
            <Tile
              key={m.id}
              mod={m}
              inProgress
              completed={false}
              onSelect={onSelect}
              isRecommended={m.id === recommendedModuleId}
              recommendedReason={recommendedReason}
              isLocked={lockedModuleIds.has(m.id)}
            />
          ))}
        </Section>
      )}
      {completedMods.length > 0 && (
        <Section title="Completed">
          {completedMods.map((m) => (
            <Tile
              key={m.id}
              mod={m}
              inProgress={false}
              completed
              onSelect={onSelect}
              isRecommended={m.id === recommendedModuleId}
              recommendedReason={recommendedReason}
              isLocked={lockedModuleIds.has(m.id)}
            />
          ))}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="learner-picker__section">
      <h3 className="learner-picker__section-title">{title}</h3>
      <div className="learner-picker__tiles">{children}</div>
    </section>
  );
}

function Tile({
  mod,
  inProgress,
  completed,
  onSelect,
  isRecommended,
  recommendedReason,
  isLocked,
}: {
  mod: AuthoredModule;
  inProgress: boolean;
  completed: boolean;
  onSelect?: (id: string) => void;
  isRecommended: boolean;
  recommendedReason: string | null;
  isLocked: boolean;
}) {
  const Tag = onSelect ? "button" : "div";
  // Suppress the recommended badge for mastered modules — defence in depth
  // against an upstream that recommends something already MASTERED.
  // `recommendNextModule()` filters those out, but the picker shouldn't
  // double-decorate a Mastered tile if a stale payload slips through.
  // Also suppress when the tile is locked (Slice 4.6): the lock badge
  // takes the top-LEFT corner and "recommended-next" would contradict
  // the lock affordance even if the recommender slipped up.
  const showRecommended =
    isRecommended && mod.progress?.status !== "MASTERED" && !isLocked;
  const className = isLocked
    ? "learner-picker__tile learner-picker-page__tile--locked"
    : "learner-picker__tile";
  return (
    <Tag
      type={onSelect ? "button" : undefined}
      className={className}
      onClick={onSelect ? () => onSelect(mod.id) : undefined}
      data-terminal={mod.sessionTerminal || undefined}
      data-progress={inProgress ? "in-progress" : completed ? "completed" : undefined}
      data-recommended={showRecommended || undefined}
      data-locked={isLocked || undefined}
      title={isLocked ? "Complete the prereqs first" : undefined}
    >
      {isLocked && <LockBadge />}
      {showRecommended && <RecommendedBadge reason={recommendedReason} />}
      <StatusBadge progress={mod.progress} />
      <ModeIcon mode={mod.mode} />
      <div className="learner-picker__tile-body">
        <div className="learner-picker__tile-label">{mod.label}</div>
        <div className="learner-picker__tile-meta">
          <span>{mod.duration}</span>
          <span className="learner-picker__sep">·</span>
          <span>{describeFrequency(mod.frequency)}</span>
        </div>
        <div className="learner-picker__tile-badges">
          {inProgress && (
            <span className="learner-picker__badge learner-picker__badge--progress">
              <CircleDashed size={10} aria-hidden="true" /> In progress
            </span>
          )}
          {completed && (
            <span className="learner-picker__badge learner-picker__badge--ok">
              <CircleDot size={10} aria-hidden="true" /> Done
            </span>
          )}
          {mod.sessionTerminal && (
            <span className="learner-picker__badge learner-picker__badge--warn">
              Ends session
            </span>
          )}
          {mod.voiceBandReadout && (
            <span className="learner-picker__badge">
              <Mic size={10} aria-hidden="true" /> Spoken bands
            </span>
          )}
        </div>
      </div>
    </Tag>
  );
}

// ── Rail layout (structured) ───────────────────────────────────────

function RailLayout({
  modules,
  completed,
  inProgress,
  onSelect,
  recommendedModuleId,
  recommendedReason,
  lockedModuleIds,
}: {
  modules: AuthoredModule[];
  completed: Set<string>;
  inProgress: Set<string>;
  onSelect?: (id: string) => void;
  recommendedModuleId: string | null;
  recommendedReason: string | null;
  lockedModuleIds: Set<string>;
}) {
  // Sort by `position` if provided, otherwise preserve catalogue order.
  const ordered = [...modules].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER;
    const pb = b.position ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });

  return (
    <ol className="learner-picker__rail">
      {ordered.map((m, i) => {
        const isComplete = completed.has(m.id);
        const isInProgress = inProgress.has(m.id) && !isComplete;
        const isLocked = lockedModuleIds.has(m.id);
        const Tag = onSelect ? "button" : "div";
        const prereqsUnmet = m.prerequisites.filter((p) => !completed.has(p));
        const advisoryHint =
          prereqsUnmet.length > 0
            ? `Recommended after ${prereqsUnmet.join(", ")}`
            : null;
        // Suppress the recommended-next badge on locked cards — same
        // reasoning as the tile layout: a hard-locked card cannot be the
        // recommendation, even if upstream slipped one through.
        const showRecommended =
          m.id === recommendedModuleId &&
          m.progress?.status !== "MASTERED" &&
          !isLocked;
        const cardClassName = isLocked
          ? "learner-picker__rail-card learner-picker-page__rail-card--locked"
          : "learner-picker__rail-card";

        return (
          <li key={m.id} className="learner-picker__rail-item">
            <div className="learner-picker__rail-marker">
              <span className="learner-picker__rail-position">{i + 1}</span>
            </div>
            <Tag
              type={onSelect ? "button" : undefined}
              className={cardClassName}
              onClick={onSelect ? () => onSelect(m.id) : undefined}
              data-progress={isComplete ? "completed" : isInProgress ? "in-progress" : undefined}
              data-terminal={m.sessionTerminal || undefined}
              data-recommended={showRecommended || undefined}
              data-locked={isLocked || undefined}
              title={isLocked ? "Complete the prereqs first" : undefined}
            >
              {isLocked && <LockBadge />}
              {showRecommended && <RecommendedBadge reason={recommendedReason} />}
              <StatusBadge progress={m.progress} />
              <ModeIcon mode={m.mode} />
              <div className="learner-picker__rail-body">
                <div className="learner-picker__rail-label">
                  {m.label}
                  {isInProgress && (
                    <span className="learner-picker__badge learner-picker__badge--progress">
                      <CircleDashed size={10} aria-hidden="true" /> In progress
                    </span>
                  )}
                  {isComplete && (
                    <span className="learner-picker__badge learner-picker__badge--ok">
                      <CircleDot size={10} aria-hidden="true" /> Done
                    </span>
                  )}
                </div>
                <div className="learner-picker__rail-meta">
                  <span>{m.duration}</span>
                  <span className="learner-picker__sep">·</span>
                  <span>{describeFrequency(m.frequency)}</span>
                </div>
                <div className="learner-picker__rail-badges">
                  {advisoryHint && (
                    <span className="learner-picker__badge learner-picker__badge--info">
                      <AlertCircle size={10} aria-hidden="true" /> {advisoryHint}
                    </span>
                  )}
                  {m.sessionTerminal && (
                    <span className="learner-picker__badge learner-picker__badge--warn">
                      Ends session
                    </span>
                  )}
                </div>
              </div>
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function ModeIcon({ mode }: { mode: AuthoredModule["mode"] }) {
  if (mode === "examiner") return <GraduationCap size={18} aria-hidden="true" className="learner-picker__icon" />;
  if (mode === "mixed") return <Layers size={18} aria-hidden="true" className="learner-picker__icon" />;
  return <Pencil size={18} aria-hidden="true" className="learner-picker__icon" />;
}

function describeFrequency(freq: AuthoredModule["frequency"]): string {
  if (freq === "once") return "Once";
  if (freq === "cooldown") return "Cooldown";
  return "Repeatable";
}

// ── Status badge (#495 Slice 4.2) ──────────────────────────────────
//
// Per-module Mastered / In progress / Not started chip pinned to the
// top-right of every tile / rail card. Source of truth is the
// import-modules endpoint, which writes `progress` when a caller scope
// is resolvable (STUDENT or OPERATOR+ ?callerId=). Modules without a
// `progress` field render nothing — preserves the legacy admin-preview
// usage (mounted inside AuthoredModulesPanel) where there's no caller.
//
// Icons match SimProgressPanel (CheckCircle2 / PlayCircle / Circle) so
// the learner's surfaces stay visually consistent across the picker
// and the in-call progress drawer.
function StatusBadge({ progress }: { progress: AuthoredModule["progress"] }) {
  if (!progress) return null;
  if (progress.status === "MASTERED") {
    return (
      <span className="learner-picker-page__status-badge learner-picker-page__status-badge--mastered">
        <CheckCircle2 size={12} aria-hidden="true" />
        <span>Mastered</span>
      </span>
    );
  }
  if (progress.status === "IN_PROGRESS") {
    return (
      <span className="learner-picker-page__status-badge learner-picker-page__status-badge--in-progress">
        <PlayCircle size={12} aria-hidden="true" />
        <span>
          In progress
          {progress.callCount > 0 && (
            <> ({progress.callCount} call{progress.callCount === 1 ? "" : "s"})</>
          )}
        </span>
      </span>
    );
  }
  return (
    <span className="learner-picker-page__status-badge learner-picker-page__status-badge--not-started">
      <Circle size={12} aria-hidden="true" />
      <span>Not started</span>
    </span>
  );
}

// ── Recommended-next badge (#495 Slice 4.3) ────────────────────────
//
// Prominent green pill pinned to the top-LEFT of the single module the
// system recommends the learner attempt next. Sits opposite the Mastered
// / In progress / Not started status chip (top-right) so the two never
// overlap. Source of truth is the import-modules endpoint's top-level
// `recommendedModuleId` field; we don't compute it client-side.
//
// The badge is advisory: it doesn't gate, doesn't disable the tile, and
// doesn't change click behaviour. `recommendNextModule()` returns null
// for fully-mastered courses so the badge is implicitly suppressed there;
// Tile / rail-card render guards add a defensive check against the
// MASTERED status anyway. Tooltip surfaces the human-readable reason
// (Next in sequence / First not started / etc.) via the `title` attribute.
function RecommendedBadge({ reason }: { reason: string | null }) {
  const tooltip = describeRecommendedReason(reason);
  return (
    <span
      className="learner-picker-page__recommended-badge"
      title={tooltip}
      aria-label={`Recommended next — ${tooltip}`}
    >
      <Sparkles size={12} aria-hidden="true" />
      <span>Recommended next</span>
    </span>
  );
}

// ── Lock badge (#495 Slice 4.6) ────────────────────────────────────
//
// Quiet grey pill pinned to the top-LEFT of any tile / rail card the
// learner can't yet take (strict-prereq mode + unmet prereqs). Sits in
// the same corner as the "Recommended next" badge — the two are mutually
// exclusive, so a locked tile never shows the green recommendation pill
// (see suppression logic in Tile / RailLayout). The badge is purely
// decorative — the tile itself stays clickable so the hard-lock modal
// can explain WHY it's locked.
function LockBadge() {
  return (
    <span
      className="learner-picker-page__lock-badge"
      aria-label="Locked — complete the prereqs first"
    >
      <Lock size={12} aria-hidden="true" />
    </span>
  );
}

function describeRecommendedReason(reason: string | null): string {
  switch (reason) {
    case "next-in-sequence":
      return "Next in sequence";
    case "weakest-not-mastered":
      return "Weakest area";
    case "first-unstarted":
      return "First not started";
    case "interleave-review":
      return "Interleave review";
    default:
      return "Recommended for you";
  }
}
