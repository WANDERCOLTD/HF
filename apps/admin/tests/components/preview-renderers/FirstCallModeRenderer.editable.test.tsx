/**
 * FirstCallModeRenderer — Phase 2 #1687 editable/read-only branches.
 *
 * Sibling to the existing FirstCallModeRenderer.test.tsx — keeps the
 * legacy read-only tests intact while adding the new editable path.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { FirstCallModeRenderer } from "@/components/shared/preview-renderers/FirstCallModeRenderer";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn();

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("FirstCallModeRenderer — editable branch (Phase 2 #1687)", () => {
  it("renders read-only badge when no provider mounted", () => {
    render(
      <FirstCallModeRenderer
        data={{ firstCallMode: "teach_immediately" }}
        selection={{ selectedKey: "firstCallMode" }}
      />,
    );
    expect(screen.getByText("Teach Immediately")).toBeInTheDocument();
  });

  it("renders read-only when provider has courseId=null", () => {
    render(
      <JourneySettingMutatorProvider courseId={null}>
        <FirstCallModeRenderer
          data={{ firstCallMode: "teach_immediately" }}
          selection={{ selectedKey: "firstCallMode" }}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByText("Teach Immediately")).toBeInTheDocument();
  });

  it("renders editable JourneyField when courseId is set + not readonly", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <FirstCallModeRenderer
          data={{ firstCallMode: "teach_immediately" }}
          selection={{ selectedKey: "firstCallMode" }}
        />
      </JourneySettingMutatorProvider>,
    );
    // The JourneyField's FieldShell mounts with a testid keyed off the
    // contract.id.
    expect(screen.getByTestId("hf-jf-row-firstCallMode")).toBeInTheDocument();
  });

  it("editable path PATCHes the journey-setting route on change", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <FirstCallModeRenderer
          data={{ firstCallMode: "onboarding" }}
          selection={{ selectedKey: "firstCallMode" }}
        />
      </JourneySettingMutatorProvider>,
    );
    // Click a segmented option (Teach Immediately)
    fireEvent.click(screen.getByRole("button", { name: /teach immediately/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/courses/course-1/journey-setting");
    expect(init?.method).toBe("PATCH");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.settingId).toBe("firstCallMode");
    expect(body.value).toBe("teach_immediately");
  });

  it("readonly=true in provider suppresses editing", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1" readonly>
        <FirstCallModeRenderer
          data={{ firstCallMode: "teach_immediately" }}
          selection={{ selectedKey: "firstCallMode" }}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByText("Teach Immediately")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-jf-row-firstCallMode")).toBeNull();
  });
});
