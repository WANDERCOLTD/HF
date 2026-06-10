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
  it("renders [PB] when source is PLAYBOOK", () => {
    render(<LayerBadge envelope={envelope("PLAYBOOK", [PB_HIT])} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("PB");
    expect(btn.className).toContain("hf-cascade-badge--pb");
    expect(screen.getByText("set on this Playbook")).toBeTruthy();
  });

  it("renders [DOM] when source is DOMAIN", () => {
    render(<LayerBadge envelope={envelope("DOMAIN", [DOM_HIT])} />);
    expect(screen.getByRole("button").textContent).toBe("DOM");
    expect(screen.getByText(/inherited from Education/)).toBeTruthy();
  });

  it("renders [SYS] when source is SYSTEM and explicit hit exists", () => {
    render(<LayerBadge envelope={envelope("SYSTEM", [SYS_HIT])} />);
    expect(screen.getByRole("button").textContent).toBe("SYS");
  });

  it("renders [CAL] when source is CALLER", () => {
    render(<LayerBadge envelope={envelope("CALLER", [CAL_HIT])} />);
    expect(screen.getByRole("button").textContent).toBe("CAL");
  });

  it("renders [—] when no layers have a value (under-disclosure guard)", () => {
    render(<LayerBadge envelope={envelope("SYSTEM", [])} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("—");
    expect(btn.className).toContain("hf-cascade-badge--none");
    expect(
      screen.getByText("(no override — using System default)"),
    ).toBeTruthy();
  });
});

describe("LayerBadge — interactions", () => {
  it("click fires onInspect", () => {
    const onInspect = vi.fn();
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        onInspect={onInspect}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onInspect).toHaveBeenCalledOnce();
  });

  it("hides subtitle when hideSubtitle is set", () => {
    render(
      <LayerBadge
        envelope={envelope("PLAYBOOK", [PB_HIT])}
        hideSubtitle
      />,
    );
    expect(screen.queryByText("set on this Playbook")).toBeNull();
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
