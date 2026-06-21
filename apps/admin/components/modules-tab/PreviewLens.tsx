"use client";

/**
 * Modules-tab PreviewLens — SIM-shell preview on RHS pane (#2206, U5 of #2185).
 *
 * Operator framing (2026-06-21): the Modules tab tunes per-module runtime
 * behaviour. The RHS pane shows what the LEARNER sees for the selected
 * Module + shell combination, so the operator can validate the chosen
 * `AuthoredModuleMode` against the resolved `LearnerShellKind` without
 * leaving the tuner.
 *
 * Lens picker offers two variants today:
 *   - `shell-preview` (default for this tab) — mounts the LearnerShell
 *     component matching `resolveLearnerShell({session, module}).shellKind`
 *     with mock data per shell kind (mock tutor turn for chat-feed, mock
 *     cue card for exam, mock MCQ for mcq-rounds, mock band readout for
 *     results-readout, mock welcome screen for intake-wizard).
 *   - `none` — collapsed state when the operator just wants the editor
 *     out of the way.
 *
 * Cascade chip surfaces which `LearnerShellCapability` overrides are in
 * effect for this module — operator can spot when a per-module knob
 * overrides the per-shell default. Renders a chip per non-default
 * capability key per `.claude/rules/cascade-reuse.md` discipline.
 *
 * Composes:
 *   - PR #2199 (`lib/voice/resolve-learner-shell.ts::resolveLearnerShell`)
 *   - PR #2202 (`components/sim/{ChatFeed,ExamModeShell,McqRounds,
 *     ResultsReadout,IntakeWizard}Shell.tsx`)
 *
 * Until those land, this file declares LOCAL STUBS marked
 * `TODO(2206-stub)` so the Modules-tab RHS can render today; the stubs
 * delete cleanly when the real modules ship.
 *
 * Sandboxed: the preview tree mounts inside a `.hf-shell-preview-sandbox`
 * container so its styles never bleed into the canvas, and click /
 * keyboard events are scoped to the mock data (no real session writes).
 */

import { useMemo, useState } from "react";
import { Eye, Sparkles } from "lucide-react";

import { type LearnerShellKind } from "@/lib/types/json-fields";
import type { ModuleEditorRow } from "./ModuleEditor";
import "./preview-lens.css";

// ── PreviewLens-local capability shape (NOT the canonical one from
// PR #2173). This stub's `LearnerShellCapabilities` describes the
// mock-data affordances of the RHS preview (mic/text/cueCard) — what
// the operator SEES in the preview pane — not the runtime capability
// frame (allowModuleSwitch / showTimer / etc.) that
// `resolveLearnerShell` returns. When PR #2202 lands the real shell
// components, this local shape collapses; until then it's the
// stub data this lens renders.
//
// `LearnerShellKind` IS canonical and imported from `@/lib/types/json-fields`
// above — adding a kind requires updating the real union per
// `.claude/rules/lattice-survey.md`.

/** Local preview-mode capability shape. The cascade chip lists every
 *  capability key whose value diverges from SHELL_DEFAULTS. */
interface LearnerShellCapabilities {
  micEnabled: boolean;
  textEnabled: boolean;
  cueCardVisible: boolean;
  waveformVisible: boolean;
  scoreboardVisible: boolean;
  /** Capability source-of-truth label — "default" / "module-override" /
   *  "playbook-override". Stub returns "default" everywhere. */
  source?: Record<string, "default" | "module-override" | "playbook-override">;
}

interface ResolvedLearnerShell {
  shellKind: LearnerShellKind;
  capabilities: LearnerShellCapabilities;
}

/** Per-shell defaults. The real SHELL_DEFAULTS lives next to the
 *  resolver in #2199; we mirror the shape so the chip renders correctly
 *  in the stub window. */
const SHELL_DEFAULTS: Record<LearnerShellKind, LearnerShellCapabilities> = {
  "chat-feed": {
    micEnabled: false,
    textEnabled: true,
    cueCardVisible: false,
    waveformVisible: false,
    scoreboardVisible: false,
  },
  exam: {
    micEnabled: true,
    textEnabled: false,
    cueCardVisible: true,
    waveformVisible: true,
    scoreboardVisible: false,
  },
  "mcq-rounds": {
    micEnabled: false,
    textEnabled: true,
    cueCardVisible: false,
    waveformVisible: false,
    scoreboardVisible: true,
  },
  "results-readout": {
    micEnabled: false,
    textEnabled: false,
    cueCardVisible: false,
    waveformVisible: false,
    scoreboardVisible: true,
  },
  "intake-wizard": {
    micEnabled: false,
    textEnabled: true,
    cueCardVisible: false,
    waveformVisible: false,
    scoreboardVisible: false,
  },
};

