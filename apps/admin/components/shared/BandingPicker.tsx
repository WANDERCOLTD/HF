"use client";

/**
 * BandingPicker (#439 — Story C of post-#407)
 *
 * Lets an educator pick the tier-mapping model used to band SKILL-NN
 * ACHIEVE goal progress. Default is IELTS Speaking (matches the
 * SKILL_MEASURE_V1 contract). Non-IELTS courses choose CEFR / 5-Level /
 * Custom — the picked mapping is stored on `Playbook.config.skillTierMapping`
 * and overrides the contract for callers on that playbook.
 *
 * Outputs the same shape the contract carries (thresholds + tierBands +
 * optional tierLabels) so `scoreToTier()` consumes it without translation.
 *
 * The chip group reuses `ChipSelect` per HF design rules.
 */

import { useState, useMemo, useEffect } from "react";
import { ChipSelect } from "./ChipSelect";

export type BandingMapping = {
  thresholds: {
    approachingEmerging: number;
    emerging: number;
    developing: number;
    secure: number;
  };
  tierBands: {
    approachingEmerging: number;
    emerging: number;
    developing: number;
    secure: number;
  };
  tierLabels?: {
    approachingEmerging?: string;
    emerging?: string;
    developing?: string;
    secure?: string;
  };
};

export type BandingPreset = "ielts" | "cefr" | "five-level" | "custom";

const PRESETS: Record<Exclude<BandingPreset, "custom">, BandingMapping> = {
  ielts: {
    thresholds: { approachingEmerging: 0.3, emerging: 0.55, developing: 0.7, secure: 1.0 },
    tierBands: { approachingEmerging: 3, emerging: 4, developing: 5.5, secure: 7 },
    tierLabels: {
      approachingEmerging: "Approaching Emerging",
      emerging: "Emerging",
      developing: "Developing",
      secure: "Secure",
    },
  },
  cefr: {
    thresholds: { approachingEmerging: 0.3, emerging: 0.5, developing: 0.75, secure: 1.0 },
    tierBands: { approachingEmerging: 2, emerging: 3, developing: 4, secure: 6 },
    tierLabels: {
      approachingEmerging: "A2",
      emerging: "B1",
      developing: "B2",
      secure: "C2",
    },
  },
  "five-level": {
    thresholds: { approachingEmerging: 0.3, emerging: 0.55, developing: 0.8, secure: 1.0 },
    tierBands: { approachingEmerging: 1, emerging: 2, developing: 3, secure: 5 },
    tierLabels: {
      approachingEmerging: "Novice",
      emerging: "Beginner",
      developing: "Intermediate",
      secure: "Expert",
    },
  },
};

const PRESET_OPTIONS: { value: BandingPreset; label: string }[] = [
  { value: "ielts", label: "IELTS Speaking" },
  { value: "cefr", label: "CEFR" },
  { value: "five-level", label: "5-Level" },
  { value: "custom", label: "Custom" },
];

/** Heuristic — figure out which preset matches an existing mapping, fall back to "custom". */
function detectPreset(mapping: BandingMapping | undefined | null): BandingPreset {
  if (!mapping) return "ielts";
  for (const [name, preset] of Object.entries(PRESETS) as Array<[Exclude<BandingPreset, "custom">, BandingMapping]>) {
    if (
      preset.thresholds.approachingEmerging === mapping.thresholds.approachingEmerging
      && preset.thresholds.emerging === mapping.thresholds.emerging
      && preset.thresholds.developing === mapping.thresholds.developing
      && preset.thresholds.secure === mapping.thresholds.secure
      && preset.tierBands.approachingEmerging === mapping.tierBands.approachingEmerging
      && preset.tierBands.emerging === mapping.tierBands.emerging
      && preset.tierBands.developing === mapping.tierBands.developing
      && preset.tierBands.secure === mapping.tierBands.secure
    ) {
      return name;
    }
  }
  return "custom";
}

export function BandingPicker({
  value,
  onChange,
}: {
  /** Current mapping, or `undefined` to default to IELTS. */
  value: BandingMapping | undefined | null;
  /** Called whenever the picker output changes — pass `undefined` when IELTS (no override needed). */
  onChange: (mapping: BandingMapping | undefined) => void;
}) {
  const initialPreset = useMemo(() => detectPreset(value ?? undefined), [value]);
  const [preset, setPreset] = useState<BandingPreset>(initialPreset);
  const [customDraft, setCustomDraft] = useState(() => {
    const seed = value && initialPreset === "custom" ? value : PRESETS.ielts;
    return JSON.stringify(seed, null, 2);
  });
  const [customError, setCustomError] = useState<string | null>(null);

  // When parent value changes externally, re-sync.
  useEffect(() => {
    const next = detectPreset(value ?? undefined);
    setPreset(next);
  }, [value]);

  const handlePreset = (next: BandingPreset) => {
    setPreset(next);
    if (next === "ielts") {
      onChange(undefined); // default → no override stored
    } else if (next === "custom") {
      try {
        const parsed = JSON.parse(customDraft) as BandingMapping;
        onChange(parsed);
        setCustomError(null);
      } catch {
        setCustomError("Custom JSON is not valid yet — fix to save.");
        onChange(undefined);
      }
    } else {
      onChange(PRESETS[next]);
    }
  };

  const handleCustomEdit = (raw: string) => {
    setCustomDraft(raw);
    try {
      const parsed = JSON.parse(raw) as BandingMapping;
      if (
        !parsed.thresholds
        || !parsed.tierBands
        || typeof parsed.thresholds.secure !== "number"
        || typeof parsed.tierBands.secure !== "number"
      ) {
        setCustomError("Mapping must include numeric thresholds + tierBands for all 4 tiers.");
        return;
      }
      setCustomError(null);
      onChange(parsed);
    } catch (e: any) {
      setCustomError(`JSON parse error: ${e.message}`);
    }
  };

  const hintForPreset: Record<BandingPreset, string> = {
    ielts: "IELTS Speaking — 4 bands (Approaching Emerging / Emerging / Developing / Secure → 3 / 4 / 5.5 / 7). Default.",
    cefr: "CEFR — A2 / B1 / B2 / C2 tiers. Use for general language courses.",
    "five-level": "5-Level — Novice / Beginner / Intermediate / Expert. Use for skills-based non-language courses.",
    custom: "Define thresholds (0-1) and tier bands directly. Educator-defined labels supported via `tierLabels`.",
  };

  return (
    <div>
      <ChipSelect<BandingPreset>
        options={PRESET_OPTIONS}
        value={preset}
        onChange={handlePreset}
        label="Banding model"
        hint={hintForPreset[preset]}
      />

      {preset === "custom" && (
        <div className="hf-mt-sm">
          <textarea
            value={customDraft}
            onChange={(e) => handleCustomEdit(e.target.value)}
            rows={14}
            spellCheck={false}
            className="hf-input"
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              minHeight: 220,
              resize: "vertical",
            }}
          />
          {customError && (
            <div className="hf-banner hf-banner-warning hf-mt-xs">{customError}</div>
          )}
        </div>
      )}
    </div>
  );
}
