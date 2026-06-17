/**
 * DesignTab + ModePolicyRenderer end-to-end wire-up — #1626.
 *
 * Sibling of `design-tab-first-call-mode.test.tsx`. Verifies that the
 * second header-banner entry-point chip renders the teachingMode
 * literal, toggles the Inspector independently of firstCallMode, and
 * surfaces the renderer body with the right chips.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock(
  "../../../app/x/courses/[courseId]/_components/CourseDesignConsole",
  () => ({
    CourseDesignConsole: () => <div data-testid="mock-console">console</div>,
  }),
);

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
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, sessionFlow: null })),
    )) as typeof globalThis.fetch;
});

import { DesignTab } from "@/app/x/courses/[courseId]/_tab/DesignTab";
import {
  ModePolicyRenderer,
  type ModePolicyRendererData,
} from "@/components/shared/preview-renderers/ModePolicyRenderer";
import { registerPreviewRenderer } from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  registerPreviewRenderer<"modePolicy", ModePolicyRendererData>(
    "modePolicy",
    ModePolicyRenderer,
  );
});

function renderDesignTab(playbookConfig: Record<string, unknown>) {
  return render(<DesignTab courseId="c1" playbookConfig={playbookConfig} />);
}

describe("DesignTab — modePolicy entry-point chip", () => {
  it("shows the teachingMode literal in the header chip", () => {
    renderDesignTab({ teachingMode: "comprehension" });
    expect(
      screen.getByRole("button", { name: /Mode policy:.*comprehension/ }),
    ).toBeInTheDocument();
  });

  it("shows 'default' when teachingMode is unset", () => {
    renderDesignTab({});
    expect(
      screen.getByRole("button", { name: /Mode policy:.*default/ }),
    ).toBeInTheDocument();
  });
});

describe("DesignTab — modePolicy Inspector toggle", () => {
  it("mounts the Inspector with renderer body on chip click", () => {
    renderDesignTab({
      teachingMode: "practice",
      useFreshMastery: true,
      maxMasteryTier: "PRACTITIONER",
    });
    expect(document.querySelector(".hf-designer-inspector")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Mode policy:.*practice/ }),
    );
    expect(document.querySelector(".hf-designer-inspector")).not.toBeNull();
    // Inspector body shows the teaching-mode label badge plus editable
    // JourneyField controls for the two mutable knobs (#1692 Slice B
    // moved Inspector renderers from read-only badges to editable
    // JourneyField widgets when courseId is in scope + not readonly).
    expect(screen.getByText("Practice")).toBeInTheDocument();
    // useFreshMastery → JourneyField toggle row
    expect(
      document.querySelector('[data-testid="hf-jf-toggle-useFreshMastery"]'),
    ).not.toBeNull();
    // maxMasteryTier → segmented JourneyField with the active "Practitioner"
    // option pressed.
    const practitionerBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "Practitioner");
    expect(practitionerBtn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking twice closes the Inspector", () => {
    renderDesignTab({ teachingMode: "recall" });
    const chip = screen.getByRole("button", { name: /Mode policy/ });
    fireEvent.click(chip);
    expect(document.querySelector(".hf-designer-inspector")).not.toBeNull();
    fireEvent.click(chip);
    expect(document.querySelector(".hf-designer-inspector")).toBeNull();
  });

  it("clicking modePolicy while firstCallMode is open swaps the Inspector content", () => {
    // Both renderers need to be registered for this test — the A.1 test
    // file does the firstCallMode registration in its own beforeEach,
    // but in this file we only register modePolicy. The Inspector won't
    // mount for firstCallMode here without registration. Use the toggle
    // assertion to validate single-Inspector semantics by aria-pressed.
    renderDesignTab({ teachingMode: "syllabus" });
    const firstCallChip = screen.getByRole("button", {
      name: /Call 1 mode/,
    });
    const modePolicyChip = screen.getByRole("button", {
      name: /Mode policy:.*syllabus/,
    });
    expect(firstCallChip.getAttribute("aria-pressed")).toBe("false");
    expect(modePolicyChip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(modePolicyChip);
    expect(modePolicyChip.getAttribute("aria-pressed")).toBe("true");
    // Now click the firstCallMode chip — modePolicy should release.
    fireEvent.click(firstCallChip);
    expect(modePolicyChip.getAttribute("aria-pressed")).toBe("false");
    expect(firstCallChip.getAttribute("aria-pressed")).toBe("true");
  });
});
