/**
 * JsonEditorModal — UX hardening (2026-06-17 session).
 *
 * Pins three behaviours added in fix/json-modal-stale-read-and-esc:
 *
 *   1. **Esc closes** — keyboard convenience the operator asked for.
 *   2. **Warn-if-unsaved** — Esc/X/backdrop while the textarea diverges
 *      from `initialText` triggers a `window.confirm`. Cancel = stay.
 *   3. **Stale-read re-sync** — when the modal is open and `initialText`
 *      prop changes (parent refetch landed a fresh value), the textarea
 *      contents follow. Without this the operator had to hard-refresh
 *      the page to see the new value after a toggle.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { JsonEditorModal } from "@/components/settings/JsonEditorModal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JsonEditorModal", () => {
  it("Esc closes when clean (no confirm dialog)", () => {
    const onClose = vi.fn();
    render(
      <JsonEditorModal
        isOpen
        onClose={onClose}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc prompts for confirmation when dirty; Cancel keeps the modal open", () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <JsonEditorModal
        isOpen
        onClose={onClose}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("hf-json-editor-modal-textarea"), {
      target: { value: "true" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc closes when dirty if the operator confirms discard", () => {
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <JsonEditorModal
        isOpen
        onClose={onClose}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("hf-json-editor-modal-textarea"), {
      target: { value: "true" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-syncs textarea when initialText changes while open (stale-read fix)", () => {
    const { rerender } = render(
      <JsonEditorModal
        isOpen
        onClose={vi.fn()}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByTestId(
      "hf-json-editor-modal-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("false");

    // Parent refetched a fresh value while the modal was open — modal
    // must adopt the new value, not hold the original mount-time one.
    rerender(
      <JsonEditorModal
        isOpen
        onClose={vi.fn()}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="true"
        onSave={vi.fn()}
      />,
    );
    expect(textarea.value).toBe("true");
  });

  it("does not fire onClose on first mount (avoids confirm-on-open)", () => {
    const onClose = vi.fn();
    render(
      <JsonEditorModal
        isOpen
        onClose={onClose}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows an `Unsaved` chip when the textarea differs from initialText", () => {
    render(
      <JsonEditorModal
        isOpen
        onClose={vi.fn()}
        label="About you"
        settingKey="intakeAboutYou"
        initialText="false"
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Unsaved/i)).toBeNull();
    fireEvent.change(screen.getByTestId("hf-json-editor-modal-textarea"), {
      target: { value: "true" },
    });
    expect(screen.getByText(/Unsaved/i)).toBeInTheDocument();
  });
});
