/**
 * Tests for PostCallCTA (UX-B B2 of learner affordances pass).
 *
 * Pinned acceptance:
 *  1. `dismissOnEnd === "home"` → primary "Back to home" button.
 *  2. `dismissOnEnd === "next-module"` → primary "Next module" button.
 *  3. `dismissOnEnd === "results-screen"` → no CTA (ResultsReadoutShell
 *     owns the post-call CTA in that case).
 *  4. Secondary "Back to home" appears only when primary is "Next module"
 *     AND `allowBackToHome: true`.
 *  5. Primary click navigates to the matching route.
 *  6. The `pickPrimaryCTA` pure resolver matches the matrix.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  PostCallCTA,
  pickPrimaryCTA,
} from "@/components/sim/PostCallCTA";
import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

// Override the global useRouter mock so we can assert pushes per test.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

// Reference capability frames from canonical SHELL_DEFAULTS.
const chatFeedCaps = SHELL_DEFAULTS["chat-feed"]; // dismissOnEnd: "home"
const examCaps = SHELL_DEFAULTS["exam"]; // dismissOnEnd: "results-screen"
const mcqRoundsCaps = SHELL_DEFAULTS["mcq-rounds"]; // dismissOnEnd: "home"
const resultsReadoutCaps = SHELL_DEFAULTS["results-readout"]; // dismissOnEnd: "next-module"

// Synthetic frames for testing the secondary "Back to home" gate.
// SHELL_DEFAULTS["results-readout"] has allowBackToHome=false; we
// synthesise a true variant to pin the positive path, and a false
// variant to pin suppression.
const nextModuleWithHomeCaps: LearnerShellCapabilities = {
  ...resultsReadoutCaps,
  allowBackToHome: true,
};
const nextModuleNoHomeCaps: LearnerShellCapabilities = {
  ...resultsReadoutCaps,
  allowBackToHome: false,
};

describe("pickPrimaryCTA", () => {
  it("returns back-to-home for dismissOnEnd=home", () => {
    expect(pickPrimaryCTA(chatFeedCaps)).toEqual({
      kind: "back-to-home",
      label: "Back to home",
    });
  });

  it("returns next-module for dismissOnEnd=next-module", () => {
    expect(pickPrimaryCTA(resultsReadoutCaps)).toEqual({
      kind: "next-module",
      label: "Next module",
    });
  });

  it("returns results-owned (null CTA) for dismissOnEnd=results-screen", () => {
    expect(pickPrimaryCTA(examCaps)).toEqual({
      kind: "results-owned",
      label: null,
    });
  });
});

describe("PostCallCTA — render", () => {
  it("renders Back to home for chat-feed default", () => {
    render(
      <PostCallCTA
        capabilities={chatFeedCaps}
        callerId="cl_test_1"
        courseId="course-1"
      />,
    );
    const cta = screen.getByTestId("post-call-cta");
    expect(cta.getAttribute("data-variant")).toBe("back-to-home");
    expect(screen.getByTestId("post-call-cta-primary").textContent).toBe(
      "Back to home",
    );
    // Primary is the lead — no secondary when primary IS back-to-home.
    expect(screen.queryByTestId("post-call-cta-secondary")).toBeNull();
  });

  it("renders Next module for results-readout default", () => {
    render(
      <PostCallCTA
        capabilities={resultsReadoutCaps}
        callerId="cl_test_2"
        courseId="course-2"
      />,
    );
    const cta = screen.getByTestId("post-call-cta");
    expect(cta.getAttribute("data-variant")).toBe("next-module");
    expect(screen.getByTestId("post-call-cta-primary").textContent).toBe(
      "Next module",
    );
  });

  it("renders nothing for dismissOnEnd=results-screen (exam shell)", () => {
    const { container } = render(
      <PostCallCTA
        capabilities={examCaps}
        callerId="cl_test_3"
        courseId="course-3"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Back to home for mcq-rounds default", () => {
    render(
      <PostCallCTA
        capabilities={mcqRoundsCaps}
        callerId="cl_test_4"
        courseId="course-4"
      />,
    );
    expect(screen.getByTestId("post-call-cta-primary").textContent).toBe(
      "Back to home",
    );
  });

  it("renders secondary Back to home for next-module + allowBackToHome", () => {
    // SHELL_DEFAULTS["results-readout"] sets allowBackToHome=false,
    // so a synthetic true-variant pins the positive secondary path.
    render(
      <PostCallCTA
        capabilities={nextModuleWithHomeCaps}
        callerId="cl_test_5"
        courseId="course-5"
      />,
    );
    const secondary = screen.getByTestId("post-call-cta-secondary");
    expect(secondary.textContent).toBe("Back to home");
  });

  it("suppresses secondary when allowBackToHome=false", () => {
    render(
      <PostCallCTA
        capabilities={nextModuleNoHomeCaps}
        callerId="cl_test_6"
        courseId="course-6"
      />,
    );
    expect(screen.queryByTestId("post-call-cta-secondary")).toBeNull();
  });

  it("primary click pushes the home route for dismissOnEnd=home", () => {
    render(
      <PostCallCTA capabilities={chatFeedCaps} callerId="cl_z_home" />,
    );
    fireEvent.click(screen.getByTestId("post-call-cta-primary"));
    expect(pushMock).toHaveBeenCalledWith("/x/student/cl_z_home");
  });

  it("primary click pushes the modules route for dismissOnEnd=next-module", () => {
    render(
      <PostCallCTA
        capabilities={resultsReadoutCaps}
        callerId="cl_z_next"
        courseId="course-z"
      />,
    );
    fireEvent.click(screen.getByTestId("post-call-cta-primary"));
    expect(pushMock).toHaveBeenCalledWith("/x/student/course-z/modules");
  });

  it("falls back to home route when courseId missing on next-module", () => {
    render(
      <PostCallCTA
        capabilities={resultsReadoutCaps}
        callerId="cl_z_fallback"
      />,
    );
    fireEvent.click(screen.getByTestId("post-call-cta-primary"));
    expect(pushMock).toHaveBeenCalledWith("/x/student/cl_z_fallback");
  });
});
