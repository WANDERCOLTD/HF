/**
 * Per-caller voice provider override (AnyVoice #1027).
 *
 * Small inline panel on the caller detail page. Shows:
 *   - The raw override (what's stored on Caller.voiceProvider)
 *   - The resolved provider (cascade output — what the system will use)
 *   - The cascade source (caller / cohort / playbook / system) so the
 *     educator can see WHICH layer took effect
 *   - A select of enabled providers + a "Use system default" option
 *
 * PATCHes /api/callers/[callerId] with `voiceProvider: <slug | null>`.
 * Empty string clears the override.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

interface VoiceProviderState {
  override: string | null;
  resolved: { slug: string; source: "caller" | "cohort" | "playbook" | "system" };
  options: Array<{ slug: string; displayName: string }>;
}

const SOURCE_LABEL: Record<VoiceProviderState["resolved"]["source"], string> = {
  caller: "this learner's override",
  cohort: "cohort override",
  playbook: "course override",
  system: "system default",
};

export function VoiceProviderOverride({ callerId }: { callerId: string }) {
  const [state, setState] = useState<VoiceProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>(""); // "" = use system default
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/callers/${callerId}/voice-provider`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState(body);
      setDraft(body.override ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setErr(null);
    setSavedMessage(null);
    try {
      const res = await fetch(`/api/callers/${callerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceProvider: draft || null }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSavedMessage("Saved.");
      await load();
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="hf-card">
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading" /> Loading voice provider&hellip;
        </div>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="hf-card">
        <div className="hf-banner hf-banner-error">{err ?? "Failed to load"}</div>
      </section>
    );
  }

  const dirty = draft !== (state.override ?? "");

  return (
    <section className="hf-card">
      <h3 className="hf-section-title">Voice provider</h3>
      <p className="hf-section-desc">
        Routes this learner&rsquo;s voice calls to a specific provider. Leave on &ldquo;Use system
        default&rdquo; unless you have a reason to override (cost, quality experiment, regional
        constraint). The system will use{" "}
        <strong>{state.resolved.slug}</strong> for the next call (from {SOURCE_LABEL[state.resolved.source]}).
      </p>

      {err ? <div className="hf-banner hf-banner-error">{err}</div> : null}
      {savedMessage ? <div className="hf-banner hf-banner-success">{savedMessage}</div> : null}

      <label className="hf-label" htmlFor="voice-provider-select">
        Override
      </label>
      <select
        id="voice-provider-select"
        className="hf-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      >
        <option value="">Use system default ({state.resolved.source === "system" ? state.resolved.slug : "—"})</option>
        {state.options.map((opt) => (
          <option key={opt.slug} value={opt.slug}>
            {opt.displayName} ({opt.slug})
          </option>
        ))}
      </select>

      <div className="hf-card-footer">
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save override"}
        </button>
      </div>
    </section>
  );
}
