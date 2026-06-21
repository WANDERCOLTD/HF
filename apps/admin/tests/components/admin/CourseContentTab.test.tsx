/**
 * Tests for the Content tab skeleton (#2204 / U2 of #2185).
 *
 * Pins:
 *  1. The tab mounts with mock typed-content data and renders the LH
 *     intent groups (MCQ Bank / Cue Cards / Topic Prompts / Scenario
 *     Probes / Reflection Prompts) with per-group counts.
 *  2. Clicking an LH group switches the RHS detail to that kind's items.
 *  3. Filter chips (module + source) narrow the RHS list.
 *  4. Empty states render distinctly when (a) the kind has no data and
 *     (b) the active filter hides every item.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";

// jsdom doesn't ship matchMedia; the DesignerShell that CourseContentTab
// composes relies on it for the narrow-viewport drawer behaviour. Stub
// once for the whole file. Mirrors the pattern in
// `tests/components/designer-shell.test.tsx`.
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { CourseContentTab } from "@/app/x/courses/[courseId]/CourseContentTab";

const COURSE_ID = "course-content-1";

function makePayload() {
  return {
    ok: true,
    courseId: COURSE_ID,
    groups: {
      mcqs: [
        {
          id: "mcq-1",
          questionText: "What is the capital of France?",
          source: { sourceId: "src-a", sourceName: "Source A" },
          learningOutcomeRef: "LO-1",
          difficulty: 2,
        },
        {
          id: "mcq-2",
          questionText: "What is 2 + 2?",
          source: { sourceId: "src-b", sourceName: "Source B" },
          learningOutcomeRef: null,
          difficulty: 1,
        },
      ],
      cueCards: [
        {
          id: "mod-1:cue:0",
          topic: "Describe a memorable trip",
          bullets: ["where you went", "who you were with", "what you did"],
          module: { moduleId: "mod-1", moduleLabel: "Part 2 Monologue" },
        },
        {
          id: "mod-2:cue:0",
          topic: "Describe a hobby",
          bullets: ["how you started", "why you enjoy it"],
          module: { moduleId: "mod-2", moduleLabel: "Practice Set" },
        },
      ],
      topicPrompts: [
        {
          id: "mod-1:topic:0",
          topic: "Travel",
          questions: ["How often do you travel?", "Where would you go next?"],
          module: { moduleId: "mod-1", moduleLabel: "Part 2 Monologue" },
        },
      ],
      scenarioProbes: [],
      reflectionPrompts: [],
    },
    modules: [
      { moduleId: "mod-1", moduleLabel: "Part 2 Monologue" },
      { moduleId: "mod-2", moduleLabel: "Practice Set" },
    ],
    sources: [
      { sourceId: "src-a", sourceName: "Source A" },
      { sourceId: "src-b", sourceName: "Source B" },
    ],
  };
}

function makeEmptyPayload() {
  return {
    ok: true,
    courseId: COURSE_ID,
    groups: {
      mcqs: [],
      cueCards: [],
      topicPrompts: [],
      scenarioProbes: [],
      reflectionPrompts: [],
    },
    modules: [],
    sources: [],
  };
}

describe("<CourseContentTab> — Content tab skeleton (#2204)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  function mockFetch(payload: unknown) {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/typed-content")) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      throw new Error(`Unmocked fetch: ${u}`);
    }) as unknown as typeof fetch;
  }

  it("mounts with mock data and renders all 5 LH intent groups with counts", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-lh-picker")).toBeDefined();
    });

    // Five intent groups present.
    expect(screen.getByTestId("hf-content-lh-row-mcqs")).toBeDefined();
    expect(screen.getByTestId("hf-content-lh-row-cueCards")).toBeDefined();
    expect(screen.getByTestId("hf-content-lh-row-topicPrompts")).toBeDefined();
    expect(
      screen.getByTestId("hf-content-lh-row-scenarioProbes"),
    ).toBeDefined();
    expect(
      screen.getByTestId("hf-content-lh-row-reflectionPrompts"),
    ).toBeDefined();

    // Counts surface correctly.
    const mcqRow = screen.getByTestId("hf-content-lh-row-mcqs");
    expect(mcqRow.textContent).toContain("MCQ Bank");
    expect(mcqRow.textContent).toContain("2");

    const cueRow = screen.getByTestId("hf-content-lh-row-cueCards");
    expect(cueRow.textContent).toContain("Cue Cards");
    expect(cueRow.textContent).toContain("2");

    const scenarioRow = screen.getByTestId("hf-content-lh-row-scenarioProbes");
    expect(scenarioRow.textContent).toContain("0");
  });

  it("defaults to MCQ Bank on first mount", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    // First MCQ rendered.
    expect(screen.getByTestId("hf-content-mcq-mcq-1")).toBeDefined();
    expect(screen.getByTestId("hf-content-mcq-mcq-2")).toBeDefined();
  });

  it("clicking an LH group switches the RHS detail content", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("hf-content-lh-row-cueCards"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-cueCards")).toBeDefined();
    });

    // RHS now shows cue-card rows, not MCQ rows.
    expect(screen.getByTestId("hf-content-cue-mod-1:cue:0")).toBeDefined();
    expect(screen.queryByTestId("hf-content-mcq-mcq-1")).toBeNull();
  });

  it("renders source filter chips on MCQ Bank and narrows the list when one is active", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    // Source chip group present.
    expect(screen.getByTestId("hf-content-filter-source")).toBeDefined();
    expect(screen.getByTestId("hf-content-chip-source-all")).toBeDefined();
    expect(screen.getByTestId("hf-content-chip-source-src-a")).toBeDefined();

    // Click Source A chip; only Source A MCQs should remain.
    fireEvent.click(screen.getByTestId("hf-content-chip-source-src-a"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-mcq-mcq-1")).toBeDefined();
    });
    expect(screen.queryByTestId("hf-content-mcq-mcq-2")).toBeNull();
  });

  it("renders module filter chips on Cue Cards and narrows the list when one is active", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("hf-content-lh-row-cueCards"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-filter-module")).toBeDefined();
    });

    expect(screen.getByTestId("hf-content-chip-module-all")).toBeDefined();
    expect(screen.getByTestId("hf-content-chip-module-mod-1")).toBeDefined();

    // Filter to mod-1 only.
    fireEvent.click(screen.getByTestId("hf-content-chip-module-mod-1"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-cue-mod-1:cue:0")).toBeDefined();
    });
    expect(screen.queryByTestId("hf-content-cue-mod-2:cue:0")).toBeNull();
  });

  it("renders the no-data empty state when no items exist for the selected kind", async () => {
    mockFetch(makePayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-lh-picker")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("hf-content-lh-row-scenarioProbes"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-empty-no-data")).toBeDefined();
    });
  });

  it("renders the filtered-empty state when an active filter hides every item", async () => {
    // Payload: one MCQ tied to src-a only — filtering by src-b empties the list.
    const payload = makePayload();
    payload.groups.mcqs = [
      {
        id: "mcq-only-a",
        questionText: "Source A only question",
        source: { sourceId: "src-a", sourceName: "Source A" },
        learningOutcomeRef: null,
        // null here would type-narrow against the makePayload literal —
        // use a real number so the array shape matches verbatim.
        difficulty: 1,
      },
    ];
    mockFetch(payload);
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("hf-content-chip-source-src-b"));

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-empty-filtered")).toBeDefined();
    });
  });

  it("renders an overall empty state when the course has zero content of any kind", async () => {
    mockFetch(makeEmptyPayload());
    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-detail-mcqs")).toBeDefined();
    });

    expect(screen.getByTestId("hf-content-empty-no-data")).toBeDefined();
  });

  it("renders the error banner when the route returns ok: false", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ ok: false, error: "Course not found" }),
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    render(<CourseContentTab courseId={COURSE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("hf-content-error")).toBeDefined();
    });
  });
});
