"use client";

/**
 * MCQRoundsShell — quiz-mode shell consuming capabilities.
 *
 * S3 of epic #2163 (#2198). Closes the `quiz.learnerUI` Coverage gap
 * (#2159) at the SHELL level even while the actual MCQ data feed
 * remains stubbed pending the sampling engine (#2180 — epic #2176 S2).
 *
 * Per `mode-ui-coverage.test.ts` baseline, `quiz` was `gap` at the
 * learnerUI axis: PR #2081 wired the compose-side directive
 * (`resolveModuleQuizDirective`) and PR #2090 wired admin badges
 * (ModePill icon), but no learner-facing surface ever consumed
 * `module.mode === "quiz"`. This shell ships the surface — once the
 * sampling engine lands, the host page can mount this shell instead
 * of the default ChatFeedShell when the module is quiz-mode.
 *
 * Affordances driven by `capabilities` (HF-canonical defaults from
 * `SHELL_DEFAULTS["mcq-rounds"]`):
 *  - `chatFeedVisibility: "cue-card-only"` — no scrollback; the
 *    question IS the screen
 *  - `showProgressBar: "mcq-counter"` — "Round N of M" instead of a
 *    fill-bar
 *  - `colourTheme: "default"` — light theme (vs. exam's dark)
 *  - `modePillKey: "quiz"` — pill label resolved by the renderer
 *  - `allowModuleSwitch: false` / `allowBackToHome: false` — in-flight
 *    quiz must finish
 *
 * **W4 (epic #2163 closeout) — MCQ data feed live.** The shell now
 * renders selectable options + an empty-state when no MCQs resolve.
 * Data flows from the canonical sampling engine
 * (`lib/assessment/sample-questions.ts`) via the
 * `useAssessmentMomentMCQs` hook in the host (`SimChat`). Per
 * `feedback_no_hardcoded_score_backfill.md` we NEVER synthesise MCQs
 * — empty pool / missing plan renders the typed empty-state with the
 * `emptyReason` prop driving copy.
 *
 * Closes #2159 quiz.learnerUI at the shell level. Coverage assertion
 * at `tests/components/sim/learner-shells.test.tsx`.
 */

import { SHELL_DEFAULTS, type LearnerShellCapabilities } from "@/lib/types/json-fields";
import "./learner-shells.css";

/**
 * Minimal MCQ shape consumed by this shell — accepts the subset of
 * `prisma.contentQuestion` columns the shell renders today. Full type
 * (questionType / metadata / etc.) lives in `lib/types/json-fields.ts`
 * once #2180 wires the sampling engine; today we deliberately accept
 * only what the shell DOM consumes.
 *
 * TODO(2180): replace with the canonical `ContentQuestionShape` from
 * `@/lib/assessment/sample-questions` once that file lands.
 */
export interface MCQShellQuestion {
  id: string;
  questionText: string;
  options?: Array<{ label: string; text: string }> | null;
}

/** Typed reason an MCQRoundsShell renders the empty-state instead of
 *  a cue card. Mirrors `AssessmentMomentNullReason` from the route. */
export type MCQRoundsEmptyReason =
  | "no-moment"
  | "empty-pool"
  | "missing-content"
  | "policy-unsatisfied"
  | "loading"
  | "error";

interface MCQRoundsShellProps {
  /** Capability frame. Defaults to `SHELL_DEFAULTS["mcq-rounds"]` so
   *  the shell renders the canonical quiz frame out of the box. */
  capabilities?: LearnerShellCapabilities;
  /** Sampled MCQs to present this round. Empty array → empty-state. */
  mcqs?: ReadonlyArray<MCQShellQuestion>;
  /** Current 1-based round index (e.g. 3 of 8). */
  roundIndex?: number;
  /** Total rounds. */
  roundTotal?: number;
  /** Whether the close screen scaffold should render
   *  (`endedAt !== null` from the host). */
  ended?: boolean;
  /** Per-Q feedback area — text or node rendered after the learner
   *  submits an answer. Stubbed today. */
  feedback?: React.ReactNode;
  /** The option label the learner has selected (e.g. "A"). When set,
   *  the matching `<li>` carries `data-selected="true"` and an
   *  `aria-pressed="true"` attribute. */
  selectedOption?: string | null;
  /** Invoked when the learner picks an option. Receives `(mcqId,
   *  optionLabel)`. The host (SimChat) advances the round and writes
   *  the result via the canonical writer (or stub). */
  onAnswer?: (mcqId: string, optionLabel: string) => void;
  /** When `mcqs.length === 0` the shell renders the empty-state. This
   *  prop drives the empty-state copy. `"loading"` / `"error"` are
   *  transient host states; the other values mirror the typed reasons
   *  from the canonical engine (see `lib/assessment/sample-questions.ts`). */
  emptyReason?: MCQRoundsEmptyReason | null;
  /** Child controls (e.g. answer-submit, dismiss, etc.). */
  children?: React.ReactNode;
}

