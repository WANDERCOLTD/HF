/**
 * ScopePicker — Slice 3 of #1454.
 *
 * Covers AC:
 *   - PLAYBOOK / DOMAIN / SEGMENT / CALLER radios render
 *   - DOMAIN selection shows the exact fanout warning copy from ADR §3.4
 *   - CALLER selection shows the exact persistence warning copy
 *   - SEGMENT is disabled with reason
 *   - Stage button fires onStage with the selected layer + scopeId
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import {
  ScopePicker,
  SCOPE_PICKER_WARNINGS,
} from "@/components/cascade/ScopePicker";

const OPTIONS = [
  { layer: "PLAYBOOK" as const, scopeId: "pb1", scopeLabel: "OCEAN" },
  { layer: "DOMAIN" as const, scopeId: "dom1", scopeLabel: "Education" },
  { layer: "SEGMENT" as const, scopeId: null, scopeLabel: "(no segments)" },
  { layer: "CALLER" as const, scopeId: "c1", scopeLabel: "Smoke Test" },
];

describe("ScopePicker — exact warning copy", () => {
  it("DOMAIN selection shows the ADR §3.4 fanout warning verbatim", () => {
    render(
      <ScopePicker
        knobLabel="Warmth"
        value={0.8}
        options={OPTIONS}
        initialLayer="DOMAIN"
        onStage={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(`⚠ ${SCOPE_PICKER_WARNINGS.DOMAIN}`)).toBeTruthy();
  });

  it("CALLER selection shows the persistence warning verbatim", () => {
    render(
      <ScopePicker
        knobLabel="Warmth"
        value={0.8}
        options={OPTIONS}
        initialLayer="CALLER"
        onStage={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(`⚠ ${SCOPE_PICKER_WARNINGS.CALLER}`)).toBeTruthy();
  });
});

describe("ScopePicker — SEGMENT disabled", () => {
  it("SEGMENT is disabled with the Sprint-1 reason copy", () => {
    render(
      <ScopePicker
        knobLabel="Warmth"
        value={0.8}
        options={OPTIONS}
        onStage={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(SCOPE_PICKER_WARNINGS.SEGMENT_DISABLED),
    ).toBeTruthy();
    const segmentLabel = screen
      .getAllByRole("radio")
      .find((r) => (r as HTMLInputElement).value === "SEGMENT");
    expect(segmentLabel).toBeTruthy();
    expect((segmentLabel as HTMLInputElement).disabled).toBe(true);
  });
});

describe("ScopePicker — actions", () => {
  it("Stage button fires onStage with selected layer + scopeId", () => {
    const onStage = vi.fn();
    render(
      <ScopePicker
        knobLabel="Warmth"
        value={0.8}
        options={OPTIONS}
        onStage={onStage}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Stage override"));
    expect(onStage).toHaveBeenCalledWith({
      layer: "PLAYBOOK",
      scopeId: "pb1",
      scopeLabel: "OCEAN",
    });
  });

  it("Cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ScopePicker
        knobLabel="Warmth"
        value={0.8}
        options={OPTIONS}
        onStage={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
