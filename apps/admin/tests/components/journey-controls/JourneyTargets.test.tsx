import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyTargets } from "@/components/journey-controls/JourneyTargets";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

vi.mock("@/components/course-design/FirstSessionSettings", () => ({
  FirstSessionSettings: ({ courseId }: { courseId: string }) => (
    <div data-testid="hf-fss-mock">FirstSessionSettings(courseId={courseId})</div>
  ),
}));

const contract: JourneySettingContract = {
  id: "firstCallTargets",
  group: "G2",
  educatorLabel: "Call 1 skill targets",
  storagePath: {
    path: "behaviorTargets[]",
    arrayKey: "scope",
    selectorValue: "firstCall",
    writeMode: "merge",
  },
  control: "targets",
  cascadeSources: [],
  composeImpact: {
    sections: ["behaviorTargets"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

afterEach(() => cleanup());

describe("JourneyTargets (Phase 3 #1693)", () => {
  it("shows placeholder when no provider", () => {
    render(
      <JourneyTargets
        contract={contract}
        value={{}}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(screen.queryByTestId("hf-fss-mock")).toBeNull();
  });

  it("shows placeholder when no playbookConfig", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <JourneyTargets
          contract={contract}
          value={{}}
          onSave={vi.fn(() => Promise.resolve())}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.queryByTestId("hf-fss-mock")).toBeNull();
  });

  it("mounts FirstSessionSettings when courseId + playbookConfig set", () => {
    render(
      <JourneySettingMutatorProvider
        courseId="course-1"
        playbookConfig={{ firstSessionTargets: {} }}
      >
        <JourneyTargets
          contract={contract}
          value={{}}
          onSave={vi.fn(() => Promise.resolve())}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-fss-mock")).toBeInTheDocument();
  });
});
