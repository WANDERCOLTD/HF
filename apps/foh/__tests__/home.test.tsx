import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Home, { computeUnlockState } from "@/app/page";
import type {
  FohModuleCard,
  FohStudentProgressResponse,
} from "@/app/api/student-progress/route";

describe("Front-of-house home", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function mockFetch(payload: FohStudentProgressResponse): void {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the HumanFirst heading", async () => {
    mockFetch({ ok: true, modules: [], lessonPlan: null, nextRecommended: null });
    render(<Home />);
    expect(
      screen.getByRole("heading", { name: /HumanFirst/i }),
    ).toBeInTheDocument();
  });

  it("renders module cards with the recommended module highlighted", async () => {
    mockFetch({
      ok: true,
      modules: [
        { slug: "part1", title: "Part 1 — Familiar Topics", status: "IN_PROGRESS" },
        { slug: "part2", title: "Part 2 — Long Turn", status: "NOT_STARTED" },
      ],
      lessonPlan: {
        focusCriterion: "skill_fluency_and_coherence_fc",
        focusLabel: "Fluency and Coherence",
        focusScore: 0.55,
        reason: "Fluency and Coherence scored lowest.",
        nextRecommendedModuleSlug: "part1",
        emittedAt: "2026-06-22T10:00:00Z",
      },
      nextRecommended: { moduleSlug: "part1", fromSessionId: "sess-1" },
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Part 1 — Familiar Topics")).toBeInTheDocument();
    });

    const part1 = screen.getByText("Part 1 — Familiar Topics").closest("a");
    expect(part1).toHaveAttribute("data-next-module-slug", "part1");
    expect(part1).toHaveAttribute("aria-current", "true");

    const part2 = screen.getByText("Part 2 — Long Turn").closest("a");
    expect(part2).not.toHaveAttribute("data-next-module-slug");
  });

  it("renders next-session banner when lesson plan is present", async () => {
    mockFetch({
      ok: true,
      modules: [{ slug: "part1", title: "Part 1", status: "IN_PROGRESS" }],
      lessonPlan: {
        focusCriterion: "skill_fluency_and_coherence_fc",
        focusLabel: "Fluency and Coherence",
        focusScore: 0.55,
        reason: "Strengthening this lifts your band fastest.",
        nextRecommendedModuleSlug: "part1",
        emittedAt: "2026-06-22T10:00:00Z",
      },
      nextRecommended: { moduleSlug: "part1", fromSessionId: "sess-1" },
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByTestId("next-session-banner")).toBeInTheDocument();
    });
    expect(screen.getByText(/Focus area: Fluency and Coherence/)).toBeInTheDocument();
  });

  it("hides the next-session banner when no lesson plan exists", async () => {
    mockFetch({ ok: true, modules: [], lessonPlan: null, nextRecommended: null });
    render(<Home />);
    await waitFor(() => {
      expect(screen.queryByText(/Loading your modules/)).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("next-session-banner")).not.toBeInTheDocument();
  });

  // #2318 MT-essential — locked-module render.
  it("renders a Locked badge + tooltip on Mock when prereqs are unmet", async () => {
    mockFetch({
      ok: true,
      modules: [
        {
          slug: "baseline",
          title: "Baseline Assessment",
          status: "MASTERED",
          prerequisites: [],
          completedCount: 1,
        },
        {
          slug: "part1",
          title: "Part 1",
          status: "IN_PROGRESS",
          prerequisites: ["baseline"],
          completedCount: 1,
        },
        {
          slug: "mock",
          title: "Full Mock Exam",
          status: "NOT_STARTED",
          prerequisites: [
            { moduleId: "baseline", minCompletions: 1 },
            { moduleId: "part1", minCompletions: 2 },
            { moduleId: "part3", minCompletions: 2 },
          ],
          completedCount: 0,
        },
      ],
      lessonPlan: null,
      nextRecommended: null,
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Full Mock Exam")).toBeInTheDocument();
    });

    const mockCard = screen.getByText("Full Mock Exam").closest('[data-module-slug="mock"]');
    expect(mockCard).toHaveAttribute("data-locked", "true");
    expect(mockCard).toHaveAttribute("aria-disabled", "true");
    expect(mockCard?.getAttribute("title")).toMatch(/Complete 1 more × Part 1/);
    expect(mockCard?.getAttribute("title")).toMatch(/Complete 2 more × part3/);
  });

  it("renders Part 1/2/3 cards locked until baseline is COMPLETED", async () => {
    mockFetch({
      ok: true,
      modules: [
        {
          slug: "baseline",
          title: "Baseline Assessment",
          status: "NOT_STARTED",
          prerequisites: [],
          completedCount: 0,
        },
        {
          slug: "part1",
          title: "Part 1",
          status: "NOT_STARTED",
          prerequisites: ["baseline"],
          completedCount: 0,
        },
      ],
      lessonPlan: null,
      nextRecommended: null,
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Part 1")).toBeInTheDocument();
    });

    const part1Card = screen.getByText("Part 1").closest('[data-module-slug="part1"]');
    expect(part1Card).toHaveAttribute("data-locked", "true");
    expect(part1Card?.getAttribute("title")).toMatch(/Complete Baseline Assessment first/);
  });

  it("does NOT lock modules with no prerequisites (baseline is the entry gate)", async () => {
    mockFetch({
      ok: true,
      modules: [
        {
          slug: "baseline",
          title: "Baseline Assessment",
          status: "NOT_STARTED",
          prerequisites: [],
          completedCount: 0,
        },
      ],
      lessonPlan: null,
      nextRecommended: null,
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Baseline Assessment")).toBeInTheDocument();
    });

    const baselineCard = screen.getByText("Baseline Assessment").closest("a");
    expect(baselineCard).not.toBeNull();
    expect(baselineCard).toHaveAttribute("href", "/sim?module=baseline");
  });
});

