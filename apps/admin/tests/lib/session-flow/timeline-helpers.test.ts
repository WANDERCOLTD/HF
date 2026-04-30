/**
 * Tests for SessionFlowTimeline helpers and snapshot output.
 *
 * Covers 3 representative course-type fixtures per #223 AC:
 *   - Continuous knowledge course (welcome toggles, NPS, no mid-test)
 *   - Structured comprehension course (mid-test, post-test, no pre-test)
 *   - Structured exam-prep course (pre + mid + post test, NPS at completion)
 *
 * @see components/session-flow/SessionFlowTimeline.tsx
 */

import { describe, it, expect } from "vitest";
import {
  sourceLabel,
  kcSummary,
  isPreTest,
  isMidTest,
  isPostTest,
  formatTrigger,
  stopSummary,
  timelineSnapshot,
} from "@/components/session-flow/timeline-helpers";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type { PlaybookConfig, JourneyStop } from "@/lib/types/json-fields";

// ── Helper unit tests ──────────────────────────────────────────────

describe("sourceLabel", () => {
  it("translates each source enum to a label", () => {
    expect(sourceLabel("new-shape")).toBe("course (sessionFlow)");
    expect(sourceLabel("playbook-legacy")).toBe("course (legacy)");
    expect(sourceLabel("domain")).toBe("domain default");
    expect(sourceLabel("init001")).toBe("system default");
  });
});

describe("kcSummary", () => {
  it("disabled → no probe", () => {
    expect(kcSummary({ enabled: false, deliveryMode: "mcq" })).toBe("Disabled — no probe, no MCQ");
  });
  it("MCQ delivery", () => {
    expect(kcSummary({ enabled: true, deliveryMode: "mcq" })).toBe("MCQ batch fires after Call 1");
  });
  it("Socratic delivery", () => {
    expect(kcSummary({ enabled: true, deliveryMode: "socratic" })).toBe("Socratic probe inside first call");
  });
  it("default to MCQ when deliveryMode missing", () => {
    expect(kcSummary({ enabled: true })).toBe("MCQ batch fires after Call 1");
  });
});

describe("formatTrigger", () => {
  it("renders each trigger type", () => {
    expect(formatTrigger({ type: "first_session" })).toBe("before first call");
    expect(formatTrigger({ type: "before_session", index: 3 })).toBe("before session 3");
    expect(formatTrigger({ type: "after_session", index: 1 })).toBe("after session 1");
    expect(formatTrigger({ type: "midpoint" })).toBe("midpoint");
    expect(formatTrigger({ type: "mastery_reached", threshold: 80 })).toBe("mastery ≥ 80%");
    expect(formatTrigger({ type: "session_count", count: 1 })).toBe("after 1 session");
    expect(formatTrigger({ type: "session_count", count: 5 })).toBe("after 5 sessions");
    expect(formatTrigger({ type: "course_complete" })).toBe("course complete");
  });
});

describe("stop classification", () => {
  const mcqStop = (trigger: JourneyStop["trigger"]): JourneyStop => ({
    id: "x", kind: "assessment", trigger,
    delivery: { mode: "either" }, payload: { source: "mcq-pool", count: 5 },
    enabled: true,
  });

  it("identifies pre-test (after_session index 1)", () => {
    expect(isPreTest(mcqStop({ type: "after_session", index: 1 }))).toBe(true);
    expect(isPreTest(mcqStop({ type: "course_complete" }))).toBe(false);
  });

  it("identifies mid-test (midpoint)", () => {
    expect(isMidTest(mcqStop({ type: "midpoint" }))).toBe(true);
    expect(isMidTest(mcqStop({ type: "after_session", index: 1 }))).toBe(false);
  });

  it("identifies post-test (course_complete)", () => {
    expect(isPostTest(mcqStop({ type: "course_complete" }))).toBe(true);
    expect(isPostTest(mcqStop({ type: "midpoint" }))).toBe(false);
  });

  it("stopSummary includes MCQ count", () => {
    expect(stopSummary(mcqStop({ type: "course_complete" }))).toBe("5 MCQs · course complete");
  });
});

// ── Snapshot fixtures ──────────────────────────────────────────────

describe("timelineSnapshot — course-type fixtures (#223)", () => {
  it("continuous knowledge course (welcome toggles + NPS)", () => {
    const config: PlaybookConfig = {
      lessonPlanMode: "continuous",
      teachingMode: "recall",
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
      welcomeMessage: "Welcome to GCSE Biology",
      nps: { enabled: true, trigger: "mastery", threshold: 80 },
    };
    const resolved = resolveSessionFlow({ playbook: { name: "GCSE Bio", config } });
    expect(timelineSnapshot({
      sessionFlow: resolved, mode: "continuous", teachingMode: "recall",
    })).toMatchSnapshot();
  });

  it("structured comprehension course (mid + post test, NPS)", () => {
    const config: PlaybookConfig = {
      lessonPlanMode: "structured",
      teachingMode: "comprehension",
      sessionCount: 6,
      sessionFlow: {
        stops: [
          {
            id: "mid-test", kind: "assessment",
            trigger: { type: "midpoint" },
            delivery: { mode: "either" },
            payload: { source: "mcq-pool", count: 5 },
            enabled: true,
          },
          {
            id: "post-test", kind: "assessment",
            trigger: { type: "course_complete" },
            delivery: { mode: "either" },
            payload: { source: "mcq-pool", count: 5 },
            enabled: true,
          },
          {
            id: "nps", kind: "nps",
            trigger: { type: "course_complete" },
            delivery: { mode: "either" },
            enabled: true,
          },
        ],
      },
    };
    const resolved = resolveSessionFlow({ playbook: { name: "Animal Farm", config } });
    expect(timelineSnapshot({
      sessionFlow: resolved, mode: "structured", teachingMode: "comprehension", sessionCount: 6,
    })).toMatchSnapshot();
  });

  it("structured exam-prep course (pre + mid + post + NPS, all in)", () => {
    const config: PlaybookConfig = {
      lessonPlanMode: "structured",
      teachingMode: "syllabus",
      sessionCount: 10,
      welcome: {
        goals: { enabled: true },
        aboutYou: { enabled: false },
        knowledgeCheck: { enabled: true },
        aiIntroCall: { enabled: false },
      },
      assessment: {
        preTest: { enabled: true, questionCount: 5 },
        postTest: { enabled: true },
      },
      nps: { enabled: true, trigger: "mastery", threshold: 80 },
    };
    const resolved = resolveSessionFlow({ playbook: { name: "A-Level Econ", config } });
    expect(timelineSnapshot({
      sessionFlow: resolved, mode: "structured", teachingMode: "syllabus", sessionCount: 10,
    })).toMatchSnapshot();
  });
});
