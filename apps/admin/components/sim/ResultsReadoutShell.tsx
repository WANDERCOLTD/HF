"use client";

/**
 * ResultsReadoutShell — post-exam Mock Results screen.
 *
 * W6 of memory/handoff_lattice_all_settings_to_ui_2026_06_21.md (story
 * #2185 U11, drops `tests/components/shell-coverage.test.ts::EXPECTED_GAP_COUNT`
 * from 2 → 1).
 *
 * **Sanctioned learner-facing surface** for per-criterion bands. Per
 * `.claude/rules/learner-ui-leak-coverage.md` exemptions + BDD US-Mock-05
 * (HF-IELTS-Pre-Voice-Testing-Checklist Unit 5), this is the ONE learner
 * surface where IELTS criterion labels (Fluency & Coherence / Lexical
 * Resource / Grammatical Range / Pronunciation) are allowed to render.
 * The labels arrive via the data payload — never as string literals in
 * this source file — so the build-time leak-coverage walk (which scans
 * literals in learner-UI dirs) stays clean.
 *
 * **Capability-driven** per `.claude/rules/shell-coverage.md` + epic
 * #2163 S3 decision: the shell reads affordances from
 * `capabilities` (default = `SHELL_DEFAULTS["results-readout"]`):
 *
 *   - `colourTheme: "brand"` — accent-tinted celebration palette
 *   - `chatFeedVisibility: "none"` — full-screen replacement, no chat
 *   - `showTimer: "none"` — no clock
 *   - `showProgressBar: "none"` — the score IS the progress
 *   - `modePillKey: null` — no mode pill (results live above the mode)
 *   - `dismissOnEnd: "next-module"` — auto-advance call site
 *   - `stallChipBehaviour: "none"` — no learner input expected
 *   - `allowModuleSwitch: false` / `allowBackToHome: false` — structured
 *     exit via the parent dismiss handler
 *
 * The shell is render-thin and intentionally avoids hard-branching on
 * the shell-kind literal inside JSX (per epic #2163 — affordances
 * declarative; procedural branches defeat the Coverage walk).
 *
 * **Data shape** mirrors the FOH `SessionScore` contract at
 * `apps/foh/lib/types.ts`. The shell accepts a `result` prop of shape
 * `{ overall, tierLabel?, narrative?, criteria: Array<{label, score, key?}> }`
 * — the host fetches from `/api/callers/[callerId]/mock-results?sessionId=…`
 * and passes the result down. Labels arrive in `result.criteria[].label`
 * (resolved server-side from canonical `Parameter` rows), so no IELTS
 * criterion string appears in this file as a literal.
 *
 * **Loading / error / empty states** are honest — no fake scores ever.
 * If the session has no `CallScore` rows yet, the empty state renders
 * with a message instead of fabricated bands (per the operator-pinned
 * "never fill empty scores with hardcoded defaults" rule).
 */

import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";
import "./learner-shells.css";

/**
 * Per-criterion row for the Results screen. Mirrors the FOH
 * `CriterionScore` shape (`apps/foh/lib/types.ts`).
 */
export interface ResultsReadoutCriterion {
  /** Stable key for React iteration (e.g. parameterId / FOH CriterionKey). */
  key: string;
  /** Display label resolved server-side from Parameter row — never a
   *  literal in this source file. */
  label: string;
  /** Numeric band (typically 0–9 for IELTS). */
  score: number;
}

/**
 * Result payload consumed by the shell. The host (typically SimChat
 * dispatcher) fetches this from `/api/callers/[callerId]/mock-results`
 * and passes it down. Shape mirrors the FOH `SessionScore` contract.
 */
export interface ResultsReadoutPayload {
  /** Overall band (typically a number like 6.5; rendered to 1dp). */
  overall: number;
  /** Optional human-readable tier label (e.g. "Modest user"). Resolved
   *  server-side; never a literal here. */
  tierLabel?: string;
  /** Optional narrative — strengths / one-area-to-work-on per BDD
   *  US-Mock-05. Resolved server-side; rendered as plain text. */
  narrative?: string;
  /** Per-criterion bands. Array order is the display order. */
  criteria: ResultsReadoutCriterion[];
}

interface ResultsReadoutShellProps {
  /** Capability frame. Defaults to `SHELL_DEFAULTS["results-readout"]`. */
  capabilities?: LearnerShellCapabilities;
  /** Server-resolved result payload. `null` while loading; pass `error`
   *  separately when the fetch failed. */
  result?: ResultsReadoutPayload | null;
  /** Honest loading state — render a placeholder while the host's
   *  fetch is in-flight. Never substitute fake bands. */
  loading?: boolean;
  /** Honest error state — render the message instead of a result. */
  error?: string | null;
  /** Optional dismiss handler (rendered as a child control). When
   *  omitted, no dismiss affordance renders. */
  onDismiss?: () => void;
  /** Optional next-module handler (rendered as a child control). */
  onNext?: () => void;
  /**
   * UX-C / Finding 8 — optional "Review transcript" handler. When
   * supplied, renders a secondary text-style button alongside the
   * dismiss / next CTAs so the learner can return to the chat-feed
   * history without dismissing the score. The SimChat host wires this
   * to a scroll-to-history or shell-switch behaviour; the shell only
   * surfaces the affordance.
   */
  onReviewTranscript?: () => void;
  /** Child controls slot for fully custom CTAs (overrides default
   *  buttons when supplied). */
  children?: React.ReactNode;
}

