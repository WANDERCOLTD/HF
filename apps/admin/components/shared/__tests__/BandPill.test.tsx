/**
 * Tests for BandPill component (#437)
 *
 * @feature Banded ACHIEVE goal progress display
 * @scenario Render tier + band number pill for SKILL-NN ACHIEVE goals
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BandPill } from "../BandPill";

describe("BandPill", () => {
  it("renders the IELTS tier label", () => {
    render(<BandPill tier="Emerging" band={4} />);
    expect(screen.getByText("Emerging")).toBeInTheDocument();
  });

  it("renders the band number as an integer when whole", () => {
    render(<BandPill tier="Emerging" band={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders the band number with one decimal when fractional", () => {
    render(<BandPill tier="Developing" band={5.5} />);
    expect(screen.getByText("5.5")).toBeInTheDocument();
  });

  it("omits the band number when not provided", () => {
    render(<BandPill tier="Secure" />);
    expect(screen.getByText("Secure")).toBeInTheDocument();
    // The pill renders a single span (tier only)
    expect(screen.queryByText("7")).not.toBeInTheDocument();
  });

  it("uses the evidence string as the hover title when provided", () => {
    render(
      <BandPill
        tier="Developing"
        band={5.5}
        title="Skill score 0.62 / target 1.00 — currently at Developing"
      />,
    );
    expect(
      screen.getByTitle("Skill score 0.62 / target 1.00 — currently at Developing"),
    ).toBeInTheDocument();
  });

  it("falls back to band-N title when no evidence supplied", () => {
    render(<BandPill tier="Emerging" band={4} />);
    expect(screen.getByTitle("Band 4")).toBeInTheDocument();
  });

  // ── 4-tier coverage (per AC) ────────────────────────────────────────
  it.each([
    ["Approaching Emerging", 3],
    ["Emerging", 4],
    ["Developing", 5.5],
    ["Secure", 7],
  ])("renders IELTS tier %s with band %s", (tier, band) => {
    render(<BandPill tier={tier} band={band} />);
    expect(screen.getByText(tier)).toBeInTheDocument();
    expect(
      screen.getByText(Number.isInteger(band) ? String(band) : (band as number).toFixed(1)),
    ).toBeInTheDocument();
  });

  it("renders non-IELTS tier labels (e.g. CEFR — Story C) without crashing", () => {
    render(<BandPill tier="B1" band={3} />);
    expect(screen.getByText("B1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
