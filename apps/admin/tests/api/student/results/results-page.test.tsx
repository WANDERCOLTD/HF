/**
 * RTL smoke tests for /x/student/[courseId]/results/[sessionId] — Theme 13a
 * Mock Results page (#1751).
 *
 * Pinned acceptance:
 *   1. While `processing: true` → spinner + "Reviewing your exam…" copy
 *   2. After `processing: false` → renders overall band, strength chip, area
 *      chip, and 4 × 3 (criterion × part) table
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

vi.mock("next/navigation", () => ({
  useParams: () => ({ courseId: "course-1", sessionId: "sess-1" }),
}));

import MockResultsPage from "@/app/x/student/[courseId]/results/[sessionId]/page";

const PROCESSING_PAYLOAD = {
  ok: true,
  processing: true,
  sessionId: "sess-1",
  courseId: "course-1",
  courseTitle: "IELTS Speaking Practice",
  callerId: "caller-1",
  startedAt: "2026-06-16T10:00:00Z",
  endedAt: null,
  status: "STARTED",
  scores: [],
  overallBand: null,
  overallBandSource: null,
  strength: null,
  area: null,
};

const READY_PAYLOAD = {
  ok: true,
  processing: false,
  sessionId: "sess-1",
  courseId: "course-1",
  courseTitle: "IELTS Speaking Practice",
  callerId: "caller-1",
  startedAt: "2026-06-16T10:00:00Z",
  endedAt: "2026-06-16T10:14:00Z",
  status: "COMPLETED",
  scores: [
    { parameterId: "fc", parameterName: "Fluency & Coherence", segmentKey: "part1", score: 0.7, tier: "Secure", band: 6, count: 1 },
    { parameterId: "fc", parameterName: "Fluency & Coherence", segmentKey: "part2", score: 0.7, tier: "Secure", band: 6, count: 1 },
    { parameterId: "fc", parameterName: "Fluency & Coherence", segmentKey: "part3", score: 0.7, tier: "Secure", band: 6, count: 1 },
    { parameterId: "lr", parameterName: "Lexical Resource", segmentKey: "part1", score: 0.6, tier: "Developing", band: 5.5, count: 1 },
    { parameterId: "lr", parameterName: "Lexical Resource", segmentKey: "part2", score: 0.6, tier: "Developing", band: 5.5, count: 1 },
    { parameterId: "lr", parameterName: "Lexical Resource", segmentKey: "part3", score: 0.6, tier: "Developing", band: 5.5, count: 1 },
  ],
  overallBand: 6,
  overallBandSource: "computed",
  strength: { parameterId: "fc", parameterName: "Fluency & Coherence", band: 6 },
  area: { parameterId: "lr", parameterName: "Lexical Resource", band: 5.5 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MockResultsPage", () => {
  it("renders processing spinner while server is still scoring", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PROCESSING_PAYLOAD,
    } as unknown as Response);

    render(<MockResultsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Reviewing your exam/i)).toBeInTheDocument();
    });
  });

  it("renders overall band + strength/area chips + per-criterion table when ready", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => READY_PAYLOAD,
    } as unknown as Response);

    const { container } = render(<MockResultsPage />);

    await waitFor(() => {
      const hero = container.querySelector(".hf-results-hero-band");
      expect(hero?.textContent).toBe("6.0");
    });
    expect(screen.getByText("Strength")).toBeInTheDocument();
    expect(screen.getByText("Area to work on")).toBeInTheDocument();
    expect(screen.getAllByText("Fluency & Coherence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lexical Resource").length).toBeGreaterThan(0);
    // Per-criterion table headers
    expect(screen.getByText("part1")).toBeInTheDocument();
    expect(screen.getByText("part2")).toBeInTheDocument();
    expect(screen.getByText("part3")).toBeInTheDocument();
  });

  it("shows error banner when the API returns ok=false", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: "Forbidden — caller scope mismatch" }),
    } as unknown as Response);

    render(<MockResultsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/caller scope mismatch/i);
    });
  });
});
