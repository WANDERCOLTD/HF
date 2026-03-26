"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { StepFooter } from "@/components/wizards/StepFooter";
import type { StepRenderProps } from "@/components/wizards/types";

const TERM_PREVIEW_KEYS = [
  { key: "domain",      label: "Institution" },
  { key: "playbook",   label: "Course" },
  { key: "caller",     label: "Learner" },
  { key: "instructor", label: "Instructor" },
  { key: "session",    label: "Session" },
] as const;

const TERM_SUGGESTIONS: Record<string, string[]> = {
  domain:      ["School", "Academy", "College", "University", "Organization", "Hub", "Practice", "Facility"],
  playbook:    ["Subject", "Course", "Module", "Unit", "Programme", "Curriculum", "Training Plan"],
  caller:      ["Student", "Learner", "Pupil", "Participant", "Member", "Employee", "Client", "Patient"],
  instructor:  ["Teacher", "Tutor", "Trainer", "Coach", "Facilitator", "Mentor", "Guide"],
  session:     ["Lesson", "Class", "Session", "Tutorial", "Call", "Meeting"],
};

// Static fallback — mirrors seed-institution-types.ts for the 5 preview keys.
// Used when the DB type has no terminology configured yet.
const STATIC_TERMINOLOGY: Record<string, Record<string, string>> = {
  school:     { domain: "School",        playbook: "Subject",        caller: "Student",     instructor: "Teacher",     session: "Lesson" },
  corporate:  { domain: "Organization",  playbook: "Training Plan",  caller: "Employee",    instructor: "Trainer",     session: "Training Session" },
  community:  { domain: "Hub",           playbook: "Programme",      caller: "Member",      instructor: "Facilitator", session: "Call" },
  coaching:   { domain: "Practice",      playbook: "Coaching Plan",  caller: "Client",      instructor: "Coach",       session: "Coaching Session" },
  healthcare: { domain: "Facility",      playbook: "Care Plan",      caller: "Patient",     instructor: "Provider",    session: "Patient Session" },
  training:   { domain: "Academy",       playbook: "Course",         caller: "Participant", instructor: "Trainer",     session: "Training Session" },
  university: { domain: "University",    playbook: "Module",         caller: "Student",     instructor: "Lecturer",    session: "Tutorial" },
};

export function TerminologyStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const typeSlug = getData<string>("typeSlug") ?? null;
  const [baseTerminology, setBaseTerminology] = useState<Record<string, string> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [customEditing, setCustomEditing] = useState<Record<string, boolean>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  useEffect(() => {
    if (!typeSlug || fetched.current) return;
    fetched.current = true;
    fetch("/api/admin/institution-types")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.types) {
          const match = data.types.find((t: { slug: string }) => t.slug === typeSlug);
          const terms = match?.terminology || STATIC_TERMINOLOGY[typeSlug] || null;
          if (terms) {
            setBaseTerminology(terms);
            // Seed overrides from existing wizard data or base terms
            const existing = getData<Record<string, string>>("terminologyOverrides");
            const initial: Record<string, string> = {};
            for (const { key } of TERM_PREVIEW_KEYS) {
              initial[key] = existing?.[key] ?? terms[key] ?? "";
            }
            setOverrides(initial);
          }
        }
      })
      .catch(() => {
        const terms = STATIC_TERMINOLOGY[typeSlug] || null;
        if (terms) {
          setBaseTerminology(terms);
          const initial: Record<string, string> = {};
          for (const { key } of TERM_PREVIEW_KEYS) {
            initial[key] = terms[key] ?? "";
          }
          setOverrides(initial);
        }
      })
      .finally(() => setLoading(false));
  }, [typeSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (key: string, value: string) => {
    const updated = { ...overrides, [key]: value };
    setOverrides(updated);
    setData("terminologyOverrides", updated);
  };

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Terminology</h1>
          <p className="hf-page-subtitle">Choose the words your institution uses</p>
        </div>

        <div className="hf-mb-lg">
          <FieldHint label="Terminology" hint={WIZARD_HINTS["institution.terminology"]} labelClass="hf-label" />
          <p className="hf-hint hf-mt-xs">
            Pre-filled from your institution type. Edit any label or pick from the suggestions.
          </p>
        </div>

        {loading ? (
          <div className="hf-ai-loading-row hf-mt-xs">
            <Loader2 size={14} className="hf-spinner" />
            <span className="hf-text-sm hf-text-muted">Loading terminology…</span>
          </div>
        ) : baseTerminology ? (
          <div className="hf-flex-col hf-gap-md">
            {TERM_PREVIEW_KEYS.map(({ key, label }) => {
              const isCustom = overrides[key] && !TERM_SUGGESTIONS[key]?.includes(overrides[key]);
              const openEditor = () => {
                setCustomText(prev => ({ ...prev, [key]: overrides[key] ?? "" }));
                setCustomEditing(prev => ({ ...prev, [key]: true }));
              };
              const applyCustom = () => {
                const val = customText[key]?.trim();
                if (val) handleChange(key, val);
                setCustomEditing(prev => ({ ...prev, [key]: false }));
              };
              const cancelCustom = () => {
                setCustomEditing(prev => ({ ...prev, [key]: false }));
              };
              return (
                <div key={key}>
                  <label className="hf-label">{label}</label>
                  <div className="hf-chip-row">
                    {TERM_SUGGESTIONS[key]?.map((s) => {
                      const isDefault = baseTerminology?.[key] === s;
                      const isSelected = overrides[key] === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`hf-chip${isSelected ? " hf-chip-selected" : ""}`}
                          onClick={() => { handleChange(key, s); setCustomEditing(prev => ({ ...prev, [key]: false })); }}
                        >
                          {s}
                          {isDefault && <span className="hf-chip-badge">Default</span>}
                        </button>
                      );
                    })}
                    {!customEditing[key] && isCustom && (
                      <button type="button" className="hf-chip hf-chip-selected" onClick={openEditor}>
                        {overrides[key]}
                      </button>
                    )}
                    {!customEditing[key] && (
                      <button type="button" className="hf-chip" onClick={openEditor}>
                        Other…
                      </button>
                    )}
                  </div>
                  {customEditing[key] && (
                    <div className="hf-flex hf-gap-sm hf-mt-xs">
                      <input
                        type="text"
                        className="hf-input"
                        value={customText[key] ?? ""}
                        onChange={(e) => setCustomText(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={label}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); applyCustom(); }
                          if (e.key === "Escape") cancelCustom();
                        }}
                      />
                      <button type="button" className="hf-btn hf-btn-primary hf-btn-sm" disabled={!customText[key]?.trim()} onClick={applyCustom}>
                        Use
                      </button>
                      <button type="button" className="hf-btn hf-btn-ghost hf-btn-sm" onClick={cancelCustom}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hf-hint hf-mt-xs">
            No terminology preset found for this type. You can configure labels in Settings after creation.
          </p>
        )}
      </div>

      <StepFooter
        onBack={onPrev}
        onSkip={onNext}
        skipLabel="Skip"
        onNext={onNext}
        nextLabel="Continue"
      />
    </div>
  );
}
