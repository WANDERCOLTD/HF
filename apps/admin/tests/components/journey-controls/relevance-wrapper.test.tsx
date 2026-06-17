/**
 * RelevanceWrapper — Phase 0 of the Journey-Design tab refactor.
 *
 * Pins all 5 mutually-exclusive relevance states with a representative
 * fixture each. Failures here surface as overlay-rendering regressions
 * in the Journey-Design Inspector.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelevanceWrapper } from "@/components/journey-controls/RelevanceWrapper";

describe("RelevanceWrapper", () => {
  it("active state renders children bare (no wrapper, no chip)", () => {
    const { container } = render(
      <RelevanceWrapper state="active">
        <input data-testid="inner" placeholder="active-control" />
      </RelevanceWrapper>,
    );
    // No outer hf-relevance-wrap class.
    expect(container.querySelector(".hf-relevance-wrap")).toBeNull();
    // Children remain intact.
    expect(screen.getByTestId("inner")).toBeTruthy();
    // No chip rendered.
    expect(container.querySelector(".hf-relevance-chip")).toBeNull();
  });

  it("inherited state renders a layer-origin chip + children", () => {
    const { container } = render(
      <RelevanceWrapper state="inherited" layerOrigin="Domain">
        <input data-testid="inner" />
      </RelevanceWrapper>,
    );
    const wrap = container.querySelector(".hf-relevance-wrap--inherited");
    expect(wrap).toBeTruthy();
    expect(wrap?.getAttribute("data-state")).toBe("inherited");
    expect(screen.getByText(/Inherited from Domain/)).toBeTruthy();
    expect(screen.getByTestId("inner")).toBeTruthy();
  });

  it("auto-derived state shows reason + Decouple button that calls unlockAction", () => {
    const unlock = vi.fn();
    const { container } = render(
      <RelevanceWrapper
        state="auto-derived"
        reason="Derived from skillTierMapping cascade"
        unlockAction={unlock}
      >
        <input data-testid="inner" />
      </RelevanceWrapper>,
    );
    expect(container.querySelector(".hf-relevance-wrap--auto-derived")).toBeTruthy();
    expect(screen.getByText(/Derived from skillTierMapping cascade/)).toBeTruthy();
    const decouple = screen.getByRole("button", { name: /Decouple/ });
    fireEvent.click(decouple);
    expect(unlock).toHaveBeenCalledTimes(1);
    // Children rendered but muted.
    expect(screen.getByTestId("inner")).toBeTruthy();
    expect(container.querySelector(".hf-relevance-children--muted")).toBeTruthy();
  });

  it("gated-off state shows parent label + chip click calls onJumpToParent", () => {
    const jump = vi.fn();
    const { container } = render(
      <RelevanceWrapper
        state="gated-off"
        parentSettingId="npsEnabled"
        parentSettingLabel="NPS enabled"
        onJumpToParent={jump}
      >
        <input data-testid="inner" />
      </RelevanceWrapper>,
    );
    expect(container.querySelector(".hf-relevance-wrap--gated-off")).toBeTruthy();
    const chip = screen.getByRole("button", { name: /NPS enabled/ });
    expect(chip.textContent).toMatch(/Enable NPS enabled first/);
    fireEvent.click(chip);
    expect(jump).toHaveBeenCalledWith("npsEnabled");
    expect(container.querySelector(".hf-relevance-children--muted")).toBeTruthy();
  });

  it("out-of-shape state shows reason chip + muted children", () => {
    const { container } = render(
      <RelevanceWrapper
        state="out-of-shape"
        reason="Continuous courses don't use modules"
      >
        <input data-testid="inner" />
      </RelevanceWrapper>,
    );
    expect(container.querySelector(".hf-relevance-wrap--out-of-shape")).toBeTruthy();
    expect(screen.getByText(/Continuous courses don't use modules/)).toBeTruthy();
    expect(container.querySelector(".hf-relevance-children--muted")).toBeTruthy();
    expect(screen.getByTestId("inner")).toBeTruthy();
  });

  it("gated-off without jump handler renders the chip as static (no button role)", () => {
    const { container, queryByRole } = render(
      <RelevanceWrapper state="gated-off" parentSettingLabel="Some parent">
        <input />
      </RelevanceWrapper>,
    );
    expect(container.querySelector(".hf-relevance-wrap--gated-off")).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });
});
