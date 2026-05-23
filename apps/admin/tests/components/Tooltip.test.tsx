/**
 * Tooltip primitive (#689) — delayed-hover, dismiss-on-leave behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show before delay", () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Hello">
        <span>Trigger</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(getByText("Trigger").parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("shows after 500ms hover (default delay)", () => {
    const { getByText, queryByRole, getByRole } = render(
      <Tooltip content="Hello">
        <span>Trigger</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(getByText("Trigger").parentElement!);
    act(() => { vi.advanceTimersByTime(550); });
    expect(queryByRole("tooltip")).not.toBeNull();
    expect(getByRole("tooltip").textContent).toBe("Hello");
  });

  it("hides immediately on mouse-leave", () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Hello">
        <span>Trigger</span>
      </Tooltip>,
    );
    const wrap = getByText("Trigger").parentElement!;
    fireEvent.mouseEnter(wrap);
    act(() => { vi.advanceTimersByTime(550); });
    expect(queryByRole("tooltip")).not.toBeNull();
    fireEvent.mouseLeave(wrap);
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("cancels pending show when mouse leaves before delay completes", () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Hello">
        <span>Trigger</span>
      </Tooltip>,
    );
    const wrap = getByText("Trigger").parentElement!;
    fireEvent.mouseEnter(wrap);
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.mouseLeave(wrap);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("renders no tooltip wrapper handlers when content is empty", () => {
    // Empty content should NOT trigger a visible tooltip even after hover.
    const { getByText, queryByRole } = render(
      <Tooltip content="">
        <span>Trigger</span>
      </Tooltip>,
    );
    const wrap = getByText("Trigger").parentElement!;
    fireEvent.mouseEnter(wrap);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("respects custom delayMs", () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Quick" delayMs={100}>
        <span>Trigger</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(getByText("Trigger").parentElement!);
    act(() => { vi.advanceTimersByTime(150); });
    expect(queryByRole("tooltip")).not.toBeNull();
  });
});
