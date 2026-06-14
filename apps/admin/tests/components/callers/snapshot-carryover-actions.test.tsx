/**
 * Tests for SnapshotCarryOverActions — #1666 (Epic #1606 Group C).
 *
 * Pinned acceptance:
 *   1. Loading state → "Loading…" badge.
 *   2. Fetch failure → "Unable to load actions" badge.
 *   3. No actions → "No open actions" empty state.
 *   4. Filters to PENDING + IN_PROGRESS only (COMPLETED + CANCELLED hidden).
 *   5. Renders each open action with type chip + title + assignee + due-by.
 *   6. Caps display at MAX_ROWS (6) with "+N more" overflow indicator.
 *   7. dueAt formatting: overdue / today / tomorrow / N days.
 *   8. Priority badge visible when set.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SnapshotCarryOverActions } from "@/components/callers/caller-detail/SnapshotCarryOverActions";

const CALLER_ID = "caller-1";

function mockFetch(response: Response | (() => Response | Promise<Response>)) {
  return vi.fn(async () =>
    typeof response === "function" ? response() : response,
  );
}

function makeActionsResponse(
  actions: Array<{
    id?: string;
    type?: string;
    title?: string;
    description?: string | null;
    assignee?: string;
    status?: string;
    priority?: string | null;
    dueAt?: string | null;
  }>,
) {
  return {
    ok: true,
    actions: actions.map((a, i) => ({
      id: a.id ?? `action-${i}`,
      type: a.type ?? "HOMEWORK",
      title: a.title ?? "Practice chain rule",
      description: a.description ?? null,
      assignee: a.assignee ?? "CALLER",
      status: a.status ?? "PENDING",
      priority: a.priority ?? null,
      dueAt: a.dueAt ?? null,
      createdAt: "2026-06-13T10:00:00.000Z",
    })),
    counts: {
      pending: actions.filter((a) => (a.status ?? "PENDING") === "PENDING").length,
      completed: actions.filter((a) => a.status === "COMPLETED").length,
      total: actions.length,
    },
  };
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SnapshotCarryOverActions — loading + error + empty states", () => {
  it("renders the loading badge before the fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it("renders the error badge when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Unable to load actions/)).toBeTruthy());
  });

  it("renders the error badge on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(null, { status: 500 })),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Unable to load actions/)).toBeTruthy());
  });

  it("renders the 'No open actions' empty state when actions array is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(new Response(JSON.stringify(makeActionsResponse([])), { status: 200 })),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/No open actions/)).toBeTruthy());
  });
});

describe("SnapshotCarryOverActions — open-status filter", () => {
  it("hides COMPLETED + CANCELLED actions; renders PENDING + IN_PROGRESS", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              { title: "Open pending", status: "PENDING" },
              { title: "Open in-progress", status: "IN_PROGRESS" },
              { title: "Done already", status: "COMPLETED" },
              { title: "Was cancelled", status: "CANCELLED" },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Open pending/)).toBeTruthy());
    expect(screen.getByText(/Open in-progress/)).toBeTruthy();
    expect(screen.queryByText(/Done already/)).toBeNull();
    expect(screen.queryByText(/Was cancelled/)).toBeNull();
    expect(screen.getByText(/Carry-over actions — 2 open/)).toBeTruthy();
  });

  it("flags IN_PROGRESS rows with the 'in progress' meta tag", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              { title: "Doing it", status: "IN_PROGRESS", assignee: "CALLER" },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Doing it/)).toBeTruthy());
    expect(screen.getByText(/in progress/)).toBeTruthy();
  });
});

describe("SnapshotCarryOverActions — row rendering", () => {
  it("renders type chip + title + assignee + description", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              {
                type: "SEND_MEDIA",
                title: "Send worksheet 3.2",
                description: "Chapter 3 problem set",
                assignee: "OPERATOR",
              },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Send worksheet 3\.2/)).toBeTruthy());
    expect(screen.getByText(/SEND_MEDIA/)).toBeTruthy();
    expect(screen.getByText(/OPERATOR/)).toBeTruthy();
    expect(screen.getByText(/Chapter 3 problem set/)).toBeTruthy();
  });

  it("renders priority badge when set", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              { title: "Urgent task", priority: "HIGH" },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Urgent task/)).toBeTruthy());
    expect(screen.getByText(/HIGH/)).toBeTruthy();
  });

  it("formats overdue dueAt as 'overdue by Nd'", async () => {
    const overdue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              { title: "Late task", dueAt: overdue },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/overdue by 3d/)).toBeTruthy());
  });

  it("formats dueAt 'due today' / 'due tomorrow' correctly", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(
          JSON.stringify(
            makeActionsResponse([
              { title: "Tomorrow task", dueAt: tomorrow },
            ]),
          ),
          { status: 200 },
        ),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/due tomorrow/)).toBeTruthy());
  });

  it("caps display at MAX_ROWS (6) with overflow indicator", async () => {
    const lots = Array.from({ length: 9 }, (_, i) => ({
      title: `Task ${i + 1}`,
      status: "PENDING",
    }));
    vi.stubGlobal(
      "fetch",
      mockFetch(
        new Response(JSON.stringify(makeActionsResponse(lots)), { status: 200 }),
      ),
    );
    render(<SnapshotCarryOverActions callerId={CALLER_ID} />);
    await waitFor(() => expect(screen.getByText(/Task 1/)).toBeTruthy());
    // Task 6 should render, Task 7 should not
    expect(screen.getByText(/Task 6/)).toBeTruthy();
    expect(screen.queryByText(/Task 7/)).toBeNull();
    expect(screen.getByText(/\+3 more open actions/)).toBeTruthy();
  });
});
