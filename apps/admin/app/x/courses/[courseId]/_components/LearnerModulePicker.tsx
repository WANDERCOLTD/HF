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

import {
  GraduationCap,
  Mic,
  Pencil,
  Layers,
  CircleDot,
  AlertCircle,
} from "lucide-react";
import type { AuthoredModule } from "@/lib/types/json-fields";

export type PickerLayout = "tiles" | "rail";

interface LearnerModulePickerProps {
  modules: AuthoredModule[];
  /** "continuous" → tiles, "structured" → rail. Null defaults to tiles. */
  lessonPlanMode: "structured" | "continuous" | null;
  /**
   * If supplied, these IDs are treated as completed. Used by the rail layout
   * to show position progress and by the tiles layout to suppress repeats
   * for `frequency: once` modules (e.g. Baseline). Empty array = first session.
   */
  completedModuleIds?: string[];
  /**
   * If supplied, the picker calls this on tile/row activation. When omitted
   * (preview mode), tiles render as `<div>` rather than `<button>` and the
   * "Start" affordance is hidden.
   */
  onSelect?: (moduleId: string) => void;
}

export function LearnerModulePicker({
  modules,
  lessonPlanMode,
  completedModuleIds = [],
  onSelect,
}: LearnerModulePickerProps) {
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

  const completed = new Set(completedModuleIds);
  const layout: PickerLayout = lessonPlanMode === "structured" ? "rail" : "tiles";

  return (
    <div className={`learner-picker learner-picker--${layout}`}>
      {layout === "rail" ? (
        <RailLayout
          modules={visible}
          completed={completed}
          onSelect={onSelect}
        />
      ) : (
        <TilesLayout
          modules={visible}
          completed={completed}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

// ── Tile layout (continuous) ───────────────────────────────────────

function TilesLayout({
  modules,
  completed,
  onSelect,
}: {
  modules: AuthoredModule[];
  completed: Set<string>;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="learner-picker__tiles">
      {modules.map((m) => {
        const isOnce = m.frequency === "once";
        const isHidden = isOnce && completed.has(m.id);
        if (isHidden) return null;

        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={m.id}
            type={onSelect ? "button" : undefined}
            className="learner-picker__tile"
            onClick={onSelect ? () => onSelect(m.id) : undefined}
            data-terminal={m.sessionTerminal || undefined}
          >
            <ModeIcon mode={m.mode} />
            <div className="learner-picker__tile-body">
              <div className="learner-picker__tile-label">{m.label}</div>
              <div className="learner-picker__tile-meta">
                <span>{m.duration}</span>
                <span className="learner-picker__sep">·</span>
                <span>{describeFrequency(m.frequency)}</span>
              </div>
              <div className="learner-picker__tile-badges">
                {m.sessionTerminal && (
                  <span className="learner-picker__badge learner-picker__badge--warn">
                    Ends session
                  </span>
                )}
                {m.voiceBandReadout && (
                  <span className="learner-picker__badge">
                    <Mic size={10} aria-hidden="true" /> Spoken bands
                  </span>
                )}
              </div>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

// ── Rail layout (structured) ───────────────────────────────────────

function RailLayout({
  modules,
  completed,
  onSelect,
}: {
  modules: AuthoredModule[];
  completed: Set<string>;
  onSelect?: (id: string) => void;
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
        const Tag = onSelect ? "button" : "div";
        const prereqsUnmet = m.prerequisites.filter((p) => !completed.has(p));
        const advisoryHint =
          prereqsUnmet.length > 0
            ? `Recommended after ${prereqsUnmet.join(", ")}`
            : null;

        return (
          <li key={m.id} className="learner-picker__rail-item">
            <div className="learner-picker__rail-marker">
              <span className="learner-picker__rail-position">{i + 1}</span>
            </div>
            <Tag
              type={onSelect ? "button" : undefined}
              className="learner-picker__rail-card"
              onClick={onSelect ? () => onSelect(m.id) : undefined}
              data-complete={isComplete || undefined}
              data-terminal={m.sessionTerminal || undefined}
            >
              <ModeIcon mode={m.mode} />
              <div className="learner-picker__rail-body">
                <div className="learner-picker__rail-label">
                  {m.label}
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
