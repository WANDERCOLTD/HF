"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { FohStudentProgressResponse } from "./api/student-progress/route";

const card: React.CSSProperties = {
  background: "var(--surface-secondary)",
  border: "1px solid var(--border-default)",
  borderRadius: 14,
  padding: 20,
};

const moduleCard: React.CSSProperties = {
  ...card,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  textDecoration: "none",
  color: "var(--text-primary)",
  transition: "border-color 120ms ease, transform 120ms ease",
};

const moduleCardNext: React.CSSProperties = {
  ...moduleCard,
  borderColor: "var(--band-high)",
  boxShadow: "0 0 0 2px color-mix(in srgb, var(--band-high) 40%, transparent)",
};

const statusBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  padding: "4px 10px",
  borderRadius: 999,
  background: "var(--surface-primary)",
  border: "1px solid var(--border-default)",
};

export default function Home() {
  const [data, setData] = useState<FohStudentProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/student-progress")
      .then((r) => r.json() as Promise<FohStudentProgressResponse>)
      .then((d) => {
        if (!d.ok) throw new Error("Failed to load progress");
        setData(d);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const nextSlug = data?.nextRecommended?.moduleSlug ?? data?.lessonPlan?.nextRecommendedModuleSlug ?? null;
  const focusLabel = data?.lessonPlan?.focusLabel ?? null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--surface-primary)",
        color: "var(--text-primary)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <Sparkles size={24} aria-hidden />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>HumanFirst</h1>
      </header>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {nextSlug && focusLabel && (
          <section
            data-testid="next-session-banner"
            style={{
              ...card,
              background: "color-mix(in srgb, var(--band-high) 12%, var(--surface-secondary))",
              borderColor: "var(--band-high)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--band-high)", textTransform: "uppercase", marginBottom: 6 }}>
              Recommended next session
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Focus area: {focusLabel}
            </div>
            {data?.lessonPlan?.reason && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
                {data.lessonPlan.reason}
              </div>
            )}
          </section>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", margin: "8px 4px" }}>
            Your modules
          </h2>

          {loading && <div style={{ ...card, color: "var(--text-secondary)" }}>Loading your modules…</div>}
          {error && <div style={{ ...card, color: "var(--text-secondary)" }}>{error}</div>}

          {data?.modules.map((m) => {
            const isNext = m.slug === nextSlug;
            return (
              <a
                key={m.slug}
                href={`/sim?module=${encodeURIComponent(m.slug)}`}
                data-next-module-slug={isNext ? m.slug : undefined}
                aria-current={isNext ? "true" : undefined}
                style={isNext ? moduleCardNext : moduleCard}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{m.title}</div>
                  {isNext && (
                    <div style={{ fontSize: 12, color: "var(--band-high)", fontWeight: 600 }}>
                      ★ Recommended next
                    </div>
                  )}
                </div>
                <div style={statusBadge}>{statusLabel(m.status)}</div>
              </a>
            );
          })}
        </section>

        <nav style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <NavLink href="/progress">View progress</NavLink>
          <NavLink href="/hf-status">Caller insights</NavLink>
          <NavLink href="/sim">SIM chat</NavLink>
        </nav>
      </div>
    </main>
  );
}

function statusLabel(status: "MASTERED" | "IN_PROGRESS" | "NOT_STARTED"): string {
  if (status === "MASTERED") return "Mastered";
  if (status === "IN_PROGRESS") return "In progress";
  return "Not started";
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <a
      href={href}
      style={{
        padding: "10px 18px",
        borderRadius: 10,
        background: "var(--surface-secondary)",
        border: "1px solid var(--border-default)",
        color: "var(--text-primary)",
        textDecoration: "none",
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      {children}
    </a>
  );
}
