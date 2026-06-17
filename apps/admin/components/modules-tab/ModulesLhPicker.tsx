"use client";

/**
 * ModulesLhPicker — LH module picker for the Modules tab.
 *
 * Fetches `/api/courses/[courseId]/sessions` for the modules array
 * (the sessions route already returns modules). When a dedicated
 * `/api/courses/[courseId]/modules` route lands, swap the fetch.
 *
 * Renders one row per AuthoredModule via `hf-list-row`. Click → setSelected.
 *
 * TODO(modules-route): replace the sessions piggyback with a dedicated
 * `/api/courses/[courseId]/modules` route when one exists. The sessions
 * route over-fetches (plan + studentProgress) for what's needed here.
 */

import { useEffect, useState } from "react";

interface ModuleSummary {
  id: string;
  slug?: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
  learningObjectiveCount?: number;
}

interface ModulesLhPickerProps {
  courseId: string;
  selectedModuleId: string | null;
  onSelect: (id: string | null) => void;
}

export function ModulesLhPicker({
  courseId,
  selectedModuleId,
  onSelect,
}: ModulesLhPickerProps) {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/sessions`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.modules)) {
          setModules(data.modules as ModuleSummary[]);
        } else {
          setError(data?.error || "Failed to load modules");
          setModules([]);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
        setModules([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading) {
    return (
      <div className="hf-journey-lh" data-testid="hf-modules-lh-picker">
        <div className="hf-journey-lh-groups">
          <div className="hf-card hf-card-compact">Loading modules…</div>
        </div>
      </div>
    );
  }

  if (error && (modules?.length ?? 0) === 0) {
    return (
      <div className="hf-journey-lh" data-testid="hf-modules-lh-picker">
        <div className="hf-journey-lh-groups">
          <div className="hf-banner hf-banner-error">
            Could not load modules. {error}
          </div>
        </div>
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <div className="hf-journey-lh" data-testid="hf-modules-lh-picker">
        <div className="hf-journey-lh-groups">
          <div className="hf-empty">
            <p className="hf-section-desc">
              No authored modules yet. Add modules from the Curriculum tab.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-journey-lh" data-testid="hf-modules-lh-picker">
      <div className="hf-journey-lh-groups">
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`hf-list-row ${
              selectedModuleId === m.id ? "hf-selected" : ""
            }`}
            onClick={() => onSelect(m.id)}
            data-testid={`hf-modules-row-${m.id}`}
          >
            <span className="hf-journey-bucket-label">{m.title}</span>
            {typeof m.learningObjectiveCount === "number" ? (
              <span className="hf-journey-bucket-count">
                {m.learningObjectiveCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
