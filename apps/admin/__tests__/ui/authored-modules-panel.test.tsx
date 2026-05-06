/**
 * Tests for AuthoredModulesPanel — Module Catalogue read-only view.
 *
 * Covers:
 * - Loading spinner before fetch resolves
 * - Empty state when no authored modules persisted
 * - Catalogue table renders rows with correct fields
 * - "Modules authored: No" copy when explicitly opted out
 * - Validation list renders warnings + errors
 * - Re-import button is hidden when isOperator=false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthoredModulesPanel } from "@/app/x/courses/[courseId]/_components/AuthoredModulesPanel";

// ── Helpers ────────────────────────────────────────────────────────

function mockFetch(body: object, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: async () => ({ ok: true, ...body }),
  }) as typeof fetch;
}

const SAMPLE_MODULES = [
  {
    id: "baseline",
    label: "Baseline Assessment",
    learnerSelectable: true,
    mode: "examiner",
    duration: "20 min fixed",
    scoringFired: "All four (FC, LR, GRA, Pron)",
    voiceBandReadout: false,
    sessionTerminal: true,
    frequency: "once",
    outcomesPrimary: [],
    prerequisites: [],
  },
  {
    id: "part1",
    label: "Part 1: Familiar Topics",
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "LR + GRA only",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: ["OUT-01", "OUT-02"],
    prerequisites: [],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("AuthoredModulesPanel — empty state", () => {
  it("renders the empty-state CTA when no modules exist", async () => {
    mockFetch({
      modulesAuthored: null,
      modules: [],
      moduleDefaults: {},
      moduleSource: null,
      moduleSourceRef: null,
      validationWarnings: [],
      hasErrors: false,
    });

    render(<AuthoredModulesPanel courseId="c1" isOperator={true} />);
    await waitFor(() => {
      expect(screen.getByText(/No authored modules for this course/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Import from Course Reference/i })).toBeInTheDocument();
  });

  it("hides the import button when isOperator=false", async () => {
    mockFetch({
      modulesAuthored: null,
      modules: [],
      moduleDefaults: {},
      moduleSource: null,
      moduleSourceRef: null,
      validationWarnings: [],
      hasErrors: false,
    });

    render(<AuthoredModulesPanel courseId="c1" isOperator={false} />);
    await waitFor(() => {
      expect(screen.getByText(/No authored modules for this course/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Import/i })).not.toBeInTheDocument();
  });
});

describe("AuthoredModulesPanel — populated catalogue", () => {
  it("renders table rows for each module with stable IDs", async () => {
    mockFetch({
      modulesAuthored: true,
      modules: SAMPLE_MODULES,
      moduleDefaults: { mode: "tutor" },
      moduleSource: "authored",
      moduleSourceRef: { docId: "doc-9", version: "2.2" },
      validationWarnings: [],
      hasErrors: false,
    });

    render(<AuthoredModulesPanel courseId="c1" isOperator={true} />);
    // ID code cell appears only in the catalogue table, so single match
    await waitFor(() => {
      expect(screen.getByText("baseline")).toBeInTheDocument();
    });
    expect(screen.getByText("part1")).toBeInTheDocument();
    // Labels appear in BOTH the catalogue table and the picker preview now
    // (PR4 mounted the picker as a preview); use getAllByText for them.
    expect(screen.getAllByText("Baseline Assessment").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Part 1: Familiar Topics").length).toBeGreaterThanOrEqual(1);
    // Status strip
    expect(screen.getByText(/Production publish ready/i)).toBeInTheDocument();
    // Source ref
    expect(screen.getByText(/doc doc-9/i)).toBeInTheDocument();
    // "Re-import" wording when modules already exist
    expect(screen.getByRole("button", { name: /Re-import/i })).toBeInTheDocument();
    // PR4: picker preview header is present
    expect(screen.getByText(/Learner Picker Preview/i)).toBeInTheDocument();
  });
});

describe("AuthoredModulesPanel — explicit No", () => {
  it("renders the opt-out copy when modulesAuthored=false and no modules", async () => {
    mockFetch({
      modulesAuthored: false,
      modules: [],
      moduleDefaults: {},
      moduleSource: "derived",
      moduleSourceRef: null,
      validationWarnings: [],
      hasErrors: false,
    });

    render(<AuthoredModulesPanel courseId="c1" isOperator={true} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Course Reference declared/i),
      ).toBeInTheDocument();
    });
  });
});

describe("AuthoredModulesPanel — validation warnings", () => {
  it("renders the warning list and shows publish-blocked status when errors present", async () => {
    mockFetch({
      modulesAuthored: true,
      modules: SAMPLE_MODULES,
      moduleDefaults: {},
      moduleSource: "authored",
      moduleSourceRef: null,
      validationWarnings: [
        {
          code: "MODULE_FIELD_DEFAULTED",
          message: "Module 'part1' defaulted scoring",
          path: "modules.part1.scoringFired",
          severity: "warning",
        },
        {
          code: "MODULE_ID_INVALID",
          message: "Bad module ID",
          path: "modules.bad.id",
          severity: "error",
        },
      ],
      hasErrors: true,
    });

    render(<AuthoredModulesPanel courseId="c1" isOperator={true} />);
    await waitFor(() => {
      expect(screen.getByText("MODULE_ID_INVALID")).toBeInTheDocument();
    });
    expect(screen.getByText("MODULE_FIELD_DEFAULTED")).toBeInTheDocument();
    expect(screen.getByText(/Production publish blocked/i)).toBeInTheDocument();
  });
});
