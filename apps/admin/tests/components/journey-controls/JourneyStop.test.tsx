import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { JourneyStop } from "@/components/journey-controls/JourneyStop";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "preTestStop",
  group: "G2",
  educatorLabel: "Pre-test stop",
  storagePath: {
    path: "sessionFlow.stops[]",
    arrayKey: "id",
    selectorValue: "pre-test",
    writeMode: "merge",
  },
  control: "stop",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate", "instructions"],
    kinds: ["section-enable", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, effectiveValue: null, autoEnabled: [], bumpedSections: [] }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithProvider(value: unknown) {
  return render(
    <JourneySettingMutatorProvider courseId="course-1">
      <JourneyStop contract={contract} value={value} onSave={vi.fn()} />
    </JourneySettingMutatorProvider>,
  );
}

describe("JourneyStop — typed compound editor", () => {
  it("shows placeholder when there is no provider", () => {
    render(
      <JourneyStop
        contract={contract}
        value={null}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    // No editable controls — only the placeholder shell.
    expect(
      screen.queryByTestId("hf-jf-stop-preTestStop-enabled"),
    ).toBeNull();
    expect(screen.getByTestId("hf-jf-stop-preTestStop")).toBeInTheDocument();
  });

  it("renders enabled toggle + trigger dropdown when provider is set", () => {
    renderWithProvider({ enabled: false, trigger: { type: "first_session" } });
    expect(
      screen.getByTestId("hf-jf-stop-preTestStop-enabled"),
    ).toBeInTheDocument();
    const select = screen.getByTestId("hf-jf-stop-preTestStop-trigger-type") as HTMLSelectElement;
    expect(select.value).toBe("first_session");
  });

  it("commits with new enabled + preserved extras when toggle is clicked", async () => {
    renderWithProvider({
      id: "preTestStop-1",
      kind: "assessment",
      delivery: { mode: "voice" },
      enabled: false,
      trigger: { type: "first_session" },
    });
    fireEvent.click(screen.getByTestId("hf-jf-stop-preTestStop-enabled"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.settingId).toBe("preTestStop");
    // Extras preserved across save:
    expect(body.value.id).toBe("preTestStop-1");
    expect(body.value.kind).toBe("assessment");
    expect(body.value.delivery).toEqual({ mode: "voice" });
    // New enabled committed:
    expect(body.value.enabled).toBe(true);
    expect(body.value.trigger).toEqual({ type: "first_session" });
  });

  it("shows index input when trigger type is before_session", () => {
    renderWithProvider({ enabled: true, trigger: { type: "before_session", index: 2 } });
    const indexInput = screen.getByTestId(
      "hf-jf-stop-preTestStop-trigger-index",
    ) as HTMLInputElement;
    expect(indexInput.value).toBe("2");
  });

  it("shows threshold input when trigger type is mastery_reached", () => {
    renderWithProvider({ enabled: true, trigger: { type: "mastery_reached", threshold: 0.8 } });
    const input = screen.getByTestId(
      "hf-jf-stop-preTestStop-trigger-threshold",
    ) as HTMLInputElement;
    expect(input.value).toBe("0.8");
  });

  it("shows count input when trigger type is session_count", () => {
    renderWithProvider({ enabled: true, trigger: { type: "session_count", count: 5 } });
    const input = screen.getByTestId(
      "hf-jf-stop-preTestStop-trigger-count",
    ) as HTMLInputElement;
    expect(input.value).toBe("5");
  });

  it("switching trigger type to mastery_reached defaults threshold to 0.7", async () => {
    renderWithProvider({ enabled: true, trigger: { type: "first_session" } });
    const select = screen.getByTestId(
      "hf-jf-stop-preTestStop-trigger-type",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "mastery_reached" } });
    const threshold = await waitFor(() =>
      screen.getByTestId("hf-jf-stop-preTestStop-trigger-threshold"),
    ) as HTMLInputElement;
    expect(threshold.value).toBe("0.7");
  });
});
