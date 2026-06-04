"use client";

/**
 * Voice Provider create page (AnyVoice #1031).
 *
 * Minimal form to register a new VoiceProvider row. slug is immutable
 * after creation (downstream tables reference it), so the form locks it
 * once typed and warns about the lock-in. adapterKey lists the keys
 * available in lib/voice/adapter-registry.ts (fetched at page mount via
 * a dedicated GET on /api/voice-providers/adapter-keys — TODO follow-up;
 * for v1 the operator types it and the API validates).
 *
 * ADMIN-only via the API layer.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VoiceProviderNewPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [adapterKey, setAdapterKey] = useState("vapi");
  const [credentialsText, setCredentialsText] = useState('{\n  "apiKey": "",\n  "webhookSecret": ""\n}');
  const [configText, setConfigText] = useState("{}");
  const [isDefault, setIsDefault] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    setErr(null);
    setSaving(true);
    try {
      let credentials: Record<string, unknown> = {};
      let config: Record<string, unknown> = {};
      try {
        credentials = JSON.parse(credentialsText);
        if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials)) {
          throw new Error("credentials must be a JSON object");
        }
      } catch (e) {
        throw new Error(`Invalid credentials JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        config = JSON.parse(configText);
        if (config === null || typeof config !== "object" || Array.isArray(config)) {
          throw new Error("config must be a JSON object");
        }
      } catch (e) {
        throw new Error(`Invalid config JSON: ${e instanceof Error ? e.message : String(e)}`);
      }

      const res = await fetch("/api/voice-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, displayName, adapterKey, credentials, config, isDefault, enabled }),
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

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">Add voice provider</h1>
      <p className="hf-page-subtitle">
        Register a new voice-call provider. The slug is permanent — pick carefully. Credentials
        are stored in the database and masked in every API response.
      </p>

      {err ? (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      ) : null}

      <section className="hf-card">
        <label className="hf-label" htmlFor="slug">
          Slug <span className="hf-section-desc">(permanent — lowercase letters, digits, hyphens; e.g. &ldquo;vapi&rdquo;, &ldquo;retell&rdquo;)</span>
        </label>
        <input
          id="slug"
          className="hf-input"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="retell"
        />

        <label className="hf-label" htmlFor="displayName">
          Display name
        </label>
        <input
          id="displayName"
          className="hf-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Retell AI"
        />

        <label className="hf-label" htmlFor="adapterKey">
          Adapter key <span className="hf-section-desc">(must match an entry in lib/voice/adapter-registry.ts)</span>
        </label>
        <input
          id="adapterKey"
          className="hf-input"
          type="text"
          value={adapterKey}
          onChange={(e) => setAdapterKey(e.target.value)}
        />

        <label className="hf-label">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {" "}Set as default (will unset the current default in the same transaction)
        </label>
        <label className="hf-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {" "}Enabled
        </label>
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Credentials</h2>
        <p className="hf-section-desc">
          JSON object. Sensitive keys (matching <code>*Key</code>, <code>*Secret</code>, <code>*Token</code>,
          <code>*Password</code>) are masked on every read.
        </p>
        <textarea
          className="hf-input"
          rows={6}
          value={credentialsText}
          onChange={(e) => setCredentialsText(e.target.value)}
        />
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Config (non-sensitive)</h2>
        <p className="hf-section-desc">JSON object. baseUrl, model, voiceId, etc.</p>
        <textarea
          className="hf-input"
          rows={4}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
        />
      </section>

      <div className="hf-card-footer">
        <button type="button" className="hf-btn hf-btn-primary" onClick={create} disabled={saving}>
          {saving ? "Creating…" : "Create"}
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
