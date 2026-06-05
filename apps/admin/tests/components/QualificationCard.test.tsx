/**
 * QualificationCard — #1098 Slice B.
 *
 * Renders against a fixture of `/api/student/qualification-progress`'s output.
 * Covers: header + tier pill, cold-start state, unit tiles, expand/collapse,
 * LO row tier classification, weakest-LO highlight, skills list, CTA visible
 * vs hidden (lens mode).
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import React from "react";
import { QualificationCard } from "@/components/student/qualification/QualificationCard";
import type { QualificationProgressData } from "@/hooks/useQualificationProgress";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function makeFixture(overrides?: Partial<QualificationProgressData>): QualificationProgressData {
  return {
    qualification: {
      anchor: "sias-cio-cto-v6",
      displayName: "The CIO/CTO Standard",
      qualificationBody: "SIAS",
      qualificationNumber: "603/0001/0",
      qualificationLevel: "Practitioner",
      tier: "PRACTITIONER",
      unitsCovered: 1,
      unitsTotal: 2,
      weakestUnitSlug: "standard-unit-09",
      losAtTierOrAbove: 3,
      losTotal: 4,
    },
    units: [
      {
        moduleSlug: "standard-unit-04",
        displayName: "IT Operations and Infrastructure",
        tier: "PRACTITIONER",
        losCovered: 2,
        losTotal: 2,
        weakestLoRef: null,
        learningObjectives: [
          { ref: "OUT-04-01", displayName: "Plan capacity", learnerStatement: "Plan capacity", tier: "PRACTITIONER", score: 0.7 },
          { ref: "OUT-04-02", displayName: "Recover from incidents", learnerStatement: "Recover", tier: "PRACTITIONER", score: 0.6 },
        ],
      },
      {
        moduleSlug: "standard-unit-09",
        displayName: "Enterprise and Business Architecture",
        tier: "DEVELOPING",
        losCovered: 1,
        losTotal: 2,
        weakestLoRef: "OUT-09-02",
        learningObjectives: [
          { ref: "OUT-09-01", displayName: "Define enterprise model", learnerStatement: "Define model", tier: "DEVELOPING", score: 0.4 },
          { ref: "OUT-09-02", displayName: "Map business capabilities", learnerStatement: "Map caps", tier: null, score: 0 },
        ],
      },
    ],
    skills: [
      { ref: "SKILL-01", name: "Stakeholder anticipation", tier: "PRACTITIONER" },
      { ref: "SKILL-02", name: "Risk articulation", tier: "DISTINCTION" },
      { ref: "SKILL-03", name: "Commercial framing", tier: "DEVELOPING" },
    ],
    recentActivity: [],
    nextBestStep: {
      courseType: "Revision Aid",
      moduleSlug: "standard-unit-09",
      loRef: "OUT-09-02",
      reason: "weakest LO in your weakest Unit",
    },
    ...overrides,
  };
}

describe("QualificationCard — #1098 Slice B", () => {
  it("returns null when data.qualification is null (non-anchored Curriculum)", () => {
    const { container } = render(
      <QualificationCard data={makeFixture({ qualification: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders header with qualification name, body + number, and tier pill", () => {
    const { getByText, container } = render(<QualificationCard data={makeFixture()} />);
    expect(getByText("The CIO/CTO Standard")).toBeDefined();
    expect(getByText(/SIAS · 603\/0001\/0/)).toBeDefined();
    expect(getByText(/on 3 of 4 Learning Outcomes/)).toBeDefined();
    // Tier pill is the styled badge inside the header — "Practitioner" appears
    // elsewhere too (unit tiles, LO rows) so scope to the pill element.
    const pill = container.querySelector(".hf-qualification-tier-pill");
    expect(pill?.textContent).toBe("Practitioner");
  });

  it("shows cold-start message when qualification.tier is null", () => {
    const data = makeFixture({
      qualification: {
        anchor: "sias-cio-cto-v6",
        displayName: "The CIO/CTO Standard",
        qualificationBody: null,
        qualificationNumber: null,
        qualificationLevel: null,
        tier: null,
        unitsCovered: 0,
        unitsTotal: 5,
        weakestUnitSlug: null,
        losAtTierOrAbove: 0,
        losTotal: 12,
      },
    });
    const { getByText } = render(<QualificationCard data={data} />);
    // Slice D — softened from "Not yet assessed" to "Ready to start" in the
    // header per ux-reviewer advisory B. Cold-start banner text unchanged.
    expect(getByText("Ready to start")).toBeDefined();
    expect(getByText(/Take your first call/)).toBeDefined();
  });

  it("renders one tile per unit with tier label and fraction", () => {
    const { getAllByRole, getByLabelText } = render(<QualificationCard data={makeFixture()} />);
    // Tiles are <button>s.
    const tiles = getAllByRole("button");
    // 2 unit tiles + 1 CTA button = at least 3. Filter by aria-label format.
    const unitTiles = tiles.filter((b) => (b.getAttribute("aria-label") ?? "").includes("learning outcomes"));
    expect(unitTiles.length).toBe(2);
    expect(getByLabelText(/IT Operations and Infrastructure — Practitioner, 2 of 2/)).toBeDefined();
    expect(getByLabelText(/Enterprise and Business Architecture — Developing, 1 of 2/)).toBeDefined();
  });

  it("expands the weakest Unit by default + highlights weakest LO", () => {
    const { container, getByText } = render(<QualificationCard data={makeFixture()} />);
    // standard-unit-09 is weakest → its LO list rendered.
    expect(getByText("Define enterprise model")).toBeDefined();
    expect(getByText("Map business capabilities")).toBeDefined();
    // Weakest LO row carries the weakest modifier class.
    const weakestRow = container.querySelector(".hf-qualification-lo-row--weakest");
    expect(weakestRow).not.toBeNull();
    expect(weakestRow?.textContent).toContain("OUT-09-02");
  });

  it("clicking a different Unit tile collapses the old + expands the new", () => {
    const { getByLabelText, queryByText } = render(<QualificationCard data={makeFixture()} />);
    // Switch from Unit 09 (weakest, default expanded) to Unit 04.
    fireEvent.click(getByLabelText(/IT Operations and Infrastructure/));
    // Unit 04 LOs now visible, Unit 09 LOs gone.
    expect(queryByText("Plan capacity")).not.toBeNull();
    expect(queryByText("Define enterprise model")).toBeNull();
  });

  it("renders skills sorted by tier DESC then name ASC", () => {
    const { container } = render(<QualificationCard data={makeFixture()} />);
    const skills = container.querySelectorAll(".hf-qualification-skill-name");
    const names = Array.from(skills).map((el) => el.textContent);
    // DISTINCTION (Risk articulation) > PRACTITIONER (Stakeholder anticipation) > DEVELOPING (Commercial framing)
    expect(names).toEqual([
      "Risk articulation",
      "Stakeholder anticipation",
      "Commercial framing",
    ]);
  });

  it("Slice D — CTA renders Unit DISPLAY NAME (not slug) + LO DISPLAY NAME (not ref)", () => {
    // ux-reviewer #2: the CTA must never expose a raw slug or ref. The
    // CTA pulls Unit + LO display names from the units catalog.
    const { getByText, getByRole, container, queryByText } = render(
      <QualificationCard data={makeFixture()} />,
    );
    // Unit display name: "Enterprise and Business Architecture", NOT "standard-unit-09"
    expect(getByText(/Revision Aid on Enterprise and Business Architecture/)).toBeDefined();
    // CTA region carries the LO display name ("Map business capabilities" from fixture).
    const ctaRegion = container.querySelector('[aria-label="Next best step"]');
    expect(ctaRegion).not.toBeNull();
    expect(ctaRegion!.textContent).toContain("Map business capabilities");
    // The raw slug must NOT appear in the CTA region.
    expect(ctaRegion!.textContent).not.toContain("standard-unit-09");
    // Reason still rendered.
    expect(getByText("weakest LO in your weakest Unit")).toBeDefined();
    // Slice D — CTA button copy changed from "Start call →" to "Practise this unit →".
    const cta = getByRole("link", { name: /Practise this unit/ });
    expect(cta.getAttribute("href")).toContain("standard-unit-09");
    // No raw ref text inside <code> any more.
    expect(queryByText("OUT-09-02", { selector: "code" })).toBeNull();
  });

  it("hides Next Best Step CTA when hideNextBestStep is true (educator lens mode)", () => {
    const { queryByText } = render(
      <QualificationCard data={makeFixture()} hideNextBestStep />,
    );
    expect(queryByText("Practise this unit →")).toBeNull();
    expect(queryByText("weakest LO in your weakest Unit")).toBeNull();
  });

  it("invokes onStartCall instead of navigating when handler is provided", () => {
    const handler = vi.fn();
    const { getByRole } = render(
      <QualificationCard data={makeFixture()} onStartCall={handler} />,
    );
    fireEvent.click(getByRole("button", { name: /Practise this unit/ }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(makeFixture().nextBestStep);
  });

  it("renders LO indicator glyphs per tier (✓ for Practitioner+, ◐ for lower, ◯ for null)", () => {
    const data = makeFixture({
      units: [
        {
          moduleSlug: "u",
          displayName: "Unit",
          tier: "DISTINCTION",
          losCovered: 3,
          losTotal: 3,
          weakestLoRef: null,
          learningObjectives: [
            { ref: "DIST", displayName: "Distinction LO", learnerStatement: "x", tier: "DISTINCTION", score: 0.9 },
            { ref: "PRAC", displayName: "Practitioner LO", learnerStatement: "x", tier: "PRACTITIONER", score: 0.6 },
            { ref: "DEV", displayName: "Developing LO", learnerStatement: "x", tier: "DEVELOPING", score: 0.4 },
            { ref: "NONE", displayName: "Untouched LO", learnerStatement: "x", tier: null, score: 0 },
          ],
        },
      ],
      qualification: {
        ...makeFixture().qualification!,
        tier: "DISTINCTION",
        weakestUnitSlug: "u",
      },
    });
    const { container } = render(<QualificationCard data={data} />);
    const indicators = container.querySelectorAll(".hf-qualification-lo-indicator");
    const glyphs = Array.from(indicators).map((el) => el.textContent);
    expect(glyphs).toEqual(["✓", "✓", "◐", "◯"]);
  });
});