/** TODO(2206-stub): replace with the real resolver from #2199. */
function resolveLearnerShell(args: {
  module: Pick<ModuleEditorRow, "mode" | "sessionTerminal"> | null;
}): ResolvedLearnerShell {
  const mode = args.module?.mode;
  let shellKind: LearnerShellKind;
  switch (mode) {
    case "examiner":
    case "mock-exam":
      shellKind = "exam";
      break;
    case "quiz":
      shellKind = "mcq-rounds";
      break;
    case "tutor":
    case "mixed":
    default:
      shellKind = "chat-feed";
      break;
  }
  // Stub: no capability overrides. The real resolver walks the cascade
  // and may flip e.g. `micEnabled` for a per-module override.
  return { shellKind, capabilities: SHELL_DEFAULTS[shellKind] };
}

// ── End stub block ─────────────────────────────────────────────────

type LensVariant = "shell-preview" | "none";

interface ModulesPreviewLensProps {
  courseId: string;
  selectedModule: ModuleEditorRow | null;
}

export function ModulesPreviewLens({
  courseId,
  selectedModule,
}: ModulesPreviewLensProps) {
  const [variant, setVariant] = useState<LensVariant>("shell-preview");

  return (
    <aside
      className="hf-modules-preview-lens"
      data-testid="hf-modules-preview-lens"
      aria-label="Module preview"
      data-course-id={courseId}
    >
      <header className="hf-modules-preview-lens-header">
        <div className="hf-modules-preview-lens-title">
          <Eye size={14} aria-hidden />
          <span>Preview</span>
        </div>
        <div
          className="hf-modules-preview-lens-toolbar"
          role="tablist"
          aria-label="Preview variant"
        >
          <button
            type="button"
            role="tab"
            aria-selected={variant === "shell-preview"}
            className={`hf-pill ${variant === "shell-preview" ? "hf-pill-primary" : ""}`}
            onClick={() => setVariant("shell-preview")}
            data-testid="hf-modules-preview-lens-shell-tab"
          >
            <Sparkles size={12} aria-hidden />
            <span>Shell</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={variant === "none"}
            className={`hf-pill ${variant === "none" ? "hf-pill-primary" : ""}`}
            onClick={() => setVariant("none")}
            data-testid="hf-modules-preview-lens-none-tab"
          >
            Off
          </button>
        </div>
      </header>

      {variant === "shell-preview" ? (
        <ShellPreviewBody module={selectedModule} />
      ) : (
        <p
          className="hf-text-muted hf-modules-preview-lens-collapsed"
          data-testid="hf-modules-preview-lens-collapsed"
        >
          Preview is off. Pick a variant above to see what the learner sees.
        </p>
      )}
    </aside>
  );
}

/* ── Shell preview body ──────────────────────────────────────────── */

function ShellPreviewBody({ module }: { module: ModuleEditorRow | null }) {
  const resolved = useMemo<ResolvedLearnerShell | null>(() => {
    if (!module) return null;
    return resolveLearnerShell({ module });
  }, [module]);

  if (!module || !resolved) {
    return (
      <div
        className="hf-modules-preview-lens-empty"
        data-testid="hf-modules-preview-lens-empty"
      >
        <p className="hf-text-muted">
          Pick a module on the left to preview the shell the learner will
          see.
        </p>
      </div>
    );
  }

  return (
    <div
      className="hf-shell-preview-sandbox"
      data-testid="hf-shell-preview-sandbox"
      data-shell-kind={resolved.shellKind}
      data-module-id={module.id}
    >
      <CascadeCapabilityChips
        shellKind={resolved.shellKind}
        capabilities={resolved.capabilities}
      />
      <div className="hf-shell-preview-kind-label">
        <span className="hf-text-muted">Shell:</span>
        <code data-testid="hf-shell-preview-kind">{resolved.shellKind}</code>
      </div>
      <ShellMount
        shellKind={resolved.shellKind}
        capabilities={resolved.capabilities}
        moduleLabel={module.label}
      />
    </div>
  );
}

/* ── Cascade chip ────────────────────────────────────────────────── */

/**
 * Lists each capability whose value diverges from the shell's defaults
 * — the operator-visible signal that "a per-module knob overrides the
 * per-shell default". When nothing diverges, renders the "all defaults"
 * chip per `.claude/rules/cascade-reuse.md` honesty discipline (we
 * surface the resolution result, not silence).
 */
