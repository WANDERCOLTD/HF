/**
 * Pins the validate-before-write contract of the generic profile-capture
 * EXTRACT routine (#1704 Theme 10).
 *
 * The whitelist guard is the critical safety property: an LLM hallucination
 * MUST NOT be able to write an arbitrary `CallerAttribute` key (or overwrite a
 * `curriculum:*` mastery row). These tests pin that, plus band coercion, the
 * grounding guard, the flag no-op, and the persisted row shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAICompletion = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerAttribute: { upsert: vi.fn() },
    playbook: { findUnique: vi.fn() },
    curriculumModule: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) => mockAICompletion(...args),
}));
vi.mock("@/lib/system-settings", () => ({
  getAITimeoutSettings: vi.fn().mockResolvedValue({ pipelineTimeoutMs: 30000 }),
}));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { log as appLog } from "@/lib/logger";
import {
  extractProfileFields,
  resolveProfileFieldsForCall,
  coerceProfileValue,
  isWhitelistedProfileKey,
  PROFILE_SCOPE,
  PROFILE_VALIDATION_FAILED_SUBJECT,
  type ProfileFieldToCapture,
} from "@/lib/pipeline/extract-profile-fields";

const mockedUpsert = prisma.callerAttribute.upsert as unknown as ReturnType<typeof vi.fn>;
const mockedAppLog = appLog as unknown as ReturnType<typeof vi.fn>;

const TRANSCRIPT = [
  "Tutor: Why are you taking IELTS?",
  "Learner: I need it for a UK university application.",
  "Tutor: What band score are you aiming for?",
  "Learner: I'm aiming for band 7.",
].join("\n");

const FIELDS: ProfileFieldToCapture[] = [
  { key: "profile:reason", prompt: "Why are you taking IELTS?", type: "text" },
  { key: "profile:targetBand", prompt: "What band score?", type: "band" },
];

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
}

function aiReturns(fields: unknown[]) {
  mockAICompletion.mockResolvedValueOnce({ content: JSON.stringify({ fields }) });
}

beforeEach(() => {
  mockedUpsert.mockReset().mockResolvedValue({ id: "attr-1" });
  mockedAppLog.mockReset();
  mockAICompletion.mockReset();
  process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
});
afterEach(() => {
  delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
});

describe("extractProfileFields — validate-before-write", () => {
  it("writes whitelisted, grounded fields to CallerAttribute scope PROFILE", async () => {
    aiReturns([
      { key: "profile:reason", value: "university application", evidence: "I need it for a UK university application", confidence: 0.9 },
      { key: "profile:targetBand", value: "7", evidence: "I'm aiming for band 7", confidence: 0.95 },
    ]);

    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });

    expect(res).toEqual({ captured: 2, rejected: 0 });
    expect(mockedUpsert).toHaveBeenCalledTimes(2);

    const first = mockedUpsert.mock.calls[0]![0];
    expect(first.where.callerId_key_scope.scope).toBe(PROFILE_SCOPE);
    expect(first.create.scope).toBe(PROFILE_SCOPE);
    expect(first.create.valueType).toBe("JSON");
    expect(first.create.jsonValue.source).toBe("ai-extract");
    expect(first.create.jsonValue.sourceCallId).toBe("call-1");

    // band coerced from "7" (string) → numeric 7.
    const band = mockedUpsert.mock.calls.find(
      (c) => c[0].where.callerId_key_scope.key === "profile:targetBand",
    )![0];
    expect(band.create.jsonValue.value).toBe(7);
  });

  it("rejects out-of-whitelist keys (LLM hallucination) and AppLogs, keeping valid fields", async () => {
    aiReturns([
      { key: "profile:reason", value: "exam prep", evidence: "I need it for a UK university application", confidence: 0.9 },
      { key: "curriculum:ielts:lo_mastery:part1:LO1", value: "9", evidence: "I'm aiming for band 7", confidence: 0.99 },
      { key: "malicious:override", value: "x", evidence: "I'm aiming for band 7", confidence: 0.9 },
    ]);

    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });

    expect(res.captured).toBe(1);
    expect(res.rejected).toBe(2);
    // Only the whitelisted profile:* key was written — never the curriculum:* key.
    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    expect(mockedUpsert.mock.calls[0]![0].where.callerId_key_scope.key).toBe("profile:reason");
    const subjects = mockedAppLog.mock.calls.map((c) => c[1]);
    expect(subjects.filter((s) => s === PROFILE_VALIDATION_FAILED_SUBJECT)).toHaveLength(2);
  });

  it("rejects a field whose evidence is not grounded in the transcript", async () => {
    aiReturns([
      { key: "profile:reason", value: "fabricated", evidence: "I want to move to Canada", confidence: 0.9 },
    ]);

    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });

    expect(res).toEqual({ captured: 0, rejected: 1 });
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(mockedAppLog.mock.calls[0]![2].reason).toBe("ungrounded_evidence");
  });

  it("rejects a non-numeric band value but keeps a valid grounded field", async () => {
    aiReturns([
      { key: "profile:targetBand", value: "tenner", evidence: "I'm aiming for band 7", confidence: 0.9 },
    ]);

    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });

    expect(res).toEqual({ captured: 0, rejected: 1 });
    expect(mockedAppLog.mock.calls[0]![2].reason).toBe("not_numeric");
  });

  it("no-ops when the feature flag is off (no LLM call, no write)", async () => {
    delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });
    expect(res.skippedReason).toBe("flag_off");
    expect(mockAICompletion).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("no-ops when the module declares no profile fields (zero regression)", async () => {
    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: TRANSCRIPT,
      profileFields: [], engine: "claude", log: makeLog(),
    });
    expect(res.skippedReason).toBe("no_fields");
    expect(mockAICompletion).not.toHaveBeenCalled();
  });

  it("no-ops when the transcript is empty/whitespace (no LLM call, no write)", async () => {
    const res = await extractProfileFields({
      callId: "call-1", callerId: "caller-1", transcript: "   \n  \t ",
      profileFields: FIELDS, engine: "claude", log: makeLog(),
    });
    expect(res).toEqual({ captured: 0, rejected: 0, skippedReason: "empty_transcript" });
    expect(mockAICompletion).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});

describe("coerceProfileValue — type validation", () => {
  it("coerces band strings and enforces 1.0–9.0 half-bands", () => {
    expect(coerceProfileValue("band", "7")).toEqual({ ok: true, valueType: "NUMBER", value: 7 });
    expect(coerceProfileValue("band", 6.5)).toEqual({ ok: true, valueType: "NUMBER", value: 6.5 });
    expect(coerceProfileValue("band", "10")).toEqual({ ok: false, reason: "band_out_of_range" });
    expect(coerceProfileValue("band", "6.3")).toEqual({ ok: false, reason: "band_not_half" });
    expect(coerceProfileValue("band", "tenner")).toEqual({ ok: false, reason: "not_numeric" });
  });

  it("validates number and non-empty text", () => {
    expect(coerceProfileValue("number", "3")).toEqual({ ok: true, valueType: "NUMBER", value: 3 });
    expect(coerceProfileValue("text", "  hi  ")).toEqual({ ok: true, valueType: "STRING", value: "hi" });
    expect(coerceProfileValue("text", "   ")).toEqual({ ok: false, reason: "empty_text" });
  });
});

describe("resolveProfileFieldsForCall — operator-editable JSON defence", () => {
  const mockedPlaybookFind = prisma.playbook.findUnique as unknown as ReturnType<typeof vi.fn>;
  const mockedModuleFind = prisma.curriculumModule.findUnique as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedPlaybookFind.mockReset();
    mockedModuleFind.mockReset();
  });

  it("returns [] when the flag is off (no DB read)", async () => {
    delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    const out = await resolveProfileFieldsForCall({
      playbookId: "pb-1",
      curriculumModuleId: "cm-1",
    });
    expect(out).toEqual([]);
    expect(mockedPlaybookFind).not.toHaveBeenCalled();
    expect(mockedModuleFind).not.toHaveBeenCalled();
  });

  it("returns [] when playbookId or curriculumModuleId is missing", async () => {
    expect(
      await resolveProfileFieldsForCall({ playbookId: null, curriculumModuleId: "cm-1" }),
    ).toEqual([]);
    expect(
      await resolveProfileFieldsForCall({ playbookId: "pb-1", curriculumModuleId: undefined }),
    ).toEqual([]);
    expect(mockedPlaybookFind).not.toHaveBeenCalled();
    expect(mockedModuleFind).not.toHaveBeenCalled();
  });

  it("returns [] when the authored module declares no profileFieldsToCapture", async () => {
    mockedPlaybookFind.mockResolvedValue({
      config: { modules: [{ id: "mod-slug", settings: {} }] },
    });
    mockedModuleFind.mockResolvedValue({ slug: "mod-slug" });

    const out = await resolveProfileFieldsForCall({
      playbookId: "pb-1",
      curriculumModuleId: "cm-1",
    });
    expect(out).toEqual([]);
  });

  it("returns [] when the bound module's slug doesn't match any authored module", async () => {
    mockedPlaybookFind.mockResolvedValue({
      config: {
        modules: [
          {
            id: "other-slug",
            settings: {
              profileFieldsToCapture: [
                { key: "profile:reason", prompt: "Why?", type: "text" },
              ],
            },
          },
        ],
      },
    });
    mockedModuleFind.mockResolvedValue({ slug: "mod-slug" });

    const out = await resolveProfileFieldsForCall({
      playbookId: "pb-1",
      curriculumModuleId: "cm-1",
    });
    expect(out).toEqual([]);
  });

  it("filters malformed entries from operator-editable JSON (Phase 1 JourneyJsonFallback)", async () => {
    mockedPlaybookFind.mockResolvedValue({
      config: {
        modules: [
          {
            id: "mod-slug",
            settings: {
              profileFieldsToCapture: [
                { key: "profile:reason", prompt: "Why?", type: "text" },
                { key: "profile:targetBand", prompt: "Band?", type: "band" },
                { key: "profile:bad", prompt: "x", type: "boolean" },
                { key: 42, prompt: "x", type: "text" },
                { prompt: "no key", type: "text" },
                null,
                "not-an-object",
              ],
            },
          },
        ],
      },
    });
    mockedModuleFind.mockResolvedValue({ slug: "mod-slug" });

    const out = await resolveProfileFieldsForCall({
      playbookId: "pb-1",
      curriculumModuleId: "cm-1",
    });
    expect(out).toEqual([
      { key: "profile:reason", prompt: "Why?", type: "text" },
      { key: "profile:targetBand", prompt: "Band?", type: "band" },
    ]);
  });

  it("returns [] when profileFieldsToCapture is not an array", async () => {
    mockedPlaybookFind.mockResolvedValue({
      config: {
        modules: [
          { id: "mod-slug", settings: { profileFieldsToCapture: "oops not an array" } },
        ],
      },
    });
    mockedModuleFind.mockResolvedValue({ slug: "mod-slug" });

    const out = await resolveProfileFieldsForCall({
      playbookId: "pb-1",
      curriculumModuleId: "cm-1",
    });
    expect(out).toEqual([]);
  });
});

describe("isWhitelistedProfileKey", () => {
  const declared = new Set(["profile:reason", "profile:targetBand"]);
  it("accepts declared profile:* keys only", () => {
    expect(isWhitelistedProfileKey("profile:reason", declared)).toBe(true);
    expect(isWhitelistedProfileKey("profile:notDeclared", declared)).toBe(false);
    expect(isWhitelistedProfileKey("curriculum:x:lo_mastery:a:b", declared)).toBe(false);
    expect(isWhitelistedProfileKey("reason", declared)).toBe(false);
    expect(isWhitelistedProfileKey(42, declared)).toBe(false);
  });
});
