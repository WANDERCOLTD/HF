"use client";

import { ExternalLink } from "lucide-react";

// ── PlanSummary ───────────────────────────────────────
//
// Compact session-type colour boxes for the v3 course builder.
// Three states: waiting (no outcomes yet), generating (skeleton), ready (boxes).

/** Session entry shape from generate-plan task result */
export interface PlanSession {
  type: string;
  label?: string;
  title?: string;
}

export type PlanSummaryState = "waiting" | "generating" | "ready";

// Short codes for the coloured boxes
const TYPE_CODES: Record<string, string> = {
  onboarding: "OB",
  introduce: "IN",
  deepen: "DP",
  review: "RV",
  assess: "AS",
  consolidate: "CN",
  practice: "PR",
  explore: "EX",
  wrap_up: "WR",
};

// Map to CSS class suffix (hf-draft-session-OB, etc.)
function getTypeCode(type: string): string {
  return TYPE_CODES[type] || type.slice(0, 2).toUpperCase();
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    onboarding: "Onboarding",
    introduce: "Introduce",
    deepen: "Deepen",
    review: "Review",
    assess: "Assess",
    consolidate: "Consolidate",
    practice: "Practice",
    explore: "Explore",
    wrap_up: "Wrap-up",
  };
  return labels[type] || type;
}

export interface PlanSummaryProps {
  state: PlanSummaryState;
  sessions: PlanSession[];
  onEditPlan?: () => void;
}

export function PlanSummary({ state, sessions, onEditPlan }: PlanSummaryProps) {
  if (state === "waiting") {
    return (
      <div className="hf-banner hf-banner-info">
        Add at least one learning outcome above to generate your session plan.
      </div>
    );
  }

  if (state === "generating") {
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="hf-draft-skeleton"
            style={{ width: 52, height: 56, borderRadius: 8 }}
          />
        ))}
      </div>
    );
  }

  // Ready state
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {sessions.map((session, i) => {
          const code = getTypeCode(session.type);
          return (
            <div
              key={i}
              className={`hf-draft-session-box hf-draft-session-${code}`}
              title={session.title || session.label || getTypeLabel(session.type)}
            >
              <span>{code}</span>
              <span className="hf-draft-session-label">
                {session.title || session.label || getTypeLabel(session.type)}
              </span>
            </div>
          );
        })}
      </div>

      {onEditPlan && (
        <button
          type="button"
          className="hf-btn hf-btn-sm hf-btn-secondary"
          onClick={onEditPlan}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          Edit plan
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}
