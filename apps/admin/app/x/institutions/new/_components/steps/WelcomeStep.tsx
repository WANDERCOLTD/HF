"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";

export function WelcomeStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const institutionName = getData<string>("institutionName") ?? "";
  const typeSlug = getData<string>("typeSlug") ?? "";
  const [welcomeMessage, setWelcomeMessage] = useState(getData<string>("welcomeMessage") ?? "");

  // AI suggestion state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const fetchedRef = useRef(false);

  // Auto-fetch suggestions when step mounts (institution name known from prior step)
  useEffect(() => {
    if (!institutionName || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoadingSuggestions(true);

    fetch("/api/institutions/suggest-welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionName, typeSlug }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinue = () => {
    setData("welcomeMessage", welcomeMessage);
    onNext();
  };

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Welcome message</h1>
          <p className="hf-page-subtitle">Set the first words learners see when they join</p>
        </div>

        <div className="hf-mb-lg">
          <div className="hf-label-row hf-mb-xs">
            <FieldHint label="Welcome Message" hint={WIZARD_HINTS["institution.welcome"]} labelClass="hf-label" />
            {(loadingSuggestions || suggestions.length > 0) && (
              <span
                className={`hf-field-hint-ai${loadingSuggestions ? " hf-field-hint-ai--loading" : ""}`}
                title="AI is generating welcome message suggestions"
              >
                <Sparkles size={14} />
              </span>
            )}
          </div>

          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder={`Welcome to ${institutionName || "our institution"}! Our AI tutors help every learner build confidence.`}
            rows={3}
            className="hf-input"
          />

          <div className="hf-suggest-slot">
            {loadingSuggestions ? (
              <div className="hf-ai-loading-row">
                <Loader2 size={12} className="hf-spinner" />
                <span className="hf-text-xs hf-text-muted">Suggesting…</span>
              </div>
            ) : suggestions.length > 0 ? (
              <>
                <div className="hf-ai-inline-hint">
                  <Sparkles size={11} />
                  Suggestions
                </div>
                <div className="hf-suggestion-chips">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="hf-suggestion-chip"
                      onClick={() => {
                        setWelcomeMessage(s);
                        setSuggestions((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="hf-suggest-slot__hint">
                <Sparkles size={11} />
                Suggestions will appear shortly
              </span>
            )}
          </div>
        </div>
      </div>

      <StepFooter
        onBack={onPrev}
        onSkip={handleContinue}
        skipLabel="Skip"
        onNext={handleContinue}
        nextLabel="Continue"
      />
    </div>
  );
}