const EMPTY_REASON_COPY: Record<MCQRoundsEmptyReason, { title: string; detail: string }> = {
  loading: {
    title: "Loading questions…",
    detail: "Pulling your next round from the question pool.",
  },
  "no-moment": {
    title: "No quiz available for this module",
    detail:
      "This course doesn't declare a quiz round for the current module. Ask your educator to add an assessment plan.",
  },
  "empty-pool": {
    title: "No questions available yet",
    detail:
      "The question pool for this module is empty. Your educator will add content soon.",
  },
  "missing-content": {
    title: "Question pool not configured",
    detail:
      "This quiz needs a different kind of content. Ask your educator to review the assessment plan.",
  },
  "policy-unsatisfied": {
    title: "Not enough questions for this round",
    detail:
      "The current pool can't satisfy this round's sampling rules. Your educator will adjust the content.",
  },
  error: {
    title: "Couldn't load questions",
    detail: "There was a problem reaching the question pool. Please try again shortly.",
  },
};

export function MCQRoundsShell({
  capabilities = SHELL_DEFAULTS["mcq-rounds"],
  mcqs = [],
  roundIndex,
  roundTotal,
  ended = false,
  feedback,
  selectedOption,
  onAnswer,
  emptyReason,
  children,
}: MCQRoundsShellProps) {
  const currentMcq = mcqs[(roundIndex ?? 1) - 1] ?? null;
  const showEmptyState =
    capabilities.chatFeedVisibility === "cue-card-only" &&
    !currentMcq &&
    !ended;
  const resolvedEmptyReason: MCQRoundsEmptyReason =
    emptyReason ?? (mcqs.length === 0 ? "no-moment" : "no-moment");
  const emptyCopy = EMPTY_REASON_COPY[resolvedEmptyReason];
  return (
    <section
      className="hf-mcq-rounds-shell"
      data-testid="hf-mcq-rounds-shell"
      data-shell-kind="mcq-rounds"
      data-colour-theme={capabilities.colourTheme}
      data-mode-pill={capabilities.modePillKey ?? ""}
      data-chat-feed-visibility={capabilities.chatFeedVisibility}
      data-show-timer={capabilities.showTimer}
      data-show-progress-bar={capabilities.showProgressBar}
      data-allow-module-switch={String(capabilities.allowModuleSwitch)}
      data-allow-back-to-home={String(capabilities.allowBackToHome)}
      data-dismiss-on-end={capabilities.dismissOnEnd}
      data-stall-chip-behaviour={capabilities.stallChipBehaviour}
      aria-label="Quiz rounds"
      role="region"
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
      {capabilities.showProgressBar === "mcq-counter" && roundIndex && roundTotal ? (
        <div
          className="hf-mcq-counter"
          data-testid="hf-mcq-counter"
          aria-label={`Round ${roundIndex} of ${roundTotal}`}
        >
          {`Round ${roundIndex} of ${roundTotal}`}
        </div>
      ) : null}
      {capabilities.chatFeedVisibility === "cue-card-only" && currentMcq ? (
        <div
          className="hf-mcq-cue-card"
          data-testid="hf-mcq-cue-card"
          data-mcq-id={currentMcq.id}
        >
          <div className="hf-mcq-question">{currentMcq.questionText}</div>
          {currentMcq.options ? (
            <ul
              className="hf-mcq-options"
              data-testid="hf-mcq-options"
              role="radiogroup"
              aria-label="Choose an answer"
            >
              {currentMcq.options.map((opt) => {
                const isSelected = selectedOption === opt.label;
                return (
                  <li
                    key={opt.label}
                    data-mcq-option-label={opt.label}
                    data-selected={isSelected ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="hf-btn hf-mcq-option-btn"
                      data-testid={`hf-mcq-option-${opt.label}`}
                      role="radio"
                      aria-checked={isSelected}
                      disabled={!onAnswer || selectedOption != null}
                      onClick={() => onAnswer?.(currentMcq.id, opt.label)}
                    >
                      <span className="hf-mcq-option-label">{opt.label}</span>
                      <span className="hf-mcq-option-text">{opt.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {showEmptyState ? (
        <div
          className="hf-mcq-empty hf-empty"
          data-testid="hf-mcq-empty"
          data-empty-reason={resolvedEmptyReason}
          role="status"
          aria-live="polite"
        >
          <div className="hf-mcq-empty-title">{emptyCopy.title}</div>
          <div className="hf-mcq-empty-detail">{emptyCopy.detail}</div>
        </div>
      ) : null}
      {feedback ? (
        <div className="hf-mcq-feedback" data-testid="hf-mcq-feedback">
          {feedback}
        </div>
      ) : null}
      {ended ? (
        <div
          className="hf-mcq-close-screen"
          data-testid="hf-mcq-close-screen"
          data-dismiss-on-end={capabilities.dismissOnEnd}
        >
          Quiz complete
        </div>
      ) : null}
      {children ? <div className="hf-mcq-controls">{children}</div> : null}
    </section>
  );
}
