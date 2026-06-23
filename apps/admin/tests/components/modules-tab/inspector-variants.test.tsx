/**
 * Inspector mode-variant tests — story #2205 (U4 of #2185).
 *
 * Covers:
 *  1. Each AuthoredModuleMode renders the right variant (variant testid).
 *  2. Each variant surfaces its expected G8 contract rows.
 *  3. Default fallback (undefined / unknown mode) renders HowCardTutor.
 *  4. Setting changes propagate via onSettingChange.
 *  5. The dispatch is data-driven — no nested if-else hidden — by
 *     asserting each variant component is reachable via `getHowCardVariant`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ModuleInspectorPanel } from "@/components/modules-tab/ModuleInspectorPanel";
import {
  getHowCardVariant,
  HowCardExaminer,
  HowCardMixed,
  HowCardMockExam,
  HowCardQuiz,
  HowCardTutor,
  isAuthoredModuleMode,
} from "@/components/modules-tab/inspector-variants";

afterEach(() => {
  cleanup();
});

describe("inspector-variants — mode dispatch (#2205)", () => {
  it("getHowCardVariant resolves the right component for every known mode", () => {
    expect(getHowCardVariant("tutor")).toBe(HowCardTutor);
    expect(getHowCardVariant("mixed")).toBe(HowCardMixed);
    expect(getHowCardVariant("examiner")).toBe(HowCardExaminer);
    expect(getHowCardVariant("quiz")).toBe(HowCardQuiz);
    expect(getHowCardVariant("mock-exam")).toBe(HowCardMockExam);
  });

  it("defaults to HowCardTutor when mode is unknown / null / undefined", () => {
    expect(getHowCardVariant(null)).toBe(HowCardTutor);
    expect(getHowCardVariant(undefined)).toBe(HowCardTutor);
    expect(getHowCardVariant("freeform-nonsense")).toBe(HowCardTutor);
    expect(getHowCardVariant("")).toBe(HowCardTutor);
  });

  it("isAuthoredModuleMode discriminates known mode literals", () => {
    expect(isAuthoredModuleMode("tutor")).toBe(true);
    expect(isAuthoredModuleMode("mixed")).toBe(true);
    expect(isAuthoredModuleMode("examiner")).toBe(true);
    expect(isAuthoredModuleMode("quiz")).toBe(true);
    expect(isAuthoredModuleMode("mock-exam")).toBe(true);
    expect(isAuthoredModuleMode("unknown")).toBe(false);
    expect(isAuthoredModuleMode(null)).toBe(false);
    expect(isAuthoredModuleMode(undefined)).toBe(false);
  });
});

describe("inspector-variants — variant rendering via ModuleInspectorPanel", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          effectiveValue: "x",
          autoEnabled: [],
          bumpedSections: ["instructions"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders HowCardTutor when mode is 'tutor'", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="tutor"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-tutor")).toBeInTheDocument();
    // Tutor surfaces the question-target + min-speaking-sec + cue-card
    // + topic-pool + closing line rows.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleMinSpeakingSec"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleClosingLine"),
    ).toBeInTheDocument();
  });

  it("renders HowCardMixed when mode is 'mixed' AND surfaces the assessment-activation note", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="mixed"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-mixed")).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-how-card-mixed-assessment-note"),
    ).toBeInTheDocument();
    // Mixed inherits the tutor knob list.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
    // Mixed adds the lesson-plan toggle.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleGenerateLessonPlan"),
    ).toBeInTheDocument();
  });

  it("renders HowCardExaminer when mode is 'examiner' AND cites the examiner-mode spec template", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="examiner"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-examiner")).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-how-card-examiner-scoring-note"),
    ).toBeInTheDocument();
    // Examiner surfaces scheduled cues + silent mode.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleScheduledCues"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleSilentMode"),
    ).toBeInTheDocument();
  });

  it("renders HowCardQuiz when mode is 'quiz' AND surfaces the editable score-readout row (S8)", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="quiz"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-quiz")).toBeInTheDocument();
    // S8 (this PR) — the pre-S8 informational MCQ note was replaced by the
    // editable `moduleScoreReadoutMode` row so operators can pick the
    // readout policy inline instead of reading a "deferred" hint.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleScoreReadoutMode"),
    ).toBeInTheDocument();
    // Quiz surfaces the question target + topic pool (MCQ pool source-ref proxy).
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleQuestionTarget"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleTopicPool"),
    ).toBeInTheDocument();
    // S3 (this PR) — every variant surfaces the learner-shell DISABLE-only
    // override row.
    expect(
      screen.getByTestId(
        "hf-module-inspector-row-moduleLearnerShellOverride",
      ),
    ).toBeInTheDocument();
  });

  it("renders HowCardMockExam when mode is 'mock-exam' AND surfaces the depth-deferred note", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="mock-exam"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-mock-exam")).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-how-card-mock-exam-depth-note"),
    ).toBeInTheDocument();
    // Mock-exam surfaces silent mode + lesson plan + scheduled cues.
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleSilentMode"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleGenerateLessonPlan"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hf-module-inspector-row-moduleScheduledCues"),
    ).toBeInTheDocument();
  });

  it("falls back to HowCardTutor when mode is missing", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-tutor")).toBeInTheDocument();
    expect(screen.queryByTestId("hf-how-card-examiner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hf-how-card-quiz")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hf-how-card-mock-exam")).not.toBeInTheDocument();
  });

  it("falls back to HowCardTutor when mode is an unknown string", () => {
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="legacy-unknown-mode"
        settings={null}
      />,
    );
    expect(screen.getByTestId("hf-how-card-tutor")).toBeInTheDocument();
  });

  it("propagates setting changes via onSettingChange (PATCH /journey-setting)", async () => {
    const onSaved = vi.fn();
    render(
      <ModuleInspectorPanel
        courseId="course-1"
        selectedModuleId="m1"
        selectedModuleLabel="Module 1"
        selectedModuleMode="quiz"
        settings={{ closingLine: "OK" }}
        onSaved={onSaved}
      />,
    );
    const row = screen.getByTestId(
      "hf-module-inspector-row-moduleClosingLine",
    );
    const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "Goodbye!" } });
    fireEvent.blur(input!);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/courses/course-1/journey-setting");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.settingId).toBe("moduleClosingLine");
    expect(body.arraySelector).toBe("m1");
    expect(body.value).toBe("Goodbye!");
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
