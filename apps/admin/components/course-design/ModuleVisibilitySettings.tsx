"use client";

/**
 * ModuleVisibilitySettings — #1405 Behaviour lens.
 *
 * Radio group controlling whether module names surface in the AI's
 * call-1 framing. Writes to
 * `PUT /api/courses/[courseId]/design`
 * inside the partial-merge `firstCall.firstCallModuleVisibility` shape.
 *
 * Triggered by operator feedback on "Big Five (OCEAN) Personality Model"
 * — brand-new learners heard "today's focus is Foundations: Why Five?"
 * before they had any context for what the modules meant.
 *
 * Behaviour contract: the choice ONLY affects orientation/framing
 * (this_session, plan.newMaterial.module, "Introduce <module>" flow
 * steps). TEACHING CONTENT — vocab, assertions, knowledge items — still
 * loads normally. See
 * `lib/prompt/composition/transforms/module-visibility-gate.ts`.
 *
 * Follows the FirstSessionSettings props pattern: `{ courseId,
 * playbookConfig?, onSaved? }`.
 */

import { useEffect, useState } from "react";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import type {
  FirstCallModuleVisibility,
} from "@/lib/prompt/composition/transforms/module-visibility-gate";
import {
  DEFAULT_FIRST_CALL_MODULE_VISIBILITY,
  isFirstCallModuleVisibility,
} from "@/lib/prompt/composition/transforms/module-visibility-gate";

interface ModuleVisibilitySettingsProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
  onSaved?: () => void;
}

interface RadioOption {
  value: FirstCallModuleVisibility;
  label: string;
  hintKey: keyof typeof WIZARD_HINTS;
}

const OPTIONS: RadioOption[] = [
  {
    value: "mention_from_call_1",
    label: "Mention from call 1 (default)",
    hintKey: "moduleVisibility.mention_from_call_1",
  },
  {
    value: "hide_until_call_2",
    label: "Introduce modules from call 2",
    hintKey: "moduleVisibility.hide_until_call_2",
  },
  {
    value: "hide_until_learner_picks",
    label: "Only when learner picks a module",
    hintKey: "moduleVisibility.hide_until_learner_picks",
  },
];

export function ModuleVisibilitySettings({
  courseId,
  playbookConfig,
  onSaved,
}: ModuleVisibilitySettingsProps): React.ReactElement {
  const cfg = (playbookConfig ?? {}) as PlaybookConfig;
  const initial: FirstCallModuleVisibility =
    cfg.firstCall?.firstCallModuleVisibility ??
    DEFAULT_FIRST_CALL_MODULE_VISIBILITY;

  const [value, setValue] = useState<FirstCallModuleVisibility>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Hydrate from the server in case the parent prop is stale (e.g. the
  // panel was opened from a Preview sidetray and the educator just saved
  // an unrelated lens). Best-effort — falls back to the prop on error.
  useEffect(() => {
    let alive = true;
    fetch(`/api/courses/${courseId}/design`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { ok?: boolean; firstCallModuleVisibility?: string | null } | null) => {
        if (!alive || !json?.ok) return;
        const fetched = json.firstCallModuleVisibility;
        if (fetched && isFirstCallModuleVisibility(fetched)) {
          setValue(fetched);
        }
      })
      .catch(() => {
        /* hydrate is non-critical — fall back to the prop */
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body = {
        firstCall: { firstCallModuleVisibility: value },
      };
      const res = await fetch(`/api/courses/${courseId}/design`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
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
        Choose how the AI talks about modules on the learner&apos;s first
        call. This is a framing choice — the teaching content for each
        module still loads as configured.
      </div>

      <div className="hf-mb-lg">
        <div className="hf-text-sm hf-text-bold hf-mb-xs">
          When should the AI start naming modules?
        </div>
        <div className="hf-flex-col hf-gap-sm">
          {OPTIONS.map((opt) => {
            const hint = WIZARD_HINTS[opt.hintKey];
            return (
              <label
                key={opt.value}
                className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer"
              >
                <input
                  type="radio"
                  name="module-visibility"
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => setValue(opt.value)}
                  disabled={saving}
                />
                <div className="hf-flex-1">
                  <FieldHint
                    label={opt.label}
                    hint={hint}
                    labelClass="hf-text-sm hf-text-bold"
                  />
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="hf-flex hf-gap-sm hf-items-center">
        <button
          type="button"
          className="hf-btn hf-btn-sm hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save module visibility"}
        </button>
        {success && (
          <span className="hf-text-xs hf-text-success">Saved.</span>
        )}
        {error && (
          <span className="hf-text-xs hf-text-error">{error}</span>
        )}
      </div>
    </div>
  );
}
