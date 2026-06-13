/**
 * Slice 1 of epic #1263 — Course Design Console smoke tests.
 *
 * Covers:
 *  - Console renders 12 lenses in the nav (5 Journey + 6 Behaviour + 1 Preview)
 *  - Default lens on first paint is `intake`
 *  - URL param is `?design_view=` not `?view=`
 *  - Each Journey lens scope-filters SessionFlowEditor to the correct rows
 *  - Dual-read fallback: a pre-migration course (welcome.* set, sessionFlow.intake
 *    empty) still renders non-blank intake toggles — covered upstream by
 *    `resolveSessionFlow` because the resolver maps `welcome.*` → `intake.*`
 *    when the new shape is absent, and SessionFlowEditor consumes the resolved
 *    response shape verbatim. This test asserts the wiring is intact.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within } from "@testing-library/react";

import { CourseDesignConsole } from "@/app/x/courses/[courseId]/_components/CourseDesignConsole";

const replaceSpy = vi.fn();
let currentDesignView: string | null = null;

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ replace: replaceSpy }),
    useSearchParams: () => ({
      get: (key: string) => (key === "design_view" ? currentDesignView : null),
      toString: () =>
        currentDesignView ? `design_view=${currentDesignView}` : "",
    }),
  };
});

// #1531 — PreviewLens consumes `useChatContext()` to read the
// `demoAnnotationsVisible` toggle. Tests render PreviewLens directly
// (lazy compose) without a `<ChatProvider>`, so stub the hook to a
// minimal shape — `demoAnnotationsVisible: true` matches the default.
vi.mock("@/contexts/ChatContext", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/contexts/ChatContext",
  );
  return {
    ...actual,
    useChatContext: () => ({ demoAnnotationsVisible: true }),
  };
});

// Synthetic resolved Session Flow response — represents a *post-migration*
// course (sessionFlow.intake set, welcome legacy can be absent).
function makeResolvedResponse(opts: {
  intakeEnabled?: Partial<{
    goals: boolean;
    aboutYou: boolean;
    knowledgeCheck: boolean;
    aiIntroCall: boolean;
  }>;
  intakeShape?: "new" | "legacy-only";
} = {}) {
  const enabled = {
    goals: opts.intakeEnabled?.goals ?? true,
    aboutYou: opts.intakeEnabled?.aboutYou ?? true,
    knowledgeCheck: opts.intakeEnabled?.knowledgeCheck ?? true,
    aiIntroCall: opts.intakeEnabled?.aiIntroCall ?? false,
  };
  return {
    ok: true,
    sessionFlow: {
      intake: {
        goals: { enabled: enabled.goals },
        aboutYou: { enabled: enabled.aboutYou },
        knowledgeCheck: { enabled: enabled.knowledgeCheck, deliveryMode: "mcq" },
        aiIntroCall: { enabled: enabled.aiIntroCall },
      },
      onboarding: { phases: [{ phase: "init-welcome", duration: "1 min", goals: ["Greet"] }] },
      stops: [],
      offboarding: { triggerAfterCalls: 0, phases: [] },
      welcomeMessage: null,
      source: {
        intake: opts.intakeShape === "legacy-only" ? "legacy-welcome" : "new-shape",
        onboarding: "playbook-legacy",
        stops: "synthesized-from-legacy",
        offboarding: "defaults",
        welcomeMessage: "generic",
      },
    },
    mode: "structured",
    teachingMode: null,
    sessionCount: 4,
    courseName: "Fixture",
    domainId: null,
    domainName: null,
  };
}

function mockSessionFlowFetch(response: ReturnType<typeof makeResolvedResponse>) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
  (global as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

beforeEach(() => {
  replaceSpy.mockReset();
  currentDesignView = null;
});

describe("CourseDesignConsole — nav", () => {
  it("renders 14 lenses in the nav (5 Journey + 7 Behaviour + 1 Preview + 1 Voice Flow)", () => {
    // 7 Behaviour: call1Mode + moduleVisibility (#1405) + firstCallTargets +
    // tolerances + skillBanding + progressSignals + agentTunerNlp.
    mockSessionFlowFetch(makeResolvedResponse());
    const { container } = render(<CourseDesignConsole courseId="course-1" />);
    const items = container.querySelectorAll(".hf-console-shell-nav-item");
    expect(items.length).toBe(14);
  });

  it("renders a 'soon' badge only on agentTunerNlp (1 — Slices 2+3 absorbed the rest)", () => {
    mockSessionFlowFetch(makeResolvedResponse());
    const { container } = render(<CourseDesignConsole courseId="course-1" />);
    const soon = container.querySelectorAll(".hf-console-shell-nav-soon");
    expect(soon.length).toBe(1);
  });

  it("defaults to Preview when ?design_view= is absent", () => {
    mockSessionFlowFetch(makeResolvedResponse());
    const { container } = render(<CourseDesignConsole courseId="course-1" />);
    const active = container.querySelector(".hf-console-shell-nav-item--active");
    expect(active?.textContent).toContain("Preview");
  });

  it("activates the lens pointed to by ?design_view=onboarding", () => {
    currentDesignView = "onboarding";
    mockSessionFlowFetch(makeResolvedResponse());
    const { container } = render(<CourseDesignConsole courseId="course-1" />);
    const active = container.querySelector(".hf-console-shell-nav-item--active");
    expect(active?.textContent).toContain("Onboarding");
  });
});

describe("CourseDesignConsole — lens-scoped SessionFlowEditor", () => {
  it("Intake lens renders the four intake rows when sessionFlow.intake is populated (new shape)", async () => {
    currentDesignView = "intake";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByText } = render(<CourseDesignConsole courseId="course-1" />);
    // SessionFlowEditor is async (fetch + setData) — findByText awaits resolution.
    await findByText("Goals question");
    await findByText("About You");
    await findByText("Knowledge Check");
    await findByText("AI Intro Call");
  });

  it("Intake lens renders non-blank for a pre-migration course (welcome.* set, sessionFlow.intake empty)", async () => {
    // The resolver collapses `welcome.*` into `sessionFlow.intake.*` shape via
    // the `legacy-welcome` source path. The GET route returns the *resolved*
    // shape, so the editor sees a populated intake object regardless of which
    // legacy field the data lived in. This test asserts the dual-read wiring
    // remains intact by feeding a `source.intake = "legacy-welcome"` payload.
    currentDesignView = "intake";
    mockSessionFlowFetch(
      makeResolvedResponse({
        intakeShape: "legacy-only",
        intakeEnabled: { goals: true, aboutYou: false, knowledgeCheck: true, aiIntroCall: false },
      }),
    );
    const { findByText, queryByText } = render(<CourseDesignConsole courseId="course-1" />);
    // All four intake rows should render — none silently dropped because of
    // the missing new shape.
    await findByText("Goals question");
    expect(queryByText("About You")).not.toBeNull();
    expect(queryByText("Knowledge Check")).not.toBeNull();
    expect(queryByText("AI Intro Call")).not.toBeNull();
  });

  it("Welcome lens renders the Welcome message row + inline editor", async () => {
    currentDesignView = "welcome";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByRole, queryByText } = render(<CourseDesignConsole courseId="course-1" />);
    const panel = (await findByRole("tabpanel")) as HTMLElement;
    // Inline Greeting form — #1403/#1495 renamed the drawer heading
    // ("Welcome message" → "Greeting — first call opener"). The drawer title
    // becomes the inline card heading.
    await within(panel).findByRole("heading", { name: "Greeting — first call opener" });
    // Inline form textarea is present
    expect(panel.querySelector("textarea")).not.toBeNull();
    // Intake rows must NOT appear in the Welcome lens panel
    expect(queryByText("Goals question")).toBeNull();
    expect(queryByText("About You")).toBeNull();
  });

  it("Onboarding lens renders only the Onboarding row", async () => {
    currentDesignView = "onboarding";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByRole, queryByText } = render(<CourseDesignConsole courseId="course-1" />);
    const panel = (await findByRole("tabpanel")) as HTMLElement;
    await within(panel).findByText("Onboarding");
    expect(queryByText("Goals question")).toBeNull();
    // Welcome message row not present in this lens
    expect(within(panel).queryByText("Welcome message")).toBeNull();
  });

  it("Offboarding lens renders only the Offboarding row", async () => {
    currentDesignView = "offboarding";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByRole, queryByText } = render(<CourseDesignConsole courseId="course-1" />);
    const panel = (await findByRole("tabpanel")) as HTMLElement;
    await within(panel).findByText("Offboarding");
    expect(queryByText("Goals question")).toBeNull();
  });
});

describe("CourseDesignConsole — soon lens behaviour", () => {
  it("agentTunerNlp lens still shows Coming soon (parked per #1276)", async () => {
    currentDesignView = "agentTunerNlp";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByRole } = render(<CourseDesignConsole courseId="course-1" />);
    const panel = (await findByRole("tabpanel")) as HTMLElement;
    await within(panel).findByText("Coming soon");
    await within(panel).findByRole("heading", { name: "Agent Tuner (NLP)" });
  });

  it("Preview lens mounts and shows its header on activation (lazy compose)", async () => {
    currentDesignView = "preview";
    mockSessionFlowFetch(makeResolvedResponse());
    const { findByRole } = render(<CourseDesignConsole courseId="course-1" />);
    const panel = (await findByRole("tabpanel")) as HTMLElement;
    // Header text appears even before compose finishes
    await within(panel).findByText(/Preview — Call 1/);
  });
});
