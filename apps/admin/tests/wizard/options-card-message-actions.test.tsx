/**
 * OptionsCard + MessageActions — #978 Slice 3
 *
 * Verifies the DOM-level contract that the harness predictor can only assert
 * indirectly: when the OptionsCard receives a `messageActions` element built
 * from MessageActions with `actionsSubset={["correct","more","skip"]}`, the
 * opened menu contains exactly those three items — Copy and Quote are NOT
 * present (they would operate on `panel.question`, which isn't sensible UX).
 *
 * Also covers the keyboard QA gate raised by Tech Lead:
 * `AC-Escape-Collision` — Esc inside an open MessageActions menu must close
 * the menu without triggering OptionsCard's `onSomethingElse` dismissal.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { OptionsCard, type OptionsPanel } from "@/app/x/wizard/components/OptionsCard";
import { MessageActions } from "@/app/x/wizard/components/MessageActions";

function makePanel(overrides: Partial<OptionsPanel> = {}): OptionsPanel {
  return {
    question: "How should learners progress?",
    dataKey: "progressionMode",
    mode: "radio",
    fieldPicker: false,
    options: [
      { value: "learner-picks", label: "Let learners pick", description: "" },
      { value: "ai-led", label: "AI directs", description: "" },
    ],
    ...overrides,
  };
}

describe("OptionsCard + MessageActions — #978 Slice 3", () => {
  it("mounts MessageActions in the footer with subset (no Copy / Quote)", () => {
    const onSelect = vi.fn();
    const onSkip = vi.fn();
    const onSomethingElse = vi.fn();
    const onSend = vi.fn();
    const onPrefill = vi.fn();
    const onFocusInput = vi.fn();

    const { getByLabelText, queryByText } = render(
      <OptionsCard
        panel={makePanel()}
        onSelect={onSelect}
        onSkip={onSkip}
        onSomethingElse={onSomethingElse}
        messageActions={
          <MessageActions
            message={{ content: "How should learners progress?" }}
            onSend={onSend}
            onPrefill={onPrefill}
            onFocusInput={onFocusInput}
            actionsSubset={["correct", "more", "skip"]}
          />
        }
      />,
    );

    // Trigger is present on the picker footer
    const trigger = getByLabelText(/Message actions/i);
    expect(trigger).toBeTruthy();

    // Open the menu
    fireEvent.click(trigger);

    // Subset items are present
    expect(queryByText("That's not right")).not.toBeNull();
    expect(queryByText("Tell me more")).not.toBeNull();
    expect(queryByText("Move on")).not.toBeNull();

    // Excluded items are NOT present
    expect(queryByText("Copy")).toBeNull();
    expect(queryByText("Quote & reply")).toBeNull();
  });

  it("renders without messageActions when prop is omitted (backwards-compatible)", () => {
    const { queryByLabelText } = render(
      <OptionsCard
        panel={makePanel()}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
        onSomethingElse={vi.fn()}
      />,
    );
    expect(queryByLabelText(/Message actions/i)).toBeNull();
  });

  it("AC-Escape-Collision: Esc inside open MessageActions does NOT dismiss the picker", () => {
    const onSomethingElse = vi.fn();
    const onSend = vi.fn();

    const { getByLabelText, queryByRole } = render(
      <OptionsCard
        panel={makePanel()}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
        onSomethingElse={onSomethingElse}
        messageActions={
          <MessageActions
            message={{ content: "q" }}
            onSend={onSend}
            onPrefill={vi.fn()}
            onFocusInput={vi.fn()}
            actionsSubset={["correct", "more", "skip"]}
          />
        }
      />,
    );

    // Open the actions menu
    fireEvent.click(getByLabelText(/Message actions/i));
    const menu = queryByRole("menu");
    expect(menu).not.toBeNull();

    // Press Escape — MessageActions handler uses capture-phase + stopPropagation,
    // so OptionsCard's Esc (which fires onSomethingElse) must NOT fire.
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    // Menu closed
    expect(queryByRole("menu")).toBeNull();
    // Picker still alive (onSomethingElse not called)
    expect(onSomethingElse).not.toHaveBeenCalled();
  });

  it("renders co-located suggestion chips when panel.suggestionChips set (slice 2 + 3 together)", () => {
    const onChipClick = vi.fn();
    const { getByText } = render(
      <OptionsCard
        panel={makePanel({ suggestionChips: ["Continue", "Something else"] })}
        onSelect={vi.fn()}
        onSkip={vi.fn()}
        onSomethingElse={vi.fn()}
        onChipClick={onChipClick}
        messageActions={
          <MessageActions
            message={{ content: "q" }}
            onSend={vi.fn()}
            onPrefill={vi.fn()}
            onFocusInput={vi.fn()}
            actionsSubset={["correct", "more", "skip"]}
          />
        }
      />,
    );

    fireEvent.click(getByText("Continue"));
    expect(onChipClick).toHaveBeenCalledWith("Continue");
  });
});
