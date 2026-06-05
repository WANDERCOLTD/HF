"use client";

/**
 * Voice Scoring Provider edit page (#1118).
 *
 * Renders three sections:
 *   1. Top-level row metadata (displayName, enabled toggle)
 *   2. Capabilities badges (adapter-declared)
 *   3. Per-provider form (generated from `adapter.getConfigSchema()`)
 *
 * Sensitive fields render as password inputs and never pre-fill with the
 * raw value — the GET endpoint masks them to `***` / `[not set]`. The
 * `fieldPresence` helper surfaces which fields currently have a saved
 * value so the operator can tell at a glance.
 *
 * Save behaviour matches the post-#1115 voice-providers pattern:
 *   - Stay on the page after save
 *   - Show a success banner naming which fields actually changed
 *   - Sensitive blank-on-save = keep current value
 *
 * No cross-provider system settings section — VoiceScoringSystemSettings
 * is explicitly out of scope for #1118 (no real cross-provider setting
 * exists yet). When one does, this page acquires a section matching the
 * voice-providers parallel.
 *
 * ADMIN-only via the API layer.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

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
  ieltsSupported: boolean;
  spontaneousSupported: boolean;
  scriptedSupported: boolean;
  acceptsRecordingUrl: boolean;
  requiresFileUpload: boolean;
  transcriptIncluded: boolean;
  perWordDiagnostics: boolean;
  prosodyFeatures: boolean;
}

interface SpeechAssessmentProviderRow {
  id: string;
  slug: string;
  displayName: string;
  adapterKey: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
}

/**
 * Compute whether a config field currently has a saved value in the DB.
 * Mirrors the voice-providers/[id]/page.tsx::fieldPresence helper (#1115).
 *
 * Sensitive fields: the GET response masks credentials to `***` (set) or
 * `[not set]` (unset) — we read that signal directly.
 *
 * Non-sensitive fields: the actual value is returned in `row.config`.
 * Empty string / undefined = unset.
 */
function fieldPresence(
  f: ConfigField,
  row: SpeechAssessmentProviderRow,
): { set: boolean; label: string } {
  if (f.sensitive) {
    const v = (row.credentials as Record<string, unknown>)[f.key];
    const isSet =
      v === "***" ||
      (typeof v === "string" && v !== "" && v !== "[not set]");
    return {
      set: isSet,
      label: isSet ? " (currently set)" : " (currently unset)",
    };
  }
  const v =
    (row.config as Record<string, unknown>)[f.key] ??
    (row.credentials as Record<string, unknown>)[f.key];
  const isSet =
    v !== undefined && v !== null && v !== "" && v !== "[not set]";
  return {
    set: isSet,
    label: isSet ? " (currently set)" : " (currently unset)",
  };
}

