"use client";

import { useState, useEffect, useCallback } from "react";
import type { StepFormProps } from "@/lib/workflow/types";
import { useTerminology } from "@/contexts/TerminologyContext";
import { ReadinessChecklist } from "@/components/shared/ReadinessBadge";

// ============================================================================
// Types
// ============================================================================

interface ReadinessCheckResult {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
}

interface ReadinessData {
  ready: boolean;
  score: number;
  level: "ready" | "almost" | "incomplete";
  checks: ReadinessCheckResult[];
  criticalPassed: number;
  criticalTotal: number;
  recommendedPassed: number;
  recommendedTotal: number;
  domainName?: string;
}

interface PlaybookSummary {
  id: string;
  name: string;
  status: string;
  itemCount: number;
}

// ============================================================================
// ActivateStepForm
// ============================================================================

export function ActivateStepForm({
  step,
  prefilled,
  collectedData,
  onComplete,
  onSkip,
  onError,
}: StepFormProps) {
  const { terms } = useTerminology();
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [draftPlaybooks, setDraftPlaybooks] = useState<PlaybookSummary[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);

  // Resolve domainId from prefilled or collected data
  const domainId =
    prefilled?.domainId ||
    Object.values(collectedData).find((d) => d.id && d.slug)?.id ||
    null;

  // Load readiness data + draft playbooks
  const loadData = useCallback(async () => {
    if (!domainId) return;
    setLoading(true);

    try {
      const [readinessRes, playbooksRes] = await Promise.all([
        fetch(`/api/domains/${domainId}/readiness`),
        fetch(`/api/playbooks?domainId=${domainId}&status=DRAFT`),
      ]);

      const readinessData = await readinessRes.json();
      if (readinessData.ok !== false) {
        setReadiness(readinessData);
      }

      const playbooksData = await playbooksRes.json();
      if (playbooksData.ok !== false && Array.isArray(playbooksData.playbooks)) {
        const drafts = playbooksData.playbooks
          .filter((p: any) => p.status === "DRAFT")
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            itemCount: p._count?.items ?? p.items?.length ?? 0,
          }));
        setDraftPlaybooks(drafts);
        if (drafts.length === 1) {
          setSelectedPlaybookId(drafts[0].id);
        }
      }
    } catch {
      // Readiness fetch failed — show error state
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Publish playbook + mark complete
  const handleActivate = async () => {
    if (!domainId) return;
    setPublishing(true);
    setPublishError(null);

    try {
      // If there's a draft playbook to publish, do it
      if (selectedPlaybookId) {
        const res = await fetch(`/api/playbooks/${selectedPlaybookId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();

        if (!data.ok) {
          setPublishError(data.error || "Failed to publish playbook");
          onError([data.error || "Failed to publish playbook"]);
          setPublishing(false);
          return;
        }
      }

      // Re-check readiness after publish
      const res = await fetch(`/api/domains/${domainId}/readiness`);
      const finalReadiness = await res.json();

      onComplete({
        domainId,
        activated: true,
        playbookPublished: selectedPlaybookId || null,
        readinessScore: finalReadiness.score ?? readiness?.score ?? 0,
        readinessLevel: finalReadiness.level ?? readiness?.level ?? "incomplete",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setPublishError(msg);
      onError([msg]);
    } finally {
      setPublishing(false);
    }
  };

  // Skip without publishing
  const handleSkipActivation = () => {
    onComplete({
      domainId,
      activated: false,
      readinessScore: readiness?.score ?? 0,
      readinessLevel: readiness?.level ?? "incomplete",
    });
  };

  // No domain available
  if (!domainId) {
    return (
      <div style={{
        background: "var(--surface-primary)",
        border: "1px solid var(--border-default)",
        borderRadius: 16,
        padding: 24,
        textAlign: "center",
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
          {step.title}
        </h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>
          No domain found in previous steps. Create a domain first to check readiness.
        </p>
        {!step.required && (
          <button
            onClick={onSkip}
            style={{
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              border: "1px solid var(--border-default)",
              background: "var(--surface-secondary)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  const criticalsFailing = readiness
    ? readiness.criticalTotal - readiness.criticalPassed
    : 0;
  const canActivate = readiness ? readiness.criticalPassed === readiness.criticalTotal : false;

  return (
    <div style={{
      background: "var(--surface-primary)",
      border: "1px solid var(--border-default)",
      borderRadius: 16,
      padding: 24,
    }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        {step.title}
      </h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px" }}>
        {step.description || "Review domain readiness and publish your playbook to go live."}
      </p>

      {/* Loading state */}
      {loading && (
        <div style={{
          padding: 40,
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 14,
        }}>
          Checking domain readiness...
        </div>
      )}

      {/* Readiness results */}
      {!loading && readiness && (
        <>
          {/* Score summary */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: 16,
            borderRadius: 12,
            border: `1px solid ${
              readiness.level === "ready" ? "var(--status-success-border, #a7f3d0)"
                : readiness.level === "almost" ? "var(--status-warning-border, #fde68a)"
                : "var(--status-error-border, #fecaca)"
            }`,
            background: readiness.level === "ready" ? "var(--status-success-bg)"
              : readiness.level === "almost" ? "var(--status-warning-bg)"
              : "var(--status-error-bg)",
            marginBottom: 20,
          }}>
            {/* Score circle */}
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: readiness.level === "ready" ? "var(--status-success-text)"
                : readiness.level === "almost" ? "var(--status-warning-text)"
                : "var(--status-error-text)",
              color: "var(--surface-primary)",
              fontWeight: 800,
              fontSize: 18,
            }}>
              {readiness.score}%
            </div>

            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 16,
                fontWeight: 700,
                color: readiness.level === "ready" ? "var(--status-success-text)"
                  : readiness.level === "almost" ? "var(--status-warning-text)"
                  : "var(--status-error-text)",
                marginBottom: 2,
              }}>
                {readiness.level === "ready" ? "Ready to Go Live"
                  : readiness.level === "almost" ? "Almost Ready"
                  : "Not Ready"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {readiness.criticalPassed}/{readiness.criticalTotal} critical checks passed
                {readiness.recommendedTotal > 0 && (
                  <> · {readiness.recommendedPassed}/{readiness.recommendedTotal} recommended</>
                )}
              </div>
            </div>
          </div>

          {/* Checklist detail */}
          <div style={{ marginBottom: 24 }}>
            <ReadinessChecklist checks={readiness.checks} level={readiness.level} />
          </div>

          {/* Draft playbook selection (if any) */}
          {draftPlaybooks.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}>
                Publish {terms.playbook}
              </label>
              {draftPlaybooks.map((pb) => (
                <label
                  key={pb.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: selectedPlaybookId === pb.id
                      ? "2px solid var(--accent-primary)"
                      : "1px solid var(--border-default)",
                    background: selectedPlaybookId === pb.id
                      ? "var(--accent-bg)"
                      : "var(--surface-secondary)",
                    cursor: "pointer",
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="radio"
                    name="playbook"
                    checked={selectedPlaybookId === pb.id}
                    onChange={() => setSelectedPlaybookId(pb.id)}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                      {pb.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {pb.itemCount} items · DRAFT
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Blocking warning */}
          {criticalsFailing > 0 && (
            <div style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "var(--status-error-bg)",
              border: "1px solid var(--status-error-border, #fecaca)",
              color: "var(--status-error-text)",
              fontSize: 13,
              marginBottom: 16,
              lineHeight: 1.5,
            }}>
              <strong>{criticalsFailing} critical check{criticalsFailing > 1 ? "s" : ""} failing.</strong>
              {" "}Fix the items above before activating. Use the links to navigate to each issue.
            </div>
          )}

          {/* Publish error */}
          {publishError && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--error-bg)",
              border: "1px solid var(--error-border)",
              color: "var(--error-text)",
              fontSize: 13,
              marginBottom: 16,
            }}>
              {publishError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            {/* Refresh button */}
            <button
              onClick={loadData}
              style={{
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                border: "1px solid var(--border-default)",
                background: "var(--surface-secondary)",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              Re-check
            </button>

            {/* Skip / complete without publishing */}
            {!step.required && (
              <button
                onClick={handleSkipActivation}
                style={{
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: "1px solid var(--border-default)",
                  background: "var(--surface-secondary)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                Skip Activation
              </button>
            )}

            {/* Go Live button */}
            <button
              onClick={handleActivate}
              disabled={!canActivate || publishing}
              title={!canActivate ? "Fix all critical checks first" : ""}
              style={{
                padding: "10px 24px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 10,
                border: "none",
                background: !canActivate || publishing
                  ? "var(--surface-tertiary)"
                  : "linear-gradient(135deg, var(--status-success-text) 0%, var(--status-success-text) 100%)",
                color: !canActivate || publishing ? "var(--text-muted)" : "var(--surface-primary)",
                cursor: !canActivate || publishing ? "not-allowed" : "pointer",
                boxShadow: canActivate && !publishing ? "0 4px 12px rgba(22, 163, 74, 0.3)" : "none",
              }}
            >
              {publishing
                ? "Publishing..."
                : selectedPlaybookId
                  ? "Publish & Go Live"
                  : "Go Live"}
            </button>
          </div>
        </>
      )}

      {/* No readiness data */}
      {!loading && !readiness && (
        <div style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}>
          Could not load readiness data. The readiness spec may not be seeded yet.
          <div style={{ marginTop: 16 }}>
            <button
              onClick={loadData}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--border-default)",
                background: "var(--surface-secondary)",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
