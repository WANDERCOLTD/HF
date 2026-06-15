import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

import { WelcomeRenderer } from "@/components/shared/preview-renderers/WelcomeRenderer";
import { JourneySettingMutatorProvider } from "@/components/shared/preview-renderers/_journey-setting-context";

global.fetch = vi.fn();

const sf = {
  intake: {
    goals: { enabled: true },
    aboutYou: { enabled: true },
    knowledgeCheck: { enabled: false },
    aiIntroCall: { enabled: false },
  },
  onboarding: { phases: [] },
  welcomeMessage: "hi there",
  firstCallCourseIntro: null,
  firstCallWaitForAck: "none" as const,
  offboarding: { phases: [] },
  stops: [],
};

afterEach(() => {
  cleanup();
  vi.mocked(global.fetch).mockReset();
});

describe("WelcomeRenderer — editable (#1689)", () => {
  it("read-only when no provider", () => {
    render(
      <WelcomeRenderer
        data={{ sessionFlow: sf }}
        selection={{ selectedKey: "welcome" }}
      />,
    );
    expect(screen.getByText("Welcome set")).toBeInTheDocument();
  });

  it("editable when courseId present", () => {
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <WelcomeRenderer
          data={{ sessionFlow: sf }}
          selection={{ selectedKey: "welcome" }}
        />
      </JourneySettingMutatorProvider>,
    );
    expect(screen.getByTestId("hf-jf-row-welcomeMessage")).toBeInTheDocument();
  });

  it("PATCHes welcomeMessage on blur", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(
      <JourneySettingMutatorProvider courseId="course-1">
        <WelcomeRenderer
          data={{ sessionFlow: sf }}
          selection={{ selectedKey: "welcome" }}
        />
      </JourneySettingMutatorProvider>,
    );
    const input = screen.getByTestId("hf-jf-text-welcomeMessage");
    fireEvent.change(input, { target: { value: "hello!" } });
    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const init = vi.mocked(global.fetch).mock.calls[0][1]!;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.settingId).toBe("welcomeMessage");
    expect(body.value).toBe("hello!");
  });
});
