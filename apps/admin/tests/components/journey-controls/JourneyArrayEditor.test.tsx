/**
 * JourneyArrayEditor (#1752 Theme 1b) — array-of-structs editor with
 * per-contract row schemas. Pinned for moduleCueCardPool +
 * moduleScheduledCues.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { JourneyArrayEditor } from "@/components/journey-controls/JourneyArrayEditor";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const cueCardContract: JourneySettingContract = {
  id: "moduleCueCardPool",
  group: "G8",
  educatorLabel: "Cue card pool",
  storagePath: { path: "config.modules[].settings.cueCardPool", arrayKey: "id" },
  control: "array-editor",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const scheduledCuesContract: JourneySettingContract = {
  id: "moduleScheduledCues",
  group: "G8",
  educatorLabel: "Scheduled cues",
  storagePath: { path: "config.modules[].settings.scheduledCues", arrayKey: "id" },
  control: "array-editor",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("JourneyArrayEditor — moduleCueCardPool", () => {
  it("renders rows from the upstream value, preserving migration from JsonFallback", () => {
    render(
      <JourneyArrayEditor
        contract={cueCardContract}
        value={[
          { topic: "Holiday", bullets: ["where", "when", "why"] },
          { topic: "Hobby", bullets: ["what", "why"] },
        ]}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByTestId("hf-jf-row-moduleCueCardPool-0")).toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-moduleCueCardPool-1")).toBeInTheDocument();
    expect(
      (screen.getByTestId("hf-jf-field-moduleCueCardPool-0-topic") as HTMLInputElement).value,
    ).toBe("Holiday");
    expect(
      (screen.getByTestId("hf-jf-field-moduleCueCardPool-0-bullets") as HTMLTextAreaElement).value,
    ).toBe("where\nwhen\nwhy");
  });

  it("Add row appends a default row", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={cueCardContract}
        value={[]}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-jf-array-add-moduleCueCardPool"));
    expect(screen.getByTestId("hf-jf-row-moduleCueCardPool-0")).toBeInTheDocument();
  });

  it("Remove row drops the row from the saved value", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={cueCardContract}
        value={[
          { topic: "Holiday", bullets: ["w"] },
          { topic: "Hobby", bullets: ["x"] },
        ]}
        onSave={onSave}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("hf-jf-row-remove-moduleCueCardPool-0"));
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith([{ topic: "Hobby", bullets: ["x"] }]);
  });

  it("Move up swaps row 1 with row 0", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={cueCardContract}
        value={[
          { topic: "A", bullets: [] },
          { topic: "B", bullets: [] },
        ]}
        onSave={onSave}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("hf-jf-row-up-moduleCueCardPool-1"));
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith([
      { topic: "B", bullets: [] },
      { topic: "A", bullets: [] },
    ]);
  });

  it("Editing a field commits on blur with the new shape", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={cueCardContract}
        value={[{ topic: "Holiday", bullets: [] }]}
        onSave={onSave}
      />,
    );
    const topicInput = screen.getByTestId("hf-jf-field-moduleCueCardPool-0-topic");
    fireEvent.change(topicInput, { target: { value: "Morning routine" } });
    await act(async () => {
      fireEvent.blur(topicInput);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith([{ topic: "Morning routine", bullets: [] }]);
  });
});

describe("JourneyArrayEditor — moduleScheduledCues", () => {
  it("renders {at, text} rows with correct field types", () => {
    render(
      <JourneyArrayEditor
        contract={scheduledCuesContract}
        value={[{ at: 45, text: "15 seconds left" }]}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    const atInput = screen.getByTestId("hf-jf-field-moduleScheduledCues-0-at") as HTMLInputElement;
    expect(atInput.type).toBe("number");
    expect(atInput.value).toBe("45");
    const textInput = screen.getByTestId("hf-jf-field-moduleScheduledCues-0-text") as HTMLInputElement;
    expect(textInput.value).toBe("15 seconds left");
  });

  it("commits {at: number, text: string} on edit + blur", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={scheduledCuesContract}
        value={[{ at: 45, text: "15 seconds left" }]}
        onSave={onSave}
      />,
    );
    const atInput = screen.getByTestId("hf-jf-field-moduleScheduledCues-0-at");
    fireEvent.change(atInput, { target: { value: "30" } });
    await act(async () => {
      fireEvent.blur(atInput);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith([{ at: 30, text: "15 seconds left" }]);
  });
});

describe("JourneyArrayEditor — moduleScaffoldPool (A2b of #2225)", () => {
  const scaffoldPoolContract: JourneySettingContract = {
    id: "moduleScaffoldPool",
    group: "G8",
    educatorLabel: "Stall scaffold pool",
    storagePath: { path: "config.modules[].settings.scaffoldPool", arrayKey: "id" },
    control: "array-editor",
    cascadeSources: [],
    composeImpact: {
      sections: [],
      kinds: ["stop-timing"],
      requiresReprompt: false,
    },
    previewLocators: [],
  };

  it("renders string-array rows (NOT the 'No row schema registered' fallback)", () => {
    render(
      <JourneyArrayEditor
        contract={scaffoldPoolContract}
        value={["Take your time…", "When you're ready, carry on…"]}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    // Editable list visible — not the fallback alert that the A2 audit caught.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-moduleScaffoldPool-0")).toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-moduleScaffoldPool-1")).toBeInTheDocument();
    expect(
      (screen.getByTestId("hf-jf-field-moduleScaffoldPool-0-value") as HTMLTextAreaElement).value,
    ).toBe("Take your time…");
    expect(
      (screen.getByTestId("hf-jf-field-moduleScaffoldPool-1-value") as HTMLTextAreaElement).value,
    ).toBe("When you're ready, carry on…");
  });

  it("Add row appends an empty string row", () => {
    render(
      <JourneyArrayEditor
        contract={scaffoldPoolContract}
        value={[]}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-jf-array-add-moduleScaffoldPool"));
    expect(screen.getByTestId("hf-jf-row-moduleScaffoldPool-0")).toBeInTheDocument();
    expect(
      (screen.getByTestId("hf-jf-field-moduleScaffoldPool-0-value") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("Editing a row commits the new string[] on blur", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={scaffoldPoolContract}
        value={["Take your time…"]}
        onSave={onSave}
      />,
    );
    const input = screen.getByTestId("hf-jf-field-moduleScaffoldPool-0-value");
    fireEvent.change(input, { target: { value: "Whenever you're ready" } });
    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(["Whenever you're ready"]);
  });

  it("Remove row drops the entry from the saved string[]", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyArrayEditor
        contract={scaffoldPoolContract}
        value={["A", "B"]}
        onSave={onSave}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("hf-jf-row-remove-moduleScaffoldPool-0"));
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(["B"]);
  });
});

describe("JourneyArrayEditor — unknown contract.id", () => {
  it("renders an error panel for contracts without a row schema", () => {
    const unknownContract: JourneySettingContract = {
      ...cueCardContract,
      id: "someNewArraySetting",
    };
    render(
      <JourneyArrayEditor
        contract={unknownContract}
        value={[]}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("someNewArraySetting");
  });
});
