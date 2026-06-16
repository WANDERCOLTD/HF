import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { JourneyInspectorPanel } from "@/components/journey-tab/JourneyInspectorPanel";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response),
);

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockClear();
});

describe("JourneyInspectorPanel — Slice C (#1721) bucket-stacking", () => {
  it("shows empty state when no bucket selected", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId={null} />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-journey-inspector-empty")).toBeInTheDocument();
  });

  it("stacks every setting in the selected bucket", () => {
    render(
      <JourneySettingMutatorProvider
        courseId="c1"
        playbookConfig={{ sessionFlow: { welcomeMessage: "hi" } }}
      >
        <JourneyInspectorPanel selectedBucketId="B_call1_opening" />
      </JourneySettingMutatorProvider>,
    );
    // The bucket container should be present.
    expect(
      screen.getByTestId("hf-journey-inspector-bucket-B_call1_opening"),
    ).toBeInTheDocument();
    // welcomeMessage lives in B_call1_opening; its row should mount.
    expect(
      screen.getByTestId("hf-journey-inspector-row-welcomeMessage"),
    ).toBeInTheDocument();
  });

  it("renders the bucket header with caption for a populated bucket", () => {
    render(
      <JourneySettingMutatorProvider courseId="c1" playbookConfig={{}}>
        <JourneyInspectorPanel selectedBucketId="A_intake" />
      </JourneySettingMutatorProvider>,
    );
    // A_intake → "Sign-up & pre-call profile".
    expect(screen.getByText(/Sign-up & pre-call profile/)).toBeInTheDocument();
  });
});
