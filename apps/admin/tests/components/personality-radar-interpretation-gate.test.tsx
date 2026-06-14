/**
 * Tests for PersonalityRadar interpretation-tooltip gate — #1664
 * (Epic #1606 Group C Phase 3).
 *
 * Decision 5: interpretation strings are OPERATOR-only. The radar
 * tooltip suppresses interpretationHigh/Low text for STUDENT-level
 * sessions; numeric value + label still render so the chart stays
 * useful.
 *
 * Pinned acceptance:
 *   1. STUDENT session → tooltip omits interpretation strings.
 *   2. OPERATOR session → tooltip includes interpretationHigh when
 *      value ≥ 0.6 and interpretationLow when value < 0.4.
 *   3. Trait label + percentage always render regardless of role.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

import { PersonalityRadar } from "@/components/shared/PersonalityRadar";

function makeTraits() {
  return [
    {
      id: "B5-O",
      label: "Openness",
      value: 0.85,
      color: "#000",
      interpretationHigh: "OPERATOR_ONLY_HIGH_TEXT_O",
      interpretationLow: "OPERATOR_ONLY_LOW_TEXT_O",
    },
    {
      id: "B5-C",
      label: "Conscientiousness",
      value: 0.25,
      color: "#000",
      interpretationHigh: "OPERATOR_ONLY_HIGH_TEXT_C",
      interpretationLow: "OPERATOR_ONLY_LOW_TEXT_C",
    },
    {
      id: "B5-E",
      label: "Extraversion",
      value: 0.5,
      color: "#000",
      interpretationHigh: "OPERATOR_ONLY_HIGH_TEXT_E",
      interpretationLow: "OPERATOR_ONLY_LOW_TEXT_E",
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PersonalityRadar — interpretation gate (#1664 Decision 5)", () => {
  it("STUDENT session: tooltip <title> elements do NOT contain interpretation strings", () => {
    mockUseSession.mockReturnValue({ data: { user: { role: "STUDENT" } } });
    const { container } = render(
      <PersonalityRadar traits={makeTraits()} animated={false} />,
    );
    const tooltipText = Array.from(container.querySelectorAll("title"))
      .map((el) => el.textContent ?? "")
      .join(" ");
    // Labels + percentages still render
    expect(tooltipText).toContain("Openness");
    expect(tooltipText).toContain("85%");
    expect(tooltipText).toContain("Conscientiousness");
    expect(tooltipText).toContain("25%");
    // Interpretation strings explicitly absent
    expect(tooltipText).not.toContain("OPERATOR_ONLY_HIGH_TEXT_O");
    expect(tooltipText).not.toContain("OPERATOR_ONLY_LOW_TEXT_C");
  });

  it("OPERATOR session: tooltip includes interpretationHigh when value ≥ 0.6 and interpretationLow when value < 0.4", () => {
    mockUseSession.mockReturnValue({ data: { user: { role: "OPERATOR" } } });
    const { container } = render(
      <PersonalityRadar traits={makeTraits()} animated={false} />,
    );
    const tooltipText = Array.from(container.querySelectorAll("title"))
      .map((el) => el.textContent ?? "")
      .join(" ");
    // Openness value 0.85 ≥ 0.6 → high interpretation rendered
    expect(tooltipText).toContain("OPERATOR_ONLY_HIGH_TEXT_O");
    // Conscientiousness value 0.25 < 0.4 → low interpretation rendered
    expect(tooltipText).toContain("OPERATOR_ONLY_LOW_TEXT_C");
    // Extraversion at 0.5 sits in the middle band — neither high nor low
    // text rendered for it.
    expect(tooltipText).not.toContain("OPERATOR_ONLY_HIGH_TEXT_E");
    expect(tooltipText).not.toContain("OPERATOR_ONLY_LOW_TEXT_E");
  });

  it("STUDENT vs OPERATOR: numeric value + label render in both modes", () => {
    mockUseSession.mockReturnValue({ data: { user: { role: "STUDENT" } } });
    const { container: studentContainer } = render(
      <PersonalityRadar traits={makeTraits()} animated={false} />,
    );
    const studentText = Array.from(studentContainer.querySelectorAll("title"))
      .map((el) => el.textContent ?? "")
      .join(" ");
    cleanup();

    mockUseSession.mockReturnValue({ data: { user: { role: "OPERATOR" } } });
    const { container: operatorContainer } = render(
      <PersonalityRadar traits={makeTraits()} animated={false} />,
    );
    const operatorText = Array.from(operatorContainer.querySelectorAll("title"))
      .map((el) => el.textContent ?? "")
      .join(" ");

    for (const t of makeTraits()) {
      expect(studentText).toContain(t.label);
      expect(operatorText).toContain(t.label);
      const pct = `${Math.round(t.value * 100)}%`;
      expect(studentText).toContain(pct);
      expect(operatorText).toContain(pct);
    }
  });
});
