import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { EditAsJsonButton } from "@/components/journey-tab/EditAsJsonButton";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

global.fetch = vi.fn();

const contract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Opening line",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: ["welcome"], kinds: ["section-content"], requiresReprompt: false },
  previewLocators: [],
};

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("EditAsJsonButton — Phase 5 (#1706)", () => {
  it("renders the JSON button when context has courseId", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1">
        <EditAsJsonButton contract={contract} value="hi" />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-jf-json-btn-welcomeMessage")).toBeInTheDocument();
  });

  it("renders nothing when context is readonly / no courseId", () => {
    render(
      <JourneySettingMutatorProvider courseId={null}>
        <EditAsJsonButton contract={contract} value="hi" />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.queryByTestId("hf-jf-json-btn-welcomeMessage")).toBeNull();
  });
});
