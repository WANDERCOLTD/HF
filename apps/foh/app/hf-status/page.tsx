"use client";

import { useEffect, useState } from "react";
import type { HfStatus } from "@/lib/hf";
import {
  callerHighlights,
  masteryPct,
  MOMENTUM_LABEL,
  TRIAGE,
  type CallersResponse,
  type CallerSummary,
} from "@/lib/callers";
import { CallerSelect } from "@/components/CallerSelect";

const card: React.CSSProperties = {
  background: "var(--surface-secondary)",
  border: "1px solid var(--border-default)",
  borderRadius: 14,
  padding: 20,
};

const statusColor: Record<string, string> = {
  green: "var(--band-high)",
  amber: "var(--band-mid)",
  red: "var(--band-poor)",
};

export default function HfStatusPage() {
  const [status, setStatus] = useState<HfStatus | null>(null);
  const [callerData, setCallerData] = useState<CallersResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    fetch("/api/hf-status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetch("/api/callers")
      .then((r) => r.json() as Promise<CallersResponse>)
      .then((d) => {
        setCallerData(d);
        if (d.callers[0]) setSelectedId(d.callers[0].id);
      })
      .catch(() => {});
  }, []);

  const callers = callerData?.callers ?? [];
  const hi = callerHighlights(callers);
  const selected = callers.find((c) => c.id === selectedId) ?? callers[0] ?? null;

  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-primary)", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-default)" }}>
        <a href="/" style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 600 }}>← Back</a>
        <span style={{ fontWeight: 700 }}>Caller Insights</span>
        {callerData && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 20,
              background: callerData.live ? "var(--band-high)" : "var(--band-mid)",
              color: "#fff",
            }}
          >
            {callerData.live ? "● LIVE" : "● SAMPLE"}
          </span>
        )}
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: 24 }}>
        {!callerData && <p style={{ color: "var(--text-secondary)" }}>Loading callers…</p>}

        {callerData && (
          <>
            {/* ── Highlight strip ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              <Metric label="Callers" value={hi.totalCallers} />
              <Metric label="Total calls" value={hi.totalCalls} />
              <Metric label="Avg mastery" value={`${hi.avgMasteryPct}%`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              <Highlight tint="var(--band-high)" label="Most active" name={hi.mostActive?.name} detail={`${hi.mostActive?.totalCalls} calls`} />
              <Highlight tint="var(--band-high)" label="Top mastery" name={hi.topMastery?.name} detail={hi.topMastery ? `${masteryPct(hi.topMastery)}%` : "—"} />
              <Highlight tint="var(--band-poor)" label="Need attention" name={`${hi.needsAttention} caller${hi.needsAttention === 1 ? "" : "s"}`} detail="triage flag" />
            </div>

            {/* ── Fancy caller select ── */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>
              Choose a caller
            </div>
            <CallerSelect callers={callers} selectedId={selectedId} onSelect={setSelectedId} />

            {/* ── Selected caller detail ── */}
            {selected && <CallerDetail caller={selected} />}

            {callerData.note && (
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 14, textAlign: "center" }}>
                {callerData.note}
              </p>
            )}

            {/* ── Live HF connection footer ── */}
            {status && <ConnectionFooter status={status} />}
          </>
        )}
      </div>
    </main>
  );
}

function CallerDetail({ caller }: { caller: CallerSummary }) {
  const t = TRIAGE[caller.triage];
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{caller.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{caller.email}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: t.color, color: "#fff" }}>
          {t.label}
        </span>
      </div>

      {/* Mastery bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13, color: "var(--text-secondary)" }}>
          <span>Mastery · {MOMENTUM_LABEL[caller.momentum]}</span>
          <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{masteryPct(caller)}%</span>
        </div>
        <div style={{ height: 8, background: "var(--border-default)", borderRadius: 4 }}>
          <div style={{ height: "100%", width: `${masteryPct(caller)}%`, background: "var(--band-high)", borderRadius: 4, transition: "width 0.6s ease" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <Metric label="Calls" value={caller.totalCalls} small />
        <Metric label="Modules" value={`${caller.completedModules}/${caller.totalModules}`} small />
        <Metric label="Last call" value={caller.lastCallAt ? new Date(caller.lastCallAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"} small />
      </div>

      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
        Current module: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{caller.currentModule ?? "—"}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {caller.recentCallDates.map((d, i) => (
          <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: "var(--hover-bg)", color: "var(--text-secondary)" }}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function ConnectionFooter({ status }: { status: HfStatus }) {
  return (
    <div style={{ ...card, marginTop: 20, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: status.connected ? "var(--band-high)" : "var(--band-poor)", boxShadow: status.connected ? "0 0 8px var(--band-high)" : "none" }} />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {status.connected ? "Live system link" : "System link down"} · {status.source} ·
          {" "}{status.stats.callers} callers · {status.stats.calls} calls · {status.stats.memories} memories
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div style={{ ...card, textAlign: "center", padding: small ? 12 : 16 }}>
      <div style={{ fontSize: small ? 20 : 26, fontWeight: 800, color: "var(--band-high)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{label}</div>
    </div>
  );
}

function Highlight({ tint, label, name, detail }: { tint: string; label: string; name?: string; detail: string }) {
  return (
    <div style={{ ...card, padding: 14, borderLeft: `3px solid ${tint}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{name ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{detail}</div>
    </div>
  );
}
