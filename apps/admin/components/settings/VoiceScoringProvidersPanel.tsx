"use client";

/**
 * Voice Scoring Providers CRUD body (#1118).
 *
 * Parallel to VoiceProvidersPanel — manages SpeechAssessmentProvider rows
 * (SpeechAce, SpeechSuper). Credentials always masked — the API never
 * returns raw values. Test-connection probe invokes the adapter's
 * `getCapabilities()` and never makes a live vendor call (per-second
 * cost). No telemetry tab yet — telemetry / PROSODY stage is the
 * sister story (#1119).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface SpeechAssessmentProviderRow {
  id: string;
  slug: string;
  displayName: string;
  adapterKey: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PingResult {
  reachable: boolean;
  detail: string;
}

interface Props {
  showHeading?: boolean;
}

export function VoiceScoringProvidersPanel({ showHeading = false }: Props = {}) {
  const [rows, setRows] = useState<SpeechAssessmentProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<
    Record<string, PingResult | "loading">
  >({});
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/speech-assessment-providers");
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      setRows(body.providers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function testConnection(id: string) {
    setPingResults((p) => ({ ...p, [id]: "loading" }));
    try {
      const res = await fetch(
        `/api/speech-assessment-providers/${id}/test-connection`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? "test failed");
      setPingResults((p) => ({ ...p, [id]: body.ping }));
    } catch (e) {
      setPingResults((p) => ({
        ...p,
        [id]: {
          reachable: false,
          detail: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  async function setDefault(id: string) {
    try {
      const res = await fetch(`/api/speech-assessment-providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteRow(id: string, displayName: string) {
    if (
      !confirm(
        `Delete speech assessment provider "${displayName}"? This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/speech-assessment-providers/${id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function setEnabled(id: string, enabled: boolean, displayName: string) {
    if (
      !enabled &&
      !confirm(
        `Archive "${displayName}"? It will stop receiving scoring requests but can be restored from "Show archived".`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/speech-assessment-providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      {showHeading ? (
        <>
          <h1 className="hf-page-title">Voice scoring</h1>
          <p className="hf-page-subtitle">
            Manage the speech-scoring vendors (SpeechAce, SpeechSuper) that
            score uploaded learner audio for IELTS bands and prosody features.
            Credentials are stored in the database and never displayed in plain
            text. Wired into the PROSODY pipeline stage (#1119).
          </p>
        </>
      ) : (
        <p className="hf-section-desc">
          Manage speech-scoring vendors (SpeechAce, SpeechSuper). Credentials
          masked. The default provider serves the PROSODY pipeline stage when
          no per-playbook override exists.
        </p>
      )}

      {err ? (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading providers" /> Loading
          providers&hellip;
        </div>
      ) : rows.length === 0 ? (
        <div className="hf-empty">
          No scoring providers registered.{" "}
          <Link href="/x/settings/voice-scoring-providers/new">Add one</Link> to
          start.
        </div>
      ) : (
        (() => {
          const visible = showArchived ? rows : rows.filter((r) => r.enabled);
          const archivedCount = rows.filter((r) => !r.enabled).length;
          return (
            <>
              {archivedCount > 0 || rows.some((r) => !r.enabled) ? (
                <div className="hf-card-footer hf-archive-toggle-row">
                  <label className="hf-label hf-archive-toggle-label">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                    />
                    Show archived ({archivedCount})
                  </label>
                </div>
              ) : null}
              <ul className="hf-card-list">
                {visible.map((row) => {
                  const credKeys = Object.keys(row.credentials);
                  const ping = pingResults[row.id];
                  return (
                    <li key={row.id} className="hf-card">
                      <header className="hf-card-header">
                        <div>
                          <h2 className="hf-section-title">{row.displayName}</h2>
                          <p className="hf-section-desc">
                            slug: <code>{row.slug}</code> · adapter:{" "}
                            <code>{row.adapterKey}</code>
                          </p>
                        </div>
                        <div className="hf-badge-row">
                          {row.isDefault ? (
                            <span className="hf-badge hf-badge-info">
                              Default
                            </span>
                          ) : null}
                          {row.enabled ? (
                            <span className="hf-badge hf-badge-success">
                              Enabled
                            </span>
                          ) : (
                            <span className="hf-badge hf-badge-muted">
                              Disabled
                            </span>
                          )}
                        </div>
                      </header>

                      {credKeys.length > 0 ? (
                        <dl className="hf-kv">
                          {credKeys.map((key) => (
                            <div key={key} className="hf-kv-row">
                              <dt>{key}</dt>
                              <dd>{String(row.credentials[key])}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}

                      {ping ? (
                        ping === "loading" ? (
                          <p className="hf-section-desc">
                            <span className="hf-spinner" aria-label="Testing" />{" "}
                            Testing connection&hellip;
                          </p>
                        ) : (
                          <p
                            className={
                              ping.reachable
                                ? "hf-banner hf-banner-success"
                                : "hf-banner hf-banner-error"
                            }
                          >
                            {ping.detail}
                          </p>
                        )
                      ) : null}

                      <footer className="hf-card-footer">
                        <button
                          type="button"
                          className="hf-btn hf-btn-secondary"
                          onClick={() => testConnection(row.id)}
                          disabled={ping === "loading"}
                        >
                          Test connection
                        </button>
                        <Link
                          href={`/x/settings/voice-scoring-providers/${row.id}`}
                          className="hf-btn hf-btn-secondary"
                        >
                          Edit
                        </Link>
                        {!row.isDefault && row.enabled ? (
                          <button
                            type="button"
                            className="hf-btn hf-btn-secondary"
                            onClick={() => setDefault(row.id)}
                          >
                            Set as default
                          </button>
                        ) : null}
                        {!row.isDefault ? (
                          row.enabled ? (
                            <button
                              type="button"
                              className="hf-btn hf-btn-secondary"
                              onClick={() =>
                                setEnabled(row.id, false, row.displayName)
                              }
                            >
                              Archive
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="hf-btn hf-btn-secondary"
                              onClick={() =>
                                setEnabled(row.id, true, row.displayName)
                              }
                            >
                              Unarchive
                            </button>
                          )
                        ) : null}
                        {!row.isDefault ? (
                          <button
                            type="button"
                            className="hf-btn hf-btn-destructive"
                            onClick={() => deleteRow(row.id, row.displayName)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </footer>
                    </li>
                  );
                })}
              </ul>
            </>
          );
        })()
      )}

      <div className="hf-card-footer">
        <Link
          href="/x/settings/voice-scoring-providers/new"
          className="hf-btn hf-btn-primary"
        >
          + Add scoring provider
        </Link>
      </div>
    </div>
  );
}
