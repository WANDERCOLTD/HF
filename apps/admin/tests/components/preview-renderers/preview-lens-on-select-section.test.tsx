/**
 * PreviewLens → onSelectSection callback wiring — #1623.
 *
 * Pinned behaviour:
 *   - Bubble click whose sidetray-lens id maps to a `ComposeSectionKey`
 *     (intake / welcome / onboarding / offboarding / stops→nps) fires
 *     `onSelectSection` AND opens the sidetray (sidetray stays the
 *     edit affordance; the callback is the new B.13 hook).
 *   - Lens ids without a `ComposeSectionKey` (e.g. `moduleVisibility`)
 *     leave the callback untouched.
 *   - When the prop is omitted, PreviewLens behaviour is unchanged
 *     (byte-identical sidetray-only).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Stub matchMedia + ChatContext + SessionFlowEditor + CascadeInspectorTray —
// the preview-lens.css import + heavy child trees aren't part of the
// behaviour under test.

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

vi.mock("@/contexts/ChatContext", () => ({
  useChatContext: () => ({ demoAnnotationsVisible: false }),
}));

vi.mock("@/components/session-flow/SessionFlowEditor", () => ({
  SessionFlowEditor: () => <div data-testid="mock-editor" />,
}));

vi.mock("@/components/course-design/ModuleVisibilitySettings", () => ({
  ModuleVisibilitySettings: () => <div data-testid="mock-mvs" />,
}));

vi.mock("@/components/cascade/CascadeInspectorTray", () => ({
  CascadeInspectorTray: () => null,
}));

vi.mock("@/components/cascade/LayerBadge", () => ({
  LayerBadge: () => null,
}));

import { PreviewLens } from "@/app/x/courses/[courseId]/_components/PreviewLens";
import type { ComposeSectionKey } from "@/lib/compose";

type SelectFn = (section: ComposeSectionKey | null) => void;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountWithFlow(opts: {
  flow: object;
  onSelectSection?: SelectFn;
}) {
  // Mock the three fetches PreviewLens fires on mount.
  // Session-flow + dry-run are required for paint; demo-script is best-effort.
  const flowResp = { ok: true, sessionFlow: opts.flow, courseName: "Test" };
  const dryResp = { ok: true, promptSummary: "[preview]" };
  const demoResp = { ok: true, demoScript: { annotations: [] } };
  globalThis.fetch = vi.fn((url: string) => {
    const u = String(url);
    if (u.endsWith("/session-flow")) {
      return Promise.resolve(new Response(JSON.stringify(flowResp)));
    }
    if (u.endsWith("/dry-run-prompt")) {
      return Promise.resolve(new Response(JSON.stringify(dryResp)));
    }
    if (u.endsWith("/demo-script")) {
      return Promise.resolve(new Response(JSON.stringify(demoResp)));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch;

  return render(
    <PreviewLens courseId="c1" onSelectSection={opts.onSelectSection} />,
  );
}

function welcomeFlow() {
  return {
    intake: {
      goals: { enabled: false },
      aboutYou: { enabled: false },
      knowledgeCheck: { enabled: false },
      aiIntroCall: { enabled: false },
    },
    onboarding: { phases: [{ phase: "Intro" }] },
    welcomeMessage: "Hello.",
    firstCallCourseIntro: null,
    firstCallWaitForAck: "none",
    offboarding: { phases: [] },
    stops: [],
  };
}

describe("PreviewLens onSelectSection callback — #1623", () => {
  it("fires onSelectSection('welcome') when the welcome bubble is clicked", async () => {
    const onSelectSection = vi.fn<SelectFn>();
    mountWithFlow({ flow: welcomeFlow(), onSelectSection });
    // Wait for the welcome bubble to paint — it carries the "Edit Greeting"
    // lens label as its click affordance.
    const editButton = await waitFor(
      () => screen.getAllByText(/Edit Greeting/).at(0),
      { timeout: 2000 },
    );
    if (!editButton) throw new Error("Edit Greeting affordance not found");
    fireEvent.click(editButton);
    await waitFor(() => {
      expect(onSelectSection).toHaveBeenCalledWith("welcome");
    });
  });

  it("does NOT fire onSelectSection for moduleVisibility lens click", async () => {
    const onSelectSection = vi.fn<SelectFn>();
    mountWithFlow({ flow: welcomeFlow(), onSelectSection });
    const editButton = await waitFor(
      () => screen.getAllByText(/Edit module visibility/).at(0),
      { timeout: 2000 },
    );
    if (!editButton) throw new Error("moduleVisibility affordance not found");
    fireEvent.click(editButton);
    // The sidetray still opens for module-visibility (existing behaviour);
    // onSelectSection should NOT fire because moduleVisibility doesn't map
    // to a ComposeSectionKey.
    await waitFor(() => {
      expect(screen.getByTestId("mock-mvs")).toBeInTheDocument();
    });
    expect(onSelectSection).not.toHaveBeenCalled();
  });

  it("is a pure addition — omitting the prop is allowed and unchanged", async () => {
    // The prop is optional; no onSelectSection passed. Behaviour must be
    // byte-identical to pre-#1623 PreviewLens — i.e. clicking the
    // welcome bubble still opens the SessionFlowEditor sidetray.
    mountWithFlow({ flow: welcomeFlow() });
    const editButton = await waitFor(
      () => screen.getAllByText(/Edit Greeting/).at(0),
      { timeout: 2000 },
    );
    if (!editButton) throw new Error("Edit Greeting affordance not found");
    fireEvent.click(editButton);
    await waitFor(() => {
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    });
  });
});
