/**
 * write-count-logger.test.ts (#1622 / Epic #1618 Slice 1)
 *
 * Pins the log-row shape `logStageWriteCounts` emits to AppLog. The
 * silent-writer detector reads these rows and aggregates them per
 * (stage, table) pair — if the row shape drifts the detector breaks
 * silently, which is exactly the gap class the epic exists to close.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AppLog writer at the module-graph level so the test never
// touches Prisma. We only care that `log()` is called with the right
// args; the persistence path is owned by lib/logger.ts.
const logSpy = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => logSpy(...args),
}));

import {
  logStageWriteCounts,
  WRITE_COUNT_STAGE_PREFIX,
  SILENT_WRITER_ALARM_STAGE,
} from "@/lib/pipeline/write-count-logger";

describe("write-count-logger", () => {
  beforeEach(() => {
    logSpy.mockClear();
  });

  it("emits one AppLog row per stage call with the expected shape", () => {
    logStageWriteCounts({
      stage: "SCORE_AGENT",
      callId: "call-uuid-1",
      callerId: "caller-uuid-1",
      playbookId: "playbook-uuid-1",
      writeCounts: { behaviorMeasurement: 12 },
      durationMs: 845,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [type, stageSubject, payload] = logSpy.mock.calls[0];
    expect(type).toBe("system");
    expect(stageSubject).toBe(`${WRITE_COUNT_STAGE_PREFIX}score_agent`);
    expect(payload).toMatchObject({
      stage: "SCORE_AGENT",
      callId: "call-uuid-1",
      callerId: "caller-uuid-1",
      playbookId: "playbook-uuid-1",
      writeCounts: { behaviorMeasurement: 12 },
      totalWrites: 12,
      durationMs: 845,
      level: "info",
    });
  });

  it("marks the row as warn-level when totalWrites is zero", () => {
    // Silent-writer detector picks up the warn level too, but the level
    // alone is also a quick signal for ad-hoc grep / Cloud Logging.
    logStageWriteCounts({
      stage: "REWARD",
      callId: "call-uuid-2",
      writeCounts: { rewardScore: 0 },
    });
    expect(logSpy.mock.calls[0][2].level).toBe("warn");
    expect(logSpy.mock.calls[0][2].totalWrites).toBe(0);
  });

  it("computes totalWrites across all non-undefined fields", () => {
    logStageWriteCounts({
      stage: "ADAPT",
      callId: "call-uuid-3",
      writeCounts: {
        callTarget: 3,
        callerTarget: 7,
        goal: 2,
        failureLog: 0,
      },
    });
    expect(logSpy.mock.calls[0][2].totalWrites).toBe(12);
  });

  it("treats missing fields as absent (does not count them as zero)", () => {
    // Detector needs to distinguish "stage doesn't write this table"
    // (field absent) from "stage tried to write and got zero" (field
    // present but 0). This logger preserves the distinction by only
    // counting fields the caller explicitly passed.
    logStageWriteCounts({
      stage: "COMPOSE",
      callId: "call-uuid-4",
      writeCounts: { composedPrompt: 1 },
    });
    const payload = logSpy.mock.calls[0][2];
    expect(payload.writeCounts).toEqual({ composedPrompt: 1 });
    expect(payload.writeCounts).not.toHaveProperty("behaviorMeasurement");
    expect(payload.totalWrites).toBe(1);
  });

  it("lower-cases the stage in the AppLog subject for grep stability", () => {
    logStageWriteCounts({
      stage: "AGGREGATE",
      callId: "call-uuid-5",
      writeCounts: { callerTarget: 4 },
    });
    expect(logSpy.mock.calls[0][1]).toBe(`${WRITE_COUNT_STAGE_PREFIX}aggregate`);
    // But the metadata payload preserves canonical case for analysis.
    expect(logSpy.mock.calls[0][2].stage).toBe("AGGREGATE");
  });

  it("exports a stable alarm-stage constant for the detector", () => {
    // The detector writes its own rows with this subject; pinning it
    // here so a rename in one place breaks the test rather than the
    // production grep / Cloud Logging filter silently.
    expect(SILENT_WRITER_ALARM_STAGE).toBe("pipeline.stage.silent_writer");
    expect(WRITE_COUNT_STAGE_PREFIX).toBe("pipeline.stage.write_counts:");
  });

  it("handles empty writeCounts (all fields absent)", () => {
    logStageWriteCounts({
      stage: "SUPERVISE",
      callId: "call-uuid-6",
      writeCounts: {},
    });
    const payload = logSpy.mock.calls[0][2];
    expect(payload.totalWrites).toBe(0);
    expect(payload.level).toBe("warn");
    expect(payload.writeCounts).toEqual({});
  });
});
