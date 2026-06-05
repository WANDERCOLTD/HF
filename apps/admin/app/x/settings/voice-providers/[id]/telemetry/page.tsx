"use client";

/**
 * Voice provider telemetry panel (AnyVoice #1080).
 *
 * Last-N UsageEvent rows for a provider, with per-call drill-down.
 * ADMIN-only via the API layer.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

interface TelemetryEvent {
  id: string;
  operation: string;
  callId: string | null;
  callerId: string | null;
  quantity: number;
  unitType: string;
  costCents: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function VoiceProviderTelemetryPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const drillCallId = search?.get("callId") ?? null;
  const id = params?.id;

  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [providerSlug, setProviderSlug] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = drillCallId
        ? `?callId=${encodeURIComponent(drillCallId)}`
        : "";
      const res = await fetch(`/api/voice/telemetry/${id}${qs}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEvents(body.events);
      setProviderSlug(body.slug);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, drillCallId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <main className="hf-page">
        <div className="hf-empty">
          <span className="hf-spinner" aria-label="Loading" /> Loading telemetry&hellip;
        </div>
      </main>
    );
  }

  return (
    <main className="hf-page">
      <h1 className="hf-page-title">
        Voice telemetry — {providerSlug || "provider"}
      </h1>
      <p className="hf-page-subtitle">
        {drillCallId ? (
          <>
            Call drill-down: <code>{drillCallId}</code>{" "}
            <Link href={`/x/settings/voice-providers/${id}/telemetry`}>
              [← back to all events]
            </Link>
          </>
        ) : (
          <>
            Last {events.length} VOICE UsageEvent rows for this provider.
            Click a row&apos;s callId to drill down.
          </>
        )}
      </p>

      {err && (
        <div className="hf-banner hf-banner-error" role="alert">
          {err}
        </div>
      )}

      {events.length === 0 ? (
        <div className="hf-empty">
          No telemetry events recorded yet. Make a voice call and check back.
        </div>
      ) : (
        <section className="hf-card">
          <table className="hf-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Operation</th>
                <th>Call</th>
                <th>Duration</th>
                <th>Cost (¢)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const m = (e.metadata ?? {}) as Record<string, unknown>;
                const durationMs = m.durationMs as number | undefined;
                const success = m.success !== false;
                return (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                    <td>
                      <code>{e.operation}</code>
                    </td>
                    <td>
                      {e.callId ? (
                        drillCallId === e.callId ? (
                          <code>{e.callId.slice(0, 8)}…</code>
                        ) : (
                          <Link
                            href={`/x/settings/voice-providers/${id}/telemetry?callId=${e.callId}`}
                          >
                            <code>{e.callId.slice(0, 8)}…</code>
                          </Link>
                        )
                      ) : (
                        <span className="hf-section-desc">—</span>
                      )}
                    </td>
                    <td>
                      {durationMs !== undefined ? `${durationMs}ms` : "—"}
                    </td>
                    <td>{e.costCents.toFixed(2)}</td>
                    <td>
                      {success ? (
                        <span className="hf-status-ok">ok</span>
                      ) : (
                        <span className="hf-status-error">error</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
