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

vi.mock("@/hooks/useStudentCallerId", () => ({
  useStudentCallerId: () => ({
    callerId: null,
    isAdmin: false,
    hasSelection: true,
    buildUrl: (base: string) => base,
  }),
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

interface FetchOptions {
  modulesPayload?: object;
  modulesStatus?: number;
  progress?: Array<{
    moduleId: string;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    completedAt: string | null;
    module: { id: string; slug: string; title: string; sortOrder: number };
  }>;
}

function mockFetch({ modulesPayload, modulesStatus = 200, progress = [] }: FetchOptions) {
  return vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/student/module-progress")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, progress }),
      } as Response);
    }
    return Promise.resolve({
      ok: modulesStatus === 200,
      status: modulesStatus,
      json: () =>
        Promise.resolve({ ok: modulesStatus === 200, ...(modulesPayload ?? {}) }),
    } as Response);
  });
}

describe("StudentModulePickerPage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
  });

  it("renders the picker when modulesAuthored=true", async () => {
    global.fetch = mockFetch({
      modulesPayload: {
        modulesAuthored: true,
        modules: MODULES,
        lessonPlanMode: "continuous",
        validationWarnings: [],
        hasErrors: false,
      },
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    expect(await screen.findByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("Part 1")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to returnTo when modulesAuthored=false", async () => {
    global.fetch = mockFetch({
      modulesPayload: {
        modulesAuthored: false,
        modules: [],
        lessonPlanMode: null,
        validationWarnings: [],
        hasErrors: false,
      },
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/x/sim/caller-1");
    });
  });

  it("redirects when modulesAuthored=null (never imported)", async () => {
    global.fetch = mockFetch({
      modulesPayload: {
        modulesAuthored: null,
        modules: [],
        lessonPlanMode: null,
        validationWarnings: [],
        hasErrors: false,
      },
    }) as typeof fetch;

    render(<StudentModulePickerPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/x/sim/caller-1");
    });
  });

  it("non-terminal pick navigates to returnTo with requestedModuleId", async () => {
    global.fetch = mockFetch({
      modulesPayload: {
        modulesAuthored: true,
        modules: MODULES,
        lessonPlanMode: "continuous",
        validationWarnings: [],
        hasErrors: false,
      },
    }) as typeof fetch;

    render(<StudentModulePickerPage />);
    const tile = await screen.findByText("Part 1");
    fireEvent.click(tile);

    expect(screen.getByText(/VAPI call would start/i)).toBeInTheDocument();

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
      modulesPayload: {
        modulesAuthored: true,
        modules: MODULES,
        lessonPlanMode: "continuous",
        validationWarnings: [],
        hasErrors: false,
      },
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
      modulesPayload: {
        modulesAuthored: true,
        modules: MODULES,
        lessonPlanMode: "continuous",
        validationWarnings: [],
        hasErrors: false,
      },
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
    global.fetch = mockFetch({ modulesStatus: 404 }) as typeof fetch;
    render(<StudentModulePickerPage />);
    expect(await screen.findByText("Course not found")).toBeInTheDocument();
  });

  it("renders sectioned tiles when progress contains COMPLETED + IN_PROGRESS", async () => {
    global.fetch = mockFetch({
      modulesPayload: {
        modulesAuthored: true,
        modules: MODULES,
        lessonPlanMode: "continuous",
        validationWarnings: [],
        hasErrors: false,
      },
      progress: [
        {
          moduleId: "uuid-baseline",
          status: "COMPLETED",
          completedAt: "2026-05-01T00:00:00Z",
          module: { id: "uuid-baseline", slug: "baseline", title: "Baseline", sortOrder: 0 },
        },
        {
          moduleId: "uuid-part1",
          status: "IN_PROGRESS",
          completedAt: null,
          module: { id: "uuid-part1", slug: "part1", title: "Part 1", sortOrder: 1 },
        },
      ],
    }) as typeof fetch;

    const { container } = render(<StudentModulePickerPage />);

    // Wait for both fetches to settle
    await screen.findByText("Part 1");
    // Baseline is `frequency: once` + COMPLETED → still hidden
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
    // Section title and tile badge both render — at least one of each
    expect(container.querySelector(".learner-picker__section-title")).not.toBeNull();
    expect(container.querySelector(".learner-picker__badge--progress")).not.toBeNull();
  });
});
