"use client";

/**
 * FeltProgressSettings — Section 1 of #784 (Felt Progress S6).
 *
 * Bundles the 9 controls for the two Felt-Progress namespaces that land
 * during this epic: progressNarrative (#779, mid-call acknowledgement) and
 * offboardingSummary (#780, structured end-of-course summary). Single
 * editor, single Save button, single write to PUT /api/courses/[id]/design.
 *
 * Same self-contained component pattern as `BandingPicker`. Reads the
 * playbook config from props, persists the relevant subtree to the design
 * route. Defaults shown in UI mirror the transform-side defaults so a fresh
 * course displays the same checkboxes it actually runs.
 */

import { useState } from "react";
import type { PlaybookConfig } from "@/lib/types/json-fields";

interface FeltProgressSettingsProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
  onSaved?: () => void;
}

// Defaults mirror the transform-side defaults
// (lib/prompt/composition/transforms/progress-narrative.ts +
// transforms/offboarding.ts). Keeping them aligned means the UI never
// misrepresents what the AI will actually do for an unset course.
const PROGRESS_DEFAULTS = {
  enabled: true,
  cadence: "on_threshold_crossing" as const,
  minScoreDelta: 0.1,
  skipFirstCall: true,
};

const OFFBOARDING_DEFAULTS = {
  enabled: true,
  cadence: "final_only" as const,
  includeModuleMastery: true,
  includeGoalProgress: true,
  includeSkillCurrentScore: true,
};

