/**
 * FirstCallModeRenderer tests — #1607 (Epic #1606 A.1).
 *
 * Pinned acceptance:
 *   1. Registry contract — `getPreviewRenderer("firstCallMode")` returns the
 *      registered component after the renderer module loads.
 *   2. Per-value render output — exact label for each of the 3 valid modes.
 *   3. Unset fallback — muted variant rendered, never crashes, never null.
 *   4. Design-system class usage — chip carries `hf-badge` + correct variant.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Side-effect import — registers FirstCallModeRenderer at module load.
import {
  FirstCallModeRenderer,
  type FirstCallModeRendererData,
} from "@/components/shared/preview-renderers/FirstCallModeRenderer";
import {
  getPreviewRenderer,
  registerPreviewRenderer,
} from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  // After the previous test's reset, re-register so each test starts in
  // the known state the registry-side-effect import would establish on a
  // fresh module load.
  registerPreviewRenderer<"firstCallMode", FirstCallModeRendererData>(
    "firstCallMode",
    FirstCallModeRenderer,
  );
});

describe("FirstCallModeRenderer — registry contract", () => {
  it("registers under the 'firstCallMode' key", () => {
    expect(getPreviewRenderer("firstCallMode")).toBe(FirstCallModeRenderer);
  });

  it("does not register under any other key", () => {
    expect(getPreviewRenderer("modePolicy")).toBeNull();
    expect(getPreviewRenderer("loMastery")).toBeNull();
    expect(getPreviewRenderer("personality")).toBeNull();
  });
});

describe("FirstCallModeRenderer — per-value render output", () => {
  it("renders 'Onboarding (default)' for 'onboarding'", () => {
    render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "onboarding" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(screen.getByText("Onboarding (default)")).toBeInTheDocument();
  });

  it("renders 'Teach Immediately' for 'teach_immediately'", () => {
    render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "teach_immediately" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(screen.getByText("Teach Immediately")).toBeInTheDocument();
  });

  it("renders 'Baseline Assessment' for 'baseline_assessment'", () => {
    render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "baseline_assessment" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(screen.getByText("Baseline Assessment")).toBeInTheDocument();
  });
});

describe("FirstCallModeRenderer — unset fallback", () => {
  it("renders the muted unset variant when firstCallMode is undefined", () => {
    const { container } = render(
      <FirstCallModeRenderer
        data={{ firstCallMode: undefined }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(
      screen.getByText("Onboarding (default — unset)"),
    ).toBeInTheDocument();
    const badge = container.querySelector(".hf-badge-muted");
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains("hf-badge-info")).toBe(false);
  });
});

describe("FirstCallModeRenderer — design-system class discipline", () => {
  it("uses hf-badge + hf-badge-info on the set variant (not muted)", () => {
    const { container } = render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "baseline_assessment" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    const badge = container.querySelector(".hf-badge");
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains("hf-badge-info")).toBe(true);
    expect(badge?.classList.contains("hf-badge-muted")).toBe(false);
  });

  it("uses hf-category-label for the section header", () => {
    const { container } = render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "onboarding" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(
      container.querySelector(".hf-category-label"),
    ).not.toBeNull();
  });
});
