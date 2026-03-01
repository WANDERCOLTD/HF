"use client";

/**
 * Prompt Preview Section — Live rendered voice prompt.
 * Fetches from /api/domains/:id/preview-prompt and displays
 * the composed prompt in a read-only viewer.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, Copy, Check } from "lucide-react";

export function PromptPreviewSection() {
  const { state } = useHolo();
  const domainId = state.id;

  const [promptText, setPromptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchPrompt = () => {
    if (!domainId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/domains/${domainId}/preview-prompt`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setPromptText(data.voicePrompt || data.promptSummary || "No prompt generated.");
        } else {
          setError(data.error || "Failed to generate prompt preview.");
        }
      })
      .catch(() => setError("Network error fetching prompt preview."))
      .finally(() => setLoading(false));
  };

  // Load on mount
  useEffect(() => {
    fetchPrompt();
  }, [domainId]);

  const handleCopy = () => {
    if (promptText) {
      navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!domainId) {
    return <div className="hp-section-empty">No domain selected.</div>;
  }

  return (
    <div className="hp-section-prompt">
      {/* Toolbar */}
      <div className="hp-prompt-toolbar">
        <button
          className="hp-prompt-action"
          onClick={fetchPrompt}
          disabled={loading}
          title="Refresh prompt"
        >
          <RefreshCw size={14} className={loading ? "hf-spinner" : ""} />
          Refresh
        </button>
        <button
          className="hp-prompt-action"
          onClick={handleCopy}
          disabled={!promptText || loading}
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Content */}
      {loading && !promptText && (
        <div className="hp-prompt-loading">
          <div className="hf-spinner" />
          <span>Composing prompt…</span>
        </div>
      )}

      {error && (
        <div className="hp-prompt-error">{error}</div>
      )}

      {promptText && (
        <pre className="hp-prompt-viewer">{promptText}</pre>
      )}

      {!loading && !error && !promptText && (
        <div className="hp-section-empty">
          <Sparkles size={24} className="hp-section-empty-icon" />
          <div>No prompt available.</div>
          <div className="hp-section-empty-hint">
            Configure identity, curriculum, and onboarding first.
          </div>
        </div>
      )}
    </div>
  );
}
