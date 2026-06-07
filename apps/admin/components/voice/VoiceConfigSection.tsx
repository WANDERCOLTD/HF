/**
 * Shared Voice config section (#1271 Slices C + D).
 *
 * Renders one row per cascadeable voice field. Each field is always
 * directly editable — no "Override" intermediate step. Edits autosave
 * on change (toggles + selects) or blur with debounce (text + number).
 * A reset-to-inherited control appears only when THIS layer is the
 * source of the resolved value.
 *
 * Used on the Course settings tab AND the Domain edit page — `scope`
 * prop switches which API the rows talk to.
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";

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
    help: "Run the post-call analysis pipeline (memories, traits, target adapts) automatically.",
    type: "boolean",
  },
  silenceTimeoutSeconds: {
    label: "Silence timeout (seconds)",
    help: "Hang up after this many seconds of silence. Lower = cheaper but harsher.",
    type: "number",
  },
  maxDurationSeconds: {
    label: "Max call duration (seconds)",
    help: "Hard cap on call length. VAPI will end any call at this point.",
    type: "number",
  },
  voicemailDetectionEnabled: {
    label: "Voicemail detection",
    help: "End the call early if VAPI detects an answering machine.",
    type: "boolean",
  },
  endCallPhrases: {
    label: "End-call phrases",
    help: "Comma-separated. When the learner says any of these, VAPI hangs up.",
    type: "string",
  },
  maxCostPerCallUsd: {
    label: "Max cost per call (USD)",
    help: "Hard cost cap. Empty = no cap (system default).",
    type: "number",
  },
  pollIntervalMs: {
    label: "Poll interval (ms)",
    help: "Server-side poll cadence checking for stale calls. Advanced.",
    type: "number",
  },
  endedReasonOverride: {
    label: "Ended-reason override",
    help: "Force this string into Call.voiceEndedReason. Debugging only.",
    type: "string",
  },
};

const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Behaviour", keys: ["autoPipeline", "endedReasonOverride"] },
  { title: "Voice & transcription", keys: ["voiceId", "voiceProvider", "transcriber", "backgroundSound", "recordingEnabled"] },
  { title: "Cost safety", keys: ["silenceTimeoutSeconds", "maxDurationSeconds", "voicemailDetectionEnabled", "endCallPhrases", "maxCostPerCallUsd"] },
  { title: "Advanced", keys: ["pollIntervalMs", "publicKey", "phoneNumberId"] },
];

function sourceBadge(source: Source, scope: "course" | "domain") {
  const isThis =
    (scope === "course" && source === "course") || (scope === "domain" && source === "domain");
  const map: Record<Source, { label: string; bg: string; fg: string }> = {
    system: { label: "System default", bg: "var(--surface-secondary)", fg: "var(--text-muted)" },
    provider: { label: "Provider default", bg: "var(--surface-secondary)", fg: "var(--text-muted)" },
    domain: { label: "Set at Domain", bg: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", fg: "var(--accent-primary)" },
    course: { label: "Set at Course", bg: "color-mix(in srgb, var(--status-success-text) 14%, transparent)", fg: "var(--status-success-text)" },
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
        outline: isThis ? `1px solid ${s.fg}` : "none",
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

function inputValueFor(value: unknown, type: SchemaField["type"]): string {
  if (value === undefined || value === null) return "";
  if (type === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
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

interface RowProps {
  meta: SchemaField;
  resolved: ResolvedField;
  scope: "course" | "domain";
  isThisLayer: boolean;
  busyKey: string | null;
  savedFlash: string | null;
  onSave: (key: string, value: unknown) => Promise<void> | void;
  onReset: (key: string) => Promise<void> | void;
}

function FieldRow({ meta, resolved, scope, isThisLayer, busyKey, savedFlash, onSave, onReset }: RowProps) {
  const [draft, setDraft] = useState(inputValueFor(resolved.value, meta.type));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft from resolved whenever the upstream value changes (e.g. after a clear).
  useEffect(() => {
    setDraft(inputValueFor(resolved.value, meta.type));
  }, [resolved.value, meta.type]);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseValueFromInput(raw, meta.type);
      void onSave(meta.key, parsed);
    },
    [meta.key, meta.type, onSave],
  );

  const onTextChange = (val: string) => {
    setDraft(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(val), 600);
  };

  const onTextBlur = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (inputValueFor(resolved.value, meta.type) !== draft) commit(draft);
  };

  const isBusy = busyKey === meta.key;
  const justSaved = savedFlash === meta.key;

  const renderInput = () => {
    if (meta.type === "boolean") {
      return (
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: isBusy ? "wait" : "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={draft === "true"}
            disabled={isBusy}
            onChange={(e) => {
              const next = e.target.checked ? "true" : "false";
              setDraft(next);
              commit(next);
            }}
            style={{ width: 16, height: 16, accentColor: "var(--accent-primary)" }}
          />
          <span style={{ fontSize: 14 }}>{draft === "true" ? "On" : "Off"}</span>
        </label>
      );
    }
    if (meta.type === "enum" && meta.enumValues) {
      return (
        <select
          className="hf-input"
          value={draft}
          disabled={isBusy}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          style={{ minWidth: 180 }}
        >
          {meta.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="hf-input"
        type={meta.type === "number" ? "number" : "text"}
        value={draft}
        disabled={isBusy}
        onChange={(e) => onTextChange(e.target.value)}
        onBlur={onTextBlur}
        placeholder="(falls back to cascade)"
        style={{ minWidth: 220 }}
      />
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 16,
        padding: 12,
        borderRadius: 8,
        background: isThisLayer
          ? "color-mix(in srgb, var(--status-success-text) 4%, var(--surface-primary))"
          : "var(--surface-primary)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{meta.label}</strong>
          {sourceBadge(resolved.source, scope)}
          {justSaved && (
            <span style={{ fontSize: 11, color: "var(--status-success-text)", fontWeight: 600 }}>✓ saved</span>
          )}
        </div>
        {meta.help && (
          <div className="hf-text-muted hf-text-xs" style={{ marginBottom: 6 }}>
            {meta.help}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {renderInput()}
          {isThisLayer && (
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              disabled={isBusy}
              onClick={() => void onReset(meta.key)}
              title="Drop this override and fall back to the inherited value."
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              ↺ Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VoiceConfigSection({ scope, scopeId }: VoiceConfigSectionProps) {
  const [data, setData] = useState<VoicePayload | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
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

  const persist = useCallback(
    async (key: string, value: unknown) => {
      setBusyKey(key);
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
        await load();
        setSavedFlash(key);
        setTimeout(() => {
          setSavedFlash((cur) => (cur === key ? null : cur));
        }, 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [apiBase, load],
  );

  const reset = useCallback((key: string) => persist(key, null), [persist]);

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

  // Order keys via FIELD_GROUPS; any keys not in a group go in "Other".
  const grouped: { title: string; keys: string[] }[] = FIELD_GROUPS.map((g) => ({
    title: g.title,
    keys: g.keys.filter((k) => data.allowedKeys.includes(k)),
  })).filter((g) => g.keys.length > 0);
  const groupedKeys = new Set(grouped.flatMap((g) => g.keys));
  const otherKeys = data.allowedKeys.filter((k) => !groupedKeys.has(k));
  if (otherKeys.length > 0) grouped.push({ title: "Other", keys: otherKeys });

  return (
    <div className="hf-card">
      <div className="hf-text-muted hf-text-sm" style={{ marginBottom: 8 }}>
        Provider: <strong>{data.enabledProviderSlug}</strong> (locked at system level). Cascade
        is <em>System → Provider → Domain → Course</em>. Edit a field to set it at this layer;
        clear it (↺ Reset) to fall back through the cascade.
      </div>

      {grouped.map((group) => (
        <div key={group.title} style={{ marginTop: 16 }}>
          <div
            className="hf-text-muted"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {group.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.keys.map((key) => {
              const meta = fieldMeta(key, data.schemaFields);
              const resolved = data.resolved.fields[key];
              if (!resolved) return null;
              return (
                <FieldRow
                  key={key}
                  meta={meta}
                  resolved={resolved}
                  scope={scope}
                  isThisLayer={key in overridesAtThisLayer}
                  busyKey={busyKey}
                  savedFlash={savedFlash}
                  onSave={persist}
                  onReset={reset}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
