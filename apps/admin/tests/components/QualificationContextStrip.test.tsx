/**
 * QualificationContextStrip + QualificationSessionSummary — #1098 Slice C.
 *
 * Both reuse `useQualificationProgress`. We mock the hook so the components'
 * render logic can be unit-tested without faking fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import type { QualificationProgressData } from "@/hooks/useQualificationProgress";

const mockHook = vi.fn();
vi.mock("@/hooks/useQualificationProgress", () => ({
  useQualificationProgress: () => mockHook(),
}));

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
      qualificationBody: null,
      qualificationNumber: null,
      qualificationLevel: null,
      tier: "DEVELOPING",
      unitsCovered: 1,
      unitsTotal: 2,
      weakestUnitSlug: "standard-unit-09",
      losAtTierOrAbove: 4,
      losTotal: 12,
    },
    units: [
      {
        moduleSlug: "standard-unit-04",
        displayName: "IT Operations",
        tier: "PRACTITIONER",
        losCovered: 7,
        losTotal: 7,
        weakestLoRef: null,
        learningObjectives: [],
      },
      {
        moduleSlug: "standard-unit-09",
        displayName: "Enterprise Architecture",
        tier: "DEVELOPING",
        losCovered: 1,
        losTotal: 7,
        weakestLoRef: "OUT-09-05",
        learningObjectives: [],
      },
    ],
    skills: [],
    recentActivity: [],
    nextBestStep: null,
    ...overrides,
  };
}

describe("QualificationContextStrip — #1098 Slice C", () => {
  let QualificationContextStrip: typeof import("@/components/sim/qualification/QualificationContextStrip").QualificationContextStrip;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/components/sim/qualification/QualificationContextStrip");
    QualificationContextStrip = mod.QualificationContextStrip;
  });

  it("returns null when hook data is missing", () => {
    mockHook.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    const { container } = render(<QualificationContextStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when qualification is null (non-anchored Curriculum)", () => {
    mockHook.mockReturnValue({
      data: makeFixture({ qualification: null }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<QualificationContextStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("surfaces the requested moduleId's unit when matched in catalog", () => {
    mockHook.mockReturnValue({
      data: makeFixture(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getByText, container } = render(
      <QualificationContextStrip requestedModuleId="standard-unit-04" />,
    );
    expect(getByText("IT Operations")).toBeDefined();
    expect(getByText("Practitioner")).toBeDefined();
    // No focus LO surfaced because Unit 04 has weakestLoRef=null.
    expect(container.textContent).not.toContain("Focus:");
  });

  it("falls back to qualification.weakestUnitSlug when no requestedModuleId match", () => {
    mockHook.mockReturnValue({
      data: makeFixture(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getByText, container } = render(<QualificationContextStrip />);
    expect(getByText("Enterprise Architecture")).toBeDefined();
    expect(getByText("Developing")).toBeDefined();
    // Focus LO surfaced from the weakest unit.
    expect(container.textContent).toContain("Focus:");
    expect(getByText("OUT-09-05")).toBeDefined();
  });

  it("shows 'Not yet assessed' when the focus unit has no tier", () => {
    mockHook.mockReturnValue({
      data: makeFixture({
        units: [
          {
            moduleSlug: "u1",
            displayName: "Unit 1",
            tier: null,
            losCovered: 0,
            losTotal: 3,
            weakestLoRef: null,
            learningObjectives: [],
          },
        ],
        qualification: {
          ...makeFixture().qualification!,
          weakestUnitSlug: "u1",
        },
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getByText } = render(<QualificationContextStrip />);
    expect(getByText("Not yet assessed")).toBeDefined();
  });

  it("returns null when no focus unit can be derived (degenerate catalog)", () => {
    mockHook.mockReturnValue({
      data: makeFixture({
        qualification: { ...makeFixture().qualification!, weakestUnitSlug: null },
        units: [],
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<QualificationContextStrip />);
    expect(container.firstChild).toBeNull();
  });
});

describe("QualificationSessionSummary — #1098 Slice C", () => {
  let QualificationSessionSummary: typeof import("@/components/sim/qualification/QualificationContextStrip").QualificationSessionSummary;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/components/sim/qualification/QualificationContextStrip");
    QualificationSessionSummary = mod.QualificationSessionSummary;
  });

  it("returns null when loading and no data yet (no flash of empty card)", () => {
    mockHook.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    const { container } = render(<QualificationSessionSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when qualification is null", () => {
    mockHook.mockReturnValue({
      data: makeFixture({ qualification: null }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<QualificationSessionSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("refetches on first mount so AGGREGATE rollup is reflected", () => {
    const refetch = vi.fn();
    mockHook.mockReturnValue({
      data: makeFixture(),
      loading: false,
      error: null,
      refetch,
    });
    render(<QualificationSessionSummary />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders qualification anchor + tier + LO totals + focus unit", () => {
    mockHook.mockReturnValue({
      data: makeFixture(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { getByText, container } = render(<QualificationSessionSummary />);
    expect(getByText("The CIO/CTO Standard")).toBeDefined();
    expect(getByText("Developing")).toBeDefined();
    expect(getByText("4 of 12 Learning Outcomes")).toBeDefined();
    expect(getByText("Enterprise Architecture")).toBeDefined();
    expect(getByText("Developing on 1/7 LOs")).toBeDefined();
    expect(getByText("OUT-09-05")).toBeDefined();
    // Link to the full dashboard.
    const link = container.querySelector('a[href="/x/student/progress"]');
    expect(link).not.toBeNull();
  });

  it("omits the focus-unit line when no focus unit can be derived", () => {
    mockHook.mockReturnValue({
      data: makeFixture({
        qualification: { ...makeFixture().qualification!, weakestUnitSlug: null },
        units: [],
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { queryByText } = render(<QualificationSessionSummary />);
    // No unit name should appear when units list is empty AND weakestUnitSlug is null.
    expect(queryByText("Enterprise Architecture")).toBeNull();
    expect(queryByText("IT Operations")).toBeNull();
  });
});
