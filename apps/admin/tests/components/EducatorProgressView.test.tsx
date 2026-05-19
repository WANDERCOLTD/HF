/**
 * #493 Slice 5.5 — Tests for EducatorProgressView.
 *
 * The component is the educator-side READ-ONLY mirror of SimProgressPanel.
 * It reuses the same `useStudentProgress` hook, so we mock the hook and
 * assert presentation only — no API contact.
 *
 * Coverage:
 *   - Loading state shows hf-spinner
 *   - Error state shows error message in hf-banner-error
 *   - Null / empty data shows hf-empty
 *   - Course-complete renders as a stat line, NOT a celebratory hero
 *   - Modules render with status badges (Mastered / In progress / Not started)
 *   - Diagnostic-from-mock renders strength, focus-next, weak-skill
 *   - Goals, Stats, Test scores, Recent topics all render when present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StudentProgress } from "@/hooks/useStudentProgress";

// ── Hook mock ──────────────────────────────────────────────────────
// Configurable per-test by mutating the `mockResult` object before render.

interface HookResult {
  data: StudentProgress | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const mockResult: HookResult = {
  data: null,
  loading: false,
  error: null,
  refresh: () => {},
};

vi.mock("@/hooks/useStudentProgress", () => ({
  useStudentProgress: () => mockResult,
}));

// Import AFTER the mock is registered so the component picks up the mock.
import { EducatorProgressView } from "@/components/educator/EducatorProgressView";

// ── Fixtures ───────────────────────────────────────────────────────

const FULL_DATA: StudentProgress = {
  goals: [
    { id: "g1", name: "Reach Band 7 overall", type: "BAND", progress: 0.4, description: null },
  ],
  totalCalls: 8,
  topicCount: 3,
  keyFactCount: 12,
  topTopics: [
    { topic: "Education", lastMentioned: "2026-05-10" },
    { topic: "Family", lastMentioned: "2026-05-09" },
  ],
  testScores: {
    preTest: 55,
    postTest: 72,
    uplift: { absolute: 17, normalised: null },
  },
  classroom: "Cohort A",
  domain: "ielts",
  teacherName: "Alex",
  institutionName: "Test Academy",
  modules: [
    {
      id: "m1",
      slug: "part-1",
      title: "Part 1: Familiar Topics",
      status: "MASTERED",
      callCount: 4,
      mastery: 0.82,
      masteryThreshold: 0.7,
      completedAt: "2026-05-12T10:00:00Z",
    },
    {
      id: "m2",
      slug: "part-2",
      title: "Part 2: Long Turn",
      status: "IN_PROGRESS",
      callCount: 2,
      mastery: 0.55,
      masteryThreshold: 0.7,
      completedAt: null,
    },
    {
      id: "m3",
      slug: "part-3",
      title: "Part 3: Discussion",
      status: "NOT_STARTED",
      callCount: 0,
      mastery: 0,
      masteryThreshold: 0.7,
      completedAt: null,
    },
  ],
  diagnosticFromMock: {
    focusModules: [
      { id: "m3", slug: "part-3", title: "Part 3: Discussion" },
    ],
    strengthModule: { id: "m1", slug: "part-1", title: "Part 1: Familiar Topics" },
    weakSkill: "pronunciation",
    summary: "Strongest in Part 1; focus next on Part 3.",
    fromCallId: "call-123",
    generatedAt: "2026-05-12T10:00:00Z",
  },
  courseComplete: null,
};

function resetHook(): void {
  mockResult.data = null;
  mockResult.loading = false;
  mockResult.error = null;
  mockResult.refresh = () => {};
}

beforeEach(() => {
  resetHook();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("EducatorProgressView — loading / error / empty", () => {
  it("renders the hf-spinner while loading", () => {
    mockResult.loading = true;
    const { container } = render(<EducatorProgressView callerId="c1" />);
    expect(container.querySelector(".hf-spinner")).not.toBeNull();
  });

  it("renders an error banner when the hook reports an error", () => {
    mockResult.error = "Failed to load progress (500)";
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.getByTestId("epv-error")).toHaveTextContent(
      /Failed to load progress \(500\)/i,
    );
  });

  it("renders hf-empty when data is null", () => {
    mockResult.data = null;
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.getByTestId("epv-empty")).toBeInTheDocument();
  });

  it("renders hf-empty when learner has no activity at all", () => {
    mockResult.data = {
      ...FULL_DATA,
      goals: [],
      totalCalls: 0,
      topicCount: 0,
      modules: [],
      diagnosticFromMock: null,
      courseComplete: null,
      testScores: { preTest: null, postTest: null, uplift: null },
      topTopics: [],
    };
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.getByTestId("epv-empty")).toHaveTextContent(
      /No progress data yet/i,
    );
  });
});

describe("EducatorProgressView — course completion", () => {
  it("renders course-complete as a stat line, NOT a celebratory hero", () => {
    mockResult.data = {
      ...FULL_DATA,
      courseComplete: {
        complete: true,
        mode: "terminal-only",
        completedAt: "2026-03-15T00:00:00Z",
      },
    };
    render(<EducatorProgressView callerId="c1" />);
    const row = screen.getByTestId("epv-course-complete");
    expect(row).toHaveTextContent(/Course complete/i);
    expect(row).toHaveTextContent(/completed/i);
    // Assert this is NOT the learner-side hero: no "Course complete!" with
    // exclamation, no celebratory wa-progress-course-complete class.
    expect(row.className).toMatch(/epv-course-complete/);
    expect(row.className).not.toMatch(/wa-progress-course-complete/);
    expect(row.textContent ?? "").not.toMatch(/Course complete!/);
  });

  it("does not render the course-complete row when complete=false", () => {
    mockResult.data = {
      ...FULL_DATA,
      courseComplete: { complete: false, mode: "terminal-only", completedAt: null },
    };
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.queryByTestId("epv-course-complete")).toBeNull();
  });
});

describe("EducatorProgressView — modules section", () => {
  it("renders one row per module with the correct status badge", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const section = screen.getByTestId("epv-modules");
    expect(section).toHaveTextContent("Part 1: Familiar Topics");
    expect(section).toHaveTextContent("Part 2: Long Turn");
    expect(section).toHaveTextContent("Part 3: Discussion");
    expect(section).toHaveTextContent(/Mastered/);
    expect(section).toHaveTextContent(/In progress/);
    expect(section).toHaveTextContent(/Not started/);
  });

  it("surfaces the EMA-mastery info badge per module row", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const section = screen.getByTestId("epv-modules");
    // EMA values come from fixture: 0.82 / 0.70 threshold, 0.55 / 0.70, 0.00 / 0.70
    expect(section).toHaveTextContent(/EMA mastery 0\.82 \/ 0\.70 threshold/);
    expect(section).toHaveTextContent(/EMA mastery 0\.55 \/ 0\.70 threshold/);
  });
});

describe("EducatorProgressView — diagnostic from mock", () => {
  it("renders the diagnostic section with strength + focus-next + weak-skill", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const section = screen.getByTestId("epv-diagnostic");
    expect(section).toHaveTextContent(/Last Mock diagnostic/i);
    expect(section).toHaveTextContent(/Strongest in Part 1/i);
    expect(section).toHaveTextContent(/Strength:/);
    expect(section).toHaveTextContent("Part 1: Familiar Topics");
    expect(section).toHaveTextContent(/Focus next:/);
    expect(section).toHaveTextContent("Part 3: Discussion");
    expect(section).toHaveTextContent(/Weakest skill:/);
    expect(section).toHaveTextContent("pronunciation");
  });

  it("omits the diagnostic section entirely when null", () => {
    mockResult.data = { ...FULL_DATA, diagnosticFromMock: null };
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.queryByTestId("epv-diagnostic")).toBeNull();
  });
});

describe("EducatorProgressView — goals / stats / test scores / topics", () => {
  it("renders goals when present", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const goals = screen.getByTestId("epv-goals");
    expect(goals).toHaveTextContent("Reach Band 7 overall");
    expect(goals).toHaveTextContent("40%");
  });

  it("renders the stats grid with calls / topics / key facts", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const stats = screen.getByTestId("epv-stats");
    expect(stats).toHaveTextContent(/Calls/);
    expect(stats).toHaveTextContent(/Topics/);
    expect(stats).toHaveTextContent(/Key facts/);
    expect(stats).toHaveTextContent("8");
    expect(stats).toHaveTextContent("12");
  });

  it("renders test scores when pre/post exist", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const tests = screen.getByTestId("epv-test-scores");
    expect(tests).toHaveTextContent(/Pre-test/);
    expect(tests).toHaveTextContent(/Post-test/);
    expect(tests).toHaveTextContent("55%");
    expect(tests).toHaveTextContent("72%");
  });

  it("renders recent topics when present", () => {
    mockResult.data = FULL_DATA;
    render(<EducatorProgressView callerId="c1" />);
    const topics = screen.getByTestId("epv-recent-topics");
    expect(topics).toHaveTextContent("Education");
    expect(topics).toHaveTextContent("Family");
  });

  it("omits sections that have no data", () => {
    mockResult.data = {
      ...FULL_DATA,
      goals: [],
      testScores: { preTest: null, postTest: null, uplift: null },
      topTopics: [],
      diagnosticFromMock: null,
    };
    render(<EducatorProgressView callerId="c1" />);
    expect(screen.queryByTestId("epv-goals")).toBeNull();
    expect(screen.queryByTestId("epv-test-scores")).toBeNull();
    expect(screen.queryByTestId("epv-recent-topics")).toBeNull();
    expect(screen.queryByTestId("epv-diagnostic")).toBeNull();
    // Modules section still present because fixture has modules.
    expect(screen.getByTestId("epv-modules")).toBeInTheDocument();
  });
});
