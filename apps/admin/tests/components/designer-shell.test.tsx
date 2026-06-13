/**
 * DesignerShell + section-registry tests (S4 of #1555).
 *
 * Acceptance checks pinned:
 *   1. Registry is empty at story-close — `getPreviewRenderer(any)` returns null.
 *   2. `registerPreviewRenderer(section, renderer)` makes the lookup return it.
 *   3. DesignerShell with `inspector={null}` does NOT render the inspector
 *      column (structurally absent, not a blank panel).
 *   4. DesignerShell with `inspector={<…>}` renders the right column.
 *   5. `useDesignerSelection` starts null, setter updates, clear() returns null.
 */

import React from "react";
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, renderHook, act, cleanup } from "@testing-library/react";

// jsdom doesn't ship matchMedia; the DesignerShell relies on it for the
// narrow-viewport drawer behaviour. Stub once for the whole file.
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import {
  DesignerShell,
  getPreviewRenderer,
  registerPreviewRenderer,
  useDesignerSelection,
} from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

describe("section-registry — S4 #1559", () => {
  it("is empty at story-close (every lookup returns null)", () => {
    expect(getPreviewRenderer("firstCallMode")).toBeNull();
    expect(getPreviewRenderer("modePolicy")).toBeNull();
    expect(getPreviewRenderer("loMastery")).toBeNull();
    expect(getPreviewRenderer("welcome")).toBeNull();
    expect(getPreviewRenderer("personality")).toBeNull();
  });

  it("registers a renderer that getPreviewRenderer then returns", () => {
    const Renderer: React.FC = () => <div data-testid="r" />;
    registerPreviewRenderer("instructions", Renderer);
    const looked = getPreviewRenderer("instructions");
    expect(looked).toBe(Renderer);
  });

  it("isolates renderers per section (siblings stay null)", () => {
    const Renderer: React.FC = () => null;
    registerPreviewRenderer("loMastery", Renderer);
    expect(getPreviewRenderer("loMastery")).toBe(Renderer);
    expect(getPreviewRenderer("moduleMastery")).toBeNull();
    expect(getPreviewRenderer("instructions")).toBeNull();
  });
});

describe("DesignerShell — S4 #1559", () => {
  it("renders only nav + canvas when inspector is null", () => {
    render(
      <DesignerShell
        nav={<div data-testid="nav">N</div>}
        canvas={<div data-testid="canvas">C</div>}
        inspector={null}
      />,
    );
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(
      document.querySelector(".hf-designer-inspector"),
    ).toBeNull();
    // Drawer toggle is only mounted in narrow mode — defaults to not narrow
    // in jsdom (matchMedia returns false), so the toggle should also be
    // absent when no inspector is supplied.
    expect(
      document.querySelector(".hf-designer-drawer-toggle"),
    ).toBeNull();
  });

  it("renders inspector slot when inspector node supplied", () => {
    render(
      <DesignerShell
        nav={<div>N</div>}
        canvas={<div>C</div>}
        inspector={<div data-testid="insp">I</div>}
      />,
    );
    expect(screen.getByTestId("insp")).toBeInTheDocument();
    expect(
      document.querySelector(".hf-designer-inspector"),
    ).not.toBeNull();
  });

  it("adds the with-inspector class only when inspector is mounted", () => {
    const { rerender } = render(
      <DesignerShell
        nav={<div>N</div>}
        canvas={<div>C</div>}
        inspector={null}
      />,
    );
    expect(document.querySelector(".hf-designer-shell")?.className).toContain(
      "hf-designer-shell-no-inspector",
    );
    rerender(
      <DesignerShell
        nav={<div>N</div>}
        canvas={<div>C</div>}
        inspector={<div>X</div>}
      />,
    );
    expect(document.querySelector(".hf-designer-shell")?.className).toContain(
      "hf-designer-shell-with-inspector",
    );
  });
});

describe("useDesignerSelection — S4 #1559", () => {
  it("starts null, setter updates, clear() returns null", () => {
    const { result } = renderHook(() => useDesignerSelection());
    expect(result.current.selectedKey).toBeNull();
    act(() => result.current.setSelectedKey("instructions"));
    expect(result.current.selectedKey).toBe("instructions");
    act(() => result.current.setSelectedKey("loMastery"));
    expect(result.current.selectedKey).toBe("loMastery");
    act(() => result.current.clear());
    expect(result.current.selectedKey).toBeNull();
  });

  it("respects initial selection passed in", () => {
    const { result } = renderHook(() => useDesignerSelection("personality"));
    expect(result.current.selectedKey).toBe("personality");
  });
});
