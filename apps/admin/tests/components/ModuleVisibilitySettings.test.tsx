/**
 * ModuleVisibilitySettings — #1405 Behaviour lens.
 *
 * Covers: radio renders all three options with FieldHint labels,
 * the initial value reflects the playbookConfig prop, clicking a radio
 * + Save POSTs the right body to /api/courses/[id]/design.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { ModuleVisibilitySettings } from "@/components/course-design/ModuleVisibilitySettings";

describe("ModuleVisibilitySettings (#1405)", () => {
  beforeEach(() => {
    // Default fetch — hydrate GET returns no override + Save returns ok.
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/design")) {
        return new Response(
          JSON.stringify({ ok: true, firstCallModuleVisibility: null, rows: [] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }) as unknown as typeof fetch;
  });

  it("renders all three radio options", () => {
    render(<ModuleVisibilitySettings courseId="c1" />);
    expect(screen.getByText("Mention from call 1 (default)")).toBeDefined();
    expect(screen.getByText("Introduce modules from call 2")).toBeDefined();
    expect(screen.getByText("Only when learner picks a module")).toBeDefined();
  });

  it("defaults to mention_from_call_1 when prop is absent", () => {
    render(<ModuleVisibilitySettings courseId="c1" />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const mentionRadio = radios.find((r) => r.value === "mention_from_call_1");
    expect(mentionRadio?.checked).toBe(true);
  });

  it("hydrates from playbookConfig prop", () => {
    render(
      <ModuleVisibilitySettings
        courseId="c1"
        playbookConfig={{
          firstCall: { firstCallModuleVisibility: "hide_until_call_2" },
        }}
      />,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const hideRadio = radios.find((r) => r.value === "hide_until_call_2");
    expect(hideRadio?.checked).toBe(true);
  });

  it("PUTs the chosen value when Save is clicked", async () => {
    const onSaved = vi.fn();
    render(
      <ModuleVisibilitySettings
        courseId="c1"
        playbookConfig={{}}
        onSaved={onSaved}
      />,
    );

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const targetRadio = radios.find(
      (r) => r.value === "hide_until_learner_picks",
    )!;
    fireEvent.click(targetRadio);

    const saveBtn = screen.getByRole("button", { name: /Save module visibility/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const putCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const putBody = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(putBody).toEqual({
      firstCall: { firstCallModuleVisibility: "hide_until_learner_picks" },
    });
  });

  it("renders a 'Saved.' confirmation after a successful save", async () => {
    render(<ModuleVisibilitySettings courseId="c1" />);
    const saveBtn = screen.getByRole("button", {
      name: /Save module visibility/i,
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText("Saved.")).toBeDefined());
  });
});
