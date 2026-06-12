// HF-D hardening tests for the EnrollmentIntake bearer surface.
//
// What's pinned:
//   1. HF-D P0 — rate-limit on PII routes (mitigates T5: line-rate
//      scraping of leaked intentIds; stays as defence-in-depth after
//      the cookie migration).
//   2. HF-D P0 — JSONL download filename redaction (mitigates T4:
//      filename-as-credential leak).
//   3. HF-D P1 #3 (issue #1542) — cookie-bearer migration. The 6
//      reader routes return 401 without the `__hf_intake_sid` cookie,
//      410 when the cookie's intentId points at an evicted session,
//      and 200 when the cookie maps to a live session. The two
//      `[intentId]` path-param routes return 410 (route removed).
//      Bootstrap sets the cookie with HttpOnly / SameSite=Strict /
//      Path=/api/intake/.
//
// See docs/audit/HF-D-evidence-pii-intentid-bearer.md +
// issue #1542.

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
import { INTAKE_SID_COOKIE } from "@/lib/intake/intake-session-cookie";
import { GET as sessionGet } from "@/app/api/intake/session/route";
import { GET as sessionPathStubGet } from "@/app/api/intake/session/[intentId]/route";
import { GET as bundleGet } from "@/app/api/intake/audit-bundle/route";
import { GET as bundlePathStubGet } from "@/app/api/intake/audit-bundle/[intentId]/route";
import { POST as bundleDownloadPost } from "@/app/api/intake/audit-bundle/download/route";

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

function reqWithCookie(
  url: string,
  ip: string,
  intentId: string,
  method: "GET" | "POST" = "GET",
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: {
      "x-forwarded-for": ip,
      cookie: `${INTAKE_SID_COOKIE}=${intentId}`,
    },
  });
}

function reqWithoutCookie(
  url: string,
  ip: string,
  method: "GET" | "POST" = "GET",
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  __resetSessionStore();
  _clearAllForTesting();
});

describe("HF-D P1 #3 — cookie-bearer auth on the reader routes", () => {
  it("GET /api/intake/session — 401 when cookie absent", async () => {
    const res = await sessionGet(
      reqWithoutCookie("http://localhost/api/intake/session", "10.0.0.1"),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("no_intake_session");
  });

  it("GET /api/intake/session — 410 when cookie present but session evicted", async () => {
    const res = await sessionGet(
      reqWithCookie(
        "http://localhost/api/intake/session",
        "10.0.0.2",
        "intent-evicted-uuid",
      ),
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("session_expired");
  });

  it("GET /api/intake/session — 200 when cookie maps to a live session", async () => {
    const s = openSession(OPEN_INPUT);
    const res = await sessionGet(
      reqWithCookie(
        "http://localhost/api/intake/session",
        "10.0.0.3",
        String(s.intentId),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intentId).toBe(s.intentId);
  });

  it("GET /api/intake/audit-bundle — 401 / 410 / 200 cookie discipline", async () => {
    // 401
    const r1 = await bundleGet(
      reqWithoutCookie("http://localhost/api/intake/audit-bundle", "10.0.0.4"),
    );
    expect(r1.status).toBe(401);

    // 410
    const r2 = await bundleGet(
      reqWithCookie(
        "http://localhost/api/intake/audit-bundle",
        "10.0.0.5",
        "intent-evicted",
      ),
    );
    expect(r2.status).toBe(410);

    // 200
    const s = openSession(OPEN_INPUT);
    const r3 = await bundleGet(
      reqWithCookie(
        "http://localhost/api/intake/audit-bundle",
        "10.0.0.6",
        String(s.intentId),
      ),
    );
    expect(r3.status).toBe(200);
  });

  it("POST /api/intake/audit-bundle/download — 401 / 410 / 200 cookie discipline", async () => {
    const r1 = await bundleDownloadPost(
      reqWithoutCookie(
        "http://localhost/api/intake/audit-bundle/download",
        "10.0.0.7",
        "POST",
      ),
    );
    expect(r1.status).toBe(401);

    const r2 = await bundleDownloadPost(
      reqWithCookie(
        "http://localhost/api/intake/audit-bundle/download",
        "10.0.0.8",
        "intent-evicted",
        "POST",
      ),
    );
    expect(r2.status).toBe(410);

    const s = openSession(OPEN_INPUT);
    const r3 = await bundleDownloadPost(
      reqWithCookie(
        "http://localhost/api/intake/audit-bundle/download",
        "10.0.0.9",
        String(s.intentId),
        "POST",
      ),
    );
    expect(r3.status).toBe(200);
    expect(r3.headers.get("content-type")).toContain("application/x-ndjson");
  });
});

describe("HF-D P1 #3 — old [intentId] path-param routes are 410 tombstones", () => {
  it("GET /api/intake/session/[intentId] returns 410 regardless of cookie or session presence", async () => {
    const res = await sessionPathStubGet();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("route_removed");
  });

  it("GET /api/intake/audit-bundle/[intentId] returns 410 regardless of cookie or session presence", async () => {
    const res = await bundlePathStubGet();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("route_removed");
  });
});

describe("HF-D P1 #3 — JSONL download filename has no intentId substring", () => {
  it("POST /api/intake/audit-bundle/download Content-Disposition is a static template", async () => {
    const s = openSession(OPEN_INPUT);
    const res = await bundleDownloadPost(
      reqWithCookie(
        "http://localhost/api/intake/audit-bundle/download",
        "10.0.0.10",
        String(s.intentId),
        "POST",
      ),
    );
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="enrollment-\d+\.jsonl"$/);
    expect(disposition).not.toContain(String(s.intentId));
    // The intentId is a UUID; specifically check no UUID-shaped substring
    // leaks into the filename.
    expect(disposition).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("HF-D P0 — rate limit defence-in-depth", () => {
  it("session GET: blocks the (MAX_ATTEMPTS+1)th request from a single IP", async () => {
    const s = openSession(OPEN_INPUT);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await sessionGet(
        reqWithCookie(
          "http://localhost/api/intake/session",
          ATTACKER_IP,
          String(s.intentId),
        ),
      );
      expect(res.status, `attempt ${i + 1}`).toBe(200);
    }
    const blocked = await sessionGet(
      reqWithCookie(
        "http://localhost/api/intake/session",
        ATTACKER_IP,
        String(s.intentId),
      ),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate-limit key is per-IP — a second IP is not affected by the first's count", async () => {
    const s = openSession(OPEN_INPUT);

    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      await sessionGet(
        reqWithCookie(
          "http://localhost/api/intake/session",
          ATTACKER_IP,
          String(s.intentId),
        ),
      );
    }
    const otherIp = "198.51.100.7";
    const res = await sessionGet(
      reqWithCookie(
        "http://localhost/api/intake/session",
        otherIp,
        String(s.intentId),
      ),
    );
    expect(res.status).toBe(200);
  });
});