// #2318 MT-essential — pure-function parity vs the admin-side resolver.
// Mirrors `apps/admin/lib/curriculum/check-module-unlock.ts::isModuleUnlocked`
// for the STUDENT-tier behavioural surface (the only one FOH renders).
describe("computeUnlockState (#2318 — parity with admin resolver)", () => {
  const baseline: FohModuleCard = {
    slug: "baseline",
    title: "Baseline",
    status: "MASTERED",
    prerequisites: [],
    completedCount: 1,
  };

  it("unlocks a module with no prerequisites", () => {
    const result = computeUnlockState(baseline, [baseline]);
    expect(result.unlocked).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("unlocks a string-form prereq once the sibling is COMPLETED (≥ 1)", () => {
    const part1: FohModuleCard = {
      slug: "part1",
      title: "Part 1",
      status: "NOT_STARTED",
      prerequisites: ["baseline"],
      completedCount: 0,
    };
    const result = computeUnlockState(part1, [baseline, part1]);
    expect(result.unlocked).toBe(true);
  });

  it("locks a string-form prereq when the sibling has 0 completions", () => {
    const empty: FohModuleCard = { ...baseline, completedCount: 0 };
    const part1: FohModuleCard = {
      slug: "part1",
      title: "Part 1",
      status: "NOT_STARTED",
      prerequisites: ["baseline"],
      completedCount: 0,
    };
    const result = computeUnlockState(part1, [empty, part1]);
    expect(result.unlocked).toBe(false);
    expect(result.missing).toEqual([
      { moduleId: "baseline", required: 1, actual: 0 },
    ]);
  });

  it("locks count-based prereqs when below minCompletions", () => {
    const mock: FohModuleCard = {
      slug: "mock",
      title: "Mock",
      status: "NOT_STARTED",
      prerequisites: [
        { moduleId: "baseline", minCompletions: 1 },
        { moduleId: "part1", minCompletions: 2 },
        { moduleId: "part3", minCompletions: 2 },
      ],
      completedCount: 0,
    };
    const part1: FohModuleCard = {
      slug: "part1",
      title: "Part 1",
      status: "IN_PROGRESS",
      completedCount: 1,
    };
    const part3: FohModuleCard = {
      slug: "part3",
      title: "Part 3",
      status: "NOT_STARTED",
      completedCount: 0,
    };
    const result = computeUnlockState(mock, [baseline, part1, part3, mock]);
    expect(result.unlocked).toBe(false);
    expect(result.missing).toEqual([
      { moduleId: "part1", required: 2, actual: 1 },
      { moduleId: "part3", required: 2, actual: 0 },
    ]);
  });

  it("unlocks count-based prereqs when all minCompletions met", () => {
    const mock: FohModuleCard = {
      slug: "mock",
      title: "Mock",
      status: "NOT_STARTED",
      prerequisites: [
        { moduleId: "baseline", minCompletions: 1 },
        { moduleId: "part1", minCompletions: 2 },
        { moduleId: "part3", minCompletions: 2 },
      ],
      completedCount: 0,
    };
    const part1: FohModuleCard = {
      slug: "part1",
      title: "Part 1",
      status: "MASTERED",
      completedCount: 3,
    };
    const part3: FohModuleCard = {
      slug: "part3",
      title: "Part 3",
      status: "MASTERED",
      completedCount: 2,
    };
    const result = computeUnlockState(mock, [baseline, part1, part3, mock]);
    expect(result.unlocked).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("drops malformed prereq entries silently (defensive)", () => {
    const broken: FohModuleCard = {
      slug: "x",
      title: "X",
      status: "NOT_STARTED",
      prerequisites: [
        null as unknown as string,
        42 as unknown as string,
        { minCompletions: 2 } as unknown as { moduleId: string; minCompletions: number },
      ],
      completedCount: 0,
    };
    const result = computeUnlockState(broken, [broken]);
    expect(result.unlocked).toBe(true);
  });
});
