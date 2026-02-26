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
};

export function TerminologyStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const typeSlug = getData<string>("typeSlug") ?? null;
  const [baseTerminology, setBaseTerminology] = useState<Record<string, string> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
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
    <div>
      <FieldHint label="Terminology" hint={WIZARD_HINTS["institution.terminology"]} />
      <p className="ws-hint" style={{ marginTop: 4 }}>
        Pre-filled from your institution type. Edit any label or pick from the suggestions.
      </p>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
          <Loader2 size={14} className="hf-spinner" />
          Loading terminology…
        </div>
      ) : baseTerminology ? (
        <table className="iw-term-table">
          <thead>
            <tr>
              <th>Concept</th>
              <th>Your Label</th>
            </tr>
          </thead>
          <tbody>
            {TERM_PREVIEW_KEYS.map(({ key, label }) => (
              <tr key={key}>
                <td className="iw-term-key">{label}</td>
                <td className="iw-term-edit-cell">
                  <input
                    type="text"
                    className="hf-input iw-term-input"
                    value={overrides[key] ?? ""}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder={baseTerminology[key] ?? label}
                  />
                  <div className="iw-term-suggestions">
                    {TERM_SUGGESTIONS[key]?.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`iw-term-chip${overrides[key] === s ? " iw-term-chip-active" : ""}`}
                        onClick={() => handleChange(key, s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
          No terminology preset found for this type. You can configure labels in Settings after creation.
        </p>
      )}

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
