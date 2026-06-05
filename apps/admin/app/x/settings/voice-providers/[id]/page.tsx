"use client";

/**
 * Voice Provider edit page (AnyVoice #1031, re-shaped #1044).
 *
 * Renders three sections:
 *   1. Cross-provider settings (system-wide; same on every provider page)
 *   2. Supported features (adapter capabilities badges)
 *   3. Per-provider form (generated from `adapter.getConfigSchema()`)
 *
 * Credentials are never pre-filled with raw values — masked on the API
 * side. Sensitive fields render as password inputs and write into
 * `credentials`; non-sensitive fields write into `config`.
 *
 * ADMIN-only via the API layer.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface ConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  help?: string;
  enumValues?: string[];
  default?: unknown;
  sensitive?: boolean;
  required?: boolean;
}

interface Capabilities {
  endOfCallEvents: "single" | "split";
  hasKnowledgeCallback: boolean;
  toolCallsOverWebSocket: boolean;
  supportsRequestEndCall: boolean;
}

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

interface SystemSettings {
  fallbackOnAdapterError: "silent" | "throw" | "escalate";
  maxCostPerCallUsd: number | null;
  auditRetentionDays: number;
  defaultProviderSlug: string;
}

export default function VoiceProviderEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [row, setRow] = useState<VoiceProviderRow | null>(null);
  const [configSchema, setConfigSchema] = useState<ConfigField[] | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingSystem, setSavingSystem] = useState(false);

  // Per-provider form state
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [provRes, sysRes] = await Promise.all([
        fetch(`/api/voice-providers/${id}`),
        fetch(`/api/voice-system-settings`),
      ]);
      const provBody = await provRes.json();
      if (!provRes.ok || !provBody.ok) {
        throw new Error(provBody.error ?? `HTTP ${provRes.status}`);
      }
      setRow(provBody.provider);
      setConfigSchema(provBody.configSchema?.fields ?? null);
      setCapabilities(provBody.capabilities ?? null);
      setDisplayName(provBody.provider.displayName);
      setEnabled(provBody.provider.enabled);

      // Seed form fields. Sensitive fields start blank (operator types a
      // new value to replace the current one). Non-sensitive fields are
      // pre-filled from config / credentials.
      const seed: Record<string, string | boolean> = {};
      for (const f of (provBody.configSchema?.fields ?? []) as ConfigField[]) {
        if (f.sensitive) {
          seed[f.key] = "";
          continue;
        }
        const v =
          (provBody.provider.config as Record<string, unknown>)[f.key] ??
          (provBody.provider.credentials as Record<string, unknown>)[f.key];
        if (f.type === "boolean") {
          seed[f.key] = v === true;
        } else {
          seed[f.key] = v === undefined || v === null ? "" : String(v);
        }
      }
      setFieldValues(seed);

      if (sysRes.ok) {
        const sysBody = await sysRes.json();
        if (sysBody.ok) setSystemSettings(sysBody.settings);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProvider() {
    if (!row || !configSchema) return;
    setSaving(true);
    setErr(null);
    try {
      const credentials: Record<string, unknown> = {
        ...row.credentials,
      };
      const config: Record<string, unknown> = { ...row.config };
      // Drop masked sentinels so we don't write "***" back to DB
      for (const k of Object.keys(credentials)) {
        if (credentials[k] === "***" || credentials[k] === "[not set]") {
          delete credentials[k];
        }
      }

      for (const f of configSchema) {
        const raw = fieldValues[f.key];
        // Sensitive empty string = keep current value
        if (f.sensitive && raw === "") continue;
        let value: unknown;
        if (f.type === "number") {
          if (raw === "" || raw === undefined) {
            value = undefined;
          } else {
            const n = Number(raw);
            if (!Number.isFinite(n)) {
              throw new Error(`${f.label}: not a number`);
            }
            value = n;
          }
        } else if (f.type === "boolean") {
          value = Boolean(raw);
        } else {
          value = raw === "" ? undefined : raw;
        }
        if (value === undefined) continue;
        if (f.sensitive) {
          credentials[f.key] = value;
        } else {
          config[f.key] = value;
        }
      }

      const patch: Record<string, unknown> = {
        displayName,
        enabled,
        credentials,
        config,
      };
      const res = await fetch(`/api/voice-providers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
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

  async function saveSystem() {
    if (!systemSettings) return;
    setSavingSystem(true);
    setErr(null);
    try {
      const res = await fetch("/api/voice-system-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(systemSettings),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSystemSettings(body.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSystem(false);
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

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">Edit voice provider</h1>
      <p className="hf-page-subtitle">
        slug: <code>{row.slug}</code> · adapter: <code>{row.adapterKey}</code>
        {row.isDefault ? " · default" : ""}
      </p>

      {err && (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      )}

      {/* 1. Cross-provider settings (system-wide) */}
      {systemSettings && (
        <section className="hf-card">
          <h2 className="hf-section-title">Cross-provider settings</h2>
          <p className="hf-section-desc">
            System-wide. Applies to every voice provider — change once, propagates everywhere.
          </p>

          <label className="hf-label" htmlFor="fallbackOnAdapterError">
            Fallback on adapter error
          </label>
          <select
            id="fallbackOnAdapterError"
            className="hf-input"
            value={systemSettings.fallbackOnAdapterError}
            onChange={(e) =>
              setSystemSettings({
                ...systemSettings,
                fallbackOnAdapterError: e.target.value as SystemSettings["fallbackOnAdapterError"],
              })
            }
          >
            <option value="throw">throw (return 500 — fail loud)</option>
            <option value="silent">silent (return ok — fail quiet)</option>
            <option value="escalate">escalate (log + page on-call)</option>
          </select>

          <label className="hf-label" htmlFor="maxCostPerCallUsd">
            Max cost per call (USD)
          </label>
          <input
            id="maxCostPerCallUsd"
            className="hf-input"
            type="number"
            step="0.01"
            min="0"
            placeholder="leave blank for no cap"
            value={
              systemSettings.maxCostPerCallUsd === null
                ? ""
                : String(systemSettings.maxCostPerCallUsd)
            }
            onChange={(e) =>
              setSystemSettings({
                ...systemSettings,
                maxCostPerCallUsd: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <p className="hf-section-desc">
            Hard cap. When cumulative live cost exceeds this, the active provider&apos;s end-call API is invoked. Requires capability <code>supportsRequestEndCall</code>.
          </p>

          <label className="hf-label" htmlFor="auditRetentionDays">
            Audit retention (days)
          </label>
          <input
            id="auditRetentionDays"
            className="hf-input"
            type="number"
            step="1"
            min="1"
            value={String(systemSettings.auditRetentionDays)}
            onChange={(e) =>
              setSystemSettings({
                ...systemSettings,
                auditRetentionDays: Number(e.target.value),
              })
            }
          />

          <label className="hf-label" htmlFor="defaultProviderSlug">
            Default provider slug
          </label>
          <input
            id="defaultProviderSlug"
            className="hf-input"
            type="text"
            placeholder="leave blank to disable fallback"
            value={systemSettings.defaultProviderSlug}
            onChange={(e) =>
              setSystemSettings({
                ...systemSettings,
                defaultProviderSlug: e.target.value,
              })
            }
          />
          <p className="hf-section-desc">
            Fallback when <code>Caller.voiceProvider</code> is null AND no row is marked default.
          </p>

          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={saveSystem}
            disabled={savingSystem}
          >
            {savingSystem ? "Saving…" : "Save cross-provider settings"}
          </button>
        </section>
      )}

      {/* 2. Capabilities badges */}
      {capabilities && (
        <section className="hf-card">
          <h2 className="hf-section-title">Supported features</h2>
          <p className="hf-section-desc">
            What this adapter exposes. Drives admin form, route dispatch, and telemetry controls.
          </p>
          <ul className="hf-list-row-list">
            <li className="hf-list-row">
              <div>
                <div className="hf-list-row-title">End-of-call events</div>
                <div className="hf-list-row-subtitle">
                  {capabilities.endOfCallEvents === "single"
                    ? "Single webhook"
                    : "Split (basic + analysis merged)"}
                </div>
              </div>
            </li>
            <li className="hf-list-row">
              <div>
                <div className="hf-list-row-title">Tool calls</div>
                <div className="hf-list-row-subtitle">
                  {capabilities.toolCallsOverWebSocket ? "WebSocket" : "HTTP"}
                </div>
              </div>
            </li>
            <li className="hf-list-row">
              <div>
                <div className="hf-list-row-title">Knowledge callback</div>
                <div className="hf-list-row-subtitle">
                  {capabilities.hasKnowledgeCallback ? "HTTP per-turn" : "Pre-uploaded IDs"}
                </div>
              </div>
            </li>
            <li className="hf-list-row">
              <div>
                <div className="hf-list-row-title">Server-side end-call</div>
                <div className="hf-list-row-subtitle">
                  {capabilities.supportsRequestEndCall
                    ? "Supported (cost cap available)"
                    : "Not supported (cost cap is observe-only)"}
                </div>
              </div>
            </li>
          </ul>
        </section>
      )}

      {/* 3. Per-provider form (schema-driven) */}
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
          />{" "}
          Enabled (factory will refuse to instantiate when off)
        </label>
      </section>

      {configSchema && configSchema.length > 0 ? (
        <section className="hf-card">
          <h2 className="hf-section-title">Provider configuration</h2>
          <p className="hf-section-desc">
            Fields declared by the <code>{row.adapterKey}</code> adapter. Sensitive fields are masked — leave blank to keep the current value.
          </p>
          {configSchema.map((f) => (
            <div key={f.key}>
              <label className="hf-label" htmlFor={`field-${f.key}`}>
                {f.label} {f.required ? <span aria-hidden>*</span> : null}
              </label>
              {f.type === "enum" ? (
                <select
                  id={`field-${f.key}`}
                  className="hf-input"
                  value={String(fieldValues[f.key] ?? "")}
                  onChange={(e) =>
                    setFieldValues({ ...fieldValues, [f.key]: e.target.value })
                  }
                >
                  <option value="">— select —</option>
                  {(f.enumValues ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : f.type === "boolean" ? (
                <input
                  id={`field-${f.key}`}
                  type="checkbox"
                  checked={Boolean(fieldValues[f.key])}
                  onChange={(e) =>
                    setFieldValues({ ...fieldValues, [f.key]: e.target.checked })
                  }
                />
              ) : (
                <input
                  id={`field-${f.key}`}
                  className="hf-input"
                  type={f.sensitive ? "password" : f.type === "number" ? "number" : "text"}
                  autoComplete={f.sensitive ? "new-password" : undefined}
                  placeholder={f.sensitive ? "leave blank to keep current" : ""}
                  value={String(fieldValues[f.key] ?? "")}
                  onChange={(e) =>
                    setFieldValues({ ...fieldValues, [f.key]: e.target.value })
                  }
                />
              )}
              {f.help && <p className="hf-section-desc">{f.help}</p>}
            </div>
          ))}
        </section>
      ) : (
        <section className="hf-card">
          <p className="hf-section-desc">
            Adapter <code>{row.adapterKey}</code> declares no provider-specific configuration.
          </p>
        </section>
      )}

      <div className="hf-card-footer">
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={saveProvider}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save provider"}
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
