"use client";

// #1078 — V6 wizard Phase 1 spike: sibling panel.
//
// Reads the projected snapshot from /api/wizard-v6/snapshot. Each
// spec field renders as a row; rows flip empty → filled as events land
// in `tallyseal_event` and the projector advances `Playbook.config.__v6`.
//
// In P1 there's no chat surface yet — the panel exposes inline inputs
// per field so the spike can be exercised manually. P2 wires the
// @tallyseal/react-assistant-ui Thread / Composer and the chat-side
// tool calls drive the same /api/wizard-v6/field-answered endpoint.

import { useCallback, useEffect, useState } from "react";

interface SpecFieldShape {
  key: string;
  type: string;
}

interface PlaygroundPanelProps {
  playbookId: string;
  spec: {
    key: string;
    version: number;
    fields: SpecFieldShape[];
  };
}

interface SnapshotResponse {
  sessionId: string;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  answeredFields: Record<string, unknown>;
  lastEventSequence: number;
}

export function PlaygroundPanel({ playbookId, spec }: PlaygroundPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTimingMs, setLastTimingMs] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // ── Bootstrap: open a session on mount. ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/wizard-v6/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playbookId,
            specKey: spec.key,
            specVersion: spec.version,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { sessionId: string };
        if (cancelled) return;
        setSessionId(data.sessionId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playbookId, spec.key, spec.version]);

  // ── Pull snapshot whenever session opens or an event lands. ────────
  const refreshSnapshot = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(
          `/api/wizard-v6/snapshot?sessionId=${encodeURIComponent(sid)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SnapshotResponse;
        setSnapshot(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  useEffect(() => {
    if (sessionId) void refreshSnapshot(sessionId);
  }, [sessionId, refreshSnapshot]);

  const handleSubmitField = useCallback(
    async (fieldKey: string, fieldType: string) => {
      if (!sessionId) return;
      const rawValue = drafts[fieldKey] ?? "";
      let fieldValue: unknown = rawValue;
      if (fieldType === "integer" || fieldType === "number") {
        const n = Number(rawValue);
        if (!Number.isFinite(n)) {
          setError(`Field ${fieldKey} expects a number`);
          return;
        }
        fieldValue = n;
      } else if (fieldType === "boolean") {
        fieldValue = rawValue === "true";
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/wizard-v6/field-answered", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, fieldKey, fieldValue }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { elapsedMs: number };
        setLastTimingMs(data.elapsedMs);
        await refreshSnapshot(sessionId);
        setDrafts((d) => ({ ...d, [fieldKey]: "" }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, drafts, refreshSnapshot],
  );

  const answered = snapshot?.answeredFields ?? {};

  return (
    <section className="wizard-v6-snapshot" aria-label="Snapshot panel">
      <div className="hf-card">
        <h2 className="hf-section-title">Snapshot</h2>
        <p className="hf-section-desc">
          Live read from <code>Playbook.config.__v6.answeredFields</code>{" "}
          via <code>/api/wizard-v6/snapshot</code>. Updates after every
          field event.
        </p>

        {error && (
          <div className="hf-banner hf-banner-error" role="alert">
            <strong>Error.</strong> {error}
          </div>
        )}

        <dl className="wizard-v6-fields">
          {spec.fields.map((f) => {
            const value = answered[f.key];
            const filled = value !== undefined && value !== "";
            return (
              <div
                key={f.key}
                className="wizard-v6-field"
                data-filled={filled ? "true" : "false"}
              >
                <dt>
                  <code>{f.key}</code>{" "}
                  <span className="wizard-v6-field-type">{f.type}</span>
                </dt>
                <dd>
                  {filled ? (
                    <span className="wizard-v6-field-value">
                      {JSON.stringify(value)}
                    </span>
                  ) : (
                    <span className="hf-empty">empty</span>
                  )}
                </dd>
                <div className="wizard-v6-field-input">
                  <input
                    className="hf-input"
                    type={
                      f.type === "integer" || f.type === "number"
                        ? "number"
                        : "text"
                    }
                    placeholder={`Set ${f.key}`}
                    value={drafts[f.key] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [f.key]: e.target.value }))
                    }
                    disabled={!sessionId || loading}
                  />
                  <button
                    type="button"
                    className="hf-btn hf-btn-secondary"
                    onClick={() => handleSubmitField(f.key, f.type)}
                    disabled={!sessionId || loading || !drafts[f.key]}
                  >
                    Send event
                  </button>
                </div>
              </div>
            );
          })}
        </dl>

        <footer className="wizard-v6-footer hf-info-footer">
          <div>
            Session: <code>{sessionId ?? "(opening…)"}</code>
          </div>
          <div>
            Last event seq:{" "}
            <code>{snapshot?.lastEventSequence ?? 0}</code>
          </div>
          {lastTimingMs !== null && (
            <div>
              End-to-end:{" "}
              <code>{lastTimingMs.toFixed(1)} ms</code>{" "}
              (event append + snapshot project, one tx)
            </div>
          )}
        </footer>
      </div>
    </section>
  );
}
