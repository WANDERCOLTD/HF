"use client";

/**
 * AttainmentCertProgressSection — Wave A2 of the legacy-tab retirement
 * plan. Lifts ProgressTab v1's TrustProgressSection (dual-track
 * Certification Readiness / General Understanding bars + per-module
 * L0-L5 trust badges) into the Attainment tab, so progress-v2 + v1 can
 * retire without losing the cert-readiness signal.
 *
 * Reads `/api/callers/[id]/trust-progress` (existing route).
 *
 * Per-curriculum card shows:
 *  - Cert readiness (certifiedMastery × trust-weighted; 0..1)
 *  - Supplementary mastery (all modules; 0..1)
 *  - Per-module rows: name + mastery % + trustLevel chip
 *    (L0–L5 / UNVERIFIED) + countsToCertification flag
 *
 * Empty states:
 *  - No active curricula → muted "No certification track yet"
 *  - Per-curriculum with zero modules → "No modules registered yet"
 *
 * Auth: inherits caller-scoped VIEWER + STUDENT-scope from the
 * underlying route.
 */

import { useEffect, useState } from "react";

interface AttainmentCertProgressSectionProps {
  callerId: string;
}

interface TrustModuleBreakdown {
  mastery: number;
  trustLevel: string;
  trustWeight: number;
  countsToCertification: boolean;
}

interface TrustCurriculum {
  specSlug: string;
  specName: string | null;
  specId: string | null;
  currentModuleId: string | null;
  lastAccessedAt: string | null;
  certifiedMastery: number;
  supplementaryMastery: number;
  certificationReadiness: number;
  moduleBreakdown: Record<string, TrustModuleBreakdown>;
}

interface TrustProgressResponse {
  ok: boolean;
  curricula: TrustCurriculum[];
}

function trustBadgeVariant(trustLevel: string): string {
  switch (trustLevel.toUpperCase()) {
    case "L5":
    case "L4":
      return "hf-badge-success";
    case "L3":
      return "hf-badge-info";
    case "L2":
    case "L1":
      return "hf-badge-warning";
    case "L0":
    case "UNVERIFIED":
    default:
      return "hf-badge-muted";
  }
}

function formatPercent(value: number): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export function AttainmentCertProgressSection({
  callerId,
}: AttainmentCertProgressSectionProps) {
  const [data, setData] = useState<TrustProgressResponse | null | "error">(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/trust-progress`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as TrustProgressResponse;
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (data === null) {
    return (
      <section
        className="hf-attainment-section"
        data-testid="hf-attainment-cert-progress"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Certification progress</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-attainment-section"
        data-testid="hf-attainment-cert-progress"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Certification progress</div>
          <span className="hf-badge hf-badge-muted">
            Unable to load certification progress
          </span>
        </div>
      </section>
    );
  }

  const curricula = Array.isArray(data.curricula) ? data.curricula : [];

  if (curricula.length === 0) {
    return (
      <section
        className="hf-attainment-section"
        data-testid="hf-attainment-cert-progress"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Certification progress</div>
          <span className="hf-badge hf-badge-muted">
            No certification track yet
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="hf-attainment-section"
      data-testid="hf-attainment-cert-progress"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Certification progress — {curricula.length} curricul
          {curricula.length === 1 ? "um" : "a"}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "var(--gap-2, 12px)",
            marginTop: "var(--gap-1, 4px)",
          }}
        >
          {curricula.map((c) => (
            <CurriculumCard key={c.specSlug} curriculum={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface CurriculumCardProps {
  curriculum: TrustCurriculum;
}

function CurriculumCard({ curriculum }: CurriculumCardProps) {
  const c = curriculum;
  const modules = Object.entries(c.moduleBreakdown ?? {});
  const totalCounted = modules.filter(
    ([, m]) => m.countsToCertification,
  ).length;

  return (
    <div
      className="hf-card-compact"
      data-testid={`hf-cert-curriculum-${c.specSlug}`}
      style={{ minWidth: 0 }}
    >
      <div className="hf-category-label">{c.specName ?? c.specSlug}</div>
      <div className="hf-text-sm hf-text-muted">
        Cert readiness {formatPercent(c.certificationReadiness)} ·
        supplementary {formatPercent(c.supplementaryMastery)}
      </div>
      <div
        className="hf-text-sm hf-text-muted"
        style={{ marginTop: 2 }}
        data-testid={`hf-cert-counted-${c.specSlug}`}
      >
        {totalCounted} of {modules.length} module
        {modules.length === 1 ? "" : "s"} count toward certification
      </div>

      {modules.length === 0 ? (
        <span className="hf-badge hf-badge-muted" style={{ marginTop: 8 }}>
          No modules registered yet
        </span>
      ) : (
        <ol className="hf-list-row" style={{ marginTop: 8 }}>
          {modules.map(([moduleKey, m]) => (
            <li key={moduleKey}>
              <strong>{moduleKey}</strong>{" "}
              <span
                className={`hf-badge ${trustBadgeVariant(m.trustLevel)}`}
                style={{ marginLeft: 4 }}
              >
                {m.trustLevel}
              </span>
              {m.countsToCertification ? (
                <span
                  className="hf-badge hf-badge-success"
                  style={{ marginLeft: 4 }}
                >
                  counts
                </span>
              ) : (
                <span
                  className="hf-badge hf-badge-muted"
                  style={{ marginLeft: 4 }}
                >
                  supplementary
                </span>
              )}
              <div className="hf-text-sm hf-text-muted">
                {formatPercent(m.mastery)} mastery · trust weight{" "}
                {(m.trustWeight ?? 0).toFixed(2)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
