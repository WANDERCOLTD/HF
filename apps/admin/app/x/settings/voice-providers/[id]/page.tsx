"use client";

/**
 * Voice Provider edit page (AnyVoice #1031).
 *
 * Loads a single VoiceProvider row, presents a form to update mutable
 * fields. Credentials are NEVER pre-filled with raw values — the form
 * shows `***` placeholder text; editing a credential replaces it
 * entirely. If the operator leaves a credential field blank, the
 * existing value is preserved (form sends only modified fields).
 *
 * ADMIN-only via the API layer.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface VoiceProviderRow {
  id: string;
  slug: string;
  displayName: string;
  adapterKey: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
}

export default function VoiceProviderEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [row, setRow] = useState<VoiceProviderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state — credential overrides start empty (means "don't change")
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [configText, setConfigText] = useState("{}");
  const [credentialOverrides, setCredentialOverrides] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/voice-providers/${id}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRow(body.provider);
      setDisplayName(body.provider.displayName);
      setEnabled(body.provider.enabled);
      setConfigText(JSON.stringify(body.provider.config ?? {}, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!row) return;
    setSaving(true);
    setErr(null);
    try {
      let configParsed: Record<string, unknown> = {};
      try {
        configParsed = JSON.parse(configText);
        if (configParsed === null || typeof configParsed !== "object" || Array.isArray(configParsed)) {
          throw new Error("config must be a JSON object");
        }
      } catch (e) {
        throw new Error(`Invalid config JSON: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Build credentials payload — merge overrides into existing keys.
      // Empty string = "don't change"; non-empty = overwrite that key.
      const mergedCreds: Record<string, unknown> = { ...row.credentials };
      for (const [key, value] of Object.entries(credentialOverrides)) {
        if (value !== "") mergedCreds[key] = value;
      }
      // Don't send the masked placeholder back to the server
      for (const [key, value] of Object.entries(mergedCreds)) {
        if (value === "***" || value === "[not set]") delete mergedCreds[key];
      }

      const patch: Record<string, unknown> = {
        displayName,
        enabled,
        config: configParsed,
        credentials: mergedCreds,
      };

      const res = await fetch(`/api/voice-providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push("/x/settings/voice-providers");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="hf-page">
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading" /> Loading provider&hellip;
        </div>
      </main>
    );
  }
  if (!row) {
    return (
      <main className="hf-page">
        <div className="hf-banner hf-banner-error">{err ?? "Provider not found"}</div>
      </main>
    );
  }

  const knownCredentialKeys = Object.keys(row.credentials);

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">Edit voice provider</h1>
      <p className="hf-page-subtitle">
        slug: <code>{row.slug}</code> · adapter: <code>{row.adapterKey}</code>
        {row.isDefault ? " · default" : ""}
      </p>

      {err ? (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      ) : null}

      <section className="hf-card">
        <label className="hf-label" htmlFor="displayName">
          Display name
        </label>
        <input
          id="displayName"
          className="hf-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <label className="hf-label" htmlFor="enabled">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {" "}Enabled (factory will refuse to instantiate when off)
        </label>
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Credentials</h2>
        <p className="hf-section-desc">
          Existing values are masked. Leave a field blank to keep the current value. Type a new
          value to replace it. New values are persisted immediately on Save.
        </p>
        {knownCredentialKeys.map((key) => (
          <div key={key}>
            <label className="hf-label" htmlFor={`cred-${key}`}>
              {key} <span className="hf-section-desc">(current: {String(row.credentials[key])})</span>
            </label>
            <input
              id={`cred-${key}`}
              className="hf-input"
              type="password"
              autoComplete="new-password"
              placeholder="leave blank to keep current"
              value={credentialOverrides[key] ?? ""}
              onChange={(e) =>
                setCredentialOverrides((c) => ({ ...c, [key]: e.target.value }))
              }
            />
          </div>
        ))}
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Config (non-sensitive)</h2>
        <p className="hf-section-desc">JSON object. Provider-specific keys (baseUrl, model, voiceId, etc.).</p>
        <textarea
          className="hf-input"
          rows={6}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
        />
      </section>

      <div className="hf-card-footer">
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="hf-btn hf-btn-secondary"
          onClick={() => router.push("/x/settings/voice-providers")}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
