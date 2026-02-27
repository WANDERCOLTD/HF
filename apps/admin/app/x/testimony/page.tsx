"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Users, BarChart3, Calendar } from "lucide-react";

interface SpecStat {
  specId: string;
  slug: string;
  name: string;
  specRole: string;
  uniqueCallers: number;
  totalScores: number;
  avgScore: number | null;
  avgConfidence: number | null;
  firstScored: string | null;
  lastScored: string | null;
}

interface DomainOption {
  id: string;
  name: string;
}

const roleColors: Record<string, string> = {
  EXTRACT: "var(--badge-blue-text)",
  SYNTHESISE: "var(--badge-purple-text)",
  ORCHESTRATE: "var(--text-muted)",
  CONSTRAIN: "var(--status-warning-text)",
  IDENTITY: "var(--identity-accent, #4338ca)",
  CONTENT: "var(--content-accent, #8b5cf6)",
  VOICE: "var(--status-success-text)",
};

export default function TestimonyDashboard() {
  const [specs, setSpecs] = useState<SpecStat[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [domainId, setDomainId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.domains) setDomains(d.domains);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = domainId
      ? `/api/testimony/specs?domainId=${domainId}`
      : "/api/testimony/specs";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setSpecs(d.specs);
      })
      .finally(() => setLoading(false));
  }, [domainId]);

  const totalCallers = new Set(specs.flatMap((s) => Array(s.uniqueCallers).fill(s.specId))).size;
  const totalScores = specs.reduce((sum, s) => sum + s.totalScores, 0);

  return (
    <div data-tour="welcome" className="hf-page-container">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 className="hf-page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Testimony
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", padding: "2px 6px", borderRadius: 4, background: "color-mix(in srgb, var(--status-success-text) 15%, transparent)", color: "var(--status-success-text)", border: "1px solid color-mix(in srgb, var(--status-success-text) 25%, transparent)" }}>GF</span>
        </h1>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24 }}>
        Per-spec evidence across callers. Proof that each measurement spec works.
      </p>

      {/* Filters & Stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {domains.length > 0 && (
          <select
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              fontSize: 13,
              background: "var(--surface-primary)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">All Domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
          <span>{specs.length} specs</span>
          <span>{totalScores.toLocaleString()} scores</span>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-[var(--surface-secondary)]" />
          ))}
        </div>
      ) : specs.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            background: "var(--surface-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: 12,
          }}
        >
          <BarChart3 size={48} style={{ color: "var(--text-muted)", margin: "0 auto 16px" }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
            No testimony data yet
          </h3>
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
            Scores will appear here after calls are analyzed by the pipeline.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {specs.map((spec) => (
            <Link
              key={spec.specId}
              href={`/x/testimony/${spec.specId}${domainId ? `?domainId=${domainId}` : ""}`}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: 20,
                background: "var(--surface-primary)",
                border: "1px solid var(--border-default)",
                borderRadius: 12,
                textDecoration: "none",
                transition: "border-color 0.2s",
              }}
              className="home-stat-card"
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: roleColors[spec.specRole] ?? "var(--text-muted)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${roleColors[spec.specRole] ?? "var(--text-muted)"} 10%, transparent)`,
                  }}
                >
                  {spec.specRole}
                </span>
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 4,
                }}
              >
                {spec.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 12,
                  fontFamily: "monospace",
                }}
              >
                {spec.slug}
              </div>

              {/* Stats */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginTop: "auto",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Users size={12} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Callers</span>
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                    {spec.uniqueCallers}
                  </span>
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <BarChart3 size={12} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Avg Score</span>
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                    {spec.avgScore !== null ? spec.avgScore.toFixed(2) : "—"}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Scores</span>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                    {spec.totalScores}
                  </div>
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={12} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Latest</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
                    {spec.lastScored
                      ? new Date(spec.lastScored).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
