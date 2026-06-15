import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn();

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("JourneyInspectorPanel — Phase 4 (#1697)", () => {
  it("shows empty state when no setting selected", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedSettingId={null} />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-journey-inspector-empty")).toBeInTheDocument();
  });

  it("mounts JourneyField for a registered settingId", () => {
    render(
      <JourneySettingMutatorProvider
        courseId="c1"
        playbookConfig={{ sessionFlow: { welcomeMessage: "hi" } }}
      >
        <JourneyInspectorPanel selectedSettingId="welcomeMessage" />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-journey-inspector-welcomeMessage")).toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-welcomeMessage")).toBeInTheDocument();
  });

  it("renders unknown-setting state for an unregistered id", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedSettingId="not_real" />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByText(/Unknown setting/)).toBeInTheDocument();
  });
});