export function FeltProgressSettings({
  courseId,
  playbookConfig,
  onSaved,
}: FeltProgressSettingsProps): React.ReactElement {
  const cfg = (playbookConfig ?? {}) as PlaybookConfig;
  const pn = cfg.progressNarrative ?? {};
  const ob = cfg.offboardingSummary ?? {};

  // ── progressNarrative state ─────────────────────────────────────────────
  const [pnEnabled, setPnEnabled] = useState<boolean>(pn.enabled ?? PROGRESS_DEFAULTS.enabled);
  const [pnCadence, setPnCadence] = useState<"every_call" | "on_threshold_crossing">(
    pn.cadence ?? PROGRESS_DEFAULTS.cadence,
  );
  const [pnDelta, setPnDelta] = useState<number>(pn.minScoreDelta ?? PROGRESS_DEFAULTS.minScoreDelta);
  const [pnSkipFirst, setPnSkipFirst] = useState<boolean>(
    pn.skipFirstCall ?? PROGRESS_DEFAULTS.skipFirstCall,
  );

  // ── offboardingSummary state ────────────────────────────────────────────
  const [obEnabled, setObEnabled] = useState<boolean>(ob.enabled ?? OFFBOARDING_DEFAULTS.enabled);
  const [obCadence, setObCadence] = useState<"final_only" | "every_session_with_data">(
    ob.cadence ?? OFFBOARDING_DEFAULTS.cadence,
  );
  const [obIncMastery, setObIncMastery] = useState<boolean>(
    ob.includeModuleMastery ?? OFFBOARDING_DEFAULTS.includeModuleMastery,
  );
  const [obIncGoals, setObIncGoals] = useState<boolean>(
    ob.includeGoalProgress ?? OFFBOARDING_DEFAULTS.includeGoalProgress,
  );
  const [obIncSkills, setObIncSkills] = useState<boolean>(
    ob.includeSkillCurrentScore ?? OFFBOARDING_DEFAULTS.includeSkillCurrentScore,
  );

  // ── persistence ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body = {
        progressNarrative: {
          enabled: pnEnabled,
          cadence: pnCadence,
          minScoreDelta: pnDelta,
          skipFirstCall: pnSkipFirst,
        },
        offboardingSummary: {
          enabled: obEnabled,
          cadence: obCadence,
          includeModuleMastery: obIncMastery,
          includeGoalProgress: obIncGoals,
          includeSkillCurrentScore: obIncSkills,
        },
      };
      const res = await fetch(`/api/courses/${courseId}/design`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Save failed");
      }
      setSuccess(true);
      onSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hf-section-title hf-mb-xs">Felt progress</div>
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        Controls how the AI acknowledges progress mid-call and summarises the
        learner&apos;s journey at the end of the course. Defaults are sensible
        — adjust only when the course needs a different rhythm.
      </div>

      {/* ── Mid-call progress mentions ─────────────────────────────── */}
      <div className="hf-mb-lg">
        <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
          <input
            type="checkbox"
            checked={pnEnabled}
            onChange={(e) => setPnEnabled(e.target.checked)}
            disabled={saving}
          />
          <span className="hf-text-sm hf-text-bold">Mid-call progress mentions</span>
        </label>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          When should the AI acknowledge improvement mid-conversation?
        </div>

        <div className="hf-flex-col hf-gap-xs hf-mb-sm">
          <label className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer">
            <input
              type="radio"
              name="pn-cadence"
              value="on_threshold_crossing"
              checked={pnCadence === "on_threshold_crossing"}
              onChange={() => setPnCadence("on_threshold_crossing")}
              disabled={saving || !pnEnabled}
            />
            <div>
              <div className="hf-text-sm">On threshold crossing</div>
              <div className="hf-text-xs hf-text-muted">
                Only when a notable score moves above the threshold below.
              </div>
            </div>
          </label>
          <label className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer">
            <input
              type="radio"
              name="pn-cadence"
              value="every_call"
              checked={pnCadence === "every_call"}
              onChange={() => setPnCadence("every_call")}
              disabled={saving || !pnEnabled}
            />
            <div>
              <div className="hf-text-sm">Every call</div>
              <div className="hf-text-xs hf-text-muted">
                Whenever any score exists. Use sparingly — most courses prefer threshold crossing.
              </div>
            </div>
          </label>
        </div>

        <div className="hf-mb-sm">
          <label className="hf-label hf-text-xs">
            Notable improvement threshold: <span className="hf-text-bold">{pnDelta.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0.01}
            max={0.5}
            step={0.01}
            value={pnDelta}
            onChange={(e) => setPnDelta(parseFloat(e.target.value))}
            disabled={saving || !pnEnabled || pnCadence !== "on_threshold_crossing"}
            className="hf-input"
          />
          <div className="hf-text-xs hf-text-muted">
            A learning-objective score must reach at least this value to be acknowledged.
          </div>
        </div>

        <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
          <input
            type="checkbox"
            checked={pnSkipFirst}
            onChange={(e) => setPnSkipFirst(e.target.checked)}
            disabled={saving || !pnEnabled}
          />
          <span className="hf-text-sm">Skip on first call</span>
        </label>
      </div>

      {/* ── End-of-course summary ──────────────────────────────────── */}
      <div className="hf-mb-lg">
        <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
          <input
            type="checkbox"
            checked={obEnabled}
            onChange={(e) => setObEnabled(e.target.checked)}
            disabled={saving}
          />
          <span className="hf-text-sm hf-text-bold">End-of-course summary</span>
        </label>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          When does the AI deliver the structured progress summary?
        </div>

        <div className="hf-flex-col hf-gap-xs hf-mb-sm">
          <label className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer">
            <input
              type="radio"
              name="ob-cadence"
              value="final_only"
              checked={obCadence === "final_only"}
              onChange={() => setObCadence("final_only")}
              disabled={saving || !obEnabled}
            />
            <div>
              <div className="hf-text-sm">Final session only</div>
              <div className="hf-text-xs hf-text-muted">Default. Saves the celebration for the end.</div>
            </div>
          </label>
          <label className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer">
            <input
              type="radio"
              name="ob-cadence"
              value="every_session_with_data"
              checked={obCadence === "every_session_with_data"}
              onChange={() => setObCadence("every_session_with_data")}
              disabled={saving || !obEnabled}
            />
            <div>
              <div className="hf-text-sm">Every session with data</div>
              <div className="hf-text-xs hf-text-muted">
                Brief progress acknowledgement at the end of each session from call 2.
              </div>
            </div>
          </label>
        </div>

        <div className="hf-text-xs hf-text-muted hf-mb-xs">Include in summary</div>
        <div className="hf-flex-col hf-gap-xs">
          <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
            <input
              type="checkbox"
              checked={obIncMastery}
              onChange={(e) => setObIncMastery(e.target.checked)}
              disabled={saving || !obEnabled}
            />
            <span className="hf-text-sm">Module mastery</span>
          </label>
          <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
            <input
              type="checkbox"
              checked={obIncGoals}
              onChange={(e) => setObIncGoals(e.target.checked)}
              disabled={saving || !obEnabled}
            />
            <span className="hf-text-sm">Goal progress</span>
          </label>
          <label className="hf-flex hf-gap-sm hf-items-center hf-cursor-pointer">
            <input
              type="checkbox"
              checked={obIncSkills}
              onChange={(e) => setObIncSkills(e.target.checked)}
              disabled={saving || !obEnabled}
            />
            <span className="hf-text-sm">Skill scores</span>
          </label>
        </div>
      </div>

      <div className="hf-flex hf-gap-sm hf-items-center">
        <button
          className="hf-btn hf-btn-sm hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Felt Progress"}
        </button>
        {success && <span className="hf-text-xs hf-text-success">Saved.</span>}
        {error && <span className="hf-text-xs hf-text-error">{error}</span>}
      </div>
    </div>
  );
}
