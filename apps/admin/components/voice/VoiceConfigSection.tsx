/**
 * Shared Voice config section (#1271 Slices C + D).
 *
 * Renders one row per cascadeable voice field with:
 *   - Field label + help text from the per-VP schema
 *   - Resolved value
 *   - Provenance badge (system | provider | domain | course)
 *   - Inline edit input
 *   - "Clear override" affordance when this layer is the source
 *
 * Used on the Course settings tab AND the Domain edit page — `scope`
 * prop switches which API the rows talk to.
 */

"use client";

import { useEffect, useState, useCallback } from "react";

type Source = "system" | "provider" | "domain" | "course";
type ResolvedField<T = unknown> = { value: T; source: Source };
type SchemaField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  help?: string;
  enumValues?: string[];
  default?: unknown;
};

interface VoicePayload {
  ok: boolean;
  enabledProviderSlug: string;
  resolved: {
    provider: ResolvedField<string>;
    model: ResolvedField<string | null>;
    fields: Record<string, ResolvedField>;
  };
  allowedKeys: string[];
  schemaFields: SchemaField[];
  /** This-layer-only overrides — used to show "Clear override" only when
   *  the value actually lives at this layer. */
  courseOverrides?: Record<string, unknown>;
  domainOverrides?: Record<string, unknown>;
}

export interface VoiceConfigSectionProps {
  scope: "course" | "domain";
  scopeId: string;
}

const CROSS_CUTTING_LABELS: Record<string, { label: string; help: string; type: SchemaField["type"]; enumValues?: string[] }> = {
  autoPipeline: {
    label: "Auto-run pipeline after each call",
    help: "When true, the post-call analysis pipeline (memories, traits, target adapts) runs automatically. Default: on.",
    type: "boolean",
  },
  silenceTimeoutSeconds: {
    label: "Silence timeout (seconds)",
    help: "Hang up the call after this many seconds of silence. Lower = harsher (saves cost). Default: 30s.",
    type: "number",
  },
  maxDurationSeconds: {
    label: "Max call duration (seconds)",
    help: "Hard cap on call length. Default: 600s (10 min). VAPI will end any call at this point.",
    type: "number",
  },
  voicemailDetectionEnabled: {
    label: "Voicemail detection",
    help: "End the call early if VAPI detects an answering machine. Default: on.",
    type: "boolean",
  },
  endCallPhrases: {
    label: "End-call phrases",
    help: "Comma-separated list. When the learner says any of these, VAPI hangs up. Default: \"goodbye, bye, talk to you later, see you later, have a nice day\".",
    type: "string",
  },
  maxCostPerCallUsd: {
    label: "Max cost per call (USD)",
    help: "Hard cost cap. Null = no cap (system default).",
    type: "number",
  },
  pollIntervalMs: {
    label: "Poll interval (ms)",
    help: "Server-side poll cadence checking for stale calls. Advanced.",
    type: "number",
  },
  endedReasonOverride: {
    label: "Ended-reason override",
    help: "Force this string into Call.voiceEndedReason instead of VAPI's value. Debugging only.",
    type: "string",
  },
};

function sourceBadge(source: Source) {
  const map: Record<Source, { label: string; bg: string; fg: string }> = {
    system: { label: "Default · System", bg: "var(--surface-secondary)", fg: "var(--text-muted)" },
    provider: { label: "Default · Provider", bg: "var(--surface-secondary)", fg: "var(--text-muted)" },
    domain: { label: "Set · Domain", bg: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", fg: "var(--accent-primary)" },
    course: { label: "Set · Course", bg: "color-mix(in srgb, var(--status-success-text) 14%, transparent)", fg: "var(--status-success-text)" },
  };
  const s = map[source];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function fieldMeta(key: string, schemaFields: SchemaField[]): SchemaField {
  const fromSchema = schemaFields.find((f) => f.key === key);
  if (fromSchema) return fromSchema;
  const xc = CROSS_CUTTING_LABELS[key];
  if (xc) return { key, label: xc.label, help: xc.help, type: xc.type, enumValues: xc.enumValues };
  return { key, label: key, type: "string" };
}

function formatValue(v: unknown, type: SchemaField["type"]): string {
  if (v === undefined || v === null) return "—";
  if (type === "boolean") return v ? "On" : "Off";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function parseValueFromInput(raw: string, type: SchemaField["type"]): unknown {
  if (raw === "") return null;
  if (type === "boolean") return raw === "true";
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export function VoiceConfigSection({ scope, scopeId }: VoiceConfigSectionProps) {
  const [data, setData] = useState<VoicePayload | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = scope === "course" ? `/api/playbooks/${scopeId}/voice-config` : `/api/domains/${scopeId}/voice-config`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(apiBase);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as VoicePayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveOverride = useCallback(
    async (key: string, value: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(apiBase, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        setEditing(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, load],
  );

  if (error) {
    return (
      <div className="hf-banner hf-banner-error">
        Voice config: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hf-card">
        <div className="hf-text-muted hf-text-sm">Loading voice config…</div>
      </div>
    );
  }

  const overridesAtThisLayer = scope === "course" ? data.courseOverrides ?? {} : data.domainOverrides ?? {};

  return (
    <div className="hf-card">
      <div className="hf-text-muted hf-text-sm" style={{ marginBottom: 8 }}>
        Provider: <strong>{data.enabledProviderSlug}</strong> (locked at system level). The fields below
        cascade <em>System → Provider → Domain → Course</em>. Setting a value here overrides every layer
        above it; clearing falls back through the cascade.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        {data.allowedKeys.map((key) => {
          const meta = fieldMeta(key, data.schemaFields);
          const resolved = data.resolved.fields[key];
          if (!resolved) return null;
          const isEditing = editing === key;
          const isThisLayer = key in overridesAtThisLayer;

          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: 12,
                borderRadius: 8,
                background: "var(--surface-primary)",
                border: "1px solid var(--border-default)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 14 }}>{meta.label}</strong>
                  {sourceBadge(resolved.source)}
                </div>
                {meta.help && (
                  <div className="hf-text-muted hf-text-xs" style={{ marginBottom: 6 }}>
                    {meta.help}
                  </div>
                )}
                {!isEditing && (
                  <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {formatValue(resolved.value, meta.type)}
                  </div>
                )}
                {isEditing && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    {meta.type === "boolean" ? (
                      <select
                        className="hf-input"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        autoFocus
                      >
                        <option value="true">On</option>
                        <option value="false">Off</option>
                      </select>
                    ) : meta.type === "enum" && meta.enumValues ? (
                      <select
                        className="hf-input"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        autoFocus
                      >
                        {meta.enumValues.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="hf-input"
                        type={meta.type === "number" ? "number" : "text"}
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        autoFocus
                        placeholder={`Override ${meta.label}`}
                      />
                    )}
                    <button
                      className="hf-btn hf-btn-primary"
                      disabled={busy}
                      onClick={() => void saveOverride(key, parseValueFromInput(draftValue, meta.type))}
                    >
                      Save
                    </button>
                    <button
                      className="hf-btn hf-btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    className="hf-btn hf-btn-secondary"
                    onClick={() => {
                      setDraftValue(formatValue(resolved.value, meta.type) === "—" ? "" : String(resolved.value));
                      setEditing(key);
                      setError(null);
                    }}
                  >
                    Override
                  </button>
                  {isThisLayer && (
                    <button
                      className="hf-btn hf-btn-secondary"
                      disabled={busy}
                      onClick={() => void saveOverride(key, null)}
                      title={`Drop this ${scope} override and fall back to the cascade.`}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
