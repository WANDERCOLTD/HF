import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Home from "@/app/page";
import type { FohStudentProgressResponse } from "@/app/api/student-progress/route";

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
});
