"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";

// ── Types ──────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────

interface Props {
  domainId: string | null;
  canEdit: boolean;
}

export function CourseDefaultsSection({ domainId, canEdit }: Props) {
  const [defaults, setDefaults] = useState<DefaultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Form state
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState<number>(30);
  const [emphasis, setEmphasis] = useState<string>("balanced");
  const [assessments, setAssessments] = useState<string>("light");
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");
  const [overrides, setOverrides] = useState<Set<string>>(new Set());

  // ── Fetch ────────────────────────────────────────

  const loadDefaults = useCallback(async () => {
    if (!domainId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/domains/${domainId}/lesson-plan-defaults`);
      const data = await res.json();
      if (data.ok && data.defaults) {
        setDefaults(data.defaults);
        const d = data.defaults as DefaultsData;
        setSessionCount(d.sessionCount.value);
        setDurationMins(d.durationMins.value);
        setEmphasis(d.emphasis.value);
        setAssessments(d.assessments.value);
        setLessonPlanModel(d.lessonPlanModel.value as LessonPlanModel);

        const ovr = new Set<string>();
        for (const [key, val] of Object.entries(d)) {
          if ((val as DefaultWithSource).source === "domain") ovr.add(key);
        }
        setOverrides(ovr);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [domainId]);

  useEffect(() => { loadDefaults(); }, [loadDefaults]);

  // ── Save (debounced auto-save) ───────────────────

  const save = useCallback(async (body: Record<string, unknown>) => {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    try {
      const res = await fetch(`/api/domains/${domainId}/lesson-plan-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setDefaults(data.defaults);
        setSaveStatus("saved");
        saveTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [domainId]);

  const handleChange = (key: string, value: unknown) => {
    const next = new Set(overrides);
    next.add(key);
    setOverrides(next);

    // Build body from current state + this change
    const body: Record<string, unknown> = {};
    const vals: Record<string, unknown> = { sessionCount, durationMins, emphasis, assessments, lessonPlanModel, [key]: value };
    for (const k of next) {
      body[k] = vals[k];
    }
    save(body);
  };

  const handleReset = (key: string) => {
    const next = new Set(overrides);
    next.delete(key);
    setOverrides(next);

    const body: Record<string, unknown> = {};
    const vals: Record<string, unknown> = { sessionCount, durationMins, emphasis, assessments, lessonPlanModel };
    for (const k of next) {
      body[k] = vals[k];
    }
    save(body);
  };

  // ── Render helpers ───────────────────────────────

  function SourceBadge({ field }: { field: string }) {
    const isOverride = overrides.has(field);
    return (
      <span className="hf-flex hf-items-center hf-gap-xs">
        <span
          className={`hf-chip hf-chip-sm hf-source-badge ${isOverride ? "hf-chip-selected" : ""}`}
        >
          {isOverride ? "OVR" : "SYS"}
        </span>
        {isOverride && canEdit && (
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

  // ── Render ───────────────────────────────────────

  if (!domainId) {
    return (
      <div className="hf-no-domain-hint">
        Select a domain above to configure course defaults.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-gap-sm">
        <div className="hf-spinner hf-spinner-sm" />
        <span className="hf-text-sm hf-text-muted">Loading defaults...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
        <p className="hf-text-sm hf-text-muted hf-flex-1">
          New courses inherit these defaults. Teachers can override per course.
        </p>
        {saveStatus === "saving" && (
          <span className="hf-save-status hf-save-status--saving">
            <div className="hf-spinner hf-spinner-xs" /> Saving...
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="hf-save-status hf-save-status--saved">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="hf-save-status hf-save-status--error">
            Failed to save
          </span>
        )}
      </div>

      <div className="hf-settings-form">
        {/* Session count */}
        <div>
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
            <FieldHint label="Sessions per course" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
            <SourceBadge field="sessionCount" />
          </div>
          <SessionCountPicker
            value={sessionCount}
            onChange={(v) => { setSessionCount(v); handleChange("sessionCount", v); }}
          />
        </div>

        {/* Duration */}
        <div>
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
            <FieldHint label="Session duration" hint={WIZARD_HINTS["course.duration"]} labelClass="hf-label" />
            <SourceBadge field="durationMins" />
          </div>
          <div className="hf-chip-row">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => { setDurationMins(d); handleChange("durationMins", d); }}
                className={`hf-chip${durationMins === d ? " hf-chip-selected" : ""}`}
                disabled={!canEdit}
              >
                {d} min
              </button>
            ))}
          </div>
        </div>

        {/* Emphasis */}
        <div>
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
            <FieldHint label="Teaching emphasis" hint={WIZARD_HINTS["course.emphasis"]} labelClass="hf-label" />
            <SourceBadge field="emphasis" />
          </div>
          <div className="hf-chip-row">
            {EMPHASIS_OPTIONS.map((e) => (
              <button
                key={e}
                onClick={() => { setEmphasis(e); handleChange("emphasis", e); }}
                className={`hf-chip${emphasis === e ? " hf-chip-selected" : ""}`}
                disabled={!canEdit}
              >
                {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
              </button>
            ))}
          </div>
        </div>

        {/* Assessments */}
        <div>
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
            <FieldHint label="Assessments" hint={WIZARD_HINTS["course.assessments"]} labelClass="hf-label" />
            <SourceBadge field="assessments" />
          </div>
          <div className="hf-chip-row">
            {ASSESSMENT_OPTIONS.map((a) => (
              <button
                key={a}
                onClick={() => { setAssessments(a); handleChange("assessments", a); }}
                className={`hf-chip${assessments === a ? " hf-chip-selected" : ""}`}
                disabled={!canEdit}
              >
                {a === "formal" ? "Yes (formal)" : a === "none" ? "No assessments" : "Light checks"}
              </button>
            ))}
          </div>
        </div>

        {/* Teaching model */}
        <div>
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-xs">
            <FieldHint label="Teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
            <SourceBadge field="lessonPlanModel" />
          </div>
          <LessonPlanModelPicker
            value={lessonPlanModel}
            onChange={(v) => { setLessonPlanModel(v); handleChange("lessonPlanModel", v); }}
          />
        </div>
      </div>

      <p className="hf-text-xs hf-text-muted hf-mt-md">
        SYS = system default · OVR = institution override
      </p>
    </div>
  );
}
