/**
 * Tests for app/x/help/demos/HelpDemosTelemetry.tsx — #1484.
 *
 * Pins AC: the demos page fires `doc-section-view` EXACTLY ONCE on mount,
 * not on re-render.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

// vi.mock is hoisted above imports, so the factory cannot reference any
// const declared in this file. Use vi.hoisted() to lift the mock fn so
// both the factory and the test body share the same instance.
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/help/track-help-event", () => ({
  trackHelpEvent: trackMock,
}));

import { HelpDemosTelemetry } from "@/app/x/help/demos/HelpDemosTelemetry";

beforeEach(() => {
  trackMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HelpDemosTelemetry — mount-fire", () => {
  it("fires doc-section-view EXACTLY ONCE on mount", () => {
    const { rerender } = render(<HelpDemosTelemetry />);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith({
      type: "doc-section-view",
      target: "demos",
    });

    // Re-rendering must NOT re-fire the event — empty dep array is the
    // structural pin in the component.
    rerender(<HelpDemosTelemetry />);
    rerender(<HelpDemosTelemetry />);
    expect(trackMock).toHaveBeenCalledTimes(1);
  });
});
