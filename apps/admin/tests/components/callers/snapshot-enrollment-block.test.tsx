/**
 * Smoke test for SnapshotEnrollmentBlock — Wave A1.
 *
 * Thin wrapper over the existing `CallerEnrollmentsSection` from
 * ProfileTab. Pinned acceptance:
 *   1. Mounts the wrapped component with the right callerId + domainId
 *   2. Passes the no-op onCountChange (Snapshot doesn't need a count badge)
 *
 * The inner component already has its own tests in the ProfileTab suite;
 * we don't duplicate them here.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SnapshotEnrollmentBlock } from "@/components/callers/caller-detail/SnapshotEnrollmentBlock";

const { mockSection } = vi.hoisted(() => ({
  mockSection: vi.fn(),
}));

vi.mock("@/components/callers/caller-detail/ProfileTab", () => ({
  CallerEnrollmentsSection: (props: {
    callerId: string;
    domainId: string | null | undefined;
    onCountChange: (n: number) => void;
  }) => {
    mockSection(props);
    return (
      <div data-testid="hf-caller-enrollments-section">
        wrapped — caller={props.callerId} domain={String(props.domainId)}
      </div>
    );
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "OPERATOR" } } }),
}));

beforeEach(() => {
  cleanup();
  mockSection.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SnapshotEnrollmentBlock — wrapper smoke", () => {
  it("renders the CallerEnrollmentsSection with the right callerId + domainId", () => {
    render(
      <SnapshotEnrollmentBlock callerId="caller-1" domainId="domain-7" />,
    );
    expect(screen.getByTestId("hf-snapshot-enrollments")).toBeTruthy();
    expect(screen.getByTestId("hf-caller-enrollments-section")).toBeTruthy();
    expect(mockSection).toHaveBeenCalledOnce();
    const props = mockSection.mock.calls[0][0];
    expect(props.callerId).toBe("caller-1");
    expect(props.domainId).toBe("domain-7");
    expect(typeof props.onCountChange).toBe("function");
  });

  it("handles null/undefined domainId without crashing", () => {
    render(<SnapshotEnrollmentBlock callerId="caller-1" domainId={null} />);
    expect(screen.getByTestId("hf-snapshot-enrollments")).toBeTruthy();
    expect(mockSection.mock.calls[0][0].domainId).toBeNull();
  });

  it("passes a no-op onCountChange (no error when invoked)", () => {
    render(
      <SnapshotEnrollmentBlock callerId="caller-1" domainId="d1" />,
    );
    const props = mockSection.mock.calls[0][0];
    expect(() => props.onCountChange(7)).not.toThrow();
  });
});
