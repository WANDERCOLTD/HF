import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ModuleInspectorPanel } from "@/components/modules-tab/ModuleInspectorPanel";

afterEach(() => {
  cleanup();
});

describe("ModuleInspectorPanel — P3 (#1850)", () => {
  it("renders the empty-state when selectedModuleId is null", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId={null}
        selectedModuleLabel={null}
        settings={null}
      />,
    );
    expect(
      screen.getByTestId("hf-module-inspector-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Select a module from the left/i),
    ).toBeInTheDocument();
  });

  it("renders G8 rows when a module is selected", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="part1"
        selectedModuleLabel="Part 1 — Interview"
        settings={{ questionTarget: { min: 10, target: 13 } }}
      />,
    );
    // Container keyed on the selected module id.
    expect(
      screen.getByTestId("hf-module-inspector-part1"),
    ).toBeInTheDocument();
    // Module label surfaces as the header.
    expect(
      screen.getByText("Part 1 — Interview"),
    ).toBeInTheDocument();
    // At least one G8 field renders (moduleQuestionTarget is the first
    // G8 entry; assert it by testid so we don't depend on the field's
    // visual label string).
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
  });

  it("does NOT render the deferred-writer banner — P3c (#1850) wired the writer", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="part1"
        selectedModuleLabel="Part 1"
        settings={null}
      />,
    );
    expect(
      screen.queryByText(/Read-only preview/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/module-scope writer ships in a follow-on/i),
    ).not.toBeInTheDocument();
  });
});

describe("ModuleInspectorPanel — P3c mutator wiring (#1850)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          effectiveValue: "x",
          autoEnabled: [],
          bumpedSections: ["instructions"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("PATCHes /journey-setting with {settingId, value, arraySelector: moduleId} on save", async () => {
    const onSaved = vi.fn();
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="part1"
        selectedModuleLabel="Part 1"
        settings={{ closingLine: "Goodbye!" }}
        onSaved={onSaved}
      />,
    );

    // The closingLine G8 field is a text control; type into it then blur
    // (JourneyField wires onSave on commit-style events depending on
    // control). Easier path: fire a change + blur on a text input the
    // row renders.
    const row = screen.getByTestId(
      "hf-module-inspector-row-moduleClosingLine",
    );
    const inputs = row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    expect(inputs.length).toBeGreaterThan(0);
    const field = inputs[0];
    fireEvent.change(field, { target: { value: "See you next time" } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/courses/course-1/journey-setting");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.settingId).toBe("moduleClosingLine");
    expect(body.arraySelector).toBe("part1");
    expect(body.value).toBe("See you next time");

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("does NOT call onSaved when the PATCH fails (failed save surfaces via JourneyField commit hook)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: "boom", code: "X" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    // The mutator throws on non-2xx; JourneyField re-raises into its
    // commit hook (consumed by the wrapping editor as a toast trigger).
    // For unit-test purposes the relevant invariant is: `onSaved` must
    // NOT fire. We register a no-op unhandled-rejection listener so the
    // rejection doesn't pollute the test runner's failure surface.
    const swallow = () => undefined;
    process.on("unhandledRejection", swallow);
    try {
      const onSaved = vi.fn();
      render(
        <ModuleInspectorPanel
          courseId="course-1"
          selectedModuleId="part1"
          selectedModuleLabel="Part 1"
          settings={{ closingLine: "Goodbye!" }}
          onSaved={onSaved}
        />,
      );
      const row = screen.getByTestId(
        "hf-module-inspector-row-moduleClosingLine",
      );
      const field = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      );
      expect(field).not.toBeNull();
      fireEvent.change(field!, { target: { value: "x" } });
      fireEvent.blur(field!);
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
      // Give the microtask queue a tick so the rejected promise settles
      // BEFORE we assert + clean up the listener.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", swallow);
    }
  });
});
