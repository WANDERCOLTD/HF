"use client";

import { useEffect, useState } from "react";
import type { ScoresResponse, SessionScore } from "@/lib/types";
import { bandColorVar } from "@/lib/band";
import { ScoreBar } from "@/components/ScoreBar";
import { MiniChart } from "@/components/MiniChart";

const card: React.CSSProperties = {
  background: "var(--surface-secondary)",
  border: "1px solid var(--border-default)",
  borderRadius: 14,
  padding: 20,
};

export default function ProgressPage() {
  const [sessions, setSessions] = useState<SessionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scores")
      .then((r) => r.json() as Promise<ScoresResponse>)
      .then((d) => {
        if (!d.ok) throw new Error("Failed to load scores");
        setSessions(d.sessions);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Shell><p style={{ color: "var(--text-secondary)" }}>Loading your progress…</p></Shell>;
  }
  if (error || sessions.length === 0) {
    return <Shell><p style={{ color: "var(--text-secondary)" }}>{error ?? "No sessions yet."}</p></Shell>;
  }

  const latest = sessions[sessions.length - 1];
  const first = sessions[0];
  const improvement = latest.overall - first.overall;

  return (
    <Shell>
      {/* Overall band */}
      <div style={{ ...card, textAlign: "center", marginBottom: 16 }}>
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: bandColorVar(latest.overall),
          }}
        >
          {latest.overall.toFixed(1)}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Estimated Band · {sessions.length} sessions
        </div>
      </div>

      {/* Trend */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>
          Band score over time
        </div>
        <MiniChart data={sessions.map((s) => s.overall)} height={100} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <Stat label="First" value={first.overall.toFixed(1)} />
          <Stat label="Improvement" value={`+${improvement.toFixed(1)}`} highlight />
          <Stat label="Latest" value={latest.overall.toFixed(1)} />
        </div>
      </div>

      {/* Latest criteria breakdown */}
      <div style={{ ...card }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>
          Latest session · {latest.type}
        </div>
        {latest.criteria.map((c) => (
          <ScoreBar key={c.key} label={c.label} score={c.score} />
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-primary)", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-default)" }}>
        <a href="/" style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 600 }}>← Back</a>
        <span style={{ fontWeight: 700 }}>Progress</span>
      </div>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>{children}</div>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, color: highlight ? "var(--band-high)" : "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? "var(--band-high)" : "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
