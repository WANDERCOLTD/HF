/**
 * Per-caller voice spend panel (AnyVoice #1028).
 *
 * Inline card on the caller detail page. Shows the rolling 30-day
 * voice cost grouped by provider. Pure read surface — no edits;
 * cost rates are managed via the metering layer.
 *
 * Calls GET /api/voice/costs?scope=caller&id=<callerId>.
 */

"use client";

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

export function VoiceCostPanel({ callerId }: { callerId: string }) {
  const [summary, setSummary] = useState<VoiceCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/voice/costs?scope=caller&id=${encodeURIComponent(callerId)}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSummary(body.summary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <section className="hf-card">
        <h3 className="hf-section-title">Voice spend (last 30 days)</h3>
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading" /> Loading&hellip;
        </div>
      </section>
    );
  }
  if (!summary) {
    return (
      <section className="hf-card">
        <h3 className="hf-section-title">Voice spend (last 30 days)</h3>
        <div className="hf-banner hf-banner-error">{err ?? "Failed to load"}</div>
      </section>
    );
  }

  if (summary.callCount === 0) {
    return (
      <section className="hf-card">
        <h3 className="hf-section-title">Voice spend (last 30 days)</h3>
        <p className="hf-section-desc">No voice calls with recorded cost in the last 30 days.</p>
      </section>
    );
  }

  return (
    <section className="hf-card">
      <h3 className="hf-section-title">Voice spend (last 30 days)</h3>
      <p className="hf-section-desc">
        <strong>{formatUsd(summary.totalUsd)}</strong> across {summary.callCount} call
        {summary.callCount === 1 ? "" : "s"}.
      </p>
      {summary.byProvider.length > 0 ? (
        <ul className="hf-kv">
          {summary.byProvider.map((row) => (
            <li key={row.provider} className="hf-kv-row">
              <span>
                <strong>{row.provider}</strong> &mdash; {row.callCount} call
                {row.callCount === 1 ? "" : "s"}
              </span>
              <span>{formatUsd(row.totalUsd)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
