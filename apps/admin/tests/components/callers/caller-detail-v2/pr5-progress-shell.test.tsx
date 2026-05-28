/**
 * PR 5 — Progress v2 shell smoke tests.
 *
 * Verifies LH-menu rendering, lens activation via setView, URL synchro-
 * nisation through next/navigation mocks, and the unknown-view fallback.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ProgressV2Tab } from "@/components/callers/caller-detail/caller-detail-v2/ProgressV2Tab";
import {
  LENSES,
  LENS_ORDER,
  isLensId,
} from "@/components/callers/caller-detail/caller-detail-v2/lenses/registry";

const replaceSpy = vi.fn();
let currentView: string | null = null;

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ replace: replaceSpy }),
    useSearchParams: () => ({
      get: (key: string) => (key === "view" ? currentView : null),
      toString: () => (currentView ? `view=${currentView}` : ""),
    }),
  };
});

beforeEach(() => {
  replaceSpy.mockReset();
  currentView = null;
});

describe("Progress v2 lens registry", () => {
  it("LENS_ORDER and LENSES stay in lockstep", () => {
    expect(LENS_ORDER.length).toBe(Object.keys(LENSES).length);
    for (const id of LENS_ORDER) {
      expect(LENSES[id]).toBeDefined();
      expect(LENSES[id].label.length).toBeGreaterThan(0);
      expect(LENSES[id].iconKey.length).toBeGreaterThan(0);
    }
  });

  it("isLensId rejects unknown / null / empty values", () => {
    expect(isLensId(null)).toBe(false);
    expect(isLensId(undefined)).toBe(false);
    expect(isLensId("")).toBe(false);
    expect(isLensId("not-a-lens")).toBe(false);
    expect(isLensId("overview")).toBe(true);
    expect(isLensId("adaptation")).toBe(true);
  });
});

describe("ProgressV2Tab shell", () => {
  it("renders one nav item per lens with 'soon' badge when no Component", () => {
    const { container } = render(<ProgressV2Tab callerId="c1" />);
    const items = container.querySelectorAll(".hf-progress-v2-nav-item");
    expect(items.length).toBe(LENS_ORDER.length);
    expect(container.querySelectorAll(".hf-progress-v2-nav-soon").length).toBe(
      LENS_ORDER.length,
    );
  });

  it("defaults to overview when no ?view= present", () => {
    const { container } = render(<ProgressV2Tab callerId="c1" />);
    const active = container.querySelector(".hf-progress-v2-nav-item--active");
    expect(active?.textContent).toContain("Overview");
  });

  it("activates the lens pointed to by ?view=adaptation", () => {
    currentView = "adaptation";
    const { container } = render(<ProgressV2Tab callerId="c1" />);
    const active = container.querySelector(".hf-progress-v2-nav-item--active");
    expect(active?.textContent).toContain("Adaptation");
    expect(container.textContent).toContain("How the system has personalised");
  });

  it("falls back to overview + warns on unknown ?view=", () => {
    currentView = "not-real";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(<ProgressV2Tab callerId="c1" />);
    const active = container.querySelector(".hf-progress-v2-nav-item--active");
    expect(active?.textContent).toContain("Overview");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("calls router.replace with the new ?view= when a nav item is clicked", () => {
    const { getByRole } = render(<ProgressV2Tab callerId="c1" />);
    const goalsBtn = getByRole("tab", { name: /Goals/i });
    fireEvent.click(goalsBtn);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const arg = replaceSpy.mock.calls[0][0] as string;
    expect(arg).toContain("view=goals");
  });
});
