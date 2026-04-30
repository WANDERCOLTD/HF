/**
 * Locks the workflow.classify call-point ID in place during the
 * Discovery → Course Intake UI rename (epic #221, story #216).
 *
 * The call-point ID flows through AI config, metering, and model
 * selection in three production locations. Renaming the educator-facing
 * label is safe; renaming the ID is a breaking change. This test fails
 * the build if anyone changes the ID.
 */

import { describe, it, expect } from "vitest";
import { CALL_POINTS } from "@/lib/ai/call-points";

describe("workflow.classify call-point ID is stable", () => {
  it("call-point with id 'workflow.classify' still exists", () => {
    const point = CALL_POINTS.find(p => p.id === "workflow.classify");
    expect(point).toBeDefined();
  });

  it("educator-facing label has been renamed to Course Intake", () => {
    const point = CALL_POINTS.find(p => p.id === "workflow.classify");
    expect(point?.label).toBe("Workflow - Course Intake");
  });
});
