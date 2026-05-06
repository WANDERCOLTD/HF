import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentModulePickerPage from "@/app/x/student/[courseId]/modules/page";
import type { AuthoredModule } from "@/lib/types/json-fields";

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useParams: () => ({ courseId: "course-1" }),
  useSearchParams: () => new URLSearchParams("returnTo=/x/sim/caller-1"),
}));

function mod(over: Partial<AuthoredModule>): AuthoredModule {
  return {
    id: "m",
    label: "Module",
    learnerSelectable: true,
    mode: "tutor",
    duration: "Student-led",
    scoringFired: "All four",
    voiceBandReadout: false,
    sessionTerminal: false,
    frequency: "repeatable",
    outcomesPrimary: [],
    prerequisites: [],
    ...over,
  };
}

const MODULES: AuthoredModule[] = [
  mod({ id: "baseline", label: "Baseline", sessionTerminal: true, frequency: "once" }),
  mod({ id: "part1", label: "Part 1" }),
];

function mockFetch(payload: object, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve({ ok: status === 200, ...payload }),
    } as Response),
  );
}

describe("StudentModulePickerPage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
  });

  it("renders the picker when modulesAuthored=true", async () => {
    global.fetch = mockFetch({
      modulesAuthored: true,
      modules: MODULES,
      lessonPlanMode: "continuous",
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    expect(await screen.findByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("Part 1")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to returnTo when modulesAuthored=false", async () => {
    global.fetch = mockFetch({
      modulesAuthored: false,
      modules: [],
      lessonPlanMode: null,
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/x/sim/caller-1");
    });
  });

  it("redirects when modulesAuthored=null (never imported)", async () => {
    global.fetch = mockFetch({
      modulesAuthored: null,
      modules: [],
      lessonPlanMode: null,
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/x/sim/caller-1");
    });
  });

  it("non-terminal pick navigates to returnTo with requestedModuleId", async () => {
    global.fetch = mockFetch({
      modulesAuthored: true,
      modules: MODULES,
      lessonPlanMode: "continuous",
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);
    const tile = await screen.findByText("Part 1");
    fireEvent.click(tile);

    expect(screen.getByText("Starting session…")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(pushMock).toHaveBeenCalledWith(
          "/x/sim/caller-1?requestedModuleId=part1",
        );
      },
      { timeout: 1500 },
    );
  });

  it("terminal pick shows confirm dialog before launching", async () => {
    global.fetch = mockFetch({
      modulesAuthored: true,
      modules: MODULES,
      lessonPlanMode: "continuous",
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);
    const baselineTile = await screen.findByText("Baseline");
    fireEvent.click(baselineTile);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/ends the session/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Start Baseline/));

    await waitFor(
      () => {
        expect(pushMock).toHaveBeenCalledWith(
          "/x/sim/caller-1?requestedModuleId=baseline",
        );
      },
      { timeout: 1500 },
    );
  });

  it("terminal cancel closes the dialog without launching", async () => {
    global.fetch = mockFetch({
      modulesAuthored: true,
      modules: MODULES,
      lessonPlanMode: "continuous",
      validationWarnings: [],
      hasErrors: false,
    }) as typeof fetch;

    render(<StudentModulePickerPage />);
    fireEvent.click(await screen.findByText("Baseline"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Cancel/));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows an error message on 404", async () => {
    global.fetch = mockFetch({}, 404) as typeof fetch;
    render(<StudentModulePickerPage />);
    expect(await screen.findByText("Course not found")).toBeInTheDocument();
  });
});