function CascadeCapabilityChips({
  shellKind,
  capabilities,
}: {
  shellKind: LearnerShellKind;
  capabilities: LearnerShellCapabilities;
}) {
  const defaults = SHELL_DEFAULTS[shellKind];
  const overrides = (
    Object.keys(defaults) as (keyof LearnerShellCapabilities)[]
  ).filter((key) => {
    if (key === "source") return false;
    return capabilities[key] !== defaults[key];
  });

  if (overrides.length === 0) {
    return (
      <div
        className="hf-shell-preview-cascade-chips"
        role="status"
        data-testid="hf-shell-preview-cascade-chips"
      >
        <span
          className="hf-shell-preview-chip hf-shell-preview-chip-default"
          data-testid="hf-shell-preview-chip-defaults"
        >
          Using {shellKind} defaults
        </span>
      </div>
    );
  }

  return (
    <div
      className="hf-shell-preview-cascade-chips"
      role="status"
      data-testid="hf-shell-preview-cascade-chips"
    >
      {overrides.map((key) => (
        <span
          key={key}
          className="hf-shell-preview-chip hf-shell-preview-chip-override"
          data-testid={`hf-shell-preview-chip-${key}`}
        >
          <span className="hf-shell-preview-chip-label">override</span>
          <span className="hf-shell-preview-chip-value">
            {String(key)}: {String(capabilities[key])}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ── Shell mounts (stubbed today, swap to #2202 components later) ── */

function ShellMount({
  shellKind,
  capabilities,
  moduleLabel,
}: {
  shellKind: LearnerShellKind;
  capabilities: LearnerShellCapabilities;
  moduleLabel: string;
}) {
  // TODO(2206-stub): replace each branch with the real component from
  // `@/components/sim/<Shell>Shell` once PR #2202 ships. Pass `capabilities`
  // as props so per-capability behaviour reaches the shell unchanged.
  switch (shellKind) {
    case "chat-feed":
      return <ChatFeedStub moduleLabel={moduleLabel} />;
    case "exam":
      return (
        <ExamStub capabilities={capabilities} moduleLabel={moduleLabel} />
      );
    case "mcq-rounds":
      return <McqRoundsStub />;
    case "results-readout":
      return <ResultsReadoutStub />;
    case "intake-wizard":
      return <IntakeWizardStub moduleLabel={moduleLabel} />;
  }
}

function ChatFeedStub({ moduleLabel }: { moduleLabel: string }) {
  return (
    <div
      className="hf-shell-preview-stub hf-shell-preview-stub-chat"
      data-testid="hf-shell-preview-stub-chat-feed"
    >
      <p className="hf-shell-preview-stub-tutor-turn">
        Great, let&apos;s start on <em>{moduleLabel}</em>. Could you walk me
        through your first take on this?
      </p>
      <p className="hf-shell-preview-stub-learner-turn">
        Sure — I&apos;d start by mapping the question to a framework I know.
      </p>
      <p className="hf-shell-preview-stub-learner-turn">
        Then I&apos;d pick the two strongest points and build from there.
      </p>
    </div>
  );
}

function ExamStub({
  capabilities,
  moduleLabel,
}: {
  capabilities: LearnerShellCapabilities;
  moduleLabel: string;
}) {
  return (
    <div
      className="hf-shell-preview-stub hf-shell-preview-stub-exam"
      data-testid="hf-shell-preview-stub-exam"
    >
      {capabilities.cueCardVisible ? (
        <div
          className="hf-shell-preview-stub-cue-card"
          data-testid="hf-shell-preview-stub-cue-card"
        >
          <strong>Topic — {moduleLabel}</strong>
          <ul>
            <li>What and when</li>
            <li>Who was involved</li>
            <li>Why it mattered</li>
          </ul>
        </div>
      ) : null}
      {capabilities.waveformVisible ? (
        <div
          className="hf-shell-preview-stub-waveform"
          data-testid="hf-shell-preview-stub-waveform"
          aria-label="Dual waveform stub"
        >
          <span aria-hidden>~~~~~</span>
          <span aria-hidden>~~~~~~~~</span>
        </div>
      ) : null}
    </div>
  );
}

function McqRoundsStub() {
  return (
    <div
      className="hf-shell-preview-stub hf-shell-preview-stub-mcq"
      data-testid="hf-shell-preview-stub-mcq"
    >
      <ol>
        <li>
          <strong>1.</strong> Which framework best fits this scenario?
          <ul>
            <li>A. Option A</li>
            <li>B. Option B</li>
            <li>C. Option C</li>
          </ul>
        </li>
        <li>
          <strong>2.</strong> What is the key risk?
          <ul>
            <li>A. Option A</li>
            <li>B. Option B</li>
            <li>C. Option C</li>
          </ul>
        </li>
      </ol>
    </div>
  );
}

function ResultsReadoutStub() {
  return (
    <div
      className="hf-shell-preview-stub hf-shell-preview-stub-results"
      data-testid="hf-shell-preview-stub-results"
    >
      <h4>Your result</h4>
      <p>
        Overall band <strong>6.5</strong>
      </p>
      <ul>
        <li>Fluency 6.0</li>
        <li>Coherence 7.0</li>
        <li>Range 6.5</li>
      </ul>
    </div>
  );
}

function IntakeWizardStub({ moduleLabel }: { moduleLabel: string }) {
  return (
    <div
      className="hf-shell-preview-stub hf-shell-preview-stub-intake"
      data-testid="hf-shell-preview-stub-intake"
    >
      <h4>Welcome</h4>
      <p>
        We&apos;ll start with a quick warm-up before <em>{moduleLabel}</em>.
        Ready when you are.
      </p>
    </div>
  );
}
