"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { AdvancedSection } from "./AdvancedSection";
import { ErrorBanner } from "./ErrorBanner";
import { deriveParameterMap } from "@/lib/agent-tuner/derive";
import type {
  AgentTunerPill,
  AgentTunerProps,
  InterpretResponse,
} from "@/lib/agent-tuner/types";

/**
 * AgentTuner — Intent-driven behavior tuning.
 *
 * Users describe agent style in natural language, AI translates to pills
 * backed by real Parameter records. Pills are manageable chips; the numeric
 * details stay hidden. Wrapped in <AdvancedSection> by default; pass `bare`
 * to render inline when the parent provides its own section header.
 *
 * Usage:
 *   <AgentTuner
 *     context={{ personaSlug: "TUT-001", subjectName: "Level 2 Hygiene" }}
 *     onChange={({ pills, parameterMap }) => { ... }}
 *   />
 *   // Or without AdvancedSection wrapper:
 *   <AgentTuner bare onChange={...} />
 */
export function AgentTuner({
  initialPills,
  context,
  onChange,
  label = "Advanced: Tune behavior",
  bare = false,
}: AgentTunerProps) {
  const [pills, setPills] = useState<AgentTunerPill[]>(initialPills ?? []);
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fire onChange whenever pills change (skip initial mount with empty pills)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (pills.length > 0) {
        onChange({ pills, parameterMap: deriveParameterMap(pills) });
      }
      return;
    }
    onChange({ pills, parameterMap: deriveParameterMap(pills) });
  }, [pills]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggest = useCallback(async () => {
    const trimmed = intent.trim();
    if (trimmed.length < 3 || loading) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/agent-tuner/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: trimmed, context }),
        signal: controller.signal,
      });

      const data: InterpretResponse = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      // Merge new pills with existing (dedup by id)
      setPills((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newPills = (data.pills || []).filter((p) => !existingIds.has(p.id));
        return [...prev, ...newPills];
      });

      if (data.interpretation) {
        setInterpretation(data.interpretation);
      }

      setIntent("");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [intent, loading, context]);

  const removePill = useCallback((pillId: string) => {
    setPills((prev) => prev.filter((p) => p.id !== pillId));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        suggest();
      }
    },
    [suggest]
  );

  const tunerContent = (
    <div className="hf-tuner-layout">
      {/* ── Intent input + Suggest button ── */}
      <div className="hf-tuner-input-row">
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. warm, patient, challenges thinking"
          className="hf-input hf-tuner-input-fill"
        />
        <button
          onClick={suggest}
          disabled={intent.trim().length < 3 || loading}
          className="hf-btn hf-btn-secondary hf-tuner-suggest-btn"
        >
          {loading ? (
            <Loader2 size={14} className="hf-spinner" />
          ) : (
            <Sparkles size={14} />
          )}
          Suggest
        </button>
      </div>

      {/* ── Error banner ── */}
      <ErrorBanner error={error} />

      {/* ── Interpretation summary ── */}
      {interpretation && pills.length > 0 && (
        <div className="hf-tuner-interpretation">
          {interpretation}
        </div>
      )}

      {/* ── Pills ── */}
      {pills.length > 0 && (
        <div className="hf-tuner-pills">
          {pills.map((pill) => (
            <span
              key={pill.id}
              title={`${pill.description} (${pill.parameters.length} parameter${pill.parameters.length !== 1 ? "s" : ""})`}
              className="hf-tuner-pill"
            >
              {pill.label}
              <button
                onClick={() => removePill(pill.id)}
                className="hf-tuner-pill-remove"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (bare) return tunerContent;

  return (
    <AdvancedSection label={label}>
      {tunerContent}
    </AdvancedSection>
  );
}
