import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ModePolicyRenderer } from "@/components/shared/preview-renderers/ModePolicyRenderer";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn();

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("ModePolicyRenderer — editable (#1689)", () => {
  const data = {
    teachingMode: "recall",
    useFreshMastery: false,
    maxMasteryTier: "FOUNDATION",
  };

  it("read-only when no provider", () => {
    render(
      <ModePolicyRenderer data={data} selection={{ selectedKey: "modePolicy" }} />,
    );
    expect(screen.getByText("Recall")).toBeInTheDocument();
  });

  it("editable mounts JourneyFields for useFreshMastery + maxMasteryTier", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <ModePolicyRenderer
          data={data}
          selection={{ selectedKey: "modePolicy" }}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-jf-row-useFreshMastery")).toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-maxMasteryTier")).toBeInTheDocument();
  });

  it("toggle useFreshMastery fires PATCH with new value", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <ModePolicyRenderer
          data={data}
          selection={{ selectedKey: "modePolicy" }}
        />
      </JourneySettingMutatorProvider>,
    );
    fireEvent.click(screen.getByTestId("hf-jf-toggle-useFreshMastery"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const init = vi.mocked(global.fetch).mock.calls[0][1]!;
    const body = JSON.parse(init.body as string);
    expect(body.settingId).toBe("useFreshMastery");
    expect(body.value).toBe(true);
  });
});
