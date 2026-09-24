/**
 * IntakeWizardShell — capability-driven render tests.
 *
 * W7 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md`
 * (story #2185 U13). Mirrors the W6 ResultsReadoutShell test shape:
 *  - Default capability frame stamps every flag in
 *    `SHELL_DEFAULTS["intake-wizard"]` onto `data-*` attributes (the
 *    Coverage observable surface).
 *  - Capability overrides flow through (per the capability-driven
 *    contract: shell DOES NOT branch on the shell-kind literal).
 *  - Dismiss affordance respects `allowBackToHome` + the `onDismiss`
 *    prop (honest opt-in: no handler → no button).
 *  - Banner / children render as supplied (no fake placeholder UX).
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { IntakeWizardShell } from "@/components/sim/IntakeWizardShell";
import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

afterEach(() => {
  cleanup();
});

describe("IntakeWizardShell — capability-driven render (closes shell-coverage W7)", () => {
  it("default capabilities stamp SHELL_DEFAULTS['intake-wizard'] attributes", () => {
    render(
      <IntakeWizardShell>
        <div data-testid="intake-content-stub">stub content</div>
      </IntakeWizardShell>,
    );
    const shell = screen.getByTestId("hf-intake-wizard-shell");
    const expected = SHELL_DEFAULTS["intake-wizard"];
    expect(shell.getAttribute("data-shell-kind")).toBe("intake-wizard");
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
  });

  it("renders children inside the body slot — host owns the intake content", () => {
    render(
      <IntakeWizardShell>
        <div data-testid="intake-content-stub">authored intake stop</div>
      </IntakeWizardShell>,
    );
    const body = screen.getByTestId("hf-intake-shell-body");
    expect(body).toContainElement(screen.getByTestId("intake-content-stub"));
    expect(body).toHaveTextContent("authored intake stop");
  });

  it("renders the banner only when banner prop is supplied", () => {
    const { rerender } = render(<IntakeWizardShell />);
    expect(screen.queryByTestId("hf-intake-shell-banner")).toBeNull();
    rerender(
      <IntakeWizardShell banner="Welcome — let's set up your profile." />,
    );
    expect(screen.getByTestId("hf-intake-shell-banner")).toHaveTextContent(
      "Welcome — let's set up your profile.",
    );
  });

  it("renders the dismiss affordance when allowBackToHome is true AND onDismiss is supplied", () => {
    const onDismiss = vitestSpy();
    render(<IntakeWizardShell onDismiss={onDismiss} />);
    const dismiss = screen.getByTestId("hf-intake-shell-dismiss");
    expect(dismiss).toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(onDismiss.calls).toBe(1);
  });

  it("does NOT render the dismiss affordance when allowBackToHome is false", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["intake-wizard"],
      allowBackToHome: false,
    };
    render(<IntakeWizardShell capabilities={caps} onDismiss={() => {}} />);
    expect(screen.queryByTestId("hf-intake-shell-dismiss")).toBeNull();
  });

  it("does NOT render the dismiss affordance when no onDismiss handler is provided (honest opt-in)", () => {
    render(<IntakeWizardShell />);
    expect(screen.queryByTestId("hf-intake-shell-dismiss")).toBeNull();
  });

  it("capability overrides flow through to data attributes (no branching on shell-kind literal)", () => {
    const caps: LearnerShellCapabilities = {
      ...SHELL_DEFAULTS["intake-wizard"],
      colourTheme: "brand",
      showProgressBar: "fill-bar",
    };
    render(<IntakeWizardShell capabilities={caps} />);
    const shell = screen.getByTestId("hf-intake-wizard-shell");
    expect(shell.getAttribute("data-colour-theme")).toBe("brand");
    expect(shell.getAttribute("data-show-progress-bar")).toBe("fill-bar");
  });

  it("carries the section ARIA role + label for screen readers", () => {
    render(<IntakeWizardShell />);
    const region = screen.getByRole("region", { name: /enrolment intake/i });
    expect(region).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// Minimal local spy helper (avoid pulling vi.fn from the suite root
// when the file's only mock need is a click counter).
// ─────────────────────────────────────────────────────────────────

interface Spy {
  calls: number;
  (): void;
}

function vitestSpy(): Spy {
  const fn = (() => {
    fn.calls += 1;
  }) as Spy;
  fn.calls = 0;
  return fn;
}
