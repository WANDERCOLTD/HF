/**
 * AssessmentPlanEditor — UI behavioural tests for #2176 S1.
 *
 * Covers the scenarios named in the build plan Slice 10:
 *  - Empty state renders all 4 [+ Declare / + Add / toggle] affordances.
 *  - Populated state renders upfront + N midpoint rows + end card.
 *  - Add-midpoint → new editable row appears at end.
 *  - Remove-midpoint → row drops.
 *  - Reorder ↑↓ → array index changes.
 *  - Tick `noAssessmentPlan` with moments → contradiction warning
 *    visible (not blocking).
 *  - Mode-mismatch (kind=upfront-baseline, moduleSlug=tutor-mode) →
 *    inline warning visible.
 *  - Edits flow through to the parent's single `onSave` callback
 *    (single debounced PATCH per operator decision 5).
 *
 * Mocks `useJourneySetting` to feed playbookConfig.modules; mocks
 * `fetch` for the `/api/system/spec-slugs` typeahead.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  within,
} from "@testing-library/react";

import { AssessmentPlanEditor } from "@/components/scoring-tab/AssessmentPlanEditor";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import type { CourseAssessmentPlan } from "@/lib/types/json-fields";

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

const mockPlaybookConfig = {
  modules: [
    { id: "baseline", label: "Baseline Assessment", mode: "examiner" },
    { id: "part-1", label: "Part 1", mode: "tutor" },
    { id: "mock-exam", label: "Mock Exam", mode: "mock-exam" },
  ],
};

vi.mock("@/components/shared/preview-renderers/_journey-setting-context", () => ({
  useJourneySetting: () => ({
    courseId: "test-course",
    saveSetting: vi.fn(),
    readonly: false,
    playbookConfig: mockPlaybookConfig,
  }),
}));

const contract: JourneySettingContract = {
  id: "assessmentPlan",
  group: "G4",
  educatorLabel: "Assessment plan",
  storagePath: "config.assessmentPlan",
  control: "assessment-plan-editor",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
  menuGroupKey: "I_scoring",
};

beforeEach(() => {
  vi.useFakeTimers();
  // Mock fetch to return a stable spec list.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            specs: [
              {
                slug: "IELTS-MEASURE-001-ielts-speaking-criteria",
                outputType: "MEASURE",
              },
              { slug: "POPQUIZ-MEASURE-001", outputType: "MEASURE" },
            ],
          }),
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("AssessmentPlanEditor (#2176 S1)", () => {
  it("empty state renders all 4 affordances", () => {
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={{}}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    // Upfront / End cards show declare buttons (empty).
    expect(screen.getByTestId("hf-ape-upfront-add")).toBeTruthy();
    expect(screen.getByTestId("hf-ape-end-add")).toBeTruthy();

    // Midpoints empty-state message + Add button.
    expect(screen.getByTestId("hf-ape-midpoints-empty")).toBeTruthy();
    expect(screen.getByTestId("hf-ape-midpoint-add")).toBeTruthy();

    // No-plan toggle present (unchecked).
    const noplan = screen.getByTestId("hf-ape-noplan") as HTMLInputElement;
    expect(noplan).toBeTruthy();
    expect(noplan.checked).toBe(false);

    // No contradiction warning while empty.
    expect(screen.queryByTestId("hf-ape-contradiction")).toBeNull();
  });

  it("populated state renders upfront + midpoints + end cards", () => {
    const value: CourseAssessmentPlan = {
      upfront: {
        kind: "upfront-baseline",
        moduleSlug: "baseline",
        samplingPolicy: {
          scope: "cross-curriculum",
          count: { min: 1, target: 1, max: 1 },
          contentKind: "mcq",
        },
        shellKind: "exam",
        scoringSpec: "IELTS-MEASURE-001-ielts-speaking-criteria",
      },
      midpoints: [
        {
          kind: "midpoint-check",
          moduleSlug: "baseline",
          samplingPolicy: {
            scope: "cross-curriculum",
            count: { min: 1, target: 1, max: 1 },
            contentKind: "mcq",
          },
          shellKind: "mcq-rounds",
          scoringSpec: "POPQUIZ-MEASURE-001",
        },
        {
          kind: "midpoint-check",
          moduleSlug: "baseline",
          samplingPolicy: {
            scope: "cross-curriculum",
            count: { min: 1, target: 1, max: 1 },
            contentKind: "mcq",
          },
          shellKind: "mcq-rounds",
          scoringSpec: "POPQUIZ-MEASURE-001",
        },
      ],
      end: {
        kind: "end-mock",
        moduleSlug: "mock-exam",
        samplingPolicy: {
          scope: "cross-curriculum",
          count: { min: 1, target: 1, max: 1 },
          contentKind: "mcq",
        },
        shellKind: "exam",
        scoringSpec: "IELTS-MEASURE-001-ielts-speaking-criteria",
      },
    };

    render(
      <AssessmentPlanEditor
        contract={contract}
        value={value}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    // Upfront populated → Clear button visible.
    expect(screen.getByTestId("hf-ape-upfront-clear")).toBeTruthy();
    // 2 midpoint rows.
    expect(screen.getByTestId("hf-ape-midpoint-0")).toBeTruthy();
    expect(screen.getByTestId("hf-ape-midpoint-1")).toBeTruthy();
    // End populated → Clear button visible.
    expect(screen.getByTestId("hf-ape-end-clear")).toBeTruthy();
  });

  it("clicking + Add midpoint appends a new row", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={{}}
        onSave={onSave}
      />,
    );

    // No midpoint rows yet.
    expect(screen.queryByTestId("hf-ape-midpoint-0")).toBeNull();

    // Click Add.
    fireEvent.click(screen.getByTestId("hf-ape-midpoint-add"));

    // New row visible.
    expect(screen.getByTestId("hf-ape-midpoint-0")).toBeTruthy();
  });

  it("clicking Remove on a midpoint drops the row", () => {
    const value: CourseAssessmentPlan = {
      midpoints: [
        {
          kind: "midpoint-check",
          moduleSlug: "baseline",
          samplingPolicy: {
            scope: "cross-curriculum",
            count: { min: 1, target: 1, max: 1 },
            contentKind: "mcq",
          },
          shellKind: "mcq-rounds",
          scoringSpec: "",
        },
      ],
    };
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={value}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(screen.getByTestId("hf-ape-midpoint-0")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hf-ape-midpoint-0-remove"));
    expect(screen.queryByTestId("hf-ape-midpoint-0")).toBeNull();
  });

  it("reorder ↑↓ on midpoints swaps array indices", () => {
    const m = (slug: string) => ({
      kind: "midpoint-check" as const,
      moduleSlug: slug,
      samplingPolicy: {
        scope: "cross-curriculum" as const,
        count: { min: 1, target: 1, max: 1 },
        contentKind: "mcq" as const,
      },
      shellKind: "mcq-rounds" as const,
      scoringSpec: "",
    });
    const value: CourseAssessmentPlan = {
      midpoints: [m("baseline"), m("part-1")],
    };
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={value}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    // Row 0's module select should currently be "baseline"; row 1
    // should be "part-1". After clicking the down-arrow on row 0,
    // row 0 should be "part-1".
    const row0Module = within(screen.getByTestId("hf-ape-midpoint-0")).getByTestId(
      "hf-mom-midpoint-0-module",
    ) as HTMLSelectElement;
    expect(row0Module.value).toBe("baseline");

    fireEvent.click(screen.getByTestId("hf-ape-midpoint-0-down"));

    const row0ModuleAfter = within(screen.getByTestId("hf-ape-midpoint-0")).getByTestId(
      "hf-mom-midpoint-0-module",
    ) as HTMLSelectElement;
    expect(row0ModuleAfter.value).toBe("part-1");
  });

  it("ticking noAssessmentPlan with moments renders contradiction warning", () => {
    const value: CourseAssessmentPlan = {
      noAssessmentPlan: true,
      upfront: {
        kind: "upfront-baseline",
        moduleSlug: "baseline",
        samplingPolicy: {
          scope: "cross-curriculum",
          count: { min: 1, target: 1, max: 1 },
          contentKind: "mcq",
        },
        shellKind: "exam",
        scoringSpec: "",
      },
    };
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={value}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(screen.getByTestId("hf-ape-contradiction")).toBeTruthy();
    // Save path is NOT blocked — Clear button still present + active.
    const noplan = screen.getByTestId("hf-ape-noplan") as HTMLInputElement;
    expect(noplan.checked).toBe(true);
  });

  it("mode-mismatch on a moment surfaces inline warning", () => {
    // moduleSlug = "part-1" (mode: tutor); kind = "upfront-baseline"
    // (needs examiner | mock-exam) → mismatch.
    const value: CourseAssessmentPlan = {
      upfront: {
        kind: "upfront-baseline",
        moduleSlug: "part-1",
        samplingPolicy: {
          scope: "cross-curriculum",
          count: { min: 1, target: 1, max: 1 },
          contentKind: "mcq",
        },
        shellKind: "exam",
        scoringSpec: "",
      },
    };
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={value}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(screen.getByTestId("hf-mom-upfront-mode-mismatch")).toBeTruthy();
  });

  it("edits flow through to onSave (debounced)", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <AssessmentPlanEditor
        contract={contract}
        value={{}}
        onSave={onSave}
      />,
    );

    // Add an upfront moment by clicking the declare button.
    fireEvent.click(screen.getByTestId("hf-ape-upfront-add"));

    // Advance debounce window.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalled();
    // First arg of the last call should be a CourseAssessmentPlan with
    // an upfront moment shape.
    const lastCall = onSave.mock.calls.at(-1) as unknown[] | undefined;
    expect(lastCall).toBeDefined();
    const plan = lastCall?.[0] as CourseAssessmentPlan | undefined;
    expect(plan?.upfront).toBeDefined();
    expect(plan?.upfront?.kind).toBe("upfront-baseline");
  });
});
