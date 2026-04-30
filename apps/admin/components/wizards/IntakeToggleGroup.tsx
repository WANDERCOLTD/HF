"use client";

/**
 * IntakeToggleGroup — the "first-call experience" tickbox group.
 *
 * Surfaces the four welcome-flow toggles (Goals / About You / Knowledge Check
 * / AI Intro Call) as a single grouped UI on the wizard's First Call step.
 * Today these toggles are only set via the chat-driven path; this gives
 * UI-driven course creators feature parity with the chat path AND with the
 * Course page Session Flow editor.
 *
 * Bag keys (stable contract — do NOT rename):
 *   - welcomeGoals: boolean
 *   - welcomeAboutYou: boolean
 *   - welcomeKnowledgeCheck: boolean
 *   - welcomeKnowledgeCheckMode: "mcq" | "socratic"  (NEW for #225 / #222)
 *   - welcomeAiIntro: boolean
 *
 * @see app/x/courses/_components/steps/CourseConfigStep.tsx (mount site)
 * @see lib/chat/wizard-tool-executor.ts (write site — both paths)
 */

import { useEffect, useState } from "react";
import { Target, HelpCircle, ClipboardCheck, Sparkles } from "lucide-react";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
// Reuse the Apple-style toggle CSS from the session-flow editor — single
// source of truth so wizard and editor look identical.
import "@/components/session-flow/session-flow-editor.css";
import "./intake-toggle-group.css";

export interface IntakeValues {
  goals: boolean;
  aboutYou: boolean;
  knowledgeCheck: boolean;
  knowledgeCheckMode: "mcq" | "socratic";
  aiIntroCall: boolean;
}

export interface IntakeToggleGroupProps {
  /** Current values (typically from the wizard data bag) */
  initial: IntakeValues;
  /** Called every time any toggle changes — caller persists via setData */
  onChange: (next: IntakeValues) => void;
}

const DEFAULTS: IntakeValues = {
  goals: true,
  aboutYou: true,
  knowledgeCheck: false,
  knowledgeCheckMode: "mcq",
  aiIntroCall: false,
};

export function IntakeToggleGroup({ initial, onChange }: IntakeToggleGroupProps) {
  const [values, setValues] = useState<IntakeValues>({ ...DEFAULTS, ...initial });

  // Push to caller whenever values change.
  useEffect(() => {
    onChange(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const set = <K extends keyof IntakeValues>(key: K, val: IntakeValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  return (
    <section className="itg">
      <FieldHint
        label="First-call intake"
        hint={WIZARD_HINTS["course.firstCallIntake"]}
        labelClass="hf-section-title"
      />
      <p className="itg-help">
        What should the AI ask the learner on Call 1? Each toggle is independent.
      </p>

      <ul className="itg-list">
        <ToggleItem
          icon={<Target size={16} />}
          title="Ask about their goals"
          subtitle="Open question — captures the goal the learner wants to reach."
          on={values.goals}
          onChange={(v) => set("goals", v)}
        />

        <ToggleItem
          icon={<HelpCircle size={16} />}
          title='Ask "About You"'
          subtitle="Confidence (1–5) + prior knowledge level + optional motivation note."
          on={values.aboutYou}
          onChange={(v) => set("aboutYou", v)}
        />

        <ToggleItem
          icon={<ClipboardCheck size={16} />}
          title="Probe prior knowledge"
          subtitle="Baseline what the learner already knows before teaching."
          on={values.knowledgeCheck}
          onChange={(v) => set("knowledgeCheck", v)}
        >
          {values.knowledgeCheck && (
            <div className="itg-sub">
              <span className="itg-sub-label">Delivery mode</span>
              <div className="itg-radio-row">
                <label className={`itg-radio ${values.knowledgeCheckMode === "mcq" ? "itg-radio--checked" : ""}`}>
                  <input
                    type="radio"
                    name="kc-mode"
                    checked={values.knowledgeCheckMode === "mcq"}
                    onChange={() => set("knowledgeCheckMode", "mcq")}
                  />
                  <span>
                    <strong>MCQ batch</strong>
                    <span className="itg-radio-hint">5 multiple-choice questions after Call 1.</span>
                  </span>
                </label>
                <label className={`itg-radio ${values.knowledgeCheckMode === "socratic" ? "itg-radio--checked" : ""}`}>
                  <input
                    type="radio"
                    name="kc-mode"
                    checked={values.knowledgeCheckMode === "socratic"}
                    onChange={() => set("knowledgeCheckMode", "socratic")}
                  />
                  <span>
                    <strong>Socratic probe</strong>
                    <span className="itg-radio-hint">In-call open question during the discovery phase.</span>
                  </span>
                </label>
              </div>
            </div>
          )}
        </ToggleItem>

        <ToggleItem
          icon={<Sparkles size={16} />}
          title="Run a separate AI intro call"
          subtitle="Soft warm-up call before any teaching — useful for anxious learners."
          on={values.aiIntroCall}
          onChange={(v) => set("aiIntroCall", v)}
        />
      </ul>
    </section>
  );
}

// ── ToggleItem ────────────────────────────────────────────

function ToggleItem({
  icon, title, subtitle, on, onChange, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  on: boolean;
  onChange: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <li className={`itg-item ${on ? "itg-item--on" : "itg-item--off"}`}>
      <div className="itg-row">
        <span className="itg-icon">{icon}</span>
        <div className="itg-text">
          <span className="itg-title">{title}</span>
          <span className="itg-subtitle">{subtitle}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={title}
          className={`sfe-toggle ${on ? "sfe-toggle--on" : ""}`}
          onClick={() => onChange(!on)}
        >
          <span className="sfe-toggle-knob" />
        </button>
      </div>
      {children}
    </li>
  );
}
