"use client";

/**
 * ModuleEditor — bi-pane Modules-tab editor surface.
 *
 * The Modules tab is a runtime-behaviour tuner, NOT an authoring surface.
 * Modules + their content (LOs, ContentAssertions, rubric) come from
 * course setup (wizard / course-ref upload). This editor only tunes
 * three intent groups per module:
 *
 *   1. **HOW** — the LLM's behaviour when teaching this module (mode,
 *      question target, cue-card pool, scaffolds, closing line, …).
 *      Today this is the existing G8 cohort surfaced via
 *      `<ModuleInspectorPanel>`.
 *
 *   2. **WHEN** — sequencing + visibility (position, terminal flags,
 *      first-call visibility, completion gate, default-for-new-callers).
 *      Today most of this is read-only — we render chips derived from
 *      the modules API response so the operator can SEE the rule.
 *      Editable controls land per-knob in follow-ons.
 *
 *   3. **LEARNER ALLOWANCES** — what the learner is / isn't allowed
 *      to do mid-module (skip, replay, hint, topic choice, …).
 *      Placeholder card for now — the underlying
 *      `AuthoredModuleAllowances` shape doesn't exist yet; landing it
 *      requires schema + compose-transform + voice-path enforcement
 *      work tracked separately.
 *
 * Bi-pane shape: LH module picker (existing) + this editor as the
 * canvas. The Inspector column from the prior tri-pane is folded into
 * the canvas as the HOW card so the operator works in one wide column
 * instead of squeezing G8 fields into a 360px sticky panel.
 */

import { Lock } from "lucide-react";

import type {
  AuthoredModuleSettings,
  PlaybookConfig,
} from "@/lib/types/json-fields";

import { ModuleInspectorPanel } from "./ModuleInspectorPanel";

export interface ModuleEditorRow {
  id: string;
  label: string;
  duration?: string;
  mode?: string;
  frequency?: string;
  position?: number;
  terminal?: boolean;
  sessionTerminal?: boolean;
  settings?: Partial<AuthoredModuleSettings>;
}

interface ModuleEditorProps {
  courseId: string;
  selectedModuleId: string | null;
  selectedModule: ModuleEditorRow | null;
  playbookConfig: PlaybookConfig | null;
  onSaved: () => void;
}

