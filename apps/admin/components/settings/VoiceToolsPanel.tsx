"use client";

/**
 * Voice Tools admin panel (AnyVoice #1043).
 *
 * Per-tool enable/disable toggles reading from and writing back to the
 * TOOLS-001 spec's `enabled` field. Supersedes the per-tool boolean
 * toggles that lived under "Voice Calls" before #1043.
 *
 * SYSTEM-wide setting (single TOOLS-001 spec), so this panel lives
 * outside the per-provider voice-providers page. Linked from the
 * voice-providers list.
 */

import { useCallback, useEffect, useState } from "react";

interface Tool {
  name: string;
  description: string;
  enabled: boolean;
}

interface Props {
  showHeading?: boolean;
}

export function VoiceToolsPanel({ showHeading = false }: Props = {}) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/voice-tools");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTools(body.tools);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(name: string, enabled: boolean) {
    setSavingName(name);
    setErr(null);
    try {
      const res = await fetch("/api/voice-tools", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, enabled }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTools((rows) =>
        rows.map((t) => (t.name === name ? { ...t, enabled } : t)),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(null);
    }
  }

  if (loading) {
    return (
      <div className="hf-card">
        <div className="hf-spinner" aria-label="Loading voice tools" />
      </div>
    );
  }

  return (
    <section className="hf-card">
      {showHeading && (
        <>
          <h1 className="hf-page-title">Voice Tools</h1>
          <p className="hf-page-subtitle">
            Enable or disable individual tools available to voice callers.
            Changes apply to every voice provider — toggles write to the
            TOOLS-001 spec.
          </p>
        </>
      )}
      {!showHeading && (
        <>
          <h2 className="hf-section-title">Voice Tools</h2>
          <p className="hf-section-desc">
            System-wide per-tool enablement. Disabling a tool removes it
            from every voice provider&apos;s assistant config at call start.
          </p>
        </>
      )}

      {err && (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      )}

      {tools.length === 0 ? (
        <div className="hf-empty">
          No tools found in the TOOLS-001 spec. Run the seeder to populate.
        </div>
      ) : (
        <ul className="hf-list-row-list">
          {tools.map((t) => (
            <li key={t.name} className="hf-list-row">
              <div>
                <div className="hf-list-row-title">{t.name}</div>
                <div className="hf-list-row-subtitle">{t.description}</div>
              </div>
              <label className="hf-toggle-label">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  disabled={savingName === t.name}
                  onChange={(e) => toggle(t.name, e.target.checked)}
                  aria-label={`Enable tool ${t.name}`}
                />
                <span>{t.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
