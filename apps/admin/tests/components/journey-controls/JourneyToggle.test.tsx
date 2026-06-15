import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { JourneyToggle } from "@/components/journey-controls/JourneyToggle";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "intakeAboutYou",
  group: "G1",
  educatorLabel: "About you",
  storagePath: "sessionFlow.intake.aboutYou",
  control: "toggle",
  cascadeSources: [],
  composeImpact: { sections: ["intake"], kinds: ["section-enable"], requiresReprompt: false },
  previewLocators: [],
};

afterEach(() => cleanup());

describe("JourneyToggle (Phase 1 #1682)", () => {
  it("renders with aria-checked reflecting the value (role=switch)", () => {
    render(
      <JourneyToggle
        contract={contract}
        value={true}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    const btn = screen.getByTestId("hf-jf-toggle-intakeAboutYou");
    expect(btn.getAttribute("aria-checked")).toBe("true");
  });

  it("commits onSave with the flipped value when clicked", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyToggle
        contract={contract}
        value={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("hf-jf-toggle-intakeAboutYou"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(true));
  });

  it("does not commit when disabled", () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <JourneyToggle
        contract={contract}
        value={false}
        onSave={onSave}
        disabled
      />,
    );
    fireEvent.click(screen.getByTestId("hf-jf-toggle-intakeAboutYou"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
