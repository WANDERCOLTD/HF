"use client";

import { useState, useRef, useCallback } from "react";
import { X, Sparkles } from "lucide-react";

// ── OutcomesEditor ────────────────────────────────────
//
// Inline outcome chip editor for v3 course builder.
// Displays AI-suggested outcomes (with badge + dismiss) alongside
// teacher-typed outcomes. Manual input is always active.

export interface OutcomesEditorProps {
  /** All current outcomes (AI + manual merged) */
  outcomes: string[];
  /** Called when outcomes change */
  onChange: (outcomes: string[]) => void;
  /** AI-suggested outcomes not yet accepted/dismissed */
  suggestions: string[];
  /** Called when a suggestion is accepted (moved to outcomes) */
  onAcceptSuggestion: (suggestion: string) => void;
  /** Called when a suggestion is dismissed */
  onDismissSuggestion: (suggestion: string) => void;
  /** Whether AI suggestions are still loading */
  suggestionsLoading?: boolean;
  /** Set of outcome strings that came from AI (for badge display) */
  aiOriginSet?: Set<string>;
}

export function OutcomesEditor({
  outcomes,
  onChange,
  suggestions,
  onAcceptSuggestion,
  onDismissSuggestion,
  suggestionsLoading,
  aiOriginSet,
}: OutcomesEditorProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addOutcome = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !outcomes.includes(trimmed)) {
      onChange([...outcomes, trimmed]);
      setInput("");
    }
  }, [input, outcomes, onChange]);

  const removeOutcome = useCallback(
    (index: number) => {
      onChange(outcomes.filter((_, i) => i !== index));
    },
    [outcomes, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addOutcome();
    }
  };

  return (
    <div>
      {/* Outcome chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {outcomes.map((outcome, i) => {
          const isAi = aiOriginSet?.has(outcome);
          return (
            <div
              key={outcome}
              className={
                "hf-draft-outcome-chip" +
                (isAi ? " hf-draft-outcome-chip-ai" : "")
              }
            >
              {isAi && <Sparkles size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />}
              <span>{outcome}</span>
              <button
                type="button"
                className="hf-draft-outcome-dismiss"
                onClick={() => removeOutcome(i)}
                title="Remove outcome"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* AI suggestion chips (not yet accepted) */}
        {suggestions.map((suggestion) => (
          <div
            key={`suggest-${suggestion}`}
            className="hf-draft-outcome-chip hf-draft-outcome-chip-ai"
            style={{ opacity: 0.7, cursor: "pointer" }}
            onClick={() => onAcceptSuggestion(suggestion)}
            title="Click to accept"
          >
            <Sparkles size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
            <span>{suggestion}</span>
            <button
              type="button"
              className="hf-draft-outcome-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                onDismissSuggestion(suggestion);
              }}
              title="Dismiss suggestion"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Skeleton chips while loading */}
        {suggestionsLoading && outcomes.length === 0 && suggestions.length === 0 && (
          <>
            <div className="hf-draft-skeleton" style={{ width: 200, height: 32, borderRadius: 8 }} />
            <div className="hf-draft-skeleton" style={{ width: 180, height: 32, borderRadius: 8 }} />
            <div className="hf-draft-skeleton" style={{ width: 220, height: 32, borderRadius: 8 }} />
          </>
        )}
      </div>

      {/* Manual input — always active */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          className="hf-input"
          placeholder="+ Type a learning outcome..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ flex: 1 }}
        />
        {input.trim() && (
          <button
            type="button"
            className="hf-btn hf-btn-secondary hf-btn-sm"
            onClick={addOutcome}
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}
