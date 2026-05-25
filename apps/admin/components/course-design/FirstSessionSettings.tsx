"use client";

/**
 * FirstSessionSettings — Section 2 of #784 (Felt Progress S6) plus the
 * #790 (S8) firstCallMode radio.
 *
 * Two responsibilities:
 *   1. A read-only signpost table listing the six first-session controls
 *      owned by `SessionFlowEditor` — discoverability only, no API calls.
 *   2. The genuinely-new knobs:
 *        - `firstCallMode` (#790 S8) — onboarding / teach_immediately /
 *          baseline_assessment radio
 *        - `firstSessionTargets` (#784 S6) — per-playbook first-call
 *          BEHAVIOR target overrides; repeater rows with parameter +
 *          value slider
 *
 * Single Save button persists firstCallMode + firstSessionTargets to
 * PUT /api/courses/[id]/design.
 *
 * Parameter picker: uses a small hardcoded list of common BEHAVIOR
 * parameter IDs rather than plumbing `loadAdjustableParameters()` from
 * server -> client (the server helper hits Prisma). When the educator needs
 * a less-common parameter, AgentTuner remains the canonical entry. This
 * keeps the component self-contained — matching the BandingPicker pattern.
 */

import { useEffect, useState } from "react";
import type { PlaybookConfig } from "@/lib/types/json-fields";

interface Call1OverrideSample {
  id: string;
  ref: string | null;
  text: string;
  truncated: boolean;
}
interface Call1OverridePreview {
  count: number;
  samples: Call1OverrideSample[];
  rangeFormCount: number;
}

// Hardcoded fallback list — covers the common first-call tuning surface.
// Kept short on purpose; the AgentTuner is the rich entry-point. If a
// course needs a parameter not in this list, an educator can add it via
// AgentTuner and the runtime will honour it because the design route
// accepts any parameterId key in `firstSessionTargets`.
const COMMON_BEHAVIOR_PARAMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "BEH-WARMTH", label: "Warmth" },
  { id: "BEH-CHALLENGE-LEVEL", label: "Challenge level" },
  { id: "BEH-PACING", label: "Pacing" },
  { id: "BEH-DEPTH", label: "Depth" },
];

interface FirstSessionSettingsProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
  onSaved?: () => void;
}

type FirstCallMode = "onboarding" | "teach_immediately" | "baseline_assessment";

interface TargetOverrideRow {
  parameterId: string;
  value: number;
}

const FIRST_CALL_MODE_OPTIONS: Array<{
  value: FirstCallMode;
  label: string;
  description: string;
}> = [
  {
    value: "onboarding",
    label: "Onboarding (default)",
    description:
      "Introduce the course, set expectations, gather goals. Teaching begins from call 2.",
  },
  {
    value: "teach_immediately",
    label: "Teach immediately",
    description:
      "Skip onboarding chatter. Apply the course's teaching mode from the very first call. Best for repeat learners or intensive programmes.",
  },
  {
    value: "baseline_assessment",
    label: "Baseline assessment",
    description:
      "First call captures diagnostic data only — no teaching content. The AI scores against learning objectives and sets a baseline for progress tracking. Works best with an authored curriculum.",
  },
];

