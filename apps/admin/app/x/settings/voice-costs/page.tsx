"use client";

/**
 * System-wide voice spend admin page (AnyVoice #1028).
 *
 * ADMIN-only. Reads GET /api/voice/costs?scope=system. Shows the
 * rolling 30-day spend grouped by provider — provider | calls | total
 * | avg cost/call. Currency: USD. No edits.
 *
 * For per-caller / per-cohort / per-playbook drill-down, the educator
 * uses the inline VoiceCostPanel on the respective entity's detail
 * page; this surface is the only system-wide one.
 */

import { useCallback, useEffect, useState } from "react";

interface VoiceCostByProvider {
  provider: string;
  totalUsd: number;
  callCount: number;
}

interface VoiceCostSummary {
  totalUsd: number;
  byProvider: VoiceCostByProvider[];
  callCount: number;
  since: string | null;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function VoiceCostsAdminPage() {
  const [summary, setSummary] = useState<VoiceCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/voice/costs?scope=system");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSummary(body.summary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">Voice spend</h1>
      <p className="hf-page-subtitle">
        Rolling 30-day total across all callers, grouped by voice provider. Values in USD.
        Drill-down to per-caller or per-cohort spend lives on the corresponding entity&rsquo;s detail
        page.
      </p>

      {err ? (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading" /> Loading&hellip;
        </div>
      ) : !summary ? null : summary.callCount === 0 ? (
        <div className="hf-empty">No voice calls with recorded cost in the last 30 days.</div>
      ) : (
        <section className="hf-card">
          <h2 className="hf-section-title">By provider</h2>
          <table className="hf-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th style={{ textAlign: "right" }}>Calls</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Avg / call</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProvider.map((row) => (
                <tr key={row.provider}>
                  <td>
                    <strong>{row.provider}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{row.callCount}</td>
                  <td style={{ textAlign: "right" }}>{formatUsd(row.totalUsd)}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.callCount === 0 ? "—" : formatUsd(row.totalUsd / row.callCount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  <strong>{summary.callCount}</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  <strong>{formatUsd(summary.totalUsd)}</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  {summary.callCount === 0
                    ? "—"
                    : formatUsd(summary.totalUsd / summary.callCount)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
