import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyBanding } from "@/components/journey-controls/JourneyBanding";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

vi.mock("@/components/shared/BandingPicker", () => ({
  BandingPicker: ({ courseId }: { courseId: string }) => (
    <div data-testid="hf-bp-mock">BandingPicker(courseId={courseId})</div>
  ),
}));

const contract: JourneySettingContract = {
  id: "skillTierMapping",
  group: "G4",
  educatorLabel: "Skill tier mapping",
  storagePath: "config.skillTierMapping",
  control: "banding",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

afterEach(() => cleanup());

describe("JourneyBanding (Phase 3 #1693)", () => {
  it("shows placeholder when no provider", () => {
    render(
      <JourneyBanding
        contract={contract}
        value={null}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.getByTestId("hf-jf-banding-skillTierMapping")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-bp-mock")).toBeNull();
  });

  it("shows placeholder when no playbookConfig", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <JourneyBanding
          contract={contract}
          value={null}
          onSave={vi.fn(() => Promise.resolve())}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.queryByTestId("hf-bp-mock")).toBeNull();
  });

  it("mounts BandingPicker when courseId + playbookConfig present", () => {
    render(
      <JourneySettingMutatorProvider
        courseId="course-1"
        playbookConfig={{ skillTierMapping: { tierLabels: ["A", "B"] } }}
      >
        <JourneyBanding
          contract={contract}
          value={null}
          onSave={vi.fn(() => Promise.resolve())}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-bp-mock")).toBeInTheDocument();
    expect(screen.getByTestId("hf-bp-mock").textContent).toContain("course-1");
  });
});
