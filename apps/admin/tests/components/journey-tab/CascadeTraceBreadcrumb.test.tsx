import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CascadeTraceBreadcrumb } from "@/components/journey-tab/CascadeTraceBreadcrumb";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

afterEach(() => cleanup());

const baseContract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Opening line",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: ["welcome"], kinds: ["section-content"], requiresReprompt: false },
  previewLocators: [],
};

describe("CascadeTraceBreadcrumb — Phase 5 (#1706)", () => {
  it("renders nothing when cascadeSources is empty", () => {
    const { container } = render(<CascadeTraceBreadcrumb contract={baseContract} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Domain → Course → effective when both layers present", () => {
    render(
      <CascadeTraceBreadcrumb
        contract={{
          ...baseContract,
          cascadeSources: [
            { level: "domain", storagePath: "domain.welcomeMessage" },
            { level: "group", storagePath: "config.sessionFlow.welcomeMessage" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("hf-cascade-trace-welcomeMessage")).toBeInTheDocument();
    expect(screen.getByTestId("hf-cascade-trace-layer-domain")).toBeInTheDocument();
    expect(screen.getByTestId("hf-cascade-trace-layer-group")).toBeInTheDocument();
    expect(screen.getByText("effective")).toBeInTheDocument();
  });
});
