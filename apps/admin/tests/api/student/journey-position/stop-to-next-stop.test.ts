/**
 * stopToNextStop — pin per-kind behaviour after the kind-switch refactor.
 *
 * Replaces the previous `switch (stop.id) case "pre-test" / "nps" /
 * "post-test"` with `switch (stop.kind)`. Pre-test vs post-test are both
 * `kind: "assessment"` per the resolver; they're disambiguated by the
 * pre-test completion state (pre-test fires while the survey hasn't been
 * submitted; post-test fires after).
 */

import { describe, it, expect } from "vitest";

import { stopToNextStop } from "@/app/api/student/journey-position/route";
import type { JourneyStop } from "@/lib/types/json-fields";

function makeStop(kind: JourneyStop["kind"], id = "synthetic"): JourneyStop {
  return {
    id,
    kind,
    trigger: { type: "after_session", index: 1 },
    delivery: { mode: "either" },
    enabled: true,
  };
}

describe("stopToNextStop — kind-keyed dispatch", () => {
  it("assessment + !preTestCompleted → pre_survey", () => {
    const out = stopToNextStop(makeStop("assessment"), { preTestCompleted: false });
    expect(out).toEqual({
      type: "pre_survey",
      session: 1,
      redirect: "/x/student/welcome",
    });
  });

  it("assessment + preTestCompleted → post_survey with includePostTest", () => {
    const out = stopToNextStop(makeStop("assessment"), { preTestCompleted: true });
    expect(out).toEqual({
      type: "post_survey",
      session: 1,
      redirect: "/x/student/survey/post",
      includePostTest: true,
    });
  });

  it("nps → post_survey, includePostTest reflects preTestCompleted (true case)", () => {
    const out = stopToNextStop(makeStop("nps"), { preTestCompleted: true });
    expect(out).toEqual({
      type: "post_survey",
      session: 1,
      redirect: "/x/student/survey/post",
      includePostTest: true,
    });
  });

  it("nps → post_survey, includePostTest=false when preTest incomplete", () => {
    const out = stopToNextStop(makeStop("nps"), { preTestCompleted: false });
    expect(out).toEqual({
      type: "post_survey",
      session: 1,
      redirect: "/x/student/survey/post",
      includePostTest: false,
    });
  });

  it("survey kind → generic post-survey fallback", () => {
    const out = stopToNextStop(makeStop("survey"), { preTestCompleted: false });
    expect(out).toEqual({
      type: "survey",
      session: 1,
      redirect: "/x/student/survey/post",
    });
  });

  it("reflection kind → generic post-survey fallback", () => {
    const out = stopToNextStop(makeStop("reflection"), { preTestCompleted: true });
    expect(out).toEqual({
      type: "reflection",
      session: 1,
      redirect: "/x/student/survey/post",
    });
  });
});
