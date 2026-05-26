"use client";

/**
 * TolerancesSettings — Course-level tolerance overrides.
 *
 * Split from PromptTunerSidebar (#843 was a one-stop combined surface).
 * The course-only knobs — retrievalCadenceOverride + memoryDecayScale —
 * belong with the rest of course design. The per-learner Mastery
 * Threshold override stays in PromptTunerSidebar where the educator is
 * tuning *this* learner.
 *
 * What lives here:
 *   - Mastery Threshold (course default) → BehaviorTarget(scope=PLAYBOOK,
 *     parameterId=TOL-MASTERY-THRESHOLD) via /api/playbooks/[id]/targets
 *   - Retrieval Cadence Override → Playbook.config.tolerances.retrievalCadenceOverride
 *   - Memory Decay Scale → Playbook.config.tolerances.memoryDecayScale
 *
 * Both writes flow through helpers that stamp Playbook.composeInputsUpdatedAt
 * (#826 / #830) → every enrolled caller's prompt is marked stale on next
 * call. The <StalePromptPill/> (#831) on the caller page is the visible
 * confirmation that the edit landed.
 */

import { useEffect, useState } from "react";
import type { PlaybookConfig } from "@/lib/types/json-fields";

interface TolerancesSettingsProps {
  courseId: string;
  /** Resolved Playbook.id for the course (needed by /api/playbooks/[id]/targets). */
  playbookId: string | null;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
  onSaved?: () => void;
}

const MASTERY_DEFAULT = 0.7;
const DECAY_DEFAULT = 1.0;

function fmt(n: number): string {
  return n.toFixed(2);
}

