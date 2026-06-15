import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { IntakeRenderer } from "@/components/shared/preview-renderers/IntakeRenderer";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn();

const sf = {
  intake: {
    goals: { enabled: true },
    aboutYou: { enabled: false },
    knowledgeCheck: { enabled: true, deliveryMode: "mcq" as const },
    aiIntroCall: { enabled: false },
  },
  onboarding: { phases: [] },
  welcomeMessage: null,
  firstCallCourseIntro: null,
  firstCallWaitForAck: "none" as const,
  offboarding: { phases: [] },
  stops: [],
};

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("IntakeRenderer — editable (#1689)", () => {
  it("read-only when no provider", () => {
    render(
      <IntakeRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "intake" }}
      />,
    );
    expect(screen.getByText("Intake — pre-call questions")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-jf-row-intakeKnowledgeCheck")).toBeNull();
  });

  it("editable mounts JourneyFields for intakeKnowledgeCheck + intakeAboutYou", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <IntakeRenderer
          data={{ sessionFlow: sf }}
          selection={{ selectedKey: "intake" }}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-jf-row-intakeKnowledgeCheck")).toBeInTheDocument();
    expect(screen.getByTestId("hf-jf-row-intakeAboutYou")).toBeInTheDocument();
  });

  it("toggling intakeAboutYou fires PATCH", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <IntakeRenderer
          data={{ sessionFlow: sf }}
          selection={{ selectedKey: "intake" }}
        />
      </JourneySettingMutatorProvider>,
    );
    fireEvent.click(screen.getByTestId("hf-jf-toggle-intakeAboutYou"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const init = vi.mocked(global.fetch).mock.calls[0][1]!;
    const body = JSON.parse(init.body as string);
    expect(body.settingId).toBe("intakeAboutYou");
    expect(body.value).toBe(true);
  });
});
