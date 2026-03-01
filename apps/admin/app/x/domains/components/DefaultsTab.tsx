"use client";

import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import type { DomainDetail } from "./types";

// ── Types ──────────────────────────────────────────────

type Source = "system" | "domain";

interface DefaultWithSource<T = unknown> {
  value: T;
  source: Source;
}

interface DefaultsData {
  sessionCount: DefaultWithSource<number>;
  durationMins: DefaultWithSource<number>;
  emphasis: DefaultWithSource<string>;
  assessments: DefaultWithSource<string>;
  lessonPlanModel: DefaultWithSource<string>;
}

const DURATIONS = [15, 20, 30, 45, 60] as const;
const EMPHASIS_OPTIONS = ["breadth", "balanced", "depth"] as const;
const ASSESSMENT_OPTIONS = ["formal", "light", "none"] as const;

// ── Component ──────────────────────────────────────────

export function DefaultsTabContent({
  domain,
  onDomainRefresh,
}: {
  domain: DomainDetail;
  onDomainRefresh: () => void;
}) {
  const [defaults, setDefaults] = useState<DefaultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Form state (mirrors defaults but editable)
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(15);
  const [emphasis, setEmphasis] = useState<string>("balanced");
  const [assessments, setAssessments] = useState<string>("light");
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");

  // Track which fields have been explicitly set at domain level
  const [overrides, setOverrides] = useState<Set<string>>(new Set());

  // ── Fetch defaults ──────────────────────────────────

  useEffect(() => {
    setLoading(true);
    fetch(`/api/domains/${domain.id}/lesson-plan-defaults`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.defaults) {
          setDefaults(data.defaults);
          const d = data.defaults as DefaultsData;
          setSessionCount(d.sessionCount.value);
          setDurationMins(d.durationMins.value);
          setEmphasis(d.emphasis.value);
          setAssessments(d.assessments.value);
          setLessonPlanModel(d.lessonPlanModel.value as LessonPlanModel);

          // Track which fields are domain overrides
          const ovr = new Set<string>();
          for (const [key, val] of Object.entries(d)) {
            if ((val as DefaultWithSource).source === "domain") ovr.add(key);
          }
          setOverrides(ovr);
        }
      })
      .catch(() => setError("Failed to load defaults"))
      .finally(() => setLoading(false));
  }, [domain.id]);

  // ── Save ────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      // Only send values that are overridden at domain level
      if (overrides.has("sessionCount")) body.sessionCount = sessionCount;
      if (overrides.has("durationMins")) body.durationMins = durationMins;
      if (overrides.has("emphasis")) body.emphasis = emphasis;
      if (overrides.has("assessments")) body.assessments = assessments;
      if (overrides.has("lessonPlanModel")) body.lessonPlanModel = lessonPlanModel;

      const res = await fetch(`/api/domains/${domain.id}/lesson-plan-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save");

      setDefaults(data.defaults);
      setDirty(false);
      onDomainRefresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleOverride(key: string) {
    setOverrides((prev) => new Set([...prev, key]));
    setDirty(true);
  }

  function handleReset(key: string) {
    const next = new Set(overrides);
    next.delete(key);
    setOverrides(next);
    setDirty(true);

    // Reset to system value
    if (defaults) {
      const d = defaults as DefaultsData;
      const sysVal = d[key as keyof DefaultsData];
      // Reload the system value — we need to re-fetch to know the system default
      // For now, keep the current value and just remove the override flag
      // The save handler will send null for reset keys, and the server will re-resolve
    }
  }

  // ── Render helpers ──────────────────────────────────

  function SourceBadge({ field }: { field: string }) {
    const isOverride = overrides.has(field);
    return (
      <span className="hf-flex hf-items-center hf-gap-xs">
        <span
          className={`hf-chip hf-chip-sm ${isOverride ? "hf-chip-selected" : ""}`}
          style={{ cursor: "default", fontSize: 10, padding: "1px 6px" }}
        >
          {isOverride ? "OVR" : "SYS"}
        </span>
        {isOverride && (
          <button
            onClick={() => handleReset(field)}
            className="hf-btn hf-btn-ghost hf-btn-xs"
            title="Reset to system default"
          >
            <RefreshCw size={10} />
          </button>
        )}
      </span>
    );
  }

  // ── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-gap-sm hf-py-lg">
        <div className="hf-spinner hf-spinner-sm" />
        <span className="hf-text-sm hf-text-muted">Loading defaults...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="hf-mb-md">
        <h3 className="hf-section-title">Course Creation Defaults</h3>
        <p className="hf-section-desc">
          Starting values when educators create courses in this institution.
          Override any value, or leave as system defaults.
        </p>
      </div>

      <ErrorBanner error={error} className="hf-mb-md" />

      <div className="hf-card" style={{ maxWidth: 600 }}>
        <div className="hf-flex-col hf-gap-lg">
          {/* Session count */}
          <div>
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
              <FieldHint label="Default session count" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
              <SourceBadge field="sessionCount" />
            </div>
            <SessionCountPicker
              value={sessionCount}
              onChange={(v) => { setSessionCount(v); handleOverride("sessionCount"); }}
            />
          </div>

          {/* Duration */}
          <div>
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
              <FieldHint label="Default session duration" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
              <SourceBadge field="durationMins" />
            </div>
            <div className="hf-chip-row">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => { setDurationMins(d); handleOverride("durationMins"); }}
                  className={`hf-chip${durationMins === d ? " hf-chip-selected" : ""}`}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Emphasis */}
          <div>
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
              <FieldHint label="Default emphasis" hint={WIZARD_HINTS["course.emphasis"]} labelClass="hf-label" />
              <SourceBadge field="emphasis" />
            </div>
            <div className="hf-chip-row">
              {EMPHASIS_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => { setEmphasis(e); handleOverride("emphasis"); }}
                  className={`hf-chip${emphasis === e ? " hf-chip-selected" : ""}`}
                >
                  {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
                </button>
              ))}
            </div>
          </div>

          {/* Assessments */}
          <div>
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
              <FieldHint label="Default assessments" hint={WIZARD_HINTS["course.assessments"]} labelClass="hf-label" />
              <SourceBadge field="assessments" />
            </div>
            <div className="hf-chip-row">
              {ASSESSMENT_OPTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => { setAssessments(a); handleOverride("assessments"); }}
                  className={`hf-chip${assessments === a ? " hf-chip-selected" : ""}`}
                >
                  {a === "formal" ? "Yes (formal)" : a === "none" ? "No assessments" : "Light checks"}
                </button>
              ))}
            </div>
          </div>

          {/* Teaching model */}
          <div>
            <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
              <FieldHint label="Default teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
              <SourceBadge field="lessonPlanModel" />
            </div>
            <LessonPlanModelPicker
              value={lessonPlanModel}
              onChange={(v) => { setLessonPlanModel(v); handleOverride("lessonPlanModel"); }}
            />
          </div>
        </div>

        {/* Footer legend + save */}
        <div className="hf-flex hf-items-center hf-gap-md hf-mt-lg hf-pt-md" style={{ borderTop: "1px solid var(--border-default)" }}>
          <span className="hf-text-xs hf-text-muted">
            SYS = system default · OVR = institution override
          </span>
          <div className="hf-flex-1" />
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="hf-btn hf-btn-primary hf-btn-sm"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
