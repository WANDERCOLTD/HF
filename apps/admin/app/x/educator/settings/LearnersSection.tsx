"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AUDIENCE_OPTIONS, type AudienceId } from "@/lib/prompt/composition/transforms/audience";
import { CheckCircle2 } from "lucide-react";

interface Props {
  domainId: string | null;
  canEdit: boolean;
}

export function LearnersSection({ domainId, canEdit }: Props) {
  const [audience, setAudience] = useState<AudienceId>("mixed");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadDefaults = useCallback(async () => {
    if (!domainId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/domains/${domainId}/lesson-plan-defaults`);
      const data = await res.json();
      if (data.ok && data.defaults?.audience) {
        setAudience(data.defaults.audience.value || "mixed");
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [domainId]);

  useEffect(() => { loadDefaults(); }, [loadDefaults]);

  const handleSelect = async (id: AudienceId) => {
    if (!canEdit || !domainId) return;
    setAudience(id);
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);

    try {
      const res = await fetch(`/api/domains/${domainId}/lesson-plan-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: id }),
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
  };

  if (!domainId) {
    return (
      <div className="hf-no-domain-hint">
        Select a domain above to configure learner settings.
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
      <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
        <span className="hf-label hf-flex-1">Default audience</span>
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

      <div className="hf-chip-row">
        {AUDIENCE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`hf-chip${audience === opt.id ? " hf-chip-selected" : ""}`}
            onClick={() => handleSelect(opt.id)}
            disabled={!canEdit}
            title={opt.description}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <p className="hf-text-xs hf-text-muted hf-mt-sm">
        {AUDIENCE_OPTIONS.find((o) => o.id === audience)?.description ||
          "The AI adjusts vocabulary, formality, and examples to suit this audience."}
      </p>

      {!canEdit && (
        <p className="hf-text-xs hf-text-muted hf-mt-sm">
          Only administrators can change this setting.
        </p>
      )}
    </div>
  );
}
