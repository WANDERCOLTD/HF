/**
 * #1504 Slice 2 — ChatContext history migration.
 *
 * `loadPersistedMessages` collapses legacy `TUNING` + `COURSE_MANAGE` arrays
 * into a single `DATA` stream once per user. The migration must be:
 *   - **idempotent** — a second call after the first must return the same
 *     shape (no re-merge, no doubled messages, no banner re-fire).
 *   - **chronological** — merged messages are sorted by timestamp so the
 *     educator sees a coherent thread, not three concatenated buckets.
 *   - **mode-rewriting** — each merged message has its `mode` field
 *     rewritten to "DATA" so future renders / persists treat it as part
 *     of the canonical stream.
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
  type ChatMessage,
} from "@/contexts/ChatContext";

const USER_ID = "u_test_001";

// The storage keys ChatContext.tsx writes / reads. Mirrored here so the
// test owns the contract; if the prefix changes, this test breaks loudly.
const STORAGE_KEY = `hf.chat.history.${USER_ID}`;
const MIGRATION_FLAG_KEY = `hf.chat.history-migrated.v1504.${USER_ID}`;
const MERGED_BANNER_KEY = `hf.chat.history-merged-banner.v1504.${USER_ID}`;

function msg(
  id: string,
  mode: "DATA" | "TUNING" | "COURSE_MANAGE" | "DEMO",
  content: string,
  timestamp: string,
): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date(timestamp),
    mode,
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

    expect(result.DATA).toEqual([]);
    expect(result.TUNING).toEqual([]);
    expect(result.COURSE_MANAGE).toEqual([]);
    expect(result.DEMO).toEqual([]);

    // Migration sentinel set even on the no-op path so we never re-scan.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    // No banner triggered — there was nothing to merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });
});

describe("loadPersistedMessages — legacy buckets present (the migration path)", () => {
  it("merges TUNING + COURSE_MANAGE into DATA in timestamp order", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data q1", "2026-06-08T10:00:00Z")],
        TUNING: [msg("t1", "TUNING", "tuning ask", "2026-06-08T09:00:00Z")],
        COURSE_MANAGE: [msg("c1", "COURSE_MANAGE", "course ask", "2026-06-08T11:00:00Z")],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    expect(result.DATA.map((m) => m.id)).toEqual(["t1", "d1", "c1"]);
    expect(result.TUNING).toEqual([]);
    expect(result.COURSE_MANAGE).toEqual([]);

    // Every merged message tagged as DATA so downstream filters by
    // `message.mode` see the canonical stream.
    for (const m of result.DATA) {
      expect(m.mode).toBe("DATA");
    }

    // Banner flagged "pending" so ChatPanel shows the one-time notice.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBe("pending");
    // Migration sentinel set so subsequent loads skip the merge.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
  });

  it("preserves DEMO history (DEMO is NOT folded in)", () => {
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

    expect(result.DATA.map((m) => m.id)).toEqual(["t1"]);
    expect(result.DEMO.map((m) => m.id)).toEqual(["dm1"]);
    expect(result.DEMO[0].mode).toBe("DEMO");
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
    expect(first.DATA).toHaveLength(2);

    // Simulate the ChatProvider persisting the merged shape back to storage
    // (the real `persistMessages` writes the new shape on the next effect).
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: first.DATA,
        TUNING: [],
        COURSE_MANAGE: [],
        DEMO: [],
      }),
    );

    const second = loadPersistedMessages(USER_ID);

    // Same length, same ids, in the same order. NOT doubled.
    expect(second.DATA).toHaveLength(2);
    expect(second.DATA.map((m) => m.id)).toEqual(first.DATA.map((m) => m.id));

    // Banner stays at whatever the first call set; the second call does NOT
    // overwrite it because the migration sentinel short-circuits the merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBe("pending");
  });

  it("does not re-merge even if a future bug repopulates TUNING after the first run", () => {
    // First run does the migration.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [],
        TUNING: [msg("t1", "TUNING", "tuning", "2026-06-08T09:00:00Z")],
        COURSE_MANAGE: [],
      }),
    );
    loadPersistedMessages(USER_ID);

    // Sentinel now set. Manually re-add a TUNING message (simulating a
    // pre-fix client that hadn't shipped Slice 2 yet writing back via the
    // same key). The next load must NOT merge it again — the user has
    // already seen the merge banner; surprising them with a second one
    // would erode trust.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data", "2026-06-08T11:00:00Z")],
        TUNING: [msg("t2", "TUNING", "leaked tuning", "2026-06-08T12:00:00Z")],
        COURSE_MANAGE: [],
      }),
    );

    const result = loadPersistedMessages(USER_ID);
    // TUNING stays in its own bucket (no merge); the educator can see
    // the leak in localStorage if they look. We can clean it up in Slice 3
    // when the UI tabs collapse and the bucket is structurally unreachable.
    expect(result.DATA.map((m) => m.id)).toEqual(["d1"]);
    expect(result.TUNING.map((m) => m.id)).toEqual(["t2"]);
  });
});

describe("loadPersistedMessages — already-migrated shape (no legacy buckets)", () => {
  it("returns the persisted shape unchanged when the migration flag is set", () => {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        DATA: [msg("d1", "DATA", "data", "2026-06-09T10:00:00Z")],
        TUNING: [],
        COURSE_MANAGE: [],
        DEMO: [msg("dm1", "DEMO", "demo", "2026-06-09T10:30:00Z")],
      }),
    );

    const result = loadPersistedMessages(USER_ID);

    expect(result.DATA.map((m) => m.id)).toEqual(["d1"]);
    expect(result.DEMO.map((m) => m.id)).toEqual(["dm1"]);
    // No banner triggered — already migrated.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });
});

describe("loadPersistedMessages — corrupt input (graceful fallback)", () => {
  it("returns the empty state when storage is unparseable JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    const result = loadPersistedMessages(USER_ID);

    expect(result.DATA).toEqual([]);
    expect(result.TUNING).toEqual([]);
    expect(result.COURSE_MANAGE).toEqual([]);
    expect(result.DEMO).toEqual([]);

    // Mark migrated so we don't retry parsing the same corrupt blob.
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    // No banner — there was nothing the user contributed to merge.
    expect(window.localStorage.getItem(MERGED_BANNER_KEY)).toBeNull();
  });

  it("returns the empty state when storage is a non-object (e.g. a stray string)", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("oops"));

    const result = loadPersistedMessages(USER_ID);

    expect(result.DATA).toEqual([]);
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
