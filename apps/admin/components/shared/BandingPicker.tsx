"use client";

/**
 * BandingPicker — preset selector for per-playbook skill tier mapping.
 * Drops onto any course-config surface. Persists via PUT
 * /api/courses/[courseId]/design.
 *
 * Presets defined in `lib/banding/presets.ts`. Custom shape is hand-edited
 * JSON for now (advanced — preset names cover 90% of cases).
 *
 * #417 Story C.
 */
import { useState } from "react";
import {
  TIER_PRESETS,
  type TierPresetId,
  type TierPreset,
} from "@/lib/banding/presets";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { Acronym } from "./Acronym";

interface BandingPickerProps {
  courseId: string;
  current?: PlaybookConfig["skillTierMapping"];
  onSaved?: () => void;
}

/**
 * Best-effort: detect which preset the current mapping matches. Used to
 * pre-select the radio. When custom thresholds are in use, falls back to
 * "custom".
 */
function detectPresetId(mapping: PlaybookConfig["skillTierMapping"]): TierPresetId {
  if (!mapping) return "ielts-speaking";
  for (const [id, p] of Object.entries(TIER_PRESETS)) {
    const t = p.mapping.thresholds;
    const b = p.mapping.tierBands;
    if (
      mapping.thresholds.approachingEmerging === t.approachingEmerging &&
      mapping.thresholds.emerging === t.emerging &&
      mapping.thresholds.developing === t.developing &&
      mapping.thresholds.secure === t.secure &&
      mapping.tierBands.approachingEmerging === b.approachingEmerging &&
      mapping.tierBands.emerging === b.emerging &&
      mapping.tierBands.developing === b.developing &&
      mapping.tierBands.secure === b.secure
    ) {
      return id as TierPresetId;
    }
  }
  return "custom";
}

export function BandingPicker({ courseId, current, onSaved }: BandingPickerProps) {
  const [selected, setSelected] = useState<TierPresetId>(detectPresetId(current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const preset: TierPreset = TIER_PRESETS[selected];

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body =
        selected === "ielts-speaking"
          ? { skillTierMapping: null } // null = clear → fall back to contract default
          : {
              skillTierMapping: {
                thresholds: preset.mapping.thresholds,
                tierBands: preset.mapping.tierBands,
                ...(preset.tierLabels ? { tierLabels: preset.tierLabels } : {}),
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
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hf-card-compact">
      <div className="hf-section-title hf-mb-xs">Skill banding</div>
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        How <Acronym>SKILL-NN</Acronym> ACHIEVE goal progress maps to a tier
        label + band number. Default is IELTS Speaking. Change this when the
        course isn&apos;t an IELTS-style criterion exam.
      </div>
      <div className="hf-flex-col hf-gap-sm">
        {(Object.values(TIER_PRESETS) as TierPreset[]).map((p) => (
          <label key={p.id} className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer">
            <input
              type="radio"
              name="banding-preset"
              value={p.id}
              checked={selected === p.id}
              onChange={() => setSelected(p.id)}
              disabled={saving}
            />
            <div className="hf-flex-1">
              <div className="hf-text-sm hf-text-bold">{p.label}</div>
              <div className="hf-text-xs hf-text-muted">{p.description}</div>
              <div className="hf-text-xs hf-text-muted hf-mt-xs">
                Tiers:{" "}
                {(["approachingEmerging", "emerging", "developing", "secure"] as const).map(
                  (slot, i) => {
                    const label = p.tierLabels?.[slot] ?? (
                      slot === "approachingEmerging"
                        ? "Approaching Emerging"
                        : slot === "emerging"
                          ? "Emerging"
                          : slot === "developing"
                            ? "Developing"
                            : "Secure"
                    );
                    return (
                      <span key={slot}>
                        {i > 0 && " · "}
                        <Acronym>{label}</Acronym> (band {p.mapping.tierBands[slot]})
                      </span>
                    );
                  },
                )}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="hf-flex hf-gap-sm hf-items-center hf-mt-md">
        <button
          className="hf-btn hf-btn-sm hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save banding"}
        </button>
        {success && <span className="hf-text-xs hf-text-success">Saved.</span>}
        {error && <span className="hf-text-xs hf-text-error">{error}</span>}
      </div>
    </div>
  );
}
