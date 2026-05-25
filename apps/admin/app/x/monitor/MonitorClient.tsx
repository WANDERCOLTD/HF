"use client";

/**
 * #761 Phase 1A — operator war-room view.
 * Polls /api/monitor/activity every 30s. Renders 6 stat chips + recent feed.
 * Spend + pipeline errors deferred to Phase 1B (need UsageEvent + ComposedPrompt status confirmation).
 */
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ROLE_LEVEL } from "@/lib/roles";
import "./monitor.css";

interface RecentCall {
  id: string;
  callerId: string | null;
  callerName: string | null;
  playbookId: string | null;
  courseName: string | null;
  createdAt: string;
  endedAt: string | null;
}

interface MonitorData {
  ok: boolean;
  liveCalls: number;
  recentCallsHour: RecentCall[];
  callsToday: number;
  callersTotal: number;
  callersActive24h: number;
  callersCalledToday: number;
  callersNotCalledToday: number;
  openTickets: number;
  aiErrorsHour: { count: number; rate: number; alertThresholdExceeded: boolean };
  timestamp: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function MonitorClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [pulseTick, setPulseTick] = useState(0);

  // Role guard — OPERATOR+
  useEffect(() => {
    if (status === "loading") return;
    const role = (session?.user?.role ?? "VIEWER") as keyof typeof ROLE_LEVEL;
    if ((ROLE_LEVEL[role] ?? 0) < 3) {
      router.replace("/x");
    }
  }, [session, status, router]);

  // 30s poll
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/monitor/activity", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setData(json);
          setLoadedAt(Date.now());
          setError(null);
        } else {
          setError(json.error || "Failed to load");
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Network error");
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 1s "Last updated" ticker
  useEffect(() => {
    const id = setInterval(() => setPulseTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!data && !error) {
    return (
      <div className="hf-card hf-card-compact">
        <span className="hf-spinner" /> Loading monitor…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="hf-banner hf-banner-error">
        Failed to load monitor: {error}
      </div>
    );
  }

  if (!data) return null;

  const updatedSec = Math.floor((Date.now() - loadedAt) / 1000);
  const engagementPct = data.callersTotal > 0 ? Math.round((data.callersCalledToday / data.callersTotal) * 100) : 0;

  return (
    <div className="hf-monitor-page">
      <div className="hf-monitor-header">
        <h1 className="hf-page-title">Pilot Monitor</h1>
        <span className="hf-monitor-meta" title={data.timestamp}>
          Last updated: {updatedSec}s ago
        </span>
      </div>

      {/* 6-chip header */}
      <div className="hf-monitor-chips">
        <Chip
          label="Live now"
          value={String(data.liveCalls)}
          sublabel="calls"
          tone={data.liveCalls > 0 ? "live" : "muted"}
          dots={Math.min(data.liveCalls, 5)}
        />
        <Chip label="Today" value={String(data.callsToday)} sublabel="calls" tone="default" />
        <Chip
          label="Active"
          value={`${data.callersCalledToday} / ${data.callersTotal}`}
          sublabel={`${engagementPct}% engaged`}
          tone={engagementPct >= 60 ? "good" : engagementPct >= 30 ? "warn" : "alert"}
        />
        <Chip
          label="Lapsed"
          value={String(data.callersNotCalledToday)}
          sublabel="no call today"
          tone={data.callersNotCalledToday === 0 ? "good" : "warn"}
        />
        <Chip
          label="AI errors"
          value={String(data.aiErrorsHour.count)}
          sublabel={`${Math.round(data.aiErrorsHour.rate * 100)}% / 1h`}
          tone={data.aiErrorsHour.alertThresholdExceeded ? "alert" : data.aiErrorsHour.count > 0 ? "warn" : "good"}
        />
        <Chip
          label="Tickets"
          value={String(data.openTickets)}
          sublabel="open"
          tone={data.openTickets > 5 ? "alert" : data.openTickets > 0 ? "warn" : "good"}
        />
      </div>

      {/* Live feed */}
      <div className="hf-card">
        <div className="hf-monitor-feed-header">
          <h2 className="hf-section-title">Live feed (last 60 min)</h2>
          <a className="hf-monitor-link" href="/x/callers">View all callers →</a>
        </div>
        {data.recentCallsHour.length === 0 ? (
          <div className="hf-empty">No calls in the last 60 minutes.</div>
        ) : (
          <ul className="hf-monitor-feed">
            {data.recentCallsHour.map((c) => (
              <li key={c.id} className="hf-monitor-feed-row">
                <span className={`hf-monitor-dot ${c.endedAt ? "ended" : "live"}`} aria-hidden="true" />
                <span className="hf-monitor-feed-name">
                  {c.callerName || "(unknown caller)"}
                </span>
                <span className="hf-monitor-feed-when">
                  {c.endedAt ? `ended ${timeAgo(c.endedAt)}` : `started ${timeAgo(c.createdAt)}`}
                </span>
                <span className="hf-monitor-feed-course">{c.courseName || ""}</span>
                {c.callerId && (
                  <a className="hf-monitor-link" href={`/x/callers/${c.callerId}`}>open →</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="hf-banner hf-banner-warning" style={{ marginTop: 12 }}>
          Last refresh failed: {error}. Showing previous data.
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  sublabel,
  tone,
  dots,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: "default" | "live" | "good" | "warn" | "alert" | "muted";
  dots?: number;
}) {
  return (
    <div className={`hf-monitor-chip tone-${tone}`}>
      <div className="hf-monitor-chip-label">{label}</div>
      <div className="hf-monitor-chip-value">{value}</div>
      <div className="hf-monitor-chip-sublabel">
        {dots !== undefined && dots > 0 && (
          <span aria-hidden="true" style={{ marginRight: 4 }}>
            {"●".repeat(dots)}
          </span>
        )}
        {sublabel}
      </div>
    </div>
  );
}
