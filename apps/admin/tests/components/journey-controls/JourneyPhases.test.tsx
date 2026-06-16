import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { JourneyPhases } from "@/components/journey-controls/JourneyPhases";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

const contract: JourneySettingContract = {
  id: "onboardingFlowPhases",
  group: "G2",
  educatorLabel: "Onboarding phases",
  storagePath: "config.onboardingFlowPhases",
  control: "phases",
  cascadeSources: [],
  composeImpact: {
    sections: ["onboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          effectiveValue: null,
          autoEnabled: [],
          bumpedSections: [],
        }),
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
      <JourneyPhases contract={contract} value={value} onSave={vi.fn()} />
    </JourneySettingMutatorProvider>,
  );
}

describe("JourneyPhases — typed compound editor", () => {
  it("shows placeholder when there is no provider", () => {
    render(
      <JourneyPhases
        contract={contract}
        value={{ phases: [{ phase: "Intro", duration: "5m", goals: [] }] }}
        onSave={vi.fn(() => Promise.resolve())}
      />,
    );
    // Placeholder summarises phases but does not render add/edit affordances.
    expect(screen.getByTestId("hf-jf-phases-onboardingFlowPhases")).toBeInTheDocument();
    expect(
      screen.queryByTestId("hf-jf-phases-add-onboardingFlowPhases"),
    ).toBeNull();
  });

  it("renders empty state + Add phase button when provider is set", () => {
    renderWithProvider({ phases: [] });
    expect(screen.getByText(/No phases yet/)).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-jf-phases-add-onboardingFlowPhases"),
    ).toBeInTheDocument();
  });

  it("renders existing phases with name/duration/goals fields", () => {
    renderWithProvider({
      phases: [
        { phase: "Intro", duration: "5 minutes", goals: ["Welcome", "Orient"] },
        { phase: "Setup", duration: "2 minutes", goals: ["Configure"] },
      ],
    });
    const nameInput = screen.getByTestId(
      "hf-jf-phase-onboardingFlowPhases-0-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Intro");
    const goals = screen.getByTestId(
      "hf-jf-phase-onboardingFlowPhases-0-goals",
    ) as HTMLTextAreaElement;
    expect(goals.value).toBe("Welcome\nOrient");
  });

  it("clicking Add phase appends and commits", async () => {
    renderWithProvider({ phases: [] });
    fireEvent.click(
      screen.getByTestId("hf-jf-phases-add-onboardingFlowPhases"),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.value.phases).toHaveLength(1);
    expect(body.value.phases[0]).toMatchObject({
      phase: "",
      duration: "",
      goals: [],
    });
  });

  it("removing a phase commits the shorter list", async () => {
    renderWithProvider({
      phases: [
        { phase: "A", duration: "1m", goals: [] },
        { phase: "B", duration: "2m", goals: [] },
      ],
    });
    fireEvent.click(
      screen.getByTestId("hf-jf-phase-remove-onboardingFlowPhases-0"),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.value.phases).toHaveLength(1);
    expect(body.value.phases[0].phase).toBe("B");
  });

  it("preserves wrapper extras (successMetrics) and per-phase extras (content/surveySteps)", async () => {
    renderWithProvider({
      successMetrics: ["learner can describe goals"],
      phases: [
        {
          phase: "Intro",
          duration: "5m",
          goals: [],
          content: [{ mediaId: "vid-1" }],
          surveySteps: [{ id: "s1", prompt: "ok?" }],
        },
      ],
    });
    fireEvent.click(
      screen.getByTestId("hf-jf-phases-add-onboardingFlowPhases"),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.value.successMetrics).toEqual(["learner can describe goals"]);
    expect(body.value.phases[0].content).toEqual([{ mediaId: "vid-1" }]);
    expect(body.value.phases[0].surveySteps).toEqual([{ id: "s1", prompt: "ok?" }]);
  });

  it("Move down swaps adjacent phases", async () => {
    renderWithProvider({
      phases: [
        { phase: "A", duration: "1m", goals: [] },
        { phase: "B", duration: "2m", goals: [] },
      ],
    });
    fireEvent.click(
      screen.getByTestId("hf-jf-phase-down-onboardingFlowPhases-0"),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.value.phases.map((p: { phase: string }) => p.phase)).toEqual(["B", "A"]);
  });
});