export default function VoiceScoringProviderEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [row, setRow] = useState<SpeechAssessmentProviderRow | null>(null);
  const [configSchema, setConfigSchema] = useState<ConfigField[] | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | boolean>
  >({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/speech-assessment-providers/${id}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRow(body.provider);
      setConfigSchema(body.configSchema?.fields ?? null);
      setCapabilities(body.capabilities ?? null);
      setDisplayName(body.provider.displayName);
      setEnabled(body.provider.enabled);

      const seed: Record<string, string | boolean> = {};
      for (const f of (body.configSchema?.fields ?? []) as ConfigField[]) {
        if (f.sensitive) {
          seed[f.key] = "";
          continue;
        }
        const v =
          (body.provider.config as Record<string, unknown>)[f.key] ??
          (body.provider.credentials as Record<string, unknown>)[f.key];
        if (f.type === "boolean") {
          seed[f.key] = v === true;
        } else {
          seed[f.key] =
            v === undefined || v === null ? "" : String(v);
        }
      }
      setFieldValues(seed);
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
    setSaveMessage(null);
    try {
      const credentials: Record<string, unknown> = { ...row.credentials };
      const config: Record<string, unknown> = { ...row.config };
      // Drop masked sentinels so we don't write "***" back to DB
      for (const k of Object.keys(credentials)) {
        if (
          credentials[k] === "***" ||
          credentials[k] === "[not set]"
        ) {
          delete credentials[k];
        }
      }

      const changedFields: string[] = [];

      for (const f of configSchema) {
        const raw = fieldValues[f.key];
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
          changedFields.push(f.label);
          credentials[f.key] = value;
        } else {
          const currentValue =
            (row.config as Record<string, unknown>)[f.key] ??
            (row.credentials as Record<string, unknown>)[f.key];
          if (currentValue !== value) {
            changedFields.push(f.label);
          }
          config[f.key] = value;
        }
      }

      const patch: Record<string, unknown> = {
        displayName,
        enabled,
        credentials,
        config,
      };
      const res = await fetch(`/api/speech-assessment-providers/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);

      await load();
      if (changedFields.length === 0) {
        setSaveMessage("Saved. No field values changed.");
      } else {
        setSaveMessage(`Saved. Updated: ${changedFields.join(", ")}.`);
      }
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
          <span className="hf-spinner" aria-label="Loading" /> Loading
          provider&hellip;
        </div>
      </main>
    );
  }
  if (!row) {
    return (
      <main className="hf-page">
        <div className="hf-banner hf-banner-error">
          {err ?? "Provider not found"}
        </div>
      </main>
    );
  }

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">{row.displayName}</h1>
      <p className="hf-page-subtitle">
        slug: <code>{row.slug}</code> · adapter: <code>{row.adapterKey}</code>
      </p>
      <p className="hf-section-desc">
        <Link href="/x/settings/voice-scoring-providers">
          ← All scoring providers
        </Link>
      </p>

      {err && (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      )}

      {saveMessage && !err && (
        <div className="hf-banner hf-banner-success" role="status">
          {saveMessage}
        </div>
      )}

      {/* Capabilities */}
      {capabilities && (
        <section className="hf-card">
          <h2 className="hf-section-title">Supported features</h2>
          <p className="hf-section-desc">
            Declared by the <code>{row.adapterKey}</code> adapter via
            <code> getCapabilities()</code>. Drives the PROSODY pipeline
            stage&rsquo;s vendor selection.
          </p>
          <ul className="hf-kv">
            <CapRow label="IELTS scoring" value={capabilities.ieltsSupported} />
            <CapRow
              label="Spontaneous speech"
              value={capabilities.spontaneousSupported}
            />
            <CapRow
              label="Scripted (read-aloud)"
              value={capabilities.scriptedSupported}
            />
            <CapRow
              label="Accepts recording URL"
              value={capabilities.acceptsRecordingUrl}
            />
            <CapRow
              label="Requires file upload"
              value={capabilities.requiresFileUpload}
            />
            <CapRow
              label="Transcript included"
              value={capabilities.transcriptIncluded}
            />
            <CapRow
              label="Per-word diagnostics"
              value={capabilities.perWordDiagnostics}
            />
            <CapRow
              label="Prosody features"
              value={capabilities.prosodyFeatures}
            />
          </ul>
        </section>
      )}

      {/* Row metadata */}
      <section className="hf-card">
        <h2 className="hf-section-title">Row settings</h2>
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

      {/* Per-provider form */}
      {configSchema && configSchema.length > 0 ? (
        <section className="hf-card">
          <h2 className="hf-section-title">Provider configuration</h2>
          <p className="hf-section-desc">
            Fields declared by the <code>{row.adapterKey}</code> adapter.
            Sensitive fields are masked — leave blank to keep the current
            value.
          </p>
          {configSchema.map((f) => {
            const presence = fieldPresence(f, row);
            return (
              <div key={f.key}>
                <label className="hf-label" htmlFor={`field-${f.key}`}>
                  {f.label}{" "}
                  {f.required ? <span aria-hidden>*</span> : null}
                  <span
                    className={
                      presence.set
                        ? "hf-presence-set"
                        : "hf-presence-unset"
                    }
                  >
                    {presence.label}
                  </span>
                </label>
                {f.type === "enum" ? (
                  <select
                    id={`field-${f.key}`}
                    className="hf-input"
                    value={String(fieldValues[f.key] ?? "")}
                    onChange={(e) =>
                      setFieldValues({
                        ...fieldValues,
                        [f.key]: e.target.value,
                      })
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
                      setFieldValues({
                        ...fieldValues,
                        [f.key]: e.target.checked,
                      })
                    }
                  />
                ) : (
                  <input
                    id={`field-${f.key}`}
                    className="hf-input"
                    type={
                      f.sensitive
                        ? "password"
                        : f.type === "number"
                          ? "number"
                          : "text"
                    }
                    autoComplete={
                      f.sensitive ? "new-password" : undefined
                    }
                    placeholder={
                      f.sensitive
                        ? presence.set
                          ? "leave blank to keep current"
                          : "type new value"
                        : ""
                    }
                    value={String(fieldValues[f.key] ?? "")}
                    onChange={(e) =>
                      setFieldValues({
                        ...fieldValues,
                        [f.key]: e.target.value,
                      })
                    }
                  />
                )}
                {f.help && (
                  <p className="hf-section-desc">{f.help}</p>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="hf-card">
          <p className="hf-section-desc">
            Adapter <code>{row.adapterKey}</code> declares no
            provider-specific configuration.
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
          onClick={() => router.push("/x/settings/voice-scoring-providers")}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </main>
  );
}

function CapRow({ label, value }: { label: string; value: boolean }) {
  return (
    <li className="hf-kv-row">
      <span>{label}</span>
      <span className={value ? "hf-badge hf-badge-success" : "hf-badge hf-badge-muted"}>
        {value ? "Yes" : "No"}
      </span>
    </li>
  );
}