function readSignpostState(cfg: PlaybookConfig): Array<{ label: string; value: string }> {
  // Source priority: new sessionFlow.intake shape -> legacy welcome shape.
  // Both surfaces are kept in sync by SessionFlowEditor during the dual-
  // read window — reading both keeps the signpost honest even when the
  // course hasn't been re-saved on the new shape yet.
  const intake = cfg.sessionFlow?.intake;
  const welcome = cfg.welcome;

  const askGoals = intake?.goals?.enabled ?? welcome?.goals?.enabled ?? true;
  const askAboutYou = intake?.aboutYou?.enabled ?? welcome?.aboutYou?.enabled ?? true;
  const askKnowledge = intake?.knowledgeCheck?.enabled ?? welcome?.knowledgeCheck?.enabled ?? false;
  const kcMode = intake?.knowledgeCheck?.deliveryMode;
  const aiIntro = intake?.aiIntroCall?.enabled ?? welcome?.aiIntroCall?.enabled ?? false;
  const hasWelcomeMessage = typeof cfg.welcomeMessage === "string" && cfg.welcomeMessage.trim().length > 0;
  const hasOnboardingPhases =
    (cfg.sessionFlow?.onboarding?.phases?.length ?? 0) > 0 ||
    (cfg.onboardingFlowPhases?.phases?.length ?? 0) > 0;

  return [
    { label: "Goals question", value: askGoals ? "On" : "Off" },
    { label: "About You", value: askAboutYou ? "On" : "Off" },
    {
      label: "Knowledge Check",
      value: askKnowledge ? `On${kcMode ? ` (${kcMode})` : ""}` : "Off",
    },
    { label: "AI Intro Call", value: aiIntro ? "On" : "Off" },
    { label: "Welcome message override", value: hasWelcomeMessage ? "Set" : "—" },
    { label: "Onboarding phases", value: hasOnboardingPhases ? "Configured" : "—" },
  ];
}

