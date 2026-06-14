/**
 * B.13 renderer suite (#1623) — registry contract + per-section render
 * output for the 5 migrated PreviewLens sections.
 *
 * Pinned acceptance per section:
 *   1. Registry contract — `getPreviewRenderer(<key>)` returns the
 *      registered component after the renderer module loads.
 *   2. Empty / null session-flow state — muted fallback, never crashes.
 *   3. Populated state — chips render with the expected labels.
 *   4. Source labels surface when present (provenance discipline).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  WelcomeRenderer,
  type WelcomeRendererData,
  IntakeRenderer,
  type IntakeRendererData,
  OnboardingRenderer,
  type OnboardingRendererData,
  OffboardingRenderer,
  type OffboardingRendererData,
  NpsRenderer,
  type NpsRendererData,
  type SessionFlowData,
} from "@/components/shared/preview-renderers";
import {
  getPreviewRenderer,
  registerPreviewRenderer,
} from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  registerPreviewRenderer<"welcome", WelcomeRendererData>("welcome", WelcomeRenderer);
  registerPreviewRenderer<"intake", IntakeRendererData>("intake", IntakeRenderer);
  registerPreviewRenderer<"onboarding", OnboardingRendererData>(
    "onboarding",
    OnboardingRenderer,
  );
  registerPreviewRenderer<"offboarding", OffboardingRendererData>(
    "offboarding",
    OffboardingRenderer,
  );
  registerPreviewRenderer<"nps", NpsRendererData>("nps", NpsRenderer);
});

function makeSessionFlow(
  overrides: Partial<SessionFlowData> = {},
): SessionFlowData {
  return {
    intake: {
      goals: { enabled: false },
      aboutYou: { enabled: false },
      knowledgeCheck: { enabled: false, deliveryMode: "mcq" },
      aiIntroCall: { enabled: false },
    },
    onboarding: { phases: [] },
    welcomeMessage: null,
    firstCallCourseIntro: null,
    firstCallWaitForAck: "none",
    offboarding: { phases: [] },
    stops: [],
    ...overrides,
  };
}

describe("B.13 renderers — registry contract", () => {
  it("registers all 5 section renderers under their canonical keys", () => {
    expect(getPreviewRenderer("welcome")).toBe(WelcomeRenderer);
    expect(getPreviewRenderer("intake")).toBe(IntakeRenderer);
    expect(getPreviewRenderer("onboarding")).toBe(OnboardingRenderer);
    expect(getPreviewRenderer("offboarding")).toBe(OffboardingRenderer);
    expect(getPreviewRenderer("nps")).toBe(NpsRenderer);
  });
});

describe("WelcomeRenderer", () => {
  it("renders muted fallback when sessionFlow is null", () => {
    render(
      <WelcomeRenderer
        data={{ sessionFlow: null }}
        selection={{ selectedKey: "welcome" }}
      />,
    );
    expect(screen.getByText("Session flow not loaded")).toBeInTheDocument();
  });

  it("renders the resolved greeting + source badge when set", () => {
    const sf = makeSessionFlow({
      welcomeMessage: "Hi {firstName}, welcome to {courseName}.",
      firstCallWaitForAck: "any_response",
      source: { welcomeMessage: "playbook" },
    });
    render(
      <WelcomeRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "welcome" }}
      />,
    );
    expect(screen.getByText("Welcome set")).toBeInTheDocument();
    expect(screen.getByText("from PLAYBOOK")).toBeInTheDocument();
    expect(screen.getByText(/Hi \{firstName\}/)).toBeInTheDocument();
    expect(screen.getByText("Waits for any reply")).toBeInTheDocument();
  });

  it("renders the course-intro panel when authored", () => {
    const sf = makeSessionFlow({
      welcomeMessage: "Welcome.",
      firstCallCourseIntro: "Today we'll cover the basics.",
    });
    render(
      <WelcomeRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "welcome" }}
      />,
    );
    expect(screen.getByText("Course intro")).toBeInTheDocument();
    expect(screen.getByText("Authored")).toBeInTheDocument();
    expect(
      screen.getByText("Today we'll cover the basics."),
    ).toBeInTheDocument();
  });
});

describe("IntakeRenderer", () => {
  it("renders 4 OFF chips + muted source when empty", () => {
    render(
      <IntakeRenderer
        data={{ sessionFlow: makeSessionFlow() }}
        selection={{ selectedKey: "intake" }}
      />,
    );
    expect(screen.getByText(/Goals: OFF/)).toBeInTheDocument();
    expect(screen.getByText(/About you: OFF/)).toBeInTheDocument();
    expect(screen.getByText(/Knowledge check \(MCQ\): OFF/)).toBeInTheDocument();
    expect(screen.getByText(/AI intro call: OFF/)).toBeInTheDocument();
  });

  it("flips chips to ON and surfaces Socratic delivery mode", () => {
    const sf = makeSessionFlow({
      intake: {
        goals: { enabled: true },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: true, deliveryMode: "socratic" },
        aiIntroCall: { enabled: false },
      },
      source: { intake: "new-shape" },
    });
    render(
      <IntakeRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "intake" }}
      />,
    );
    expect(screen.getByText(/Goals: ON/)).toBeInTheDocument();
    expect(screen.getByText(/About you: ON/)).toBeInTheDocument();
    expect(
      screen.getByText(/Knowledge check \(Socratic\): ON/),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI intro call: OFF/)).toBeInTheDocument();
    expect(screen.getByText("source: new-shape")).toBeInTheDocument();
  });
});

describe("OnboardingRenderer", () => {
  it("renders empty state when no phases", () => {
    render(
      <OnboardingRenderer
        data={{ sessionFlow: makeSessionFlow() }}
        selection={{ selectedKey: "onboarding" }}
      />,
    );
    expect(
      screen.getByText("No phases configured — using fallback"),
    ).toBeInTheDocument();
  });

  it("renders phase chips with optional duration + goal preview", () => {
    const sf = makeSessionFlow({
      onboarding: {
        phases: [
          { phase: "Intro", duration: "2m", goals: ["Set context"] },
          { phase: "Goal capture" },
        ],
      },
      source: { onboarding: "playbook-legacy" },
    });
    render(
      <OnboardingRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "onboarding" }}
      />,
    );
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(screen.getByText("2m")).toBeInTheDocument();
    expect(screen.getByText("Set context")).toBeInTheDocument();
    expect(screen.getByText("Goal capture")).toBeInTheDocument();
    expect(screen.getByText("source: playbook-legacy")).toBeInTheDocument();
  });
});

describe("OffboardingRenderer", () => {
  it("renders empty state when no phases", () => {
    render(
      <OffboardingRenderer
        data={{ sessionFlow: makeSessionFlow() }}
        selection={{ selectedKey: "offboarding" }}
      />,
    );
    expect(screen.getByText("No phases configured")).toBeInTheDocument();
  });

  it("renders phases + the call-count trigger pluralised correctly", () => {
    const sf = makeSessionFlow({
      offboarding: {
        phases: [{ phase: "Wrap-up" }, { phase: "Survey" }],
        triggerAfterCalls: 5,
      },
    });
    render(
      <OffboardingRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "offboarding" }}
      />,
    );
    expect(screen.getByText("Wrap-up")).toBeInTheDocument();
    expect(screen.getByText("Survey")).toBeInTheDocument();
    expect(screen.getByText("After 5 calls")).toBeInTheDocument();
  });

  it("uses singular call-count copy when triggerAfterCalls is 1", () => {
    const sf = makeSessionFlow({
      offboarding: { phases: [{ phase: "Wrap-up" }], triggerAfterCalls: 1 },
    });
    render(
      <OffboardingRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "offboarding" }}
      />,
    );
    expect(screen.getByText("After 1 call")).toBeInTheDocument();
  });
});

describe("NpsRenderer", () => {
  it("renders muted state when no nps stop in the flow", () => {
    render(
      <NpsRenderer
        data={{ sessionFlow: makeSessionFlow() }}
        selection={{ selectedKey: "nps" }}
      />,
    );
    expect(screen.getByText("No NPS stop configured")).toBeInTheDocument();
  });

  it("describes the mastery_reached trigger as a percentage", () => {
    const sf = makeSessionFlow({
      stops: [
        {
          id: "s1",
          kind: "nps",
          trigger: { type: "mastery_reached", threshold: 0.85 },
        },
      ],
    });
    render(
      <NpsRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "nps" }}
      />,
    );
    expect(screen.getByText(/Mastery ≥ 85%/)).toBeInTheDocument();
  });

  it("describes the after_n_calls trigger pluralised", () => {
    const sf = makeSessionFlow({
      stops: [
        {
          id: "s2",
          kind: "nps",
          trigger: { type: "after_n_calls", count: 3 },
        },
      ],
    });
    render(
      <NpsRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "nps" }}
      />,
    );
    expect(screen.getByText(/After 3 calls/)).toBeInTheDocument();
  });
});
