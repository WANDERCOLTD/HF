"use client";

import React from "react";
import { Target } from "lucide-react";
import {
  CardGrid,
  Donut,
} from "@/components/shared/display-primitives";
import { pct } from "@/lib/caller-insights/formatNum";
import { useUpliftData } from "../useUpliftData";
import type { Goal } from "../../types";
import "./goals-section.css";

type Props = {
  callerId: string;
};

/**
 * Goals achieved — Card grid of badge cards, one per goal. Active goals
 * surface first; Completed cluster sits below. Read-only on Uplift v2 —
 * Progress v2 (later PR) will surface the editor with action chips.
 *
 * Each card uses the Donut primitive for progress + Lucide Target icon +
 * goal type as a small chip. Goal type slugs that don't resolve to a label
 * render as-is rather than crashing (defensive against spec drift).
 */
export function GoalsSection({ callerId }: Props): React.ReactElement {
  const { data, loading } = useUpliftData(callerId);

  if (loading) {
    return (
      <div className="hf-uplift-v2-goals-loading" role="status">
        Loading goals…
      </div>
    );
  }

  const goals = data?.goals ?? [];
  const active = goals.filter((g) => g.status !== "COMPLETED");
  const completed = goals.filter((g) => g.status === "COMPLETED");

  return (
    <div className="hf-uplift-v2-goals">
      <div className="hf-uplift-v2-goals-head">
        <h3 className="hf-uplift-v2-goals-title">Goals</h3>
        {goals.length > 0 && (
          <span className="hf-uplift-v2-goals-sub">
            {active.length} active · {completed.length} done
          </span>
        )}
      </div>

      {goals.length === 0 ? (
        <div className="hf-uplift-v2-goals-empty">
          No goals set yet. Goals appear once the course defines them.
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <GoalGroup label="Active" goals={active} variant="active" />
          )}
          {completed.length > 0 && (
            <GoalGroup label="Completed" goals={completed} variant="completed" />
          )}
        </>
      )}
    </div>
  );
}

function GoalGroup({
  label,
  goals,
  variant,
}: {
  label: string;
  goals: Goal[];
  variant: "active" | "completed";
}): React.ReactElement {
  return (
    <div className={`hf-uplift-v2-goals-group hf-uplift-v2-goals-group--${variant}`}>
      <div className="hf-uplift-v2-goals-group-label">{label}</div>
      <CardGrid minColumnWidth={240} gap={12}>
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} />
        ))}
      </CardGrid>
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }): React.ReactElement {
  const isDone = goal.status === "COMPLETED";
  const color = isDone
    ? "var(--status-success-text)"
    : "var(--accent-primary)";

  return (
    <div
      className={`hf-uplift-v2-goal-card${isDone ? " hf-uplift-v2-goal-card--done" : ""}`}
    >
      <div className="hf-uplift-v2-goal-ring">
        <Donut value={goal.progress} size={56} strokeWidth={6} color={color}>
          <span className="hf-uplift-v2-goal-ring-pct">{pct(goal.progress)}</span>
        </Donut>
      </div>
      <div className="hf-uplift-v2-goal-body">
        <div className="hf-uplift-v2-goal-name" title={goal.name}>
          {goal.name}
        </div>
        <div className="hf-uplift-v2-goal-meta">
          <span className="hf-uplift-v2-goal-type">
            <Target size={10} />
            {goalTypeLabel(goal.type)}
          </span>
          {isDone && <span className="hf-uplift-v2-goal-done">✓ Done</span>}
        </div>
      </div>
    </div>
  );
}

const GOAL_TYPE_LABELS: Record<string, string> = {
  MASTERY: "mastery",
  ACHIEVE: "achieve",
  RECENCY: "recency",
  FREQUENCY: "frequency",
  ATTENDANCE: "attendance",
};

function goalTypeLabel(type: string): string {
  return GOAL_TYPE_LABELS[type.toUpperCase()] ?? type.toLowerCase();
}
