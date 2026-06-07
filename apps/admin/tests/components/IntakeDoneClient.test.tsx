/**
 * Tests for IntakeDoneClient — the post-intake recap page that
 * triggers the join flow.
 *
 * Pre-fix the "Continue to course" button was an `<a href="/join/[token]?...">`.
 * The browser navigated to /join/[token], which rendered a visible
 * page and auto-submitted a form. That flash + the subsequent form-
 * POST-then-redirect pattern were the suspects in the post-enrol
 * "Caller not found" race (#1247).
 *
 * Now the button POSTs directly to /api/join/[token] and uses
 * router.push to land at /x/sim/<callerId> with the session cookie
 * already committed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
import React from "react";

const mockPush = vi.fn();
const mockGet = vi.fn();
const mockFetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => mockGet(k) }),
}));

// IntakeCoCPanel pulls in tallyseal types we don't need to render here.
vi.mock("@/components/intake/IntakeCoCPanel", () => ({
  IntakeCoCPanel: () => <div data-testid="coc-panel-stub" />,
}));

global.fetch = mockFetch as unknown as typeof fetch;

import { IntakeDoneClient } from "@/components/intake/IntakeDoneClient";

function mockSessionFetch(snapshotValues: Record<string, unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/intake/session/")) {
      return {
        ok: true,
        json: async () => ({
          intentId: "intent-1",
          state: "committed",
          events: [],
          values: snapshotValues,
        }),
      } as unknown as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockGet.mockReset();
  mockFetch.mockReset();
  mockGet.mockImplementation((k: string) =>
    k === "intentId" ? "intent-1" : k === "token" ? "tok-abc" : null,
  );
});

describe("IntakeDoneClient — Continue to course (no visible /join flash)", () => {
  it("POSTs captured values directly to /api/join/[token] and router.push to /x/sim/<callerId>", async () => {
    mockSessionFetch({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
      classroomToken: "tok-abc",
    });

    await act(async () => {
      render(<IntakeDoneClient />);
    });

    await waitFor(() => expect(screen.getByTestId("intake-done-continue")).toBeDefined());

    // Swap fetch's behaviour for the join POST.
    let joinBodySeen: unknown = null;
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/join/")) {
        joinBodySeen = init?.body ? JSON.parse(String(init.body)) : null;
        return {
          ok: true,
          json: async () => ({
            ok: true,
            callerId: "caller-new",
            redirect: "/x/sim/caller-new",
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("intake-done-continue"));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/x/sim/caller-new"));
    expect(joinBodySeen).toEqual({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
    });
    // Continue button never produced an `<a href="/join/...">` nav.
    expect(screen.getByTestId("intake-done-continue").tagName).toBe("BUTTON");
  });

  it("surfaces the server's error message when the join POST fails", async () => {
    mockSessionFetch({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
    });

    await act(async () => {
      render(<IntakeDoneClient />);
    });

    await waitFor(() => expect(screen.getByTestId("intake-done-continue")).toBeDefined());

    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/join/")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({ ok: false, error: "cohort full" }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("intake-done-continue"));
    });

    await waitFor(() => expect(screen.getByTestId("intake-done-join-error")).toBeDefined());
    expect(screen.getByTestId("intake-done-join-error").textContent).toContain("cohort full");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("falls back to a friendly status message when the server returns no error string", async () => {
    mockSessionFetch({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
    });

    await act(async () => {
      render(<IntakeDoneClient />);
    });
    await waitFor(() => expect(screen.getByTestId("intake-done-continue")).toBeDefined());

    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/join/")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("intake-done-continue"));
    });

    await waitFor(() => expect(screen.getByTestId("intake-done-join-error")).toBeDefined());
    expect(screen.getByTestId("intake-done-join-error").textContent).toMatch(/500/);
  });

  it("hides the Continue button when no token is in the URL (platform demo path)", async () => {
    mockGet.mockImplementation((k: string) => (k === "intentId" ? "intent-1" : null));
    mockSessionFetch({});

    await act(async () => {
      render(<IntakeDoneClient />);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("intake-done-summary")).toBeDefined(),
    );
    expect(screen.queryByTestId("intake-done-continue")).toBeNull();
  });
});
