/**
 * ModuleQuickSwitcher — #1248.
 *
 * Inline modal that replaces the page-nav module picker for the common
 * "switch unit" case. Covers: closed state renders nothing meaningful;
 * open state lists modules; click invokes onPick + onClose; empty state
 * surfaces helpful copy; status pills render only when progress data
 * is supplied; current-module marker fires when an id matches.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ModuleQuickSwitcher } from "@/components/sim/ModuleQuickSwitcher";

const modules = [
  { id: "u04", label: "Unit 04 — IT Operations" },
  { id: "u09", label: "Unit 09 — Architecture" },
  { id: "u16", label: "Unit 16 — Data" },
];

describe("ModuleQuickSwitcher", () => {
  it("renders the modules list when open", () => {
    render(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={modules}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText("Unit 04 — IT Operations")).toBeDefined();
    expect(screen.getByText("Unit 09 — Architecture")).toBeDefined();
    expect(screen.getByText("Unit 16 — Data")).toBeDefined();
  });

  it("renders nothing visible when closed", () => {
    const { container } = render(
      <ModuleQuickSwitcher
        open={false}
        onClose={() => {}}
        modules={modules}
        onPick={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("calls onPick with the chosen id and onClose when a row is clicked", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <ModuleQuickSwitcher
        open={true}
        onClose={onClose}
        modules={modules}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByTestId("module-switcher-row-u09"));
    expect(onPick).toHaveBeenCalledWith("u09");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders an empty-state message when no modules are authored", () => {
    render(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={[]}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText(/no modules authored/i)).toBeDefined();
  });

  it("renders status badges only for modules with progress data", () => {
    render(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={modules}
        onPick={() => {}}
        progressByModuleId={{
          u04: "COMPLETED",
          u09: "IN_PROGRESS",
        }}
      />,
    );
    expect(screen.getByText("Completed")).toBeDefined();
    expect(screen.getByText("In progress")).toBeDefined();
    // Unit 16 has no progress entry — no badge rendered for it.
    expect(screen.queryByText("Not started")).toBeNull();
  });

  it("marks the current-module row with the focus class", () => {
    render(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={modules}
        currentModuleId="u09"
        onPick={() => {}}
      />,
    );
    const currentRow = screen.getByTestId("module-switcher-row-u09");
    expect(currentRow.className).toContain("hf-module-switcher-row-current");
    const otherRow = screen.getByTestId("module-switcher-row-u04");
    expect(otherRow.className).not.toContain("hf-module-switcher-row-current");
  });

  it("renders the full-picker escape link only when fullPickerHref is supplied", () => {
    const { rerender } = render(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={modules}
        onPick={() => {}}
      />,
    );
    expect(screen.queryByText(/see full picker/i)).toBeNull();

    rerender(
      <ModuleQuickSwitcher
        open={true}
        onClose={() => {}}
        modules={modules}
        onPick={() => {}}
        fullPickerHref="/x/student/pb-1/modules?returnTo=%2Fx%2Fsim%2Fc-1"
      />,
    );
    const link = screen.getByText(/see full picker/i) as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/x/student/pb-1/modules?returnTo=%2Fx%2Fsim%2Fc-1");
  });
});