export function TolerancesSettings({
  courseId,
  playbookId,
  playbookConfig,
  onSaved,
}: TolerancesSettingsProps): React.ReactElement {
  const cfg = (playbookConfig ?? {}) as PlaybookConfig;
  const tol = cfg.tolerances ?? {};

  // Course default for Mastery Threshold lives in BehaviorTarget(scope=PLAYBOOK),
  // not Playbook.config.tolerances.masteryThreshold (the latter is a legacy
  // fallback layer in the cascade). We fetch the current PLAYBOOK-scope
  // target value at mount.
  const [masteryThreshold, setMasteryThreshold] = useState<number>(
    tol.masteryThreshold ?? MASTERY_DEFAULT,
  );
  const [masteryLoading, setMasteryLoading] = useState(true);

  const [retrievalCadence, setRetrievalCadence] = useState<number | "">(
    tol.retrievalCadenceOverride ?? "",
  );
  const [memoryDecay, setMemoryDecay] = useState<number>(
    tol.memoryDecayScale ?? DECAY_DEFAULT,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!playbookId) {
      setMasteryLoading(false);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/playbooks/${playbookId}/targets`);
        if (!res.ok) return;
        const data = await res.json();
        const t = (data?.targets ?? []).find(
          (x: { parameterId: string }) => x.parameterId === "TOL-MASTERY-THRESHOLD",
        );
        if (t?.targetValue != null) setMasteryThreshold(t.targetValue);
      } catch {
        // Silent — cascade default will display until next refresh.
      } finally {
        setMasteryLoading(false);
      }
    })();
  }, [playbookId]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      // Write the two Playbook.config.tolerances fields via the course
      // design route (already plumbed in this surface).
      const cadenceVal =
        retrievalCadence === "" ? null : Math.max(1, Math.floor(Number(retrievalCadence)));
      const designBody = {
        tolerances: {
          // Don't echo masteryThreshold here — its canonical home is
          // BehaviorTarget(scope=PLAYBOOK). Keeping it out of
          // Playbook.config avoids two-place-of-truth drift.
          retrievalCadenceOverride: cadenceVal,
          memoryDecayScale: memoryDecay,
        },
      };
      const designRes = await fetch(`/api/courses/${courseId}/design`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(designBody),
      });
      const designJson = await designRes.json();
      if (!designRes.ok || !designJson.ok) {
        throw new Error(designJson.error ?? "Design save failed");
      }

      // Write the course-default Mastery Threshold to BehaviorTarget.
      if (playbookId) {
        const targetRes = await fetch(`/api/playbooks/${playbookId}/targets`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targets: [
              { parameterId: "TOL-MASTERY-THRESHOLD", targetValue: masteryThreshold },
            ],
          }),
        });
        const targetJson = await targetRes.json();
        if (!targetRes.ok || !targetJson.ok) {
          throw new Error(targetJson.error ?? "Mastery threshold save failed");
        }
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
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        Course-wide pacing knobs. Per-learner Mastery Threshold overrides live on
        each caller&apos;s Tune tab. Edits here mark every enrolled caller&apos;s
        prompt stale — they recompose on their next call.
      </div>

      {/* Mastery Threshold (course default) */}
      <div className="hf-mb-lg">
        <label className="hf-label hf-text-sm hf-text-bold" htmlFor="td-mastery">
          Mastery Threshold (course default)
        </label>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          0–1. Higher = caller stays longer on each LO before mastery. Per-learner
          adaptation can override this on the caller&apos;s Tune tab.
        </div>
        <div className="hf-flex hf-gap-md hf-items-center">
          <input
            id="td-mastery"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masteryThreshold}
            disabled={saving || masteryLoading || !playbookId}
            onChange={(e) => setMasteryThreshold(parseFloat(e.target.value))}
            className="hf-input"
            data-testid="course-tolerance-mastery"
          />
          <span className="hf-text-sm hf-text-bold" style={{ minWidth: "3em" }}>
            {fmt(masteryThreshold)}
          </span>
        </div>
      </div>

      {/* Retrieval Cadence Override */}
      <div className="hf-mb-lg">
        <label className="hf-label hf-text-sm hf-text-bold" htmlFor="td-cadence">
          Retrieval Cadence Override
        </label>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          Fire retrieval questions every N calls. Leave blank to use the preset
          from your course archetype.
        </div>
        <div className="hf-flex hf-gap-md hf-items-center">
          <input
            id="td-cadence"
            type="range"
            min={1}
            max={10}
            step={1}
            value={retrievalCadence === "" ? 0 : retrievalCadence}
            disabled={saving}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setRetrievalCadence(v === 0 ? "" : v);
            }}
            className="hf-input"
            data-testid="course-tolerance-cadence"
          />
          <span className="hf-text-sm hf-text-bold" style={{ minWidth: "5em" }}>
            {retrievalCadence === "" ? "(preset)" : `every ${retrievalCadence}`}
          </span>
          {retrievalCadence !== "" && (
            <button
              type="button"
              className="hf-btn hf-btn-sm hf-btn-secondary"
              onClick={() => setRetrievalCadence("")}
              disabled={saving}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Memory Decay Scale */}
      <div className="hf-mb-lg">
        <label className="hf-label hf-text-sm hf-text-bold" htmlFor="td-decay">
          Memory Decay Scale
        </label>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          0.1–1.0 multiplier on default per-category decay. Lower = memories fade
          faster (forces more revisits).
        </div>
        <div className="hf-flex hf-gap-md hf-items-center">
          <input
            id="td-decay"
            type="range"
            min={0.1}
            max={1.0}
            step={0.1}
            value={memoryDecay}
            disabled={saving}
            onChange={(e) => setMemoryDecay(parseFloat(e.target.value))}
            className="hf-input"
            data-testid="course-tolerance-decay"
          />
          <span className="hf-text-sm hf-text-bold" style={{ minWidth: "3em" }}>
            {fmt(memoryDecay)}
          </span>
        </div>
      </div>

      <div className="hf-flex hf-gap-sm hf-items-center">
        <button
          className="hf-btn hf-btn-sm hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Tolerances"}
        </button>
        {success && <span className="hf-text-xs hf-text-success">Saved.</span>}
        {error && <span className="hf-text-xs hf-text-error">{error}</span>}
      </div>
    </div>
  );
}
