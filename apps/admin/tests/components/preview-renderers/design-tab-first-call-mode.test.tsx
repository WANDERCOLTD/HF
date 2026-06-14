/**
 * DesignTab + FirstCallModeRenderer end-to-end wire-up — #1607.
 *
 * Verifies the smoke-test wiring:
 *   - Entry-point chip in the header banner renders the correct mode label
 *   - Click → Inspector slot mounts the renderer with `data.firstCallMode`
 *     populated from `playbookConfig.firstCallMode`
 *   - Click again → Inspector slot is structurally absent (selectedKey null)
 *
 * `CourseDesignConsole` is mocked — the heavy data dependencies aren't
 * relevant to the registry wire-up.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock(
  "../../../app/x/courses/[courseId]/_components/CourseDesignConsole",
  () => ({
    CourseDesignConsole: () => <div data-testid="mock-console">console</div>,
  }),
);

// Stub matchMedia for jsdom — DesignerShell relies on it for the narrow-viewport
// drawer behaviour. Same pattern as designer-shell.test.tsx.
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { DesignTab } from "@/app/x/courses/[courseId]/_tab/DesignTab";
import {
  FirstCallModeRenderer,
  type FirstCallModeRendererData,
} from "@/components/shared/preview-renderers/FirstCallModeRenderer";
import { registerPreviewRenderer } from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  // The renderer module's load-time side-effect registers once per
  // process; after each test's reset we manually re-register so every
  // test starts in the known state.
  registerPreviewRenderer<"firstCallMode", FirstCallModeRendererData>(
    "firstCallMode",
    FirstCallModeRenderer,
  );
});

function renderDesignTab(
  firstCallMode:
    | "onboarding"
    | "teach_immediately"
    | "baseline_assessment"
    | undefined,
) {
  return render(
    <DesignTab
      courseId="c1"
      playbookConfig={firstCallMode ? { firstCallMode } : {}}
    />,
  );
}

describe("DesignTab — entry-point chip label", () => {
  it("shows 'Onboarding (default)' for 'onboarding'", () => {
    renderDesignTab("onboarding");
    expect(
      screen.getByRole("button", { name: /Onboarding \(default\)/ }),
    ).toBeInTheDocument();
  });

  it("shows 'Teach Immediately' for 'teach_immediately'", () => {
    renderDesignTab("teach_immediately");
    expect(
      screen.getByRole("button", { name: /Teach Immediately/ }),
    ).toBeInTheDocument();
  });

  it("shows 'Baseline Assessment' for 'baseline_assessment'", () => {
    renderDesignTab("baseline_assessment");
    expect(
      screen.getByRole("button", { name: /Baseline Assessment/ }),
    ).toBeInTheDocument();
  });

  it("shows the unset-state label when firstCallMode is undefined", () => {
    renderDesignTab(undefined);
    expect(
      screen.getByRole("button", { name: /Onboarding \(default — unset\)/ }),
    ).toBeInTheDocument();
  });
});

describe("DesignTab — Inspector toggle", () => {
  it("mounts the Inspector with the renderer when the chip is clicked", () => {
    renderDesignTab("baseline_assessment");
    expect(document.querySelector(".hf-designer-inspector")).toBeNull();
    const chip = screen.getByRole("button", { name: /Baseline Assessment/ });
    fireEvent.click(chip);
    expect(document.querySelector(".hf-designer-inspector")).not.toBeNull();
    // Renderer surfaces the mode label inside the inspector AND the chip
    // text shows it — at least two occurrences in the DOM.
    const labels = screen.getAllByText(/Baseline Assessment/);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("clears the Inspector when the chip is clicked twice", () => {
    renderDesignTab("teach_immediately");
    const chip = screen.getByRole("button", { name: /Teach Immediately/ });
    fireEvent.click(chip);
    expect(document.querySelector(".hf-designer-inspector")).not.toBeNull();
    fireEvent.click(chip);
    expect(document.querySelector(".hf-designer-inspector")).toBeNull();
  });

  it("marks the chip aria-pressed=true while the Inspector is open", () => {
    renderDesignTab("onboarding");
    const chip = screen.getByRole("button", { name: /Onboarding/ });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });
});
