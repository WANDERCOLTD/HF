/**
 * Tests for capability-driven LearnerShell components (S3 of #2163, PR #2198).
 *
 * Each shell × every capability flag combo → expected DOM.
 *
 * Covers:
 *  - ExamModeShell (refactored to consume capabilities) — IELTS Mock
 *    byte-identical regression under SHELL_DEFAULTS.exam.
 *  - shouldMountExamModeShell — closes #2161 (mock-exam mode mounts).
 *  - ChatFeedShell — new typed wrapper around SimChat (default-feed).
 *  - MCQRoundsShell — new quiz-mode shell (closes #2159 at shell level).
 *
 * Pattern: assert capability flags map to expected DOM attributes /
 * presence-or-absence of testid nodes. We use `data-*` attributes so the
 * shell's frame is observable from the runtime SUPERVISE scan and from
 * these tests without coupling to internal styling decisions.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  ExamModeShell,
  shouldMountExamModeShell,
} from "@/components/sim/ExamModeShell";
import { ChatFeedShell } from "@/components/sim/ChatFeedShell";
import { MCQRoundsShell } from "@/components/sim/MCQRoundsShell";
import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────
// shouldMountExamModeShell — mount-gate matrix
// ────────────────────────────────────────────────────────────

describe("shouldMountExamModeShell — capability-driven matrix (closes #2161)", () => {
  it("returns true for examiner mode + terminal session", () => {
    expect(shouldMountExamModeShell({ mode: "examiner" }, true)).toBe(true);
  });

  it("returns true for mock-exam mode + terminal session (#2161)", () => {
    expect(shouldMountExamModeShell({ mode: "mock-exam" }, true)).toBe(true);
  });

  it("returns false for examiner mode + non-terminal session", () => {
    expect(shouldMountExamModeShell({ mode: "examiner" }, false)).toBe(false);
  });

  it("returns false for mock-exam mode + non-terminal session", () => {
    expect(shouldMountExamModeShell({ mode: "mock-exam" }, false)).toBe(false);
  });

  it("returns false for tutor / mixed / quiz modes regardless of terminal", () => {
    expect(shouldMountExamModeShell({ mode: "tutor" }, true)).toBe(false);
    expect(shouldMountExamModeShell({ mode: "mixed" }, true)).toBe(false);
    expect(shouldMountExamModeShell({ mode: "quiz" }, true)).toBe(false);
  });

  it("returns false for null / undefined module", () => {
    expect(shouldMountExamModeShell(null, true)).toBe(false);
    expect(shouldMountExamModeShell(undefined, true)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// ExamModeShell — capability-driven render
// ────────────────────────────────────────────────────────────

describe("ExamModeShell — capability-driven render", () => {
  it("IELTS Mock byte-identical regression: SHELL_DEFAULTS.exam preserves dual-waveform + dark theme + mock-exam pill", () => {
    const { container } = render(
      <ExamModeShell
        examinerLevel={0.5}
        learnerLevel={0.3}
        banner="Mock exam — speak naturally"
      />,
    );

    const region = container.querySelector(".hf-exam-shell");
    expect(region).not.toBeNull();
    // colour theme reflects SHELL_DEFAULTS.exam.colourTheme === "dark"
    expect(region?.getAttribute("data-colour-theme")).toBe("dark");
    // mode pill key reflects SHELL_DEFAULTS.exam.modePillKey
    expect(region?.getAttribute("data-mode-pill")).toBe("mock-exam");
    // dismissOnEnd === "results-screen"
    expect(region?.getAttribute("data-dismiss-on-end")).toBe("results-screen");
    // Banner present
    expect(screen.getByTestId("hf-exam-shell-banner")).toHaveTextContent(
      "Mock exam — speak naturally",
    );
    // dual-waveform mounted because chatFeedVisibility === "none"
    expect(
      screen.getByRole("group", { name: /dual waveform/i }),
    ).toBeInTheDocument();
    // Mode pill rendered because modePillKey is non-null
    expect(screen.getByTestId("hf-shell-mode-pill")).toHaveAttribute(
      "data-mode-pill-key",
      "mock-exam",
    );
    // Timer NOT rendered because showTimer === "hidden-internal"
    expect(screen.queryByTestId("hf-shell-timer")).toBeNull();
  });

  it("when chatFeedVisibility !== 'none', dual-waveform is NOT mounted", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS.exam,
      chatFeedVisibility: "full",
    };
    render(
      <ExamModeShell examinerLevel={0} learnerLevel={0} capabilities={caps} />,
    );
    expect(
      screen.queryByRole("group", { name: /dual waveform/i }),
    ).toBeNull();
  });

  it("when showTimer === 'visible', timer node renders", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS.exam,
      showTimer: "visible",
    };
    render(
      <ExamModeShell examinerLevel={0} learnerLevel={0} capabilities={caps} />,
    );
    expect(screen.getByTestId("hf-shell-timer")).toBeInTheDocument();
  });

  it("when modePillKey is null, mode pill is NOT rendered", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS.exam,
      modePillKey: null,
    };
    render(
      <ExamModeShell examinerLevel={0} learnerLevel={0} capabilities={caps} />,
    );
    expect(screen.queryByTestId("hf-shell-mode-pill")).toBeNull();
  });

  it("colour theme override flows through to data-colour-theme attribute", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS.exam,
      colourTheme: "brand",
    };
    const { container } = render(
      <ExamModeShell examinerLevel={0} learnerLevel={0} capabilities={caps} />,
    );
    expect(
      container.querySelector(".hf-exam-shell")?.getAttribute("data-colour-theme"),
    ).toBe("brand");
  });

  it("dismissOnEnd override flows through to data-dismiss-on-end attribute", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS.exam,
      dismissOnEnd: "home",
    };
    const { container } = render(
      <ExamModeShell examinerLevel={0} learnerLevel={0} capabilities={caps} />,
    );
    expect(
      container.querySelector(".hf-exam-shell")?.getAttribute("data-dismiss-on-end"),
    ).toBe("home");
  });

  it("renders child controls beneath the waveform area", () => {
    render(
      <ExamModeShell examinerLevel={0} learnerLevel={0}>
        <button type="button">End exam</button>
      </ExamModeShell>,
    );
    expect(
      screen.getByRole("button", { name: /end exam/i }),
    ).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// ChatFeedShell — typed wrapper for default chat-feed
// ────────────────────────────────────────────────────────────

describe("ChatFeedShell — typed instance of SHELL_DEFAULTS['chat-feed']", () => {
  it("default capabilities stamp data attributes matching SHELL_DEFAULTS['chat-feed']", () => {
    render(
      <ChatFeedShell>
        <div data-testid="sim-chat-stub">SimChat goes here</div>
      </ChatFeedShell>,
    );
    const shell = screen.getByTestId("hf-chat-feed-shell");
    const expected = SHELL_DEFAULTS["chat-feed"];
    expect(shell.getAttribute("data-shell-kind")).toBe("chat-feed");
    expect(shell.getAttribute("data-colour-theme")).toBe(expected.colourTheme);
    expect(shell.getAttribute("data-mode-pill")).toBe(expected.modePillKey ?? "");
    expect(shell.getAttribute("data-chat-feed-visibility")).toBe(
      expected.chatFeedVisibility,
    );
    expect(shell.getAttribute("data-show-timer")).toBe(expected.showTimer);
    expect(shell.getAttribute("data-show-progress-bar")).toBe(
      expected.showProgressBar,
    );
    expect(shell.getAttribute("data-allow-module-switch")).toBe(
      String(expected.allowModuleSwitch),
    );
    expect(shell.getAttribute("data-allow-back-to-home")).toBe(
      String(expected.allowBackToHome),
    );
    expect(shell.getAttribute("data-dismiss-on-end")).toBe(expected.dismissOnEnd);
    expect(shell.getAttribute("data-stall-chip-behaviour")).toBe(
      expected.stallChipBehaviour,
    );
    // child mounts as-is
    expect(screen.getByTestId("sim-chat-stub")).toBeInTheDocument();
  });

  it("override capabilities flow through to the data attributes", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["chat-feed"],
      allowModuleSwitch: false,
      colourTheme: "neutral",
    };
    render(
      <ChatFeedShell capabilities={caps}>
        <div />
      </ChatFeedShell>,
    );
    const shell = screen.getByTestId("hf-chat-feed-shell");
    expect(shell.getAttribute("data-colour-theme")).toBe("neutral");
    expect(shell.getAttribute("data-allow-module-switch")).toBe("false");
  });
});

// ────────────────────────────────────────────────────────────
// MCQRoundsShell — quiz-mode shell (closes #2159 at shell level)
// ────────────────────────────────────────────────────────────

describe("MCQRoundsShell — capability-driven quiz shell (closes #2159 at shell level)", () => {
  it("default capabilities stamp SHELL_DEFAULTS['mcq-rounds'] attributes", () => {
    render(<MCQRoundsShell />);
    const shell = screen.getByTestId("hf-mcq-rounds-shell");
    const expected = SHELL_DEFAULTS["mcq-rounds"];
    expect(shell.getAttribute("data-shell-kind")).toBe("mcq-rounds");
    expect(shell.getAttribute("data-colour-theme")).toBe(expected.colourTheme);
    expect(shell.getAttribute("data-mode-pill")).toBe(expected.modePillKey ?? "");
    expect(shell.getAttribute("data-chat-feed-visibility")).toBe(
      expected.chatFeedVisibility,
    );
    expect(shell.getAttribute("data-show-progress-bar")).toBe(
      expected.showProgressBar,
    );
    expect(shell.getAttribute("data-allow-module-switch")).toBe("false");
  });

  it("renders the mode pill when modePillKey is non-null", () => {
    render(<MCQRoundsShell />);
    const pill = screen.getByTestId("hf-shell-mode-pill");
    expect(pill.getAttribute("data-mode-pill-key")).toBe("quiz");
  });

  it("renders the MCQ counter when showProgressBar === 'mcq-counter' and round* props supplied", () => {
    render(<MCQRoundsShell roundIndex={3} roundTotal={8} />);
    expect(screen.getByTestId("hf-mcq-counter")).toHaveTextContent(
      "Round 3 of 8",
    );
  });

  it("does not render the MCQ counter when round* props omitted", () => {
    render(<MCQRoundsShell />);
    expect(screen.queryByTestId("hf-mcq-counter")).toBeNull();
  });

  it("renders the cue card when chatFeedVisibility === 'cue-card-only' and an MCQ is supplied", () => {
    const mcq = {
      id: "mcq-1",
      questionText: "Which option is the best summary?",
      options: [
        { label: "A", text: "Option A" },
        { label: "B", text: "Option B" },
      ],
    };
    render(<MCQRoundsShell mcqs={[mcq]} roundIndex={1} roundTotal={1} />);
    const card = screen.getByTestId("hf-mcq-cue-card");
    expect(card.getAttribute("data-mcq-id")).toBe("mcq-1");
    expect(card).toHaveTextContent("Which option is the best summary?");
    const options = screen.getByTestId("hf-mcq-options");
    expect(options).toHaveTextContent("Option A");
    expect(options).toHaveTextContent("Option B");
  });

  it("does not render the cue card when chatFeedVisibility !== 'cue-card-only'", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["mcq-rounds"],
      chatFeedVisibility: "none",
    };
    const mcq = { id: "x", questionText: "ignored", options: null };
    render(
      <MCQRoundsShell mcqs={[mcq]} capabilities={caps} roundIndex={1} roundTotal={1} />,
    );
    expect(screen.queryByTestId("hf-mcq-cue-card")).toBeNull();
  });

  it("renders the per-Q feedback area when feedback prop supplied", () => {
    render(
      <MCQRoundsShell feedback={<div>Correct — well done!</div>} />,
    );
    expect(screen.getByTestId("hf-mcq-feedback")).toHaveTextContent(
      "Correct — well done!",
    );
  });

  it("renders the close screen scaffold when ended === true", () => {
    render(<MCQRoundsShell ended />);
    const close = screen.getByTestId("hf-mcq-close-screen");
    expect(close).toHaveTextContent("Quiz complete");
    expect(close.getAttribute("data-dismiss-on-end")).toBe("home");
  });

  it("override capabilities reach the data attributes", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["mcq-rounds"],
      colourTheme: "brand",
      dismissOnEnd: "next-module",
      modePillKey: null,
    };
    render(<MCQRoundsShell capabilities={caps} />);
    const shell = screen.getByTestId("hf-mcq-rounds-shell");
    expect(shell.getAttribute("data-colour-theme")).toBe("brand");
    expect(shell.getAttribute("data-dismiss-on-end")).toBe("next-module");
    expect(shell.getAttribute("data-mode-pill")).toBe("");
    expect(screen.queryByTestId("hf-shell-mode-pill")).toBeNull();
  });

  // ──────────────────────────────────────────────────────────
  // W4 — answer-flow + empty-state (PR for handoff W4)
  // ──────────────────────────────────────────────────────────

  it("W4 — renders the empty-state when no MCQs and not ended (cue-card-only)", () => {
    render(<MCQRoundsShell emptyReason="no-moment" />);
    const empty = screen.getByTestId("hf-mcq-empty");
    expect(empty.getAttribute("data-empty-reason")).toBe("no-moment");
    expect(empty).toHaveTextContent("No quiz available");
    expect(screen.queryByTestId("hf-mcq-cue-card")).toBeNull();
  });

  it("W4 — empty-state copy varies per emptyReason", () => {
    const cases: Array<["loading" | "empty-pool" | "policy-unsatisfied" | "missing-content" | "error", string]> = [
      ["loading", "Loading"],
      ["empty-pool", "empty"],
      ["policy-unsatisfied", "sampling rules"],
      ["missing-content", "different kind of content"],
      ["error", "Couldn't load"],
    ];
    for (const [reason, snippet] of cases) {
      cleanup();
      render(<MCQRoundsShell emptyReason={reason} />);
      const empty = screen.getByTestId("hf-mcq-empty");
      expect(empty.getAttribute("data-empty-reason")).toBe(reason);
      expect(empty.textContent ?? "").toMatch(new RegExp(snippet, "i"));
    }
  });

  it("W4 — does not render empty-state when an MCQ is present", () => {
    const mcq = { id: "q", questionText: "What?", options: [{ label: "A", text: "yes" }] };
    render(<MCQRoundsShell mcqs={[mcq]} roundIndex={1} roundTotal={1} />);
    expect(screen.queryByTestId("hf-mcq-empty")).toBeNull();
    expect(screen.getByTestId("hf-mcq-cue-card")).toBeTruthy();
  });

  it("W4 — does not render empty-state when ended (close screen takes over)", () => {
    render(<MCQRoundsShell ended emptyReason="no-moment" />);
    expect(screen.queryByTestId("hf-mcq-empty")).toBeNull();
    expect(screen.getByTestId("hf-mcq-close-screen")).toBeTruthy();
  });

  it("W4 — option buttons invoke onAnswer with (mcqId, optionLabel)", () => {
    const onAnswer = vi.fn();
    const mcq = {
      id: "mcq-42",
      questionText: "Pick one",
      options: [
        { label: "A", text: "First" },
        { label: "B", text: "Second" },
      ],
    };
    render(
      <MCQRoundsShell
        mcqs={[mcq]}
        roundIndex={1}
        roundTotal={1}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-mcq-option-B"));
    expect(onAnswer).toHaveBeenCalledWith("mcq-42", "B");
  });

  it("W4 — selected option is reflected on the <li> + button disables further clicks", () => {
    const onAnswer = vi.fn();
    const mcq = {
      id: "q1",
      questionText: "Pick",
      options: [
        { label: "A", text: "x" },
        { label: "B", text: "y" },
      ],
    };
    render(
      <MCQRoundsShell
        mcqs={[mcq]}
        roundIndex={1}
        roundTotal={1}
        selectedOption="A"
        onAnswer={onAnswer}
      />,
    );
    const options = screen.getByTestId("hf-mcq-options");
    const aLi = options.querySelector('[data-mcq-option-label="A"]');
    const bLi = options.querySelector('[data-mcq-option-label="B"]');
    expect(aLi?.getAttribute("data-selected")).toBe("true");
    expect(bLi?.getAttribute("data-selected")).toBe("false");
    // Both buttons are disabled once a selection landed (no double-click).
    expect((screen.getByTestId("hf-mcq-option-A") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("hf-mcq-option-B") as HTMLButtonElement).disabled).toBe(true);
  });

  it("W4 — option buttons are disabled when no onAnswer handler is supplied", () => {
    const mcq = {
      id: "q",
      questionText: "Pick",
      options: [{ label: "A", text: "x" }],
    };
    render(<MCQRoundsShell mcqs={[mcq]} roundIndex={1} roundTotal={1} />);
    expect((screen.getByTestId("hf-mcq-option-A") as HTMLButtonElement).disabled).toBe(true);
  });

  it("W4 — round counter reflects progression through the round", () => {
    const mcqs = [
      { id: "q1", questionText: "Q1", options: [{ label: "A", text: "x" }] },
      { id: "q2", questionText: "Q2", options: [{ label: "A", text: "x" }] },
      { id: "q3", questionText: "Q3", options: [{ label: "A", text: "x" }] },
    ];
    const { rerender } = render(
      <MCQRoundsShell mcqs={mcqs} roundIndex={1} roundTotal={3} />,
    );
    expect(screen.getByTestId("hf-mcq-counter")).toHaveTextContent("Round 1 of 3");
    expect(screen.getByTestId("hf-mcq-cue-card").getAttribute("data-mcq-id")).toBe("q1");

    rerender(<MCQRoundsShell mcqs={mcqs} roundIndex={2} roundTotal={3} />);
    expect(screen.getByTestId("hf-mcq-counter")).toHaveTextContent("Round 2 of 3");
    expect(screen.getByTestId("hf-mcq-cue-card").getAttribute("data-mcq-id")).toBe("q2");
  });
});

// ────────────────────────────────────────────────────────────
// SHELL_DEFAULTS coverage — sanity: every shell × every capability key
// has a non-undefined value (Cartesian completeness — sibling of the
// learner-shell-types.test.ts assertion in PR #2173).
// ────────────────────────────────────────────────────────────

describe("SHELL_DEFAULTS Cartesian completeness sanity (defence-in-depth vs PR #2173)", () => {
  const REQUIRED_KEYS = [
    "allowModuleSwitch",
    "showTimer",
    "showProgressBar",
    "chatFeedVisibility",
    "allowBackToHome",
    "colourTheme",
    "modePillKey",
    "dismissOnEnd",
    "stallChipBehaviour",
  ] as const;

  it("every shell has every required capability key defined", () => {
    for (const shell of Object.keys(SHELL_DEFAULTS)) {
      const caps = SHELL_DEFAULTS[shell as keyof typeof SHELL_DEFAULTS];
      for (const key of REQUIRED_KEYS) {
        expect(
          caps[key],
          `${shell}.${key} is undefined`,
        ).not.toBeUndefined();
      }
    }
  });
});
