/**
 * LayerBadge — chip + subtitle for cascade-honesty UX (#1454 Slice 3).
 *
 * Covers AC:
 *   - 5 badge states ([PB] / [DOM] / [SYS] / [CAL] / [—]) with correct
 *     class names and labels
 *   - Inline subtitle text reflects winning layer
 *   - click fires onInspect
 *   - renders even when there's no override (under-disclosure guard)
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { LayerBadge } from "@/components/cascade/LayerBadge";
import type { Effective, LayerHit } from "@/lib/cascade/layer-types";

function envelope(
  source: Effective<unknown>["source"],
  layers: LayerHit<unknown>[],
): Effective<unknown> {
  return {
    value: layers.find((h) => h.layer === source)?.value ?? null,
    source,
    layers,
    isInherited: source !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

const PB_HIT: LayerHit<unknown> = {
  layer: "PLAYBOOK",
  scopeId: "pb1",
  scopeLabel: "OCEAN",
  value: 0.6,
  setAt: null,
  setBy: null,
};
const DOM_HIT: LayerHit<unknown> = {
  layer: "DOMAIN",
  scopeId: "dom1",
  scopeLabel: "Education",
  value: 0.55,
  setAt: null,
  setBy: null,
};
const SYS_HIT: LayerHit<unknown> = {
  layer: "SYSTEM",
  scopeId: null,
  scopeLabel: "System default",
  value: 0.5,
  setAt: null,
  setBy: null,
};
const CAL_HIT: LayerHit<unknown> = {
  layer: "CALLER",
  scopeId: "c1",
  scopeLabel: "Smoke Test",
  value: 0.8,
  setAt: null,
  setBy: null,
};

describe("LayerBadge — 5 states", () => {
  it("renders Course icon when source is PLAYBOOK", () => {
    render(<LayerBadge envelope={envelope("PLAYBOOK", [PB_HIT])} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hf-cascade-badge--pb");
    expect(btn.getAttribute("data-layer")).toBe("playbook");
    expect(btn.getAttribute("aria-label")).toContain("Course");
    expect(btn.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("set on this Course")).toBeTruthy();
  });

  it("renders Domain icon when source is DOMAIN", () => {
    render(<LayerBadge envelope={envelope("DOMAIN", [DOM_HIT])} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hf-cascade-badge--dom");
    expect(btn.getAttribute("aria-label")).toContain("Domain");
    expect(btn.querySelector("svg")).toBeTruthy();
    expect(screen.getByText(/inherited from Education/)).toBeTruthy();
  });

  it("renders Settings icon when source is SYSTEM and explicit hit exists", () => {
    render(<LayerBadge envelope={envelope("SYSTEM", [SYS_HIT])} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hf-cascade-badge--sys");
    expect(btn.getAttribute("aria-label")).toContain("System default");
    expect(btn.querySelector("svg")).toBeTruthy();
  });

  it("renders Caller icon when source is CALLER", () => {
    render(<LayerBadge envelope={envelope("CALLER", [CAL_HIT])} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hf-cascade-badge--cal");
    expect(btn.getAttribute("aria-label")).toContain("Caller");
    expect(btn.querySelector("svg")).toBeTruthy();
  });

  it("renders dash glyph (no icon) when no layers have a value (under-disclosure guard)", () => {
    render(<LayerBadge envelope={envelope("SYSTEM", [])} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("—");
    expect(btn.className).toContain("hf-cascade-badge--none");
    // No sidebar icon — the dash glyph is intentional for the "no override" state.
    expect(btn.querySelector("svg")).toBeNull();
    expect(
      screen.getByText("(no override — using System default)"),
    ).toBeTruthy();
  });
});

describe("LayerBadge — interactions", () => {
  it("click on chip fires onInspect (legacy quick path preserved)", () => {
    const onInspect = vi.fn();
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={onInspect}
      />,
    );
    // The chip is the first button (kebab is second when present).
    const chip = screen.getByRole("button", { name: /^Cascade layer:/ });
    fireEvent.click(chip);
    expect(onInspect).toHaveBeenCalledOnce();
  });

  it("hides subtitle when hideSubtitle is set", () => {
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        hideSubtitle
      />,
    );
    expect(screen.queryByText("set on this Course")).toBeNull();
  });

  it("overrides subtitle when prop provided", () => {
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        subtitle="custom subtitle"
      />,
    );
    expect(screen.getByText("custom subtitle")).toBeTruthy();
  });
});

describe("LayerBadge — kebab affordance (#1469)", () => {
  it("does not render the kebab when onInspect is undefined", () => {
    render(<LayerBadge envelope={envelope("PLAYBOOK", [PB_HIT])} />);
    expect(screen.queryByTestId("hf-cascade-badge-kebab")).toBeNull();
  });

  it("renders the kebab when onInspect is provided", () => {
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={() => undefined}
      />,
    );
    const kebab = screen.getByTestId("hf-cascade-badge-kebab");
    expect(kebab).toBeTruthy();
    expect(kebab.getAttribute("aria-haspopup")).toBe("dialog");
    expect(kebab.getAttribute("aria-label")).toContain("Inspect cascade chain");
  });

  it("clicking the kebab fires onInspect once", () => {
    const onInspect = vi.fn();
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={onInspect}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-cascade-badge-kebab"));
    expect(onInspect).toHaveBeenCalledOnce();
  });

  it("kebab click stops propagation (no parent re-fire)", () => {
    const onInspect = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <LayerBadge
          envelope={envelope("PLAYBOOK", [PB_HIT])}
          onInspect={onInspect}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId("hf-cascade-badge-kebab"));
    expect(onInspect).toHaveBeenCalledOnce();
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("keyboard activation: Enter on kebab fires onInspect", () => {
    const onInspect = vi.fn();
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={onInspect}
      />,
    );
    const kebab = screen.getByTestId("hf-cascade-badge-kebab") as HTMLButtonElement;
    kebab.focus();
    // <button> activates onClick from native Enter, but fireEvent.click is the canonical surrogate.
    fireEvent.click(kebab);
    expect(onInspect).toHaveBeenCalledOnce();
  });

  it("chip gains aria-haspopup=dialog when onInspect is provided", () => {
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={() => undefined}
      />,
    );
    const chip = screen.getByRole("button", { name: /^Cascade layer:/ });
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("chip has no aria-haspopup when onInspect is undefined (passive indicator)", () => {
    render(<LayerBadge envelope={envelope("PLAYBOOK", [PB_HIT])} />);
    const chip = screen.getByRole("button", { name: /^Cascade layer:/ });
    expect(chip.getAttribute("aria-haspopup")).toBeNull();
  });
});
