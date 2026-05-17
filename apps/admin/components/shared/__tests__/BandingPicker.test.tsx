/**
 * Tests for BandingPicker (#439 Story C)
 *
 * Covers preset switching + the onChange contract (IELTS default ⇒ undefined,
 * everything else ⇒ explicit mapping).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BandingPicker } from "../BandingPicker";

describe("BandingPicker (#439)", () => {
  it("defaults to IELTS preset when value is undefined", () => {
    const onChange = vi.fn();
    render(<BandingPicker value={undefined} onChange={onChange} />);
    const ieltsChip = screen.getByText("IELTS Speaking");
    expect(ieltsChip.className).toContain("hf-chip-selected");
  });

  it("emits undefined when IELTS is picked (no override stored)", () => {
    const onChange = vi.fn();
    render(<BandingPicker value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("CEFR"));
    onChange.mockClear();
    fireEvent.click(screen.getByText("IELTS Speaking"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("emits the CEFR mapping when CEFR is picked", () => {
    const onChange = vi.fn();
    render(<BandingPicker value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("CEFR"));
    expect(onChange).toHaveBeenCalled();
    const mapping = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(mapping).toMatchObject({
      thresholds: { secure: 1.0 },
      tierBands: { secure: 6 }, // CEFR top band is "C2" → 6
      tierLabels: { secure: "C2" },
    });
  });

  it("emits the 5-Level mapping when 5-Level is picked", () => {
    const onChange = vi.fn();
    render(<BandingPicker value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("5-Level"));
    const mapping = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(mapping.tierLabels.secure).toBe("Expert");
  });

  it("reveals the JSON editor when Custom is picked", () => {
    const onChange = vi.fn();
    render(<BandingPicker value={undefined} onChange={onChange} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Custom"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("detects an incoming CEFR-shaped value and selects the CEFR chip", () => {
    const cefr = {
      thresholds: { approachingEmerging: 0.3, emerging: 0.5, developing: 0.75, secure: 1.0 },
      tierBands: { approachingEmerging: 2, emerging: 3, developing: 4, secure: 6 },
      tierLabels: { secure: "C2" },
    };
    render(<BandingPicker value={cefr} onChange={() => {}} />);
    const chip = screen.getByText("CEFR");
    expect(chip.className).toContain("hf-chip-selected");
  });
});
