/**
 * Behavioural tests for `lib/pipeline/runners/supervise/leak-scan.ts`
 * (#2151 — LEAK-SCAN-001 SUPERVISE-stage runtime gate, complement to
 * the build-time leak Coverage gate at
 * `apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts` /
 * PR #2144).
 *
 * Pins:
 *   - leak detected → writes CallScore (parameterId=BEH-INTERNAL-LEAK)
 *     via the canonical chokepoint + emits AppLog subject
 *     `supervise.internal_leak_detected`
 *   - no leaks → silent no-op (NO CallScore, NO AppLog) per the
 *     honest-empty-state contract (feedback_no_hardcoded_score_backfill.md)
 *   - empty registry → silent no-op (returns "skipped:empty-registry")
 *   - shared registry is in sync between this runtime gate and the
 *     PR #2144 build-time gate — both read the same JSON
 *
 * The pure detection helpers (`detectLeaks` / `uniqueLeakCount`) are
 * exercised directly; the end-to-end runner is exercised with the
 * `writeCallScore` + `log` modules mocked.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mockWriteCallScore = vi.fn();
const mockLog = vi.fn();

vi.mock("@/lib/measurement/write-call-score", () => ({
  writeCallScore: (...args: unknown[]) => mockWriteCallScore(...args),
}));

vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

import {
  detectLeaks,
  uniqueLeakCount,
  loadInternalLabelRegistry,
  runLeakScan,
  LEAK_SCAN_SPEC_SLUG,
  LEAK_SCAN_PARAMETER_ID,
  LEAK_SCAN_APPLOG_SUBJECT,
  type InternalLabelSet,
} from "@/lib/pipeline/runners/supervise/leak-scan";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");
const SHARED_REGISTRY_PATH = join(
  REPO_ROOT,
  "docs",
  "kb",
  "generated",
  "internal-label-registry.json",
);

const IELTS_REGISTRY: Record<string, InternalLabelSet> = {
  IELTS_CRITERIA: {
    description: "IELTS scoring criteria — internal scoring axes.",
    labels: [
      "Fluency and Coherence",
      "Lexical Resource",
      "Grammatical Range and Accuracy",
      "Pronunciation",
    ],
  },
  IELTS_CRITERION_SLUGS: {
    description: "IELTS criterion slug form — internal parameter IDs.",
    labels: [
      "skill_fluency_and_coherence_fc",
      "skill_lexical_resource_lr",
      "skill_grammatical_range_and_accuracy_gra",
      "skill_pronunciation_p",
    ],
  },
};

let tempDir: string;
let tempRegistryPath: string;

beforeEach(() => {
  mockWriteCallScore.mockReset();
  mockLog.mockReset();
  mockWriteCallScore.mockResolvedValue({ id: "fake-score-id", created: true });
  tempDir = mkdtempSync(join(tmpdir(), "leak-scan-test-"));
  tempRegistryPath = join(tempDir, "registry.json");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeRegistryOverride(
  registry: Record<string, InternalLabelSet>,
): void {
  writeFileSync(
    tempRegistryPath,
    JSON.stringify({ version: 1, registry }),
    "utf8",
  );
}

// ──────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────

describe("detectLeaks (pure)", () => {
  it("returns empty when no surface contains any label", () => {
    const out = detectLeaks(IELTS_REGISTRY, [
      { surface: "composedPrompt", text: "The tutor is warm and patient." },
    ]);
    expect(out).toEqual([]);
  });

  it("returns one detection per (setKey, label, surface) match", () => {
    const out = detectLeaks(IELTS_REGISTRY, [
      {
        surface: "composedPrompt",
        text: "Today's focus: Lexical Resource — pick richer vocabulary.",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      setKey: "IELTS_CRITERIA",
      label: "Lexical Resource",
      surface: "composedPrompt",
    });
  });

  it("attributes per-surface — same label across two surfaces yields two detections", () => {
    const out = detectLeaks(IELTS_REGISTRY, [
      { surface: "composedPrompt", text: "score Lexical Resource highly" },
      { surface: "pinnedCard.focusArea", text: "Lexical Resource" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.surface).sort()).toEqual([
      "composedPrompt",
      "pinnedCard.focusArea",
    ]);
  });

  it("matches across multiple label sets in one pass", () => {
    const out = detectLeaks(IELTS_REGISTRY, [
      {
        surface: "composedPrompt",
        text: "internal: skill_lexical_resource_lr ; rendered: Pronunciation",
      },
    ]);
    expect(out).toHaveLength(2);
    const keys = out.map((l) => `${l.setKey}:${l.label}`).sort();
    expect(keys).toEqual([
      "IELTS_CRITERIA:Pronunciation",
      "IELTS_CRITERION_SLUGS:skill_lexical_resource_lr",
    ]);
  });

  it("skips empty / null / undefined surface text", () => {
    const out = detectLeaks(IELTS_REGISTRY, [
      { surface: "composedPrompt", text: "" },
      { surface: "pinnedCard.topic", text: null },
      { surface: "pinnedCard.focusArea", text: undefined },
    ]);
    expect(out).toEqual([]);
  });

  it("empty registry → no matches even when text is long", () => {
    const out = detectLeaks({}, [
      { surface: "composedPrompt", text: "a long prompt with content" },
    ]);
    expect(out).toEqual([]);
  });
});

describe("uniqueLeakCount (pure)", () => {
  it("collapses cross-surface duplicates", () => {
    const count = uniqueLeakCount([
      { setKey: "A", label: "X", surface: "s1" },
      { setKey: "A", label: "X", surface: "s2" }, // dupe across surfaces
      { setKey: "A", label: "Y", surface: "s1" },
      { setKey: "B", label: "X", surface: "s1" }, // different setKey
    ]);
    expect(count).toBe(3);
  });

  it("returns 0 for empty input", () => {
    expect(uniqueLeakCount([])).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// loadInternalLabelRegistry
// ──────────────────────────────────────────────────────────

describe("loadInternalLabelRegistry", () => {
  it("loads from the shared JSON at docs/kb/generated/internal-label-registry.json", () => {
    const reg = loadInternalLabelRegistry();
    expect(Object.keys(reg).length).toBeGreaterThan(0);
    // The shared JSON SHOULD carry IELTS_CRITERIA at minimum (the
    // PR #2144 incumbent set).
    expect(reg.IELTS_CRITERIA).toBeTruthy();
  });

  it("respects a path override (used by tests)", () => {
    writeRegistryOverride({
      FOO: { description: "test set", labels: ["foo-1", "foo-2"] },
    });
    const reg = loadInternalLabelRegistry(tempRegistryPath);
    expect(Object.keys(reg)).toEqual(["FOO"]);
  });

  it("handles a registry with empty top-level — returns {}", () => {
    writeFileSync(
      tempRegistryPath,
      JSON.stringify({ version: 1, registry: {} }),
      "utf8",
    );
    const reg = loadInternalLabelRegistry(tempRegistryPath);
    expect(reg).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────
// runLeakScan — end-to-end
// ──────────────────────────────────────────────────────────

const BASE_ARGS = {
  callId: "call-abc",
  callerId: "caller-xyz",
  moduleId: "module-1",
  sessionId: "session-1",
  analysisSpecId: "leak-scan-spec-id-uuid",
};

describe("runLeakScan (end-to-end)", () => {
  it("LEAK PRESENT → fires writeCallScore + AppLog", async () => {
    writeRegistryOverride(IELTS_REGISTRY);
    const result = await runLeakScan({
      ...BASE_ARGS,
      composedPromptText:
        "You are a tutor. Today focus on Lexical Resource and Pronunciation.",
      pinnedCard: null,
      registryPathOverride: tempRegistryPath,
    });

    expect(result.status).toBe("leaks-reported");
    expect(result.uniqueLeakCount).toBe(2);
    expect(result.callScoreWritten).toBe(true);
    expect(result.appLogEmitted).toBe(true);

    expect(mockWriteCallScore).toHaveBeenCalledTimes(1);
    const csCall = mockWriteCallScore.mock.calls[0][0];
    expect(csCall.callId).toBe("call-abc");
    expect(csCall.parameterId).toBe(LEAK_SCAN_PARAMETER_ID);
    expect(csCall.parameterId).toBe("BEH-INTERNAL-LEAK");
    expect(csCall.score).toBe(2);
    expect(csCall.analysisSpecId).toBe("leak-scan-spec-id-uuid");
    expect(csCall.evidence).toHaveLength(2);
    expect(csCall.scoredBy).toBe("leak-scan-v1");

    expect(mockLog).toHaveBeenCalledTimes(1);
    const logCall = mockLog.mock.calls[0];
    expect(logCall[0]).toBe("system");
    expect(logCall[1]).toBe("supervise.leak-scan");
    const meta = logCall[2];
    expect(meta.subject).toBe(LEAK_SCAN_APPLOG_SUBJECT);
    expect(meta.uniqueLeakCount).toBe(2);
    expect(Array.isArray(meta.leaks)).toBe(true);
    expect(meta.leaks).toHaveLength(2);
  });

  it("LEAK PRESENT in PinnedCardContent.focusArea → still fires (the #1955 fingerprint)", async () => {
    writeRegistryOverride(IELTS_REGISTRY);
    const result = await runLeakScan({
      ...BASE_ARGS,
      composedPromptText: "Generic tutor prompt with no criterion names.",
      pinnedCard: {
        kind: "topicFocus",
        topic: "Modern technology",
        focusArea: "Lexical Resource", // the live #1955 leak shape
      } as any,
      registryPathOverride: tempRegistryPath,
    });

    expect(result.status).toBe("leaks-reported");
    expect(result.uniqueLeakCount).toBe(1);
    expect(mockWriteCallScore).toHaveBeenCalledTimes(1);
    const meta = mockLog.mock.calls[0][2];
    expect(meta.leaks[0].surface).toBe("pinnedCard.focusArea");
  });

  it("NO LEAKS → silent no-op (no CallScore, no AppLog)", async () => {
    writeRegistryOverride(IELTS_REGISTRY);
    const result = await runLeakScan({
      ...BASE_ARGS,
      composedPromptText:
        "You are a warm, patient tutor helping the learner with English.",
      pinnedCard: {
        kind: "topicFocus",
        topic: "Modern technology",
        focusArea: "giving reasons", // learner-safe label — should not fire
      } as any,
      registryPathOverride: tempRegistryPath,
    });

    expect(result.status).toBe("clean");
    expect(result.uniqueLeakCount).toBe(0);
    expect(result.callScoreWritten).toBe(false);
    expect(result.appLogEmitted).toBe(false);
    expect(mockWriteCallScore).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("EMPTY REGISTRY → silent no-op (returns skipped:empty-registry)", async () => {
    writeRegistryOverride({});
    const result = await runLeakScan({
      ...BASE_ARGS,
      composedPromptText:
        "A long prompt that would otherwise match many things.",
      pinnedCard: null,
      registryPathOverride: tempRegistryPath,
    });

    expect(result.status).toBe("skipped:empty-registry");
    expect(result.callScoreWritten).toBe(false);
    expect(result.appLogEmitted).toBe(false);
    expect(mockWriteCallScore).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("scans every text-bearing PinnedCard field (topic + focusArea + secondaryNote + bullets[])", async () => {
    writeRegistryOverride({
      SET: { description: "test set", labels: ["LEAKY"] },
    });
    const result = await runLeakScan({
      ...BASE_ARGS,
      composedPromptText: "clean prompt",
      pinnedCard: {
        kind: "cueCard",
        topic: "talk about LEAKY topic",
        bullets: ["normal bullet", "LEAKY bullet"],
        secondaryNote: "LEAKY note",
        focusArea: "LEAKY focus",
      } as any,
      registryPathOverride: tempRegistryPath,
    });

    // 1 unique label across 4 surfaces → uniqueLeakCount=1
    expect(result.uniqueLeakCount).toBe(1);
    // But 4 detections by surface
    expect(result.leaks).toHaveLength(4);
    const surfaces = result.leaks.map((l) => l.surface).sort();
    expect(surfaces).toEqual([
      "pinnedCard.bullets[1]",
      "pinnedCard.focusArea",
      "pinnedCard.secondaryNote",
      "pinnedCard.topic",
    ]);
  });

  it("constants exported for the dispatch site", () => {
    expect(LEAK_SCAN_SPEC_SLUG).toBe("leak-scan-001");
    expect(LEAK_SCAN_PARAMETER_ID).toBe("BEH-INTERNAL-LEAK");
    expect(LEAK_SCAN_APPLOG_SUBJECT).toBe("supervise.internal_leak_detected");
  });
});

// ──────────────────────────────────────────────────────────
// Shared-registry sync — the load-bearing cross-gate pin.
// ──────────────────────────────────────────────────────────

describe("shared registry in sync (cross-gate pin)", () => {
  it("the runtime runner loads the SAME labels the build-time gate reads", () => {
    // 1) Runtime side — what this runner sees.
    const runtimeRegistry = loadInternalLabelRegistry();

    // 2) Build-time side — read the JSON the way the PR #2144 test does.
    const raw = readFileSync(SHARED_REGISTRY_PATH, "utf8");
    const buildTimeJson = JSON.parse(raw) as {
      version: number;
      registry: Record<string, InternalLabelSet>;
    };

    // 3) Symmetric set equality on top-level keys.
    expect(Object.keys(runtimeRegistry).sort()).toEqual(
      Object.keys(buildTimeJson.registry).sort(),
    );

    // 4) For each set, labels must match.
    for (const [setKey, set] of Object.entries(runtimeRegistry)) {
      const buildSet = buildTimeJson.registry[setKey];
      expect(buildSet, `set ${setKey} missing in build-time JSON`).toBeTruthy();
      expect(
        [...set.labels].sort(),
        `labels for ${setKey} diverged between runtime + build-time`,
      ).toEqual([...buildSet.labels].sort());
    }
  });

  it("the shared JSON has at least one non-empty label set", () => {
    const reg = loadInternalLabelRegistry();
    const totalLabels = Object.values(reg).reduce(
      (s, set) => s + set.labels.length,
      0,
    );
    expect(totalLabels).toBeGreaterThan(0);
  });
});
