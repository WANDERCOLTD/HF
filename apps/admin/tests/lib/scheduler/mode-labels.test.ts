/**
 * Unit tests for `getSchedulerModeLabel()` — learner-facing copy for the
 * scheduler's 4 modes (#917 Slice 2).
 */

import { describe, it, expect } from "vitest";
import { getSchedulerModeLabel } from "@/lib/scheduler/mode-labels";

describe("getSchedulerModeLabel", () => {
  it("maps teach to 'Learning new'", () => {
    expect(getSchedulerModeLabel("teach")).toBe("Learning new");
  });

  it("maps review to 'Reviewing'", () => {
    expect(getSchedulerModeLabel("review")).toBe("Reviewing");
  });

  it("maps assess to 'Mock checkpoint'", () => {
    expect(getSchedulerModeLabel("assess")).toBe("Mock checkpoint");
  });

  it("maps practice to 'Practice'", () => {
    expect(getSchedulerModeLabel("practice")).toBe("Practice");
  });
});
