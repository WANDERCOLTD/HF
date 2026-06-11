/**
 * #1504 Slice 2 — ChatContext history migration (legacy bucket collapse).
 * #1504 Slice 3 — extended to assert the legacy buckets now read as
 *                  `ASSISTANT` after the public ChatMode union narrows.
 *
 * `loadPersistedMessages` collapses any legacy `DATA` / `TUNING` /
 * `COURSE_MANAGE` arrays into a single `ASSISTANT` stream once per user.
 * The migration must be:
 *   - **idempotent** — a second call after the first must return the same
 *     shape (no re-merge, no doubled messages, no banner re-fire).
 *   - **chronological** — merged messages are sorted by timestamp so the
 *     educator sees a coherent thread, not multiple concatenated buckets.
 *   - **mode-rewriting** — each merged message has its `mode` field
 *     rewritten to "ASSISTANT" so future renders / persists treat it as
 *     part of the canonical stream.
 *   - **safe on corrupt input** — JSON parse failure returns the empty
 *     state and marks the user as migrated so we don't retry forever.
 *
 * These tests exercise the pure migration function directly so they don't
 * need a React render tree; the function is exported from ChatContext.tsx
 * for exactly this reason.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPersistedMessages,
  getMergedBannerKey,
  normalizeChatMode,
  type ChatMessage,
} from "@/contexts/ChatContext";

const USER_ID = "u_test_001";

// The storage keys ChatContext.tsx writes / reads. Mirrored here so the
// test owns the contract; if the prefix changes, this test breaks loudly.
const STORAGE_KEY = `hf.chat.history.${USER_ID}`;
const MIGRATION_FLAG_KEY = `hf.chat.history-migrated.v1504.${USER_ID}`;
const MERGED_BANNER_KEY = `hf.chat.history-merged-banner.v1504.${USER_ID}`;

// Legacy modes still appear on persisted messages written pre-Slice-3, so
// the test fixture builder accepts the wide union; we cast on the way in
// (`ChatMessage` post-Slice-3 only accepts `ASSISTANT` or `DEMO`).
type AnyPersistedMode = "ASSISTANT" | "DATA" | "TUNING" | "COURSE_MANAGE" | "DEMO";

function msg(
  id: string,
  mode: AnyPersistedMode,
  content: string,
  timestamp: string,
): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date(timestamp),
    // The on-disk shape carries the legacy string; the loader re-tags it
    // to ASSISTANT in-memory. Cast through `unknown` so TypeScript doesn't
    // complain about the legacy string entering a narrowed union.
    mode: mode as unknown as ChatMessage["mode"],
  };
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe("loadPersistedMessages — fresh install (no legacy keys)", () => {
  it("returns the empty state and marks the user as migrated", () => {
    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT).toEqual([]);
    expect(result.DEMO).toEqual([]);

    // Migration sentinel set even on the no-op path so we never re-scan.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    // No banner triggered — there was nothing to merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });
});

describe("loadPersistedMessages — legacy buckets present (the migration path)", () => {
  it("merges DATA + TUNING + COURSE_MANAGE into ASSISTANT in timestamp order", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data q1", "2026-06-08T10:00:00Z")],
        TUNING: [msg("t1", "TUNING", "tuning ask", "2026-06-08T09:00:00Z")],
        COURSE_MANAGE: [msg("c1", "COURSE_MANAGE", "course ask", "2026-06-08T11:00:00Z")],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["t1", "d1", "c1"]);

    // Every merged message tagged as ASSISTANT so downstream filters by
    // `message.mode` see the canonical stream.
    for (const m of result.ASSISTANT) {
      expect(m.mode).toBe("ASSISTANT");
    }

    // Banner flagged "pending" so ChatPanel shows the one-time notice
    // (banner only fires when legacy TUNING / COURSE_MANAGE had content).
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBe("pending");
    // Migration sentinel set so subsequent loads skip the merge.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("preserves DEMO history (DEMO is NOT folded into ASSISTANT)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [],
        TUNING: [msg("t1", "TUNING", "tuning", "2026-06-08T09:00:00Z")],
        COURSE_MANAGE: [],
        DEMO: [msg("dm1", "DEMO", "demo ask", "2026-06-08T09:30:00Z")],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["t1"]);
    expect(result.DEMO.map((m) => m.id)).toEqual(["dm1"]);
    expect(result.DEMO[0].mode).toBe("DEMO");
  });

  it("does NOT trigger the merge banner when only DATA was present (Slice 2 already moved those messages)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data", "2026-06-09T10:00:00Z")],
        TUNING: [],
        COURSE_MANAGE: [],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    // DATA → ASSISTANT alias-read still happens, but the user-visible
    // "history merged" notice only fires when the operator can detect a
    // change. Pre-Slice-2 the user only had DATA; they wouldn't see a
    // merge happening because nothing was reshuffled.
    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["d1"]);
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });

  it("reads a post-Slice-3 client's ASSISTANT bucket directly (no DATA fallback needed)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ASSISTANT: [
          msg("a1", "ASSISTANT", "assistant q1", "2026-06-10T10:00:00Z"),
          msg("a2", "ASSISTANT", "assistant q2", "2026-06-10T11:00:00Z"),
        ],
        DEMO: [],
      }),
    );

    const result = loadPersistedMessages(USER_ID);
    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["a1", "a2"]);
  });
});

describe("loadPersistedMessages — idempotent (the second call must be a no-op)", () => {
  it("a second call returns the same shape and does not re-merge", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [],
        TUNING: [msg("t1", "TUNING", "tuning ask", "2026-06-08T09:00:00Z")],
        COURSE_MANAGE: [msg("c1", "COURSE_MANAGE", "course ask", "2026-06-08T10:00:00Z")],
      }),
    );

    const first = loadPersistedMessages(USER_ID);
    expect(first.ASSISTANT).toHaveLength(2);

    // Simulate the ChatProvider persisting the merged shape back to storage
    // (the real `persistMessages` writes the new shape on the next effect).
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ASSISTANT: first.ASSISTANT,
        DEMO: [],
      }),
    );

    const second = loadPersistedMessages(USER_ID);

    // Same length, same ids, in the same order. NOT doubled.
    expect(second.ASSISTANT).toHaveLength(2);
    expect(second.ASSISTANT.map((m) => m.id)).toEqual(first.ASSISTANT.map((m) => m.id));

    // Banner stays at whatever the first call set; the second call does NOT
    // overwrite it because the migration sentinel short-circuits the merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBe("pending");
  });

  it("a leaked legacy TUNING bucket from an unmigrated client still alias-reads into ASSISTANT", () => {
    // Slice 3 broadens the safety net: the post-Slice-2 idempotency check
    // would have left a leaked TUNING bucket sitting in its own slot. In
    // Slice 3 the in-memory shape no longer has a TUNING slot at all, so
    // the alias-read pulls those entries into ASSISTANT every load. The
    // banner sentinel is what guarantees idempotency from the *user's*
    // perspective — they only see "history merged" once.
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    window.localStorage.setItem(MERGED_BANNER_KEY, "shown");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data", "2026-06-08T11:00:00Z")],
        TUNING: [msg("t2", "TUNING", "leaked tuning", "2026-06-08T12:00:00Z")],
        COURSE_MANAGE: [],
      }),
    );

    const result = loadPersistedMessages(USER_ID);
    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["d1", "t2"]);
    // Banner state unchanged — user already dismissed it.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBe("shown");
  });
});

describe("loadPersistedMessages — already-migrated shape (no legacy buckets)", () => {
  it("returns the persisted shape unchanged when the migration flag is set", () => {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ASSISTANT: [msg("a1", "ASSISTANT", "assistant", "2026-06-09T10:00:00Z")],
        DEMO: [msg("dm1", "DEMO", "demo", "2026-06-09T10:30:00Z")],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT.map((m) => m.id)).toEqual(["a1"]);
    expect(result.DEMO.map((m) => m.id)).toEqual(["dm1"]);
    // No banner triggered — already migrated.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });
});

describe("loadPersistedMessages — corrupt input (graceful fallback)", () => {
  it("returns the empty state when storage is unparseable JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT).toEqual([]);
    expect(result.DEMO).toEqual([]);

    // Mark migrated so we don't retry parsing the same corrupt blob.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    // No banner — there was nothing the user contributed to merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });

  it("returns the empty state when storage is a non-object (e.g. a stray string)", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("oops"));

    const result = loadPersistedMessages(USER_ID);

    expect(result.ASSISTANT).toEqual([]);
    // The migration sentinel is still set so we don't retry parsing this
    // valid-JSON-but-wrong-shape blob on every page load.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
  });
});

describe("getMergedBannerKey — exported for ChatPanel reads", () => {
  it("produces a user-scoped key", () => {
    expect(getMergedBannerKey("alice")).toBe(
      "hf.chat.history-merged-banner.v1504.alice",
    );
  });

  it("falls back to the prefix when userId is undefined", () => {
    expect(getMergedBannerKey(undefined)).toBe(
      "hf.chat.history-merged-banner.v1504",
    );
  });
});

describe("normalizeChatMode — public API maps legacy mode strings → ASSISTANT", () => {
  it("round-trips ASSISTANT and DEMO unchanged", () => {
    expect(normalizeChatMode("ASSISTANT")).toBe("ASSISTANT");
    expect(normalizeChatMode("DEMO")).toBe("DEMO");
  });

  it("collapses every legacy alias to ASSISTANT", () => {
    expect(normalizeChatMode("DATA")).toBe("ASSISTANT");
    expect(normalizeChatMode("TUNING")).toBe("ASSISTANT");
    expect(normalizeChatMode("COURSE_MANAGE")).toBe("ASSISTANT");
  });

  it("falls back to ASSISTANT on unknown / missing values (safer than stranding the user)", () => {
    expect(normalizeChatMode("UNKNOWN")).toBe("ASSISTANT");
    expect(normalizeChatMode(undefined)).toBe("ASSISTANT");
    expect(normalizeChatMode(null)).toBe("ASSISTANT");
    expect(normalizeChatMode("")).toBe("ASSISTANT");
  });
});
