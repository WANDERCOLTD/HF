// HF-D P0 hardening tests for the 3 PII-returning intake GET routes.
//
// What's pinned:
//   1. Rate limiting kicks in after MAX_ATTEMPTS for a single IP under the
//      "intake-pii-read" key — bulk scraping of leaked intentIds is bounded.
//   2. The JSONL download filename redaction — was `enrollment-${intentId}.jsonl`
//      (filename-as-credential leak); is now `enrollment-${epochMs}.jsonl` with
//      no intentId substring.
//
// See docs/audit/HF-D-evidence-pii-intentid-bearer.md.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/intake/hf-adapter/disclosure-content", () => ({
  loadDisclosureCopy: vi.fn(async (requirementId: string) => ({
    meta: {
      requirementId,
      regulation: "gdpr",
      article: "13",
      version: "0.1.0",
      status: "DRAFT",
      effective: "2026-06-02",
      controller: "HumanFirst Foundation",
      controllerContact: "dpo@humanfirstfoundation.com",
      locale: "en",
    },
    body: "stub body",
    content: { text: "stub body", format: "markdown", locale: "en" },
    contentHash: `fake-hash-${requirementId}`,
  })),
}));

import {
  openSession,
  __resetSessionStore,
} from "@/lib/intake/session-store";
import type {
  IntentKey,
  ProjectionName,
  TenantId,
  Region,
  ActorId,
} from "@/lib/intake/tallyseal";
import { _clearAllForTesting } from "@/lib/rate-limit";
import { GET as sessionGet } from "@/app/api/intake/session/[intentId]/route";
import { GET as bundleByPathGet } from "@/app/api/intake/audit-bundle/[intentId]/route";

const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5", 10);
const ATTACKER_IP = "203.0.113.42"; // RFC 5737 documentation prefix

const TENANT = {
  id: "hf-test" as TenantId,
  region: "europe-west2" as Region,
};
const ACTOR = {
  id: "test-actor" as ActorId,
  kind: "human" as const,
};
const OPEN_INPUT = {
  tenant: TENANT,
  actor: ACTOR,
  key: "EnrollmentIntake" as IntentKey,
  projection: "IntakeApplication" as ProjectionName,
};

function reqFor(url: string, ip: string): NextRequest {
  return new NextRequest(new URL(url), {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  __resetSessionStore();
  _clearAllForTesting();
});

describe("HF-D P0 — rate limit on PII GET routes", () => {
  it("session/[intentId]: blocks the (MAX_ATTEMPTS+1)th request from a single IP", async () => {
    const s = openSession(OPEN_INPUT);

    // Up to MAX_ATTEMPTS legitimate hits return 200.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await sessionGet(
        reqFor(`http://localhost/api/intake/session/${s.intentId}`, ATTACKER_IP),
        { params: Promise.resolve({ intentId: String(s.intentId) }) },
      );
      expect(res.status, `attempt ${i + 1}`).toBe(200);
    }
    // The next call is rate-limited.
    const blocked = await sessionGet(
      reqFor(`http://localhost/api/intake/session/${s.intentId}`, ATTACKER_IP),
      { params: Promise.resolve({ intentId: String(s.intentId) }) },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate-limit key is per-IP — a second IP is not affected by the first's count", async () => {
    const s = openSession(OPEN_INPUT);

    // Exhaust the first IP.
    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      await sessionGet(
        reqFor(`http://localhost/api/intake/session/${s.intentId}`, ATTACKER_IP),
        { params: Promise.resolve({ intentId: String(s.intentId) }) },
      );
    }
    // A different IP can still hit the route once.
    const otherIp = "198.51.100.7";
    const res = await sessionGet(
      reqFor(`http://localhost/api/intake/session/${s.intentId}`, otherIp),
      { params: Promise.resolve({ intentId: String(s.intentId) }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("HF-D P0 — JSONL download filename redaction", () => {
  it("audit-bundle/[intentId]?format=jsonl: Content-Disposition filename does NOT contain the intentId", async () => {
    const s = openSession(OPEN_INPUT);

    const res = await bundleByPathGet(
      reqFor(
        `http://localhost/api/intake/audit-bundle/${s.intentId}?format=jsonl`,
        "10.0.0.1",
      ),
      { params: Promise.resolve({ intentId: String(s.intentId) }) },
    );

    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="enrollment-\d+\.jsonl"$/);
    expect(disposition).not.toContain(String(s.intentId));
    // The intentId is a UUID; specifically check no UUID-shaped substring leaks
    // into the filename.
    expect(disposition).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("audit-bundle/[intentId] default JSON form is unchanged (no Content-Disposition header set)", async () => {
    const s = openSession(OPEN_INPUT);

    const res = await bundleByPathGet(
      reqFor(
        `http://localhost/api/intake/audit-bundle/${s.intentId}`,
        "10.0.0.2",
      ),
      { params: Promise.resolve({ intentId: String(s.intentId) }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBeNull();
  });
});