function formatBand(score: number): string {
  if (!Number.isFinite(score)) return "—";
  // IELTS bands are reported to 1dp (e.g. 6.5). Other scoring schemes
  // may use integers; we trim trailing zeros so "6.0" doesn't render
  // when "6" is more honest.
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function ResultsReadoutShell({
  capabilities = SHELL_DEFAULTS["results-readout"],
  result = null,
  loading = false,
  error = null,
  onDismiss,
  onNext,
  onReviewTranscript,
  children,
}: ResultsReadoutShellProps) {
  const hasResult = result !== null && result.criteria.length > 0;
  return (
    <section
      className="hf-results-readout-shell"
      role="region"
      aria-label="Results"
      data-testid="hf-results-readout-shell"
      data-shell-kind="results-readout"
      data-colour-theme={capabilities.colourTheme}
      data-mode-pill={capabilities.modePillKey ?? ""}
      data-chat-feed-visibility={capabilities.chatFeedVisibility}
      data-show-timer={capabilities.showTimer}
      data-show-progress-bar={capabilities.showProgressBar}
      data-allow-module-switch={String(capabilities.allowModuleSwitch)}
      data-allow-back-to-home={String(capabilities.allowBackToHome)}
      data-dismiss-on-end={capabilities.dismissOnEnd}
      data-stall-chip-behaviour={capabilities.stallChipBehaviour}
    >
      {capabilities.modePillKey ? (
        <div
          className="hf-shell-mode-pill"
          data-testid="hf-shell-mode-pill"
          data-mode-pill-key={capabilities.modePillKey}
        >
          {capabilities.modePillKey}
        </div>
      ) : null}

      {loading ? (
        <div
          className="hf-results-readout-loading"
          data-testid="hf-results-readout-loading"
          role="status"
          aria-live="polite"
        >
          Loading your results…
        </div>
      ) : null}

      {!loading && error ? (
        <div
          className="hf-results-readout-error"
          data-testid="hf-results-readout-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {!loading && !error && !hasResult ? (
        <div
          className="hf-results-readout-empty"
          data-testid="hf-results-readout-empty"
          role="status"
        >
          Results are still being scored. Check back in a moment.
        </div>
      ) : null}

      {!loading && !error && hasResult && result ? (
        <>
          <div
            className="hf-results-readout-overall"
            data-testid="hf-results-readout-overall"
          >
            <span
              className="hf-results-readout-overall-label"
              data-testid="hf-results-readout-overall-label"
            >
              Overall
            </span>
            <span
              className="hf-results-readout-overall-score"
              data-testid="hf-results-readout-overall-score"
              data-score={String(result.overall)}
            >
              {formatBand(result.overall)}
            </span>
            {result.tierLabel ? (
              <span
                className="hf-results-readout-tier"
                data-testid="hf-results-readout-tier"
              >
                {result.tierLabel}
              </span>
            ) : null}
          </div>

          <ul
            className="hf-results-readout-criteria"
            data-testid="hf-results-readout-criteria"
          >
            {result.criteria.map((c) => (
              <li key={c.key} data-criterion-key={c.key}>
                <span
                  className="hf-results-readout-criterion-label"
                  data-testid={`hf-results-readout-criterion-label-${c.key}`}
                >
                  {c.label}
                </span>
                <span
                  className="hf-results-readout-criterion-score"
                  data-testid={`hf-results-readout-criterion-score-${c.key}`}
                  data-score={String(c.score)}
                >
                  {formatBand(c.score)}
                </span>
              </li>
            ))}
          </ul>

          {result.narrative ? (
            <p
              className="hf-results-readout-narrative"
              data-testid="hf-results-readout-narrative"
            >
              {result.narrative}
            </p>
          ) : null}
        </>
      ) : null}

      {children ? (
        <div className="hf-results-readout-controls">{children}</div>
      ) : onDismiss || onNext || onReviewTranscript ? (
        <div className="hf-results-readout-controls">
          {onReviewTranscript ? (
            <button
              type="button"
              className="hf-button-tertiary"
              data-testid="hf-results-readout-review-transcript"
              onClick={onReviewTranscript}
            >
              Review transcript
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="hf-button-secondary"
              data-testid="hf-results-readout-dismiss"
              onClick={onDismiss}
            >
              Done
            </button>
          ) : null}
          {onNext ? (
            <button
              type="button"
              className="hf-button-primary"
              data-testid="hf-results-readout-next"
              onClick={onNext}
            >
              Continue
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
