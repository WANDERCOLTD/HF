/**
 * detect-silent-writers.test.ts (#1622 / Epic #1618 Slice 1)
 *
 * Pins the silent-writer detector against fixture AppLog rows. The
 * detector's job is to distinguish:
 *   - "stage doesn't write this table" → field absent in every row → NOT silent
 *   - "stage writes this table sometimes" → field present, some rows > 0 → NOT silent
 *   - "stage tries to write but always zero" → field present, every row = 0 → SILENT
 *
 * The third case is the alarm condition — the exact fingerprint of
 * #1608 / #1609 / #1614 / #1615 pre-fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Fixture AppLog rows the mocked Prisma client returns.
let mockAppLogRows: Array<{
  id: string;
  stage: string;
  createdAt: Date;
  metadata: any;
}> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appLog: {
      findMany: vi.fn(async () => mockAppLogRows),
    },
  },
}));

const logSpy = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => logSpy(...args),
}));

import { detectSilentWriters } from "@/lib/pipeline/detect-silent-writers";
import { WRITE_COUNT_STAGE_PREFIX, SILENT_WRITER_ALARM_STAGE } from "@/lib/pipeline/write-count-logger";

function fixture(stage: string, writeCounts: Record<string, number>, daysAgo = 0) {
  return {
    id: `log-${Math.random().toString(36).slice(2, 9)}`,
    stage: `${WRITE_COUNT_STAGE_PREFIX}${stage.toLowerCase()}`,
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    metadata: { stage, writeCounts },
  };
}

describe("detect-silent-writers", () => {
  beforeEach(() => {
    mockAppLogRows = [];
    logSpy.mockClear();
  });

  it("returns empty findings when there are no rows in the window", async () => {
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.rowsScanned).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.alarmsFired).toBe(0);
  });

  it("flags a (stage, table) pair as silent when every row reports zero", async () => {
    // The #1608 / #1609 fingerprint: SCORE_AGENT keeps running but the
    // BehaviorMeasurement write count is 0 every call.
    mockAppLogRows = [
      fixture("SCORE_AGENT", { behaviorMeasurement: 0 }),
      fixture("SCORE_AGENT", { behaviorMeasurement: 0 }),
      fixture("SCORE_AGENT", { behaviorMeasurement: 0 }),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.stage).toBe("SCORE_AGENT");
    expect(finding.table).toBe("behaviorMeasurement");
    expect(finding.samplesInWindow).toBe(3);
    expect(finding.totalWrites).toBe(0);
    expect(finding.silent).toBe(true);
    expect(result.alarmsFired).toBe(1);
  });

  it("does NOT flag a pair as silent when at least one row had writes", async () => {
    mockAppLogRows = [
      fixture("SCORE_AGENT", { behaviorMeasurement: 0 }),
      fixture("SCORE_AGENT", { behaviorMeasurement: 4 }),
      fixture("SCORE_AGENT", { behaviorMeasurement: 0 }),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].silent).toBe(false);
    expect(result.findings[0].totalWrites).toBe(4);
    expect(result.alarmsFired).toBe(0);
  });

  it("treats an absent field as 'not written by this stage' rather than silent", async () => {
    // EXTRACT never writes BehaviorMeasurement. The detector must not
    // alarm "EXTRACT BehaviorMeasurement silent" — the field is simply
    // not present in EXTRACT's rows.
    mockAppLogRows = [
      fixture("EXTRACT", { callerMemory: 2 }),
      fixture("EXTRACT", { callerMemory: 3 }),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].table).toBe("callerMemory");
    expect(result.findings[0].silent).toBe(false);
  });

  it("groups counts across multiple tables per stage independently", async () => {
    // ADAPT writes multiple tables. Silence on one shouldn't mask non-silence
    // on another.
    mockAppLogRows = [
      fixture("ADAPT", { goal: 3, callTarget: 0, callerTarget: 1 }),
      fixture("ADAPT", { goal: 2, callTarget: 0, callerTarget: 4 }),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    const adaptByTable = new Map(result.findings.map((f) => [f.table, f]));
    expect(adaptByTable.get("goal")?.silent).toBe(false);
    expect(adaptByTable.get("callTarget")?.silent).toBe(true);  // ← #1609 fingerprint
    expect(adaptByTable.get("callerTarget")?.silent).toBe(false);
  });

  it("emits one alarm AppLog row per silent finding", async () => {
    mockAppLogRows = [
      fixture("ADAPT", { goal: 0, callTarget: 0 }),
      fixture("ADAPT", { goal: 0, callTarget: 0 }),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.alarmsFired).toBe(2);  // goal + callTarget both silent
    const alarmCalls = logSpy.mock.calls.filter((c) => c[1] === SILENT_WRITER_ALARM_STAGE);
    expect(alarmCalls).toHaveLength(2);
    const tablesAlarmed = alarmCalls.map((c) => c[2].table).sort();
    expect(tablesAlarmed).toEqual(["callTarget", "goal"]);
    for (const call of alarmCalls) {
      expect(call[2].level).toBe("warn");
      expect(call[2].stage).toBe("ADAPT");
    }
  });

  it("respects the windowHours parameter", async () => {
    // Two rows in-window, one row out-of-window. The out-of-window row
    // would flip the verdict to "not silent" if the detector pulled it.
    mockAppLogRows = [
      fixture("REWARD", { rewardScore: 0 }, 0),
      fixture("REWARD", { rewardScore: 0 }, 0),
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings[0].silent).toBe(true);
  });

  it("recovers stage name from the AppLog subject when metadata.stage is absent", async () => {
    // Defensive: detector should not crash if an older log row lacks
    // `metadata.stage` (e.g. row written by a pre-#1622 path). Fall
    // back to extracting from the subject string.
    mockAppLogRows = [
      {
        id: "legacy-row",
        stage: `${WRITE_COUNT_STAGE_PREFIX}reward`,
        createdAt: new Date(),
        metadata: { writeCounts: { rewardScore: 0 } },
      },
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings[0].stage).toBe("REWARD");
    expect(result.findings[0].silent).toBe(true);
  });

  it("records the most-recent non-zero timestamp", async () => {
    const old = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const fresh = new Date(Date.now() - 1 * 60 * 60 * 1000);
    mockAppLogRows = [
      { id: "a", stage: `${WRITE_COUNT_STAGE_PREFIX}score_agent`, createdAt: fresh, metadata: { stage: "SCORE_AGENT", writeCounts: { behaviorMeasurement: 5 } } },
      { id: "b", stage: `${WRITE_COUNT_STAGE_PREFIX}score_agent`, createdAt: old, metadata: { stage: "SCORE_AGENT", writeCounts: { behaviorMeasurement: 3 } } },
    ];
    const result = await detectSilentWriters({ windowHours: 24 });
    expect(result.findings[0].lastNonZeroAt).toBe(fresh.toISOString());
  });
});
