/**
 * JourneyMinTarget (#1752 Theme 1b) — typed min/target pair editor.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { JourneyMinTarget } from "@/components/journey-controls/JourneyMinTarget";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "moduleQuestionTarget",
  group: "G8",
  educatorLabel: "Question target",
  storagePath: { path: "config.modules[].settings.questionTarget", arrayKey: "id" },
  control: "min-target",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("JourneyMinTarget", () => {
  it("renders both inputs with the upstream value", () => {
    render(
      <JourneyMinTarget
        contract={contract}
        value={{ min: 10, target: 13 }}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect((screen.getByTestId("hf-jf-min-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "10",
    );
    expect((screen.getByTestId("hf-jf-target-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "13",
    );
  });

  it("preserves saved {min, target} when migrating from JsonFallback (object passed through)", () => {
    render(
      <JourneyMinTarget
        contract={contract}
        value={{ min: 5, target: 9 }}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect((screen.getByTestId("hf-jf-min-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "5",
    );
    expect((screen.getByTestId("hf-jf-target-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "9",
    );
  });

  it("falls back to {min:0, target:0} for non-object values", () => {
    render(
      <JourneyMinTarget
        contract={contract}
        value={"not a pair" as unknown}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect((screen.getByTestId("hf-jf-min-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "0",
    );
    expect((screen.getByTestId("hf-jf-target-moduleQuestionTarget") as HTMLInputElement).value).toBe(
      "0",
    );
  });

  it("commits new values on blur as a {min, target} object", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyMinTarget
        contract={contract}
        value={{ min: 10, target: 13 }}
        onSave={onSave}
      />,
    );
    const minInput = screen.getByTestId("hf-jf-min-moduleQuestionTarget");
    const targetInput = screen.getByTestId("hf-jf-target-moduleQuestionTarget");
    fireEvent.change(minInput, { target: { value: "8" } });
    fireEvent.change(targetInput, { target: { value: "12" } });
    await act(async () => {
      fireEvent.blur(targetInput);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith({ min: 8, target: 12 });
  });

  it("surfaces inline error + blocks commit on min > target", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyMinTarget
        contract={contract}
        value={{ min: 5, target: 10 }}
        onSave={onSave}
      />,
    );
    const minInput = screen.getByTestId("hf-jf-min-moduleQuestionTarget");
    fireEvent.change(minInput, { target: { value: "20" } });
    await act(async () => {
      fireEvent.blur(minInput);
      await Promise.resolve();
    });
    expect(screen.getByTestId("hf-jf-min-target-error-moduleQuestionTarget")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
