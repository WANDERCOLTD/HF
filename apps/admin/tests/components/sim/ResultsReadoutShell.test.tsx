/**
 * Tests for ResultsReadoutShell (W6 of memory/handoff_lattice_all_settings_to_ui_2026_06_21.md,
 * story #2185 U11). Capability-driven Mock Results screen — the ONE
 * sanctioned learner-facing surface that renders per-criterion bands
 * (per BDD US-Mock-05 + `.claude/rules/learner-ui-leak-coverage.md`
 * exemptions).
 *
 * Pinned acceptance:
 *  1. Default `SHELL_DEFAULTS["results-readout"]` capabilities stamp the
 *     expected data attributes (brand theme, no mode pill, no timer,
 *     no progress bar, dismissOnEnd="next-module").
 *  2. Overall band + per-criterion list render when a real `result`
 *     payload is supplied.
 *  3. Labels flow from props, not literals — the shell stays leak-clean.
 *  4. Honest empty state when `result` is null (per the operator-pinned
 *     "never fill empty scores with hardcoded defaults" rule).
 *  5. Loading + error states render without fabricating bands.
 *  6. Capability overrides flow through to data attributes.
 *  7. Optional dismiss / next CTAs render when handlers supplied.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  ResultsReadoutShell,
  type ResultsReadoutPayload,
} from "@/components/sim/ResultsReadoutShell";
import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────
// Default capability frame
// ────────────────────────────────────────────────────────────

describe("ResultsReadoutShell — default SHELL_DEFAULTS['results-readout'] capabilities", () => {
  it("stamps data attributes matching the canonical defaults", () => {
    render(<ResultsReadoutShell />);
    const shell = screen.getByTestId("hf-results-readout-shell");
    const expected = SHELL_DEFAULTS["results-readout"];
    expect(shell.getAttribute("data-shell-kind")).toBe("results-readout");
    expect(shell.getAttribute("data-colour-theme")).toBe(expected.colourTheme); // "brand"
    expect(shell.getAttribute("data-mode-pill")).toBe(expected.modePillKey ?? ""); // ""
    expect(shell.getAttribute("data-chat-feed-visibility")).toBe(
      expected.chatFeedVisibility,
    ); // "none"
    expect(shell.getAttribute("data-show-timer")).toBe(expected.showTimer); // "none"
    expect(shell.getAttribute("data-show-progress-bar")).toBe(
      expected.showProgressBar,
    ); // "none"
    expect(shell.getAttribute("data-allow-module-switch")).toBe("false");
    expect(shell.getAttribute("data-allow-back-to-home")).toBe("false");
    expect(shell.getAttribute("data-dismiss-on-end")).toBe("next-module");
    expect(shell.getAttribute("data-stall-chip-behaviour")).toBe("none");
  });

  it("does NOT render the mode pill when modePillKey is null", () => {
    render(<ResultsReadoutShell />);
    expect(screen.queryByTestId("hf-shell-mode-pill")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// Result rendering — overall + per-criterion bands
// ────────────────────────────────────────────────────────────

describe("ResultsReadoutShell — renders per-criterion bands from data (BDD US-Mock-05)", () => {
  // Labels arrive as props (server-resolved from canonical Parameter.name
  // rows). They never appear as literals in the shell source — this test
  // pins that pattern by passing arbitrary label strings.
  const SAMPLE: ResultsReadoutPayload = {
    overall: 6.5,
    tierLabel: "Competent user",
    narrative: "Strong fluency; work on a wider lexical range.",
    criteria: [
      { key: "fluency", label: "Fluency-and-Coherence-label", score: 7 },
      { key: "lexical", label: "Lexical-Resource-label", score: 6 },
      { key: "grammar", label: "Grammar-label", score: 6.5 },
      { key: "pronunciation", label: "Pronunciation-label", score: 6.5 },
    ],
  };

  it("renders the overall band, tier label, and narrative when supplied", () => {
    render(<ResultsReadoutShell result={SAMPLE} />);
    expect(screen.getByTestId("hf-results-readout-overall-score")).toHaveTextContent(
      "6.5",
    );
    expect(screen.getByTestId("hf-results-readout-tier")).toHaveTextContent(
      "Competent user",
    );
    expect(screen.getByTestId("hf-results-readout-narrative")).toHaveTextContent(
      "Strong fluency; work on a wider lexical range.",
    );
  });

  it("renders every criterion row with label + score from props", () => {
    render(<ResultsReadoutShell result={SAMPLE} />);
    expect(
      screen.getByTestId("hf-results-readout-criterion-label-fluency"),
    ).toHaveTextContent("Fluency-and-Coherence-label");
    expect(
      screen.getByTestId("hf-results-readout-criterion-score-fluency"),
    ).toHaveTextContent("7");
    expect(
      screen.getByTestId("hf-results-readout-criterion-label-lexical"),
    ).toHaveTextContent("Lexical-Resource-label");
    expect(
      screen.getByTestId("hf-results-readout-criterion-score-lexical"),
    ).toHaveTextContent("6");
    expect(
      screen.getByTestId("hf-results-readout-criterion-score-grammar"),
    ).toHaveTextContent("6.5");
    expect(
      screen.getByTestId("hf-results-readout-criterion-score-pronunciation"),
    ).toHaveTextContent("6.5");
  });

  it("integer bands render without trailing zero ('6' not '6.0')", () => {
    const payload: ResultsReadoutPayload = {
      overall: 6,
      criteria: [{ key: "k", label: "L", score: 6 }],
    };
    render(<ResultsReadoutShell result={payload} />);
    expect(screen.getByTestId("hf-results-readout-overall-score")).toHaveTextContent(
      "6",
    );
    expect(screen.getByTestId("hf-results-readout-criterion-score-k")).toHaveTextContent(
      "6",
    );
  });

  it("non-finite band renders as em-dash (honest)", () => {
    const payload: ResultsReadoutPayload = {
      overall: Number.NaN,
      criteria: [{ key: "k", label: "L", score: Number.NaN }],
    };
    render(<ResultsReadoutShell result={payload} />);
    expect(screen.getByTestId("hf-results-readout-overall-score")).toHaveTextContent(
      "—",
    );
  });

  it("tier label + narrative are optional (absent props → not rendered)", () => {
    const payload: ResultsReadoutPayload = {
      overall: 6,
      criteria: [{ key: "k", label: "L", score: 6 }],
    };
    render(<ResultsReadoutShell result={payload} />);
    expect(screen.queryByTestId("hf-results-readout-tier")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-narrative")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// Honest empty / loading / error states (no fake bands)
// ────────────────────────────────────────────────────────────

describe("ResultsReadoutShell — honest loading / error / empty (no fake bands)", () => {
  it("renders the empty state when result is null and no error/loading", () => {
    render(<ResultsReadoutShell result={null} />);
    expect(
      screen.getByTestId("hf-results-readout-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("hf-results-readout-overall")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-criteria")).toBeNull();
  });

  it("renders the empty state when result.criteria is empty", () => {
    const empty: ResultsReadoutPayload = { overall: 0, criteria: [] };
    render(<ResultsReadoutShell result={empty} />);
    expect(screen.getByTestId("hf-results-readout-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-results-readout-overall")).toBeNull();
  });

  it("renders the loading state when loading=true (no fake bands)", () => {
    render(<ResultsReadoutShell loading />);
    expect(screen.getByTestId("hf-results-readout-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-results-readout-overall")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-empty")).toBeNull();
  });

  it("renders the error state when error string is supplied (no fake bands)", () => {
    render(<ResultsReadoutShell error="Could not load results." />);
    const err = screen.getByTestId("hf-results-readout-error");
    expect(err).toHaveTextContent("Could not load results.");
    expect(screen.queryByTestId("hf-results-readout-overall")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-empty")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// Capability overrides flow through to data attributes
// ────────────────────────────────────────────────────────────

describe("ResultsReadoutShell — capability overrides", () => {
  it("colourTheme override flows to data-colour-theme attribute", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["results-readout"],
      colourTheme: "dark",
    };
    render(<ResultsReadoutShell capabilities={caps} />);
    expect(
      screen.getByTestId("hf-results-readout-shell").getAttribute("data-colour-theme"),
    ).toBe("dark");
  });

  it("dismissOnEnd override flows to data-dismiss-on-end attribute", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["results-readout"],
      dismissOnEnd: "home",
    };
    render(<ResultsReadoutShell capabilities={caps} />);
    expect(
      screen
        .getByTestId("hf-results-readout-shell")
        .getAttribute("data-dismiss-on-end"),
    ).toBe("home");
  });

  it("a non-null modePillKey override renders the pill", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["results-readout"],
      modePillKey: "mock-exam",
    };
    render(<ResultsReadoutShell capabilities={caps} />);
    const pill = screen.getByTestId("hf-shell-mode-pill");
    expect(pill.getAttribute("data-mode-pill-key")).toBe("mock-exam");
  });
});

// ────────────────────────────────────────────────────────────
// Dismiss / Next CTAs + children slot
// ────────────────────────────────────────────────────────────

describe("ResultsReadoutShell — dismiss + next CTAs", () => {
  it("renders the dismiss button when onDismiss handler supplied", () => {
    const onDismiss = vi.fn();
    render(<ResultsReadoutShell onDismiss={onDismiss} />);
    const btn = screen.getByTestId("hf-results-readout-dismiss");
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders the next button when onNext handler supplied", () => {
    const onNext = vi.fn();
    render(<ResultsReadoutShell onNext={onNext} />);
    const btn = screen.getByTestId("hf-results-readout-next");
    fireEvent.click(btn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("children slot OVERRIDES the default CTAs", () => {
    render(
      <ResultsReadoutShell onDismiss={() => {}} onNext={() => {}}>
        <button type="button" data-testid="custom-cta">Custom</button>
      </ResultsReadoutShell>,
    );
    expect(screen.getByTestId("custom-cta")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-results-readout-dismiss")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-next")).toBeNull();
  });

  it("renders no controls slot when no handlers and no children", () => {
    render(<ResultsReadoutShell />);
    expect(screen.queryByTestId("hf-results-readout-dismiss")).toBeNull();
    expect(screen.queryByTestId("hf-results-readout-next")).toBeNull();
  });
});