export function FirstSessionSettings({
  courseId,
  playbookConfig,
  onSaved,
}: FirstSessionSettingsProps): React.ReactElement {
  const cfg = (playbookConfig ?? {}) as PlaybookConfig;

  const initialMode: FirstCallMode = (cfg.firstCallMode as FirstCallMode | undefined) ?? "onboarding";
  const initialRows: TargetOverrideRow[] = Object.entries(cfg.firstSessionTargets ?? {}).map(
    ([parameterId, v]) => ({ parameterId, value: v.value }),
  );

  const [mode, setMode] = useState<FirstCallMode>(initialMode);
  const [rows, setRows] = useState<TargetOverrideRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // #798 — course-ref Layer-0 override preview. Read-only fetch on mount.
  const [courseRefPreview, setCourseRefPreview] = useState<Call1OverridePreview | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/courses/${courseId}/call1-override-preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive || !json?.ok) return;
        setCourseRefPreview({
          count: json.count,
          samples: json.samples,
          rangeFormCount: json.rangeFormCount,
        });
      })
      .catch(() => {
        /* preview is non-critical — silently no-op on error */
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  const signpost = readSignpostState(cfg);

  function addOverride() {
    // Pick the first parameter not already present, or fall back to first option.
    const used = new Set(rows.map((r) => r.parameterId));
    const next = COMMON_BEHAVIOR_PARAMS.find((p) => !used.has(p.id)) ?? COMMON_BEHAVIOR_PARAMS[0];
    setRows([...rows, { parameterId: next.id, value: 0.5 }]);
  }

  function updateRow(index: number, patch: Partial<TargetOverrideRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      // Coalesce rows into the record shape the route + transform expect.
      // Empty rows array → null body field, which the route uses to delete
      // the namespace so the domain default cascade runs again.
      const targets: Record<string, { value: number; confidence?: number }> = {};
      for (const r of rows) {
        targets[r.parameterId] = { value: r.value };
      }

      const body = {
        firstCallMode: mode,
        firstSessionTargets: rows.length > 0 ? targets : null,
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
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        How the learner&apos;s first call is configured. Some controls live
        in the Session Flow editor above — the table below shows their
        current state for reference.
      </div>

      {/* ── Signpost: read-only summary of SessionFlowEditor state ───────── */}
      <div className="hf-mb-lg">
        <div className="hf-text-xs hf-text-muted hf-mb-xs">
          Owned by Session Flow editor — scroll up to edit
        </div>
        <div className="hf-card-compact">
          {signpost.map((row) => (
            <div
              key={row.label}
              className="hf-flex hf-gap-sm hf-items-center hf-list-row"
            >
              <div className="hf-flex-1 hf-text-sm">{row.label}</div>
              <div className="hf-text-xs hf-text-muted">{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── firstCallMode radio group (#790 S8) ───────────────────────────── */}
      <div className="hf-mb-lg">
        <div className="hf-text-sm hf-text-bold hf-mb-xs">
          How should the AI approach the learner&apos;s first call?
        </div>
        <div className="hf-flex-col hf-gap-sm">
          {FIRST_CALL_MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer"
            >
              <input
                type="radio"
                name="first-call-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => setMode(opt.value)}
                disabled={saving}
              />
              <div className="hf-flex-1">
                <div className="hf-text-sm hf-text-bold">{opt.label}</div>
                <div className="hf-text-xs hf-text-muted">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ── firstSessionTargets repeater (#784 S6) ────────────────────────── */}
      <div className="hf-mb-lg">
        <div className="hf-text-sm hf-text-bold hf-mb-xs">First-call AI behaviour targets</div>
        <div className="hf-text-xs hf-text-muted hf-mb-sm">
          Sets the AI&apos;s starting parameters before any caller data
          exists. Falls back to domain defaults when not set.
        </div>

        {rows.length === 0 ? (
          <div className="hf-empty hf-text-xs hf-text-muted hf-mb-sm">
            No overrides set — domain defaults apply.
          </div>
        ) : (
          <div className="hf-flex-col hf-gap-sm hf-mb-sm">
            {rows.map((row, i) => (
              <div
                key={`${row.parameterId}-${i}`}
                className="hf-flex hf-gap-sm hf-items-center"
              >
                <select
                  className="hf-input"
                  value={row.parameterId}
                  onChange={(e) => updateRow(i, { parameterId: e.target.value })}
                  disabled={saving}
                >
                  {COMMON_BEHAVIOR_PARAMS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.id})
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: parseFloat(e.target.value) })}
                  disabled={saving}
                  className="hf-input"
                />
                <span className="hf-text-xs hf-text-muted">{row.value.toFixed(2)}</span>
                <button
                  type="button"
                  className="hf-btn hf-btn-sm hf-btn-destructive"
                  onClick={() => removeRow(i)}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          className="hf-btn hf-btn-sm hf-btn-secondary"
          onClick={addOverride}
          disabled={saving}
        >
          + Add first-call target override
        </button>
      </div>

      {/* ── #798: read-only preview of course-ref Layer-0 call-1 overrides ── */}
      {courseRefPreview && (
        <div className="hf-mb-lg">
          <div className="hf-text-sm hf-text-bold hf-mb-xs">From your course-ref</div>
          {courseRefPreview.count === 0 ? (
            <div className="hf-text-xs hf-text-muted">
              Your course-ref has no call-1 specific instructions. Call 1 uses
              the cascade above.
            </div>
          ) : (
            <>
              <div className="hf-text-xs hf-text-muted hf-mb-xs">
                Your course-ref defines {courseRefPreview.count} call-1
                instruction{courseRefPreview.count === 1 ? "" : "s"}. These
                REPLACE the onboarding flow entirely on call 1 (highest
                priority).
              </div>
              <ul className="hf-card-compact hf-text-xs hf-mb-xs">
                {courseRefPreview.samples.map((s) => (
                  <li key={s.id} className="hf-list-row">
                    {s.ref ? <span className="hf-text-muted">[{s.ref}] </span> : null}
                    {s.text}
                  </li>
                ))}
                {courseRefPreview.count > courseRefPreview.samples.length && (
                  <li className="hf-list-row hf-text-muted">
                    …and {courseRefPreview.count - courseRefPreview.samples.length}{" "}
                    more
                  </li>
                )}
              </ul>
              <div className="hf-text-xs hf-text-muted">
                Edit by updating your course-ref doc →{" "}
                <a
                  href={`/x/courses/${courseId}?tab=content`}
                  className="hf-link"
                >
                  Subject sources
                </a>
              </div>
              {courseRefPreview.rangeFormCount > 0 && (
                <div className="hf-text-xs hf-text-muted hf-mt-xs">
                  Note: range-form assertions (e.g. &ldquo;1-3&rdquo;,
                  &ldquo;1-5&rdquo;) that also apply to call 1 aren&apos;t shown
                  here — view all course-ref instructions in the sources tab.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="hf-flex hf-gap-sm hf-items-center">
        <button
          className="hf-btn hf-btn-sm hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save First Session"}
        </button>
        {success && <span className="hf-text-xs hf-text-success">Saved.</span>}
        {error && <span className="hf-text-xs hf-text-error">{error}</span>}
      </div>
    </div>
  );
}
