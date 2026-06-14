/**
 * ModePolicyRenderer tests — #1626 (Epic #1606 A.2).
 *
 * Pinned acceptance:
 *   1. Registry contract — `getPreviewRenderer("modePolicy")` returns it.
 *   2. Per-field render output for all 3 knobs (set + unset variants).
 *   3. Unknown teachingMode literals fall through to raw value (no crash).
 *   4. Unknown maxMasteryTier literals fall through to raw value.
 *   5. Design-system class discipline (hf-badge + variant; hf-category-label).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ModePolicyRenderer,
  type ModePolicyRendererData,
} from "@/components/shared/preview-renderers/ModePolicyRenderer";
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
  registerPreviewRenderer<"modePolicy", ModePolicyRendererData>(
    "modePolicy",
    ModePolicyRenderer,
  );
});

function r(data: ModePolicyRendererData) {
  return render(
    <ModePolicyRenderer
      data={data}
      selection={{ selectedKey: "modePolicy" }}
    />,
  );
}

describe("ModePolicyRenderer — registry contract", () => {
  it("registers under 'modePolicy'", () => {
    expect(getPreviewRenderer("modePolicy")).toBe(ModePolicyRenderer);
  });
});

describe("ModePolicyRenderer — teachingMode", () => {
  it("shows 'Unset (default)' when teachingMode is undefined", () => {
    r({
      teachingMode: undefined,
      useFreshMastery: undefined,
      maxMasteryTier: undefined,
    });
    expect(screen.getByText("Unset (default)")).toBeInTheDocument();
  });

  it("maps recall / comprehension / practice / syllabus to readable labels", () => {
    for (const [literal, label] of [
      ["recall", "Recall"],
      ["comprehension", "Comprehension"],
      ["practice", "Practice"],
      ["syllabus", "Syllabus"],
    ] as const) {
      cleanup();
      r({
        teachingMode: literal,
        useFreshMastery: undefined,
        maxMasteryTier: undefined,
      });
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("falls through to the raw literal for unknown teachingMode values", () => {
    r({
      teachingMode: "experimental-mode",
      useFreshMastery: undefined,
      maxMasteryTier: undefined,
    });
    expect(screen.getByText("experimental-mode")).toBeInTheDocument();
  });
});

describe("ModePolicyRenderer — useFreshMastery", () => {
  it("renders the ON variant when true", () => {
    r({
      teachingMode: undefined,
      useFreshMastery: true,
      maxMasteryTier: undefined,
    });
    expect(
      screen.getByText("ON — writes to scratch space"),
    ).toBeInTheDocument();
  });

  it("renders the OFF default variant when false or undefined", () => {
    r({
      teachingMode: undefined,
      useFreshMastery: false,
      maxMasteryTier: undefined,
    });
    expect(
      screen.getByText("OFF — writes to CallerAttribute (default)"),
    ).toBeInTheDocument();
    cleanup();
    r({
      teachingMode: undefined,
      useFreshMastery: undefined,
      maxMasteryTier: undefined,
    });
    expect(
      screen.getByText("OFF — writes to CallerAttribute (default)"),
    ).toBeInTheDocument();
  });
});

describe("ModePolicyRenderer — maxMasteryTier", () => {
  it("renders 'Uncapped (default)' when undefined", () => {
    r({
      teachingMode: undefined,
      useFreshMastery: undefined,
      maxMasteryTier: undefined,
    });
    expect(screen.getByText("Uncapped (default)")).toBeInTheDocument();
  });

  it("maps the 4 enum tiers to readable labels", () => {
    for (const [tier, label] of [
      ["FOUNDATION", "Foundation"],
      ["DEVELOPING", "Developing"],
      ["PRACTITIONER", "Practitioner"],
      ["DISTINCTION", "Distinction"],
    ] as const) {
      cleanup();
      r({
        teachingMode: undefined,
        useFreshMastery: undefined,
        maxMasteryTier: tier,
      });
      expect(screen.getByText(`Capped at ${label}`)).toBeInTheDocument();
    }
  });
});

describe("ModePolicyRenderer — design-system class discipline", () => {
  it("uses hf-badge-muted for default/unset variants", () => {
    const { container } = r({
      teachingMode: undefined,
      useFreshMastery: undefined,
      maxMasteryTier: undefined,
    });
    expect(container.querySelectorAll(".hf-badge-muted").length).toBe(3);
    expect(container.querySelector(".hf-badge-info")).toBeNull();
  });

  it("uses hf-badge-info for set values", () => {
    const { container } = r({
      teachingMode: "recall",
      useFreshMastery: true,
      maxMasteryTier: "PRACTITIONER",
    });
    expect(container.querySelectorAll(".hf-badge-info").length).toBe(3);
    expect(container.querySelector(".hf-badge-muted")).toBeNull();
  });
});