export function ModuleEditor({
  courseId,
  selectedModuleId,
  selectedModule,
  playbookConfig,
  onSaved,
}: ModuleEditorProps) {
  if (!selectedModuleId || !selectedModule) {
    return <ModuleEditorEmpty />;
  }

  return (
    <div
      className="hf-module-editor"
      data-testid={`hf-module-editor-${selectedModuleId}`}
    >
      <ModuleHeaderCard module={selectedModule} />
      <ModuleHowCard
        courseId={courseId}
        selectedModuleId={selectedModuleId}
        selectedModule={selectedModule}
        playbookConfig={playbookConfig}
        onSaved={onSaved}
      />
      <ModuleWhenCard module={selectedModule} />
      <ModuleAllowancesCard />
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────── */

function ModuleEditorEmpty() {
  return (
    <div className="hf-empty" data-testid="hf-module-editor-empty">
      <h2 className="hf-section-title">Pick a module to tune</h2>
      <p className="hf-section-desc">
        Pick a module on the left to tune how the system delivers it and
        when learners reach it. Modules and their content come from course
        setup — this surface only adjusts delivery behaviour.
      </p>
    </div>
  );
}

/* ── Header card: identity + at-a-glance ─────────────────────────── */

function ModuleHeaderCard({ module: m }: { module: ModuleEditorRow }) {
  return (
    <section
      className="hf-card hf-module-editor-header"
      data-testid="hf-module-editor-header"
    >
      <div className="hf-module-editor-header-title">
        <h2 className="hf-section-title">{m.label}</h2>
        <p className="hf-section-desc">
          Identity comes from course setup; this surface only tunes
          delivery and visibility.
        </p>
      </div>
      <div
        className="hf-module-editor-chips"
        role="list"
        aria-label="Module identity"
      >
        {m.mode ? <Chip label="Mode" value={m.mode} /> : null}
        {m.frequency ? <Chip label="Frequency" value={m.frequency} /> : null}
        {m.duration ? <Chip label="Duration" value={m.duration} /> : null}
        {typeof m.position === "number" ? (
          <Chip label="Position" value={`#${m.position + 1}`} />
        ) : null}
      </div>
    </section>
  );
}

/* ── HOW card: behavioural settings (wraps existing G8 panel) ─────── */

function ModuleHowCard({
  courseId,
  selectedModuleId,
  selectedModule,
  playbookConfig,
  onSaved,
}: {
  courseId: string;
  selectedModuleId: string;
  selectedModule: ModuleEditorRow;
  playbookConfig: PlaybookConfig | null;
  onSaved: () => void;
}) {
  return (
    <section
      className="hf-card hf-module-editor-card"
      data-testid="hf-module-editor-how"
      aria-labelledby="hf-module-editor-how-title"
    >
      <header className="hf-module-editor-card-header">
        <h3 id="hf-module-editor-how-title" className="hf-section-title">
          How the system delivers this module
        </h3>
        <p className="hf-section-desc">
          The LLM&apos;s behaviour during this module — question target,
          cue-card pool, scaffolds, closing line, and more.
        </p>
      </header>
      <ModuleInspectorPanel
        courseId={courseId}
        selectedModuleId={selectedModuleId}
        selectedModuleLabel={selectedModule.label}
        settings={selectedModule.settings ?? null}
        playbookConfig={playbookConfig}
        onSaved={onSaved}
      />
    </section>
  );
}

/* ── WHEN card: sequencing + visibility (read-only chips today) ─── */

function ModuleWhenCard({ module: m }: { module: ModuleEditorRow }) {
  const positionLabel =
    typeof m.position === "number" ? `Position #${m.position + 1}` : "Unset";
  return (
    <section
      className="hf-card hf-module-editor-card"
      data-testid="hf-module-editor-when"
      aria-labelledby="hf-module-editor-when-title"
    >
      <header className="hf-module-editor-card-header">
        <h3 id="hf-module-editor-when-title" className="hf-section-title">
          When learners reach this module
        </h3>
        <p className="hf-section-desc">
          Sequencing and visibility rules. Most of these are read-only
          today — editable controls land in a follow-on.
        </p>
      </header>
      <div
        className="hf-module-editor-chips"
        role="list"
        aria-label="Module sequencing"
      >
        <Chip label="Position" value={positionLabel} />
        <Chip
          label="Ends session"
          value={m.sessionTerminal ? "Yes" : "No"}
          tone={m.sessionTerminal ? "warn" : "muted"}
        />
        <Chip
          label="Ends course"
          value={m.terminal ? "Yes" : "No"}
          tone={m.terminal ? "warn" : "muted"}
        />
      </div>
      <p className="hf-info-footer">
        Reorder by dragging modules in the left panel (coming soon).
        First-call visibility, completion gate, and per-module strictness
        controls land per-knob.
      </p>
    </section>
  );
}

/* ── ALLOWANCES card: placeholder (schema not yet shipped) ────────── */

function ModuleAllowancesCard() {
  return (
    <section
      className="hf-card hf-module-editor-card hf-module-editor-card-locked"
      data-testid="hf-module-editor-allowances"
      aria-labelledby="hf-module-editor-allowances-title"
    >
      <header className="hf-module-editor-card-header">
        <h3
          id="hf-module-editor-allowances-title"
          className="hf-section-title hf-module-editor-card-locked-title"
        >
          <Lock size={14} aria-hidden="true" />
          What the learner can &amp; can&apos;t do
        </h3>
        <p className="hf-section-desc">
          Per-module skip / replay / hint-request / topic-choice
          allowances. The data model and compose-side enforcement land
          in a follow-on; this card surfaces the intent so the operator
          knows it&apos;s coming.
        </p>
      </header>
    </section>
  );
}

/* ── Chip helper ─────────────────────────────────────────────────── */

function Chip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "muted";
}) {
  return (
    <span
      className={`hf-module-editor-chip hf-module-editor-chip-${tone}`}
      role="listitem"
    >
      <span className="hf-module-editor-chip-label">{label}</span>
      <span className="hf-module-editor-chip-value">{value}</span>
    </span>
  );
}
