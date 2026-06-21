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
 * **MCQ data feed is stubbed** — `mcqs` is accepted as a prop today.
 * The full per-question feedback flow + answer submission lifecycle
 * lands in #2180 (sampling engine + question-presentation lifecycle).
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

interface MCQRoundsShellProps {
  /** Capability frame. Defaults to `SHELL_DEFAULTS["mcq-rounds"]` so
   *  the shell renders the canonical quiz frame out of the box. */
  capabilities?: LearnerShellCapabilities;
  /** Sampled MCQs to present this round. Stubbed today — once #2180
   *  ships the sampling engine, the host page resolves this from the
   *  AssessmentMoment + samplingPolicy. */
  mcqs?: MCQShellQuestion[];
  /** Current 1-based round index (e.g. 3 of 8). Stubbed today. */
  roundIndex?: number;
  /** Total rounds. Stubbed today. */
  roundTotal?: number;
  /** Whether the close screen scaffold should render
   *  (`endedAt !== null` from the host). */
  ended?: boolean;
  /** Per-Q feedback area — text or node rendered after the learner
   *  submits an answer. Stubbed today. */
  feedback?: React.ReactNode;
  /** Child controls (e.g. answer-submit, dismiss, etc.). */
  children?: React.ReactNode;
}

export function MCQRoundsShell({
  capabilities = SHELL_DEFAULTS["mcq-rounds"],
  mcqs = [],
  roundIndex,
  roundTotal,
  ended = false,
  feedback,
  children,
}: MCQRoundsShellProps) {
  const currentMcq = mcqs[(roundIndex ?? 1) - 1] ?? null;
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
            <ul className="hf-mcq-options" data-testid="hf-mcq-options">
              {currentMcq.options.map((opt) => (
                <li key={opt.label} data-mcq-option-label={opt.label}>
                  <span className="hf-mcq-option-label">{opt.label}</span>
                  <span className="hf-mcq-option-text">{opt.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
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
