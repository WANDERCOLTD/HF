"use client";

import { useState, useEffect } from "react";
import { FileText, Building2, GraduationCap, BookOpen } from "lucide-react";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { useErrorCapture } from "@/contexts/ErrorCaptureContext";
import type { StepProps } from "../types";

type ReadinessCheck = {
  id: string;
  label: string;
  passed: boolean;
  level: string;
  actionLabel?: string;
  actionHref?: string;
};

type ReadinessResult = {
  ready: boolean;
  score: number;
  level: string;
  checks: ReadinessCheck[];
  criticalPassed: number;
  criticalTotal: number;
};

export default function DoneStep({ getData, onPrev, endFlow }: StepProps) {
  const { reportError } = useErrorCapture();
  const sourceId = getData<string>("sourceId");
  const sourceName = getData<string>("sourceName");
  const subjectName = getData<string>("subjectName");
  const domainId = getData<string>("domainId");
  const domainName = getData<string>("domainName");
  const lessonCount = getData<number>("lessonCount");
  const reviewedCount = getData<number>("reviewedCount");
  const assertionCount = getData<number>("assertionCount");
  const questionCount = getData<number>("questionCount");
  const vocabCount = getData<number>("vocabCount");
  const curriculumId = getData<string>("curriculumId");

  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);

  // ── Fetch course readiness ───────────────────────────
  useEffect(() => {
    if (!domainId) return;
    setLoadingReadiness(true);
    const params = new URLSearchParams({ domainId });
    if (sourceId) params.set("sourceId", sourceId);
    fetch(`/api/domains/${domainId}/course-readiness?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setReadiness({
            ready: data.ready,
            score: data.score,
            level: data.level,
            checks: data.checks || [],
            criticalPassed: data.criticalPassed,
            criticalTotal: data.criticalTotal,
          });
        }
      })
      .catch((err: unknown) => { reportError(err instanceof Error ? err : String(err), { source: "wizard", step: "done" }); })
      .finally(() => setLoadingReadiness(false));
  }, [domainId, sourceId]);

  const scorePct = readiness ? Math.round(readiness.score * 100) : 0;

  // Build stats from available data
  const stats = [
    ...(assertionCount != null ? [{ label: "Teaching Points", value: assertionCount }] : []),
    ...(reviewedCount != null ? [{ label: "Reviewed", value: reviewedCount }] : []),
    ...((questionCount ?? 0) > 0 ? [{ label: "Questions", value: questionCount! }] : []),
    ...((vocabCount ?? 0) > 0 ? [{ label: "Vocabulary", value: vocabCount! }] : []),
    ...(lessonCount != null ? [{ label: "Sessions", value: lessonCount }] : []),
  ];

  return (
    <WizardSummary
      title={readiness?.ready !== false ? "Content Ready!" : "Content Extracted"}
      subtitle={readiness?.ready === false
        ? "Your content has been extracted. Review the readiness checks below to finish setup."
        : "Your content has been extracted and configured."
      }
      intent={{
        items: [
          { icon: <FileText className="w-4 h-4" />, label: "Material", value: sourceName || "—" },
          ...(subjectName ? [{ icon: <GraduationCap className="w-4 h-4" />, label: "Subject", value: subjectName }] : []),
          ...(domainName ? [{ icon: <Building2 className="w-4 h-4" />, label: "Institution", value: domainName }] : []),
        ],
      }}
      created={{
        entities: [
          ...(sourceId ? [{
            icon: <FileText className="w-5 h-5" />,
            label: "Material",
            name: sourceName || "—",
            detail: assertionCount != null ? `${assertionCount} teaching points` : undefined,
            href: `/x/content-sources/${sourceId}`,
          }] : []),
          ...(curriculumId && subjectName ? [{
            icon: <GraduationCap className="w-5 h-5" />,
            label: "Subject",
            name: subjectName,
            detail: lessonCount != null ? `${lessonCount} sessions` : undefined,
          }] : []),
          ...(domainId ? [{
            icon: <Building2 className="w-5 h-5" />,
            label: "Institution",
            name: domainName || "—",
            href: `/x/domains?id=${domainId}`,
          }] : []),
        ],
      }}
      stats={stats.length > 0 ? stats : undefined}
      primaryAction={{
        label: domainId ? "Teach This" : "Done",
        href: domainId ? `/x/teach?domainId=${domainId}` : "/x/content-sources",
        onClick: endFlow,
      }}
      secondaryActions={[
        ...(sourceId ? [{ label: "View Material", href: `/x/content-sources/${sourceId}`, onClick: endFlow }] : []),
        ...(domainId ? [{ label: "Go to Institution", href: `/x/domains?id=${domainId}`, onClick: endFlow }] : []),
        { label: "Start Another", onClick: endFlow },
      ]}
      onBack={onPrev}
    >
      {/* Course Readiness */}
      {domainId && (
        <div className="wiz-section">
          <div className="wiz-section-label">Course Readiness</div>
          <div style={{
            padding: 20, borderRadius: 12,
            border: "1px solid var(--border-default)", background: "var(--surface-primary)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: readiness ? 16 : 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                Status
              </span>
              {loadingReadiness ? (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Checking...</span>
              ) : readiness ? (
                <span style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                  color: readiness.ready ? "var(--status-success-text)" : "var(--status-error-text)",
                  background: readiness.ready
                    ? "color-mix(in srgb, var(--status-success-text) 10%, transparent)"
                    : "color-mix(in srgb, var(--status-error-text) 10%, transparent)",
                }}>
                  {readiness.ready ? `${scorePct}% Ready` : `${scorePct}% — Not Ready`}
                </span>
              ) : null}
            </div>

            {readiness && (
              <>
                <div style={{ height: 8, borderRadius: 4, background: "var(--surface-tertiary)", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    background: readiness.ready
                      ? "var(--status-success-text)"
                      : "var(--accent-primary)",
                    width: `${scorePct}%`, transition: "width 0.3s ease-out",
                  }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {readiness.checks.map((check) => (
                    <div key={check.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                      borderRadius: 6, background: "var(--surface-secondary)",
                    }}>
                      <span style={{
                        width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: "50%", fontSize: 11, fontWeight: 700,
                        background: check.passed
                          ? "color-mix(in srgb, var(--status-success-text) 15%, transparent)"
                          : "color-mix(in srgb, var(--status-error-text) 15%, transparent)",
                        color: check.passed ? "var(--status-success-text)" : "var(--status-error-text)",
                      }}>
                        {check.passed ? "\u2713" : "\u2717"}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>
                        {check.label}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                        color: check.level === "critical" ? "var(--status-error-text)" : "var(--text-muted)",
                      }}>
                        {check.level}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </WizardSummary>
  );
}
