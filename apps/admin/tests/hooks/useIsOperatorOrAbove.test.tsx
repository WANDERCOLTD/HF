/**
 * Tests for `useIsOperatorOrAbove` — #1664 (Epic #1606 Group C
 * Phase 3, final story).
 *
 * Pinned acceptance:
 *   1. Unauthenticated session → false (safe default for the
 *      interpretation-chip sweep).
 *   2. STUDENT / VIEWER / TESTER / DEMO sessions → false.
 *   3. OPERATOR / EDUCATOR session → true.
 *   4. ADMIN / SUPERADMIN session → true.
 *   5. Unknown role string → false (graceful degradation).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const { mockUseSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

import { useIsOperatorOrAbove } from "@/hooks/useIsOperatorOrAbove";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("useIsOperatorOrAbove", () => {
  it("returns false when no session is available", () => {
    mockUseSession.mockReturnValue({ data: null });
    const { result } = renderHook(() => useIsOperatorOrAbove());
    expect(result.current).toBe(false);
  });

  it("returns false when session lacks a role", () => {
    mockUseSession.mockReturnValue({ data: { user: {} } });
    const { result } = renderHook(() => useIsOperatorOrAbove());
    expect(result.current).toBe(false);
  });

  it.each([["STUDENT"], ["VIEWER"], ["TESTER"], ["DEMO"]])(
    "returns false for low-level role %s",
    (role) => {
      mockUseSession.mockReturnValue({ data: { user: { role } } });
      const { result } = renderHook(() => useIsOperatorOrAbove());
      expect(result.current).toBe(false);
    },
  );

  it.each([["OPERATOR"], ["EDUCATOR"], ["ADMIN"], ["SUPERADMIN"]])(
    "returns true for elevated role %s",
    (role) => {
      mockUseSession.mockReturnValue({ data: { user: { role } } });
      const { result } = renderHook(() => useIsOperatorOrAbove());
      expect(result.current).toBe(true);
    },
  );

  it("returns false when role string is unknown (graceful degradation)", () => {
    mockUseSession.mockReturnValue({
      data: { user: { role: "UNKNOWN_FUTURE_ROLE" } },
    });
    const { result } = renderHook(() => useIsOperatorOrAbove());
    expect(result.current).toBe(false);
  });
});
