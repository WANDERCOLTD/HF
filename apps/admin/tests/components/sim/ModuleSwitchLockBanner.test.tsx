/**
 * Tests for ModuleSwitchLockBanner (UX-B B1 of learner affordances pass).
 *
 * Pinned acceptance:
 *  1. Silent when `allowModuleSwitch: true`.
 *  2. Per (shellKind, modePillKey) cells render the learner-safe copy
 *     declared in the pickBannerCopy matrix.
 *  3. Generic fallback when `allowModuleSwitch: false` but no specific
 *     cell matches.
 *  4. Dismiss removes the banner from the DOM.
 *  5. Copy never includes internal criterion labels.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  ModuleSwitchLockBanner,
  pickBannerCopy,
} from "@/components/sim/ModuleSwitchLockBanner";
import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

afterEach(() => {
  cleanup();
});

const chatFeedCaps = SHELL_DEFAULTS["chat-feed"];
const examMockExamCaps = SHELL_DEFAULTS["exam"]; // modePillKey = "mock-exam"
const examExaminerCaps: LearnerShellCapabilities = {
  ...SHELL_DEFAULTS["exam"],
  modePillKey: "examiner",
};
const mcqRoundsCaps = SHELL_DEFAULTS["mcq-rounds"];
const resultsReadoutCaps = SHELL_DEFAULTS["results-readout"];

describe("pickBannerCopy", () => {
  it("returns null when allowModuleSwitch is true", () => {
    expect(pickBannerCopy(chatFeedCaps, "chat-feed")).toBeNull();
  });

  it("returns examiner copy for exam shell + modePillKey=examiner", () => {
    const copy = pickBannerCopy(examExaminerCaps, "exam");
    expect(copy).not.toBeNull();
    expect(copy?.variantId).toBe("exam-examiner");
    expect(copy?.message).toMatch(/assessment/i);
  });

  it("returns mock-exam copy for exam shell + modePillKey=mock-exam", () => {
    const copy = pickBannerCopy(examMockExamCaps, "exam");
    expect(copy).not.toBeNull();
    expect(copy?.variantId).toBe("exam-mock-exam");
    expect(copy?.message).toMatch(/mock exam/i);
  });

  it("returns mcq-rounds copy for mcq-rounds shell", () => {
    const copy = pickBannerCopy(mcqRoundsCaps, "mcq-rounds");
    expect(copy).not.toBeNull();
    expect(copy?.variantId).toBe("mcq-rounds");
    expect(copy?.message).toMatch(/round/i);
  });

  it("returns generic copy for other locked shells (results-readout)", () => {
    const copy = pickBannerCopy(resultsReadoutCaps, "results-readout");
    expect(copy).not.toBeNull();
    expect(copy?.variantId).toBe("generic");
    expect(copy?.message).toMatch(/session/i);
  });

  it("learner-safe copy never carries criterion labels", () => {
    const internalLabels = [
      "Fluency and Coherence",
      "Lexical Resource",
      "Grammatical Range and Accuracy",
      "Pronunciation",
    ];
    const messages = [
      pickBannerCopy(examExaminerCaps, "exam")?.message,
      pickBannerCopy(examMockExamCaps, "exam")?.message,
      pickBannerCopy(mcqRoundsCaps, "mcq-rounds")?.message,
      pickBannerCopy(resultsReadoutCaps, "results-readout")?.message,
    ];
    for (const m of messages) {
      expect(m).toBeDefined();
      for (const label of internalLabels) {
        expect(m).not.toContain(label);
      }
    }
  });
});

describe("ModuleSwitchLockBanner — render", () => {
  it("renders nothing when allowModuleSwitch is true", () => {
    const { container } = render(
      <ModuleSwitchLockBanner
        capabilities={chatFeedCaps}
        shellKind="chat-feed"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders examiner copy", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={examExaminerCaps}
        shellKind="exam"
      />,
    );
    const banner = screen.getByTestId("module-switch-lock-banner");
    expect(banner.getAttribute("data-variant")).toBe("exam-examiner");
    expect(banner.textContent).toMatch(/Finish this assessment/);
  });

  it("renders mock-exam copy", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={examMockExamCaps}
        shellKind="exam"
      />,
    );
    const banner = screen.getByTestId("module-switch-lock-banner");
    expect(banner.getAttribute("data-variant")).toBe("exam-mock-exam");
    expect(banner.textContent).toMatch(/mock exam/i);
  });

  it("renders mcq-rounds copy", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={mcqRoundsCaps}
        shellKind="mcq-rounds"
      />,
    );
    const banner = screen.getByTestId("module-switch-lock-banner");
    expect(banner.getAttribute("data-variant")).toBe("mcq-rounds");
    expect(banner.textContent).toMatch(/round/i);
  });

  it("renders generic copy fallback", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={resultsReadoutCaps}
        shellKind="results-readout"
      />,
    );
    const banner = screen.getByTestId("module-switch-lock-banner");
    expect(banner.getAttribute("data-variant")).toBe("generic");
  });

  it("dismiss button removes the banner from the DOM", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={examExaminerCaps}
        shellKind="exam"
      />,
    );
    expect(screen.queryByTestId("module-switch-lock-banner")).not.toBeNull();
    fireEvent.click(screen.getByTestId("module-switch-lock-banner-dismiss"));
    expect(screen.queryByTestId("module-switch-lock-banner")).toBeNull();
  });

  it("uses hf-banner classes (UI design system compliance)", () => {
    render(
      <ModuleSwitchLockBanner
        capabilities={examExaminerCaps}
        shellKind="exam"
      />,
    );
    const banner = screen.getByTestId("module-switch-lock-banner");
    expect(banner.className).toContain("hf-banner");
    expect(banner.className).toContain("hf-banner-info");
  });
});
