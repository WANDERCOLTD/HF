/**
 * Tests for the pending-change payload contract used by AI tool
 * handlers (epic #854 / #873).
 *
 * Asserts the builder produces the shape that the client renderer
 * + tray Provider listener expect, and that the type guard correctly
 * narrows.
 */

import { describe, it, expect } from "vitest";
import {
  buildPendingChangePayload,
  hasPendingChangePayload,
  extractPendingChangeFromToolResult,
} from "@/lib/chat/pending-change-payload";

describe("buildPendingChangePayload", () => {
  it("produces the canonical shape for a playbook-scope change", () => {
    const p = buildPendingChangePayload({
      scope: "playbook",
      scopeId: "pb-1",
      scopeLabel: "Course IELTS Prep",
      key: "masteryThreshold",
      label: "Mastery threshold",
      beforeValue: 0.7,
      afterValue: 0.6,
    });
    expect(p).toEqual({
      key: "masteryThreshold",
      label: "Mastery threshold",
      scopeLabel: "Course IELTS Prep",
      beforeValue: "0.7",
      afterValue: "0.6",
      scope: "playbook",
      scopeId: "pb-1",
      fanoutScope: "caller",
    });
  });

  it("stringifies before/after values consistently", () => {
    const p = buildPendingChangePayload({
      scope: "domain",
      scopeId: "d-1",
      scopeLabel: "Domain Acme",
      key: "onboardingWelcome",
      label: "Onboarding welcome",
      beforeValue: null,
      afterValue: "Welcome to Acme",
    });
    expect(p.beforeValue).toBe("—");
    expect(p.afterValue).toBe("Welcome to Acme");
  });

  it("handles boolean + object values", () => {
    const p1 = buildPendingChangePayload({
      scope: "playbook",
      scopeId: "pb-1",
      scopeLabel: "Course X",
      key: "isActive",
      label: "Active",
      beforeValue: true,
      afterValue: false,
    });
    expect(p1.beforeValue).toBe("true");
    expect(p1.afterValue).toBe("false");

    const p2 = buildPendingChangePayload({
      scope: "system",
      scopeId: null,
      scopeLabel: "Spec EXTRACT-001",
      key: "thresholds",
      label: "Thresholds",
      beforeValue: { foo: 1 },
      afterValue: { foo: 2 },
    });
    expect(p2.beforeValue).toBe('{"foo":1}');
    expect(p2.afterValue).toBe('{"foo":2}');
    expect(p2.scopeId).toBeNull();
  });

  it("AI-emitted payloads always default fanoutScope to 'caller'", () => {
    const p = buildPendingChangePayload({
      scope: "playbook",
      scopeId: "pb-1",
      scopeLabel: "Course X",
      key: "anything",
      label: "Anything",
      beforeValue: 1,
      afterValue: 2,
    });
    expect(p.fanoutScope).toBe("caller");
    // AI MUST NOT request 'all' — enforced server-side by /api/recompose/apply
    expect(p.fanoutScope).not.toBe("all");
  });
});

describe("hasPendingChangePayload type guard", () => {
  const valid = {
    pendingChange: {
      key: "k",
      label: "L",
      scopeLabel: "S",
      beforeValue: "0.7",
      afterValue: "0.6",
      scope: "playbook" as const,
      scopeId: "pb-1",
      fanoutScope: "caller" as const,
    },
  };

  it("accepts a well-formed payload", () => {
    expect(hasPendingChangePayload(valid)).toBe(true);
  });

  it("rejects null + non-objects", () => {
    expect(hasPendingChangePayload(null)).toBe(false);
    expect(hasPendingChangePayload(undefined)).toBe(false);
    expect(hasPendingChangePayload("string")).toBe(false);
    expect(hasPendingChangePayload(42)).toBe(false);
  });

  it("rejects objects missing pendingChange", () => {
    expect(hasPendingChangePayload({ ok: true })).toBe(false);
  });

  it("rejects pendingChange with wrong scope value", () => {
    const bad = { pendingChange: { ...valid.pendingChange, scope: "bogus" } };
    expect(hasPendingChangePayload(bad)).toBe(false);
  });

  it("rejects pendingChange with fanoutScope='all' (AI safety)", () => {
    const bad = { pendingChange: { ...valid.pendingChange, fanoutScope: "all" } };
    expect(hasPendingChangePayload(bad)).toBe(false);
  });

  it("accepts scopeId=null (system scope)", () => {
    const ok = {
      pendingChange: { ...valid.pendingChange, scope: "system" as const, scopeId: null },
    };
    expect(hasPendingChangePayload(ok)).toBe(true);
  });
});

describe("extractPendingChangeFromToolResult (chat-route bridge)", () => {
  const validPayload = {
    key: "k",
    label: "L",
    scopeLabel: "S",
    beforeValue: "0.7",
    afterValue: "0.6",
    scope: "playbook" as const,
    scopeId: "pb-1",
    fanoutScope: "caller" as const,
  };

  it("extracts pendingChange from a stringified tool result", () => {
    const toolResult = JSON.stringify({
      ok: true,
      message: "done",
      pendingChange: validPayload,
    });
    const extracted = extractPendingChangeFromToolResult(toolResult);
    expect(extracted).toEqual(validPayload);
  });

  it("returns null when the string has no pendingChange field", () => {
    const toolResult = JSON.stringify({ ok: true, message: "no payload" });
    expect(extractPendingChangeFromToolResult(toolResult)).toBeNull();
  });

  it("returns null for truncated / malformed JSON (3000+ char results)", () => {
    // Simulates `truncateResult`'s "json.slice(0, 3000) + '... (truncated)'"
    const truncated = '{"ok":true,"pendingChange":{"key":"k","label":"L"... (truncated)';
    expect(extractPendingChangeFromToolResult(truncated)).toBeNull();
  });

  it("returns null when input is not a string", () => {
    // Defensive against future signature drift
    expect(extractPendingChangeFromToolResult(null as unknown as string)).toBeNull();
    expect(
      extractPendingChangeFromToolResult({ pendingChange: validPayload } as unknown as string),
    ).toBeNull();
  });

  it("returns null when pendingChange exists but has wrong shape", () => {
    const toolResult = JSON.stringify({
      ok: true,
      pendingChange: { key: 42 /* should be string */ },
    });
    expect(extractPendingChangeFromToolResult(toolResult)).toBeNull();
  });
});
