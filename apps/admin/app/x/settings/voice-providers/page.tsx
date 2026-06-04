"use client";

/**
 * Voice Providers admin list (AnyVoice #1031).
 *
 * Lists all registered VoiceProvider rows. Credentials always masked (the
 * API never returns raw values to this surface). Each card surfaces:
 *   - identification: displayName, slug, adapterKey
 *   - status badges: default, enabled
 *   - masked credential summary (apiKey ***, webhookSecret ***)
 *   - actions: Test connection · Edit · Set as default · Delete
 *
 * ADMIN-only — the API enforces auth; this page just renders.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface VoiceProviderRow {
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

export default function VoiceProvidersPage() {
  const [rows, setRows] = useState<VoiceProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, PingResult | "loading">>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/voice-providers");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
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
      const res = await fetch(`/api/voice-providers/${id}/test-connection`, { method: "POST" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? "test failed");
      setPingResults((p) => ({ ...p, [id]: body.ping }));
    } catch (e) {
      setPingResults((p) => ({
        ...p,
        [id]: { reachable: false, detail: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  async function setDefault(id: string) {
    try {
      const res = await fetch(`/api/voice-providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteRow(id: string, displayName: string) {
    if (!confirm(`Delete voice provider "${displayName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/voice-providers/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">Voice providers</h1>
      <p className="hf-page-subtitle">
        Manage the voice-call providers HF can route learners to. Credentials are stored in the
        database and never displayed in plain text. The default provider serves any caller who
        doesn&rsquo;t have a per-caller override.
      </p>

      {err ? (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading providers" /> Loading providers&hellip;
        </div>
      ) : rows.length === 0 ? (
        <div className="hf-empty">
          No providers registered. <Link href="/x/settings/voice-providers/new">Add one</Link> to start.
        </div>
      ) : (
        <ul className="hf-card-list">
          {rows.map((row) => {
            const credKeys = Object.keys(row.credentials);
            const ping = pingResults[row.id];
            return (
              <li key={row.id} className="hf-card">
                <header className="hf-card-header">
                  <div>
                    <h2 className="hf-section-title">{row.displayName}</h2>
                    <p className="hf-section-desc">
                      slug: <code>{row.slug}</code> · adapter: <code>{row.adapterKey}</code>
                    </p>
                  </div>
                  <div className="hf-badge-row">
                    {row.isDefault ? <span className="hf-badge hf-badge-info">Default</span> : null}
                    {row.enabled ? (
                      <span className="hf-badge hf-badge-success">Enabled</span>
                    ) : (
                      <span className="hf-badge hf-badge-muted">Disabled</span>
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
                      <span className="hf-spinner" aria-label="Testing" /> Testing connection&hellip;
                    </p>
                  ) : (
                    <p
                      className={
                        ping.reachable ? "hf-banner hf-banner-success" : "hf-banner hf-banner-error"
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
                  <Link href={`/x/settings/voice-providers/${row.id}`} className="hf-btn hf-btn-secondary">
                    Edit
                  </Link>
                  {!row.isDefault ? (
                    <button
                      type="button"
                      className="hf-btn hf-btn-secondary"
                      onClick={() => setDefault(row.id)}
                    >
                      Set as default
                    </button>
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
      )}

      <div className="hf-card-footer">
        <Link href="/x/settings/voice-providers/new" className="hf-btn hf-btn-primary">
          + Add voice provider
        </Link>
      </div>
    </main>
  );
}
