"use client";

import { useEffect, useState } from "react";
import { Sparkles, Lock } from "lucide-react";
import type { FohModuleCard, FohStudentProgressResponse } from "./api/student-progress/route";

/**
 * #2318 MT-essential — client-side module-unlock computation.
 *
 * Mirrors `apps/admin/lib/curriculum/check-module-unlock.ts::normalisePrerequisite`
 * + the COMPLETED-count comparison logic. Pure function — no DB. Inlined
 * here because FOH cannot import from `apps/admin`. Parity is pinned
 * by `apps/foh/__tests__/home.test.tsx` and the data shape is pinned
 * by `apps/admin/tests/lib/curriculum/ielts-module-prerequisites-data.test.ts`.
 *
 * SERVER-side enforcement (the canonical gate) lives in follow-on #2320.
 * This client check is MT-essential UX only — operator-supervised demos
 * mitigate the URL-hack bypass risk for the ~20-100 prospect window.
 */
interface UnlockComputation {
  unlocked: boolean;
  missing: Array<{ moduleId: string; required: number; actual: number }>;
}

function normalisePrereq(
  p: unknown,
): { moduleId: string; minCompletions: number } | null {
  if (typeof p === "string") return { moduleId: p, minCompletions: 1 };
  if (typeof p === "object" && p !== null) {
    const obj = p as { moduleId?: unknown; minCompletions?: unknown };
    if (typeof obj.moduleId !== "string" || obj.moduleId.length === 0) {
      return null;
    }
    const min =
      typeof obj.minCompletions === "number" && obj.minCompletions > 0
        ? obj.minCompletions
        : 1;
    return { moduleId: obj.moduleId, minCompletions: min };
  }
  return null;
}

export function computeUnlockState(
  module: FohModuleCard,
  modules: FohModuleCard[],
): UnlockComputation {
  const prereqs = module.prerequisites ?? [];
  if (!Array.isArray(prereqs) || prereqs.length === 0) {
    return { unlocked: true, missing: [] };
  }
  const completedBySlug = new Map<string, number>();
  for (const m of modules) {
    completedBySlug.set(m.slug, m.completedCount ?? 0);
  }
  const missing: UnlockComputation["missing"] = [];
  for (const p of prereqs) {
    const n = normalisePrereq(p);
    if (!n) continue;
    const actual = completedBySlug.get(n.moduleId) ?? 0;
    if (actual < n.minCompletions) {
      missing.push({
        moduleId: n.moduleId,
        required: n.minCompletions,
        actual,
      });
    }
  }
  return { unlocked: missing.length === 0, missing };
}

function formatMissingTooltip(
  missing: UnlockComputation["missing"],
  modulesBySlug: Map<string, FohModuleCard>,
): string {
  if (missing.length === 0) return "";
  const parts = missing.map((m) => {
    const label = modulesBySlug.get(m.moduleId)?.title ?? m.moduleId;
    const remaining = m.required - m.actual;
    if (m.required === 1) return `Complete ${label} first`;
    return `Complete ${remaining} more × ${label}`;
  });
  return parts.join(" · ");
}

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

// #2318 MT-essential — locked module card. Not clickable, dimmed,
// renders a 🔒 badge + title="..." tooltip describing missing prereqs.
const moduleCardLocked: React.CSSProperties = {
  ...moduleCard,
  background: "color-mix(in srgb, var(--surface-secondary) 70%, var(--surface-primary))",
  color: "var(--text-secondary)",
  cursor: "not-allowed",
  opacity: 0.7,
};

const lockBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  padding: "4px 10px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--text-secondary) 12%, var(--surface-primary))",
  border: "1px solid var(--border-default)",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
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
            // #2318 MT-essential — compute client-side lock state. The
            // server is trust-the-operator for MT; full enforcement
            // ships via #2320 (Lattice cluster).
            const unlock = computeUnlockState(m, data?.modules ?? []);
            const tooltip = formatMissingTooltip(
              unlock.missing,
              new Map((data?.modules ?? []).map((x) => [x.slug, x])),
            );

            if (!unlock.unlocked) {
              return (
                <div
                  key={m.slug}
                  role="button"
                  aria-disabled="true"
                  data-locked="true"
                  data-module-slug={m.slug}
                  title={tooltip}
                  style={moduleCardLocked}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {tooltip}
                    </div>
                  </div>
                  <div style={lockBadge} aria-label="Locked">
                    <Lock size={12} aria-hidden />
                    Locked
                  </div>
                </div>
              );
            }

            return (
              <a
                key={m.slug}
                href={`/sim?module=${encodeURIComponent(m.slug)}`}
                data-next-module-slug={isNext ? m.slug : undefined}
                data-module-slug={m.slug}
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
