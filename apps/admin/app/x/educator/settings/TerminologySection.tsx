"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  type TerminologyPresetId,
  type TerminologyOverrides,
  TERMINOLOGY_PRESETS,
  PRESET_OPTIONS,
  resolveTerminology,
} from "@/lib/terminology/types";

const TERM_KEYS = ["institution", "cohort", "learner", "instructor", "supervisor"] as const;

interface Props {
  canEdit: boolean;
}

export function TerminologySection({ canEdit }: Props) {
  const [termPreset, setTermPreset] = useState<TerminologyPresetId>("corporate");
  const [termOverrides, setTermOverrides] = useState<TerminologyOverrides>({});
  const [showCustomize, setShowCustomize] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resolvedTerms = resolveTerminology({ preset: termPreset, overrides: termOverrides });

  useEffect(() => {
    fetch("/api/institution/terminology")
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok) {
          if (res.preset) setTermPreset(res.preset);
          if (res.overrides) {
            setTermOverrides(res.overrides);
            if (Object.keys(res.overrides).length > 0) setShowCustomize(true);
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (preset: TerminologyPresetId, overrides: TerminologyOverrides) => {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch("/api/institution/terminology", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset,
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus("saved");
        saveTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, []);

  const handlePresetChange = (preset: TerminologyPresetId) => {
    if (!canEdit) return;
    setTermPreset(preset);
    setTermOverrides({});
    setShowCustomize(false);
    save(preset, {});
  };

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-gap-sm">
        <div className="hf-spinner hf-spinner-sm" />
        <span className="hf-text-sm hf-text-muted">Loading...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
        <p className="hf-text-sm hf-text-muted hf-flex-1">
          Choose how your institution labels key concepts. This affects sidebar navigation and dashboard labels.
        </p>
        {saveStatus === "saving" && (
          <span className="hf-save-status hf-save-status--saving">
            <div className="hf-spinner hf-spinner-xs" /> Saving...
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="hf-save-status hf-save-status--saved">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="hf-save-status hf-save-status--error">
            Failed to save
          </span>
        )}
      </div>

      {/* Preset picker */}
      <div className="hf-preset-grid hf-mb-md">
        {PRESET_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`hf-preset-card${termPreset === opt.id ? " hf-preset-card--selected" : ""}${!canEdit ? " hf-preset-card--disabled" : ""}`}
            onClick={() => handlePresetChange(opt.id)}
            disabled={!canEdit}
          >
            <span className="hf-preset-card-name">{opt.label}</span>
            <span className="hf-preset-card-traits">{opt.description}</span>
          </button>
        ))}
      </div>

      {/* Preview table */}
      <div className="hf-card hf-mb-sm hf-term-preview-card">
        <div className="hf-text-xs hf-text-muted hf-mb-xs hf-preview-header">
          Preview
        </div>
        <div className="hf-term-preview">
          {TERM_KEYS.map((key) => (
            <div key={key} className="hf-term-preview-row">
              <span className="hf-term-preview-key">{key}</span>
              <span className="hf-term-preview-val">
                {resolvedTerms[key]}
                {termOverrides[key] && (
                  <span className="hf-text-xs hf-term-custom-badge">custom</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Customize toggle */}
      {canEdit && (
        <button
          type="button"
          className="hf-btn hf-btn-ghost hf-btn-sm"
          onClick={() => setShowCustomize(!showCustomize)}
        >
          {showCustomize ? "Hide customisation" : "Customise individual terms"}
        </button>
      )}

      {/* Custom term fields */}
      {showCustomize && canEdit && (
        <div className="hf-flex-col hf-gap-sm hf-mt-md">
          {TERM_KEYS.map((key) => (
            <div key={key}>
              <span className="hf-label hf-label-block hf-mb-xs hf-term-preview-key">{key}</span>
              <input
                type="text"
                className="hf-input"
                value={termOverrides[key] ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setTermOverrides((prev) => {
                    const next = { ...prev };
                    if (!val.trim()) {
                      delete next[key];
                    } else {
                      next[key] = val;
                    }
                    // Debounce save
                    clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(() => save(termPreset, next), 800);
                    return next;
                  });
                }}
                placeholder={TERMINOLOGY_PRESETS[termPreset][key]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
