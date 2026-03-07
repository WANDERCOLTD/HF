"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2 } from "lucide-react";

interface Props {
  domainId: string | null;
  canEdit: boolean;
}

export function WelcomeSection({ domainId, canEdit }: Props) {
  const [welcome, setWelcome] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadWelcome = useCallback(async () => {
    if (!domainId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/domains/${domainId}`);
      const data = await res.json();
      if (data.ok) {
        setWelcome(data.domain?.onboardingWelcome || "");
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [domainId]);

  useEffect(() => { loadWelcome(); }, [loadWelcome]);

  const save = useCallback(async (text: string) => {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch(`/api/domains/${domainId}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingWelcome: text }),
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

  const handleChange = (text: string) => {
    setWelcome(text);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => save(text), 800);
  };

  if (!domainId) {
    return (
      <div className="hf-no-domain-hint">
        Select a domain above to configure the welcome message.
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
        <span className="hf-label hf-flex-1">Opening message</span>
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

      <textarea
        className="hf-input hf-textarea-resize-v"
        rows={3}
        placeholder="e.g. Hi! I'm your learning assistant. What would you like to work on today?"
        value={welcome}
        onChange={(e) => handleChange(e.target.value)}
        disabled={!canEdit}
      />

      <p className="hf-text-xs hf-text-muted hf-mt-sm">
        The AI speaks this message verbatim at the start of every new caller&apos;s first session.
        Leave blank for the AI to generate its own greeting.
      </p>
    </div>
  );
}
