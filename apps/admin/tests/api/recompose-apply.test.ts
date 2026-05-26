/**
 * Tests for POST /api/recompose/apply (epic #854 / Story #857).
 *
 * Asserts:
 *   - AI-safety rejection when any entry is aiSuggested and toggleAll is true
 *   - Toggle 1 invokes autoComposeForCaller
 *   - Toggle 2 POSTs to each unique playbook's recompose-all endpoint
 *   - PENDING_CHANGES_APPLIED audit row written regardless of toggles
 *   - Body validation rejects unknown shapes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "u-test", email: "test@example.com", role: "OPERATOR" },
    },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

const auditLogMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: auditLogMock,
  AuditAction: {
    PENDING_CHANGES_APPLIED: "pending_changes_applied",
  },
}));

const autoComposeMock = vi.fn();
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: autoComposeMock,
}));

// Mock fetch for the recompose-all cohort calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Lazy import after mocks
let POST: typeof import("@/app/api/recompose/apply/route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  autoComposeMock.mockResolvedValue(undefined);
  auditLogMock.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ ok: true, total: 5, succeeded: 5, failed: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  ({ POST } = await import("@/app/api/recompose/apply/route"));
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/recompose/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "session=test" },
    body: JSON.stringify(body),
  });
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    key: "tolerances.masteryThreshold",
    label: "Mastery threshold",
    scopeLabel: "Course IELTS Prep",
    beforeValue: "0.7",
    afterValue: "0.6",
    scope: "playbook" as const,
    scopeId: "pb-1",
    aiSuggested: false,
    fanoutScope: "none" as const,
    ...overrides,
  };
}

describe("POST /api/recompose/apply", () => {
  it("rejects body with empty entries array", async () => {
    const res = await POST(
      makeRequest({
        entries: [],
        toggleCaller: false,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("AI-safety: rejects when any entry is aiSuggested and toggleAll is true", async () => {
    const res = await POST(
      makeRequest({
        entries: [makeEntry({ aiSuggested: true })],
        toggleCaller: false,
        toggleAll: true,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/AI-suggested/i);
    expect(autoComposeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AI-safety: allows aiSuggested entries when toggleAll is false", async () => {
    const res = await POST(
      makeRequest({
        entries: [makeEntry({ aiSuggested: true })],
        toggleCaller: false,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("Toggle 1 (toggleCaller) invokes autoComposeForCaller with playbook from first entry", async () => {
    const res = await POST(
      makeRequest({
        entries: [makeEntry({ scopeId: "pb-7" })],
        toggleCaller: true,
        toggleAll: false,
        callerInContext: { id: "c-1", name: "Mary" },
      }),
    );
    expect(res.status).toBe(200);
    expect(autoComposeMock).toHaveBeenCalledWith("c-1", "pb-7");
    const json = await res.json();
    expect(json.callerRecomposed).toBe(true);
  });

  it("Toggle 1 is a no-op when callerInContext is null", async () => {
    const res = await POST(
      makeRequest({
        entries: [makeEntry()],
        toggleCaller: true,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(autoComposeMock).not.toHaveBeenCalled();
  });

  it("Toggle 2 (toggleAll) POSTs to recompose-all for each unique playbook scope", async () => {
    const res = await POST(
      makeRequest({
        entries: [
          makeEntry({ id: "e-1", scopeId: "pb-1" }),
          makeEntry({ id: "e-2", scopeId: "pb-2" }),
          makeEntry({ id: "e-3", scopeId: "pb-1" }), // dup — should NOT trigger 3rd call
        ],
        toggleCaller: false,
        toggleAll: true,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls;
    const calledUrls = calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/api/playbooks/pb-1/recompose-all"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/playbooks/pb-2/recompose-all"))).toBe(true);
    const json = await res.json();
    expect(json.cohortRecomposeAttempts).toHaveLength(2);
  });

  it("Toggle 2 forwards cookie header to downstream recompose-all", async () => {
    await POST(
      makeRequest({
        entries: [makeEntry()],
        toggleCaller: false,
        toggleAll: true,
        callerInContext: null,
      }),
    );
    expect(fetchMock).toHaveBeenCalled();
    const fetchOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((fetchOpts.headers as Record<string, string>).cookie).toBe("session=test");
  });

  it("PENDING_CHANGES_APPLIED audit row written even when both toggles are off", async () => {
    await POST(
      makeRequest({
        entries: [makeEntry()],
        toggleCaller: false,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const entry = auditLogMock.mock.calls[0][0];
    expect(entry.action).toBe("pending_changes_applied");
    expect(entry.metadata.entryCount).toBe(1);
    expect(entry.metadata.toggleCaller).toBe(false);
    expect(entry.metadata.toggleAll).toBe(false);
    expect(entry.metadata.aiSuggestedCount).toBe(0);
  });

  it("audit row carries aiSuggestedCount + cohortRecomposePlaybookIds", async () => {
    await POST(
      makeRequest({
        entries: [
          makeEntry({ id: "e-1", scopeId: "pb-1", aiSuggested: true }),
          makeEntry({ id: "e-2", scopeId: "pb-2", aiSuggested: false }),
        ],
        toggleCaller: false,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    const entry = auditLogMock.mock.calls[0][0];
    expect(entry.metadata.aiSuggestedCount).toBe(1);
    expect(entry.metadata.cohortRecomposePlaybookIds.sort()).toEqual(["pb-1", "pb-2"]);
  });

  it("audit failure does not block the response", async () => {
    auditLogMock.mockRejectedValueOnce(new Error("audit DB down"));
    const res = await POST(
      makeRequest({
        entries: [makeEntry()],
        toggleCaller: false,
        toggleAll: false,
        callerInContext: null,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.audited).toBe(false);
    expect(json.ok).toBe(true);
  });
});
