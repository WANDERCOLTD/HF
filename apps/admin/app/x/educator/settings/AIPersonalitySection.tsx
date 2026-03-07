"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

// ── Preset definitions (mirroring agent-tuning.ts) ─

const COMMUNICATION_PRESETS = [
  { id: "friendly-professor", name: "Friendly Professor", traits: ["Warm", "Formal", "Approachable"] },
  { id: "socratic-mentor", name: "Socratic Mentor", traits: ["Warm", "Conversational", "Thoughtful"] },
  { id: "drill-instructor", name: "Drill Instructor", traits: ["Precise", "Formal", "Authoritative"] },
  { id: "casual-peer", name: "Casual Peer", traits: ["Relaxed", "Informal", "Friendly"] },
] as const;

const TEACHING_PRESETS = [
  { id: "discovery-guide", name: "Discovery Guide", traits: ["Facilitative", "Patient", "Exploratory"] },
  { id: "stretch-mentor", name: "Stretch Mentor", traits: ["Challenging", "Questioning", "Growth-oriented"] },
  { id: "clear-instructor", name: "Clear Instructor", traits: ["Direct", "Clear", "Supportive"] },
  { id: "tough-love-coach", name: "Tough Love Coach", traits: ["Demanding", "Direct", "Results-driven"] },
] as const;

interface Props {
  domainId: string | null;
  canEdit: boolean;
}

export function AIPersonalitySection({ domainId, canEdit }: Props) {
  const [commPreset, setCommPreset] = useState<string>("friendly-professor");
  const [teachPreset, setTeachPreset] = useState<string>("clear-instructor");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadPresets = useCallback(async () => {
    if (!domainId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/domains/${domainId}`);
      const data = await res.json();
      if (data.ok) {
        const targets = data.domain?.onboardingDefaultTargets;
        // Read from _-prefixed metadata keys (API route stores presets there)
        if (targets?._communicationPreset) setCommPreset(targets._communicationPreset);
        if (targets?._teachingPreset) setTeachPreset(targets._teachingPreset);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [domainId]);

  useEffect(() => { loadPresets(); }, [loadPresets]);

  const save = useCallback(async (comm: string, teach: string) => {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch(`/api/domains/${domainId}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingDefaultTargets: {
            communicationPreset: comm,
            teachingPreset: teach,
          },
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
  }, [domainId]);

  if (!domainId) {
    return (
      <div className="hf-no-domain-hint">
        Select a domain above to configure AI personality.
      </div>
    );
  }

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
          Choose how the AI communicates and teaches. New courses inherit these defaults.
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

      {/* Communication style */}
      <div className="hf-mb-lg">
        <span className="hf-label hf-label-block hf-mb-xs">Communication style</span>
        <div className="hf-preset-grid">
          {COMMUNICATION_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`hf-preset-card${commPreset === p.id ? " hf-preset-card--selected" : ""}${!canEdit ? " hf-preset-card--disabled" : ""}`}
              onClick={() => { if (!canEdit) return; setCommPreset(p.id); save(p.id, teachPreset); }}
              disabled={!canEdit}
            >
              <span className="hf-preset-card-name">{p.name}</span>
              <span className="hf-preset-card-traits">{p.traits.join(" · ")}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Teaching approach */}
      <div className="hf-mb-md">
        <span className="hf-label hf-label-block hf-mb-xs">Teaching approach</span>
        <div className="hf-preset-grid">
          {TEACHING_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`hf-preset-card${teachPreset === p.id ? " hf-preset-card--selected" : ""}${!canEdit ? " hf-preset-card--disabled" : ""}`}
              onClick={() => { if (!canEdit) return; setTeachPreset(p.id); save(commPreset, p.id); }}
              disabled={!canEdit}
            >
              <span className="hf-preset-card-name">{p.name}</span>
              <span className="hf-preset-card-traits">{p.traits.join(" · ")}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="hf-text-xs hf-text-muted">
        <Link href={`/x/domains?id=${domainId}`} className="hf-link">
          Fine-tune with the full personality matrix
        </Link>
      </p>
    </div>
  );
}
