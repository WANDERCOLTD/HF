"use client";

/**
 * Readiness Section — Read-only checklist of domain readiness checks.
 * Renders pass/fail with severity badges and fix action links.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { CheckCircle, XCircle, AlertTriangle, ExternalLink } from "lucide-react";

export function ReadinessSection() {
  const { state } = useHolo();
  const checks = state.readinessChecks;

  if (!checks.length) {
    return (
      <div className="hp-section-empty">
        No readiness checks available. Save the domain first.
      </div>
    );
  }

  const passed = checks.filter((c) => c.passed).length;
  const critical = checks.filter((c) => c.severity === "critical");
  const recommended = checks.filter((c) => c.severity === "recommended");
  const optional = checks.filter((c) => c.severity === "optional");

  return (
    <div className="hp-section-readiness">
      {/* Summary bar */}
      <div className="hp-readiness-summary">
        <span className="hp-readiness-score">
          {passed}/{checks.length} checks passing
        </span>
        {passed === checks.length && (
          <span className="hp-readiness-badge hp-readiness-badge-ready">Ready</span>
        )}
      </div>

      {/* Critical checks */}
      {critical.length > 0 && (
        <CheckGroup label="Critical" checks={critical} />
      )}

      {/* Recommended checks */}
      {recommended.length > 0 && (
        <CheckGroup label="Recommended" checks={recommended} />
      )}

      {/* Optional checks */}
      {optional.length > 0 && (
        <CheckGroup label="Optional" checks={optional} />
      )}
    </div>
  );
}

function CheckGroup({
  label,
  checks,
}: {
  label: string;
  checks: Array<{
    id: string;
    name: string;
    passed: boolean;
    severity: string;
    message?: string;
    fixAction?: string;
  }>;
}) {
  return (
    <div className="hp-check-group">
      <div className="hp-check-group-label">{label}</div>
      {checks.map((check) => (
        <div
          key={check.id}
          className={`hp-check-row ${check.passed ? "hp-check-passed" : "hp-check-failed"}`}
        >
          <div className="hp-check-icon">
            {check.passed ? (
              <CheckCircle size={16} />
            ) : check.severity === "critical" ? (
              <XCircle size={16} />
            ) : (
              <AlertTriangle size={16} />
            )}
          </div>
          <div className="hp-check-content">
            <div className="hp-check-name">{check.name}</div>
            {check.message && !check.passed && (
              <div className="hp-check-message">{check.message}</div>
            )}
          </div>
          {check.fixAction && !check.passed && (
            <a
              href={check.fixAction}
              className="hp-check-fix"
              title="Fix this"
            >
              <ExternalLink size={12} />
              Fix
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
