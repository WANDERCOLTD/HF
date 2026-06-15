import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import { JourneyText } from "@/components/journey-controls/JourneyText";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Opening line",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
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

describe("JourneyText (Phase 1 #1682)", () => {
  it("renders the upstream value", () => {
    render(
      <JourneyText
        contract={contract}
        value="hi there"
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect((screen.getByTestId("hf-jf-text-welcomeMessage") as HTMLInputElement).value).toBe(
      "hi there",
    );
  });

  it("fires onSave on blur with the new value", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyText
        contract={contract}
        value="hi"
        onSave={onSave}
      />,
    );
    const input = screen.getByTestId("hf-jf-text-welcomeMessage");
    fireEvent.change(input, { target: { value: "hi there" } });
    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith("hi there");
  });
});
