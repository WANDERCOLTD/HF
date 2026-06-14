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

type Mapping = NonNullable<PlaybookConfig["skillTierMapping"]>;
type TierSlot = "approachingEmerging" | "emerging" | "developing" | "secure";
const SLOTS: readonly TierSlot[] = [
  "approachingEmerging",
  "emerging",
  "developing",
  "secure",
];

function numbersMatch(mapping: Mapping, preset: TierPreset): boolean {
  return SLOTS.every(
    (s) =>
      mapping.thresholds[s] === preset.mapping.thresholds[s] &&
      mapping.tierBands[s] === preset.mapping.tierBands[s],
  );
}

function labelsMatch(mapping: Mapping, preset: TierPreset): boolean {
  if (!mapping.tierLabels || !preset.tierLabels) return false;
  return SLOTS.every((s) => mapping.tierLabels![s] === preset.tierLabels![s]);
}

/**
 * Detect which preset the current mapping matches. Used to pre-select the
 * radio.
 *
 * Order matters:
 *  - First match label-bearing presets (CEFR, 5-Level) on BOTH numbers and
 *    labels. A mapping with cefr numbers but Foundation/Developing/... labels
 *    must NOT collapse into the CEFR radio.
 *  - Then match label-free presets (IELTS, custom) on numbers only when the
 *    current mapping ALSO has no labels.
 *  - If labels are present but didn't match any baked preset → "source-derived"
 *    (the #1635 derivation path — labels parsed from the uploaded document).
 *  - Otherwise fall through to "custom" (hand-edited mapping with no labels).
 *
 * Skips "source-derived" in the matching loop — its registry mapping is a
 * placeholder; the live shape is read from `current` at render time.
 */
function detectPresetId(mapping: PlaybookConfig["skillTierMapping"]): TierPresetId {
  if (!mapping) return "ielts-speaking";
  const m = mapping as Mapping;

  for (const [id, p] of Object.entries(TIER_PRESETS) as [TierPresetId, TierPreset][]) {
    if (id === "source-derived") continue;
    if (!p.tierLabels) continue;
    if (numbersMatch(m, p) && labelsMatch(m, p)) return id;
  }

  const hasLabels = !!m.tierLabels;
  for (const [id, p] of Object.entries(TIER_PRESETS) as [TierPresetId, TierPreset][]) {
    if (id === "source-derived") continue;
    if (p.tierLabels) continue;
    if (!hasLabels && numbersMatch(m, p)) return id;
  }

  if (hasLabels) return "source-derived";
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
      if (selected === "source-derived") {
        setSuccess(true);
        onSaved?.();
        return;
      }
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
      <div className="hf-text-xs hf-text-muted hf-mb-md">
        How <Acronym>SKILL-NN</Acronym> ACHIEVE goal progress maps to a tier
        label + band number. Default is IELTS Speaking. Change this when the
        course isn&apos;t an IELTS-style criterion exam.
      </div>
      <div className="hf-flex-col hf-gap-sm">
        {(Object.values(TIER_PRESETS) as TierPreset[]).map((p) => {
          const isSourceDerived = p.id === "source-derived";
          if (isSourceDerived && !current?.tierLabels) return null;
          const sourceLabels = isSourceDerived ? current?.tierLabels : undefined;
          const sourceBands = isSourceDerived ? current?.tierBands : undefined;
          return (
            <label
              key={p.id}
              className="hf-flex hf-gap-sm hf-items-start hf-cursor-pointer"
            >
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
                  {SLOTS.map((slot, i) => {
                    const label =
                      sourceLabels?.[slot] ??
                      p.tierLabels?.[slot] ??
                      (slot === "approachingEmerging"
                        ? "Approaching Emerging"
                        : slot === "emerging"
                          ? "Emerging"
                          : slot === "developing"
                            ? "Developing"
                            : "Secure");
                    const band = sourceBands?.[slot] ?? p.mapping.tierBands[slot];
                    return (
                      <span key={slot}>
                        {i > 0 && " · "}
                        <Acronym>{label}</Acronym> (band {band})
                      </span>
                    );
                  })}
                </div>
              </div>
            </label>
          );
        })}
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
