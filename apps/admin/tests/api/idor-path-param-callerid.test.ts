// HF-M IDOR sweep — pins the `studentAllowedToReadCaller` guard on the
// worst-case route (snapshot, which returns full PII).
//
// Pre-HF-M: a STUDENT supplying any victim callerId in /api/callers/[callerId]/snapshot
// got the victim's full dossier (name, email, personality, memories, calls with
// transcripts, identities, composed prompts).
// Post-HF-M: same request returns 403 "Forbidden — caller scope mismatch".
//
// Non-STUDENT roles pass through unchanged (admin browsing preserved).
//
// See docs/audit/HF-M-evidence-path-param-idor.md.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth layer — the guard fires BEFORE any DB hit, so a session
// fixture is sufficient. We mock requireAuth to return STUDENT / OPERATOR
// sessions and assert the guard's response shape.
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) =>
    !!r && typeof r === "object" && "error" in (r as Record<string, unknown>),
}));

// Mock prisma — we should NEVER reach it for STUDENT-foreign-callerId case
// (the guard short-circuits before the DB). The non-STUDENT case will reach
// prisma; mock the relevant call so the route doesn't blow up post-guard.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: {
      findUnique: vi.fn(async () => null), // 404 — but the guard fired first if STUDENT
    },
  },
}));

import { requireAuth } from "@/lib/permissions";
import { GET as snapshotGet } from "@/app/api/callers/[callerId]/snapshot/route";

const STUDENT_OWN_CALLER_ID = "caller-student-own-abc123";
const VICTIM_CALLER_ID = "caller-victim-xyz789";

function studentSession() {
  return {
    user: {
      id: "user-student-1",
      role: "STUDENT" as const,
      learnerCallerId: STUDENT_OWN_CALLER_ID,
    },
    expires: "2099-01-01T00:00:00Z",
  };
}

function operatorSession() {
  return {
    user: {
      id: "user-op-1",
      role: "OPERATOR" as const,
      learnerCallerId: null,
    },
    expires: "2099-01-01T00:00:00Z",
  };
}

function reqFor(path: string) {
  return new Request(`http://localhost${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HF-M IDOR guard on /api/callers/[callerId]/snapshot", () => {
  it("STUDENT supplying a FOREIGN callerId gets 403 with the scope-mismatch envelope", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: studentSession(),
    });

    const res = await snapshotGet(reqFor(`/api/callers/${VICTIM_CALLER_ID}/snapshot`), {
      params: Promise.resolve({ callerId: VICTIM_CALLER_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: expect.stringMatching(/scope mismatch/i) });
  });

  it("STUDENT supplying their OWN callerId passes the guard (reaches the route logic)", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: studentSession(),
    });

    const res = await snapshotGet(reqFor(`/api/callers/${STUDENT_OWN_CALLER_ID}/snapshot`), {
      params: Promise.resolve({ callerId: STUDENT_OWN_CALLER_ID }),
    });

    // Past the guard. Prisma mock returns null → snapshot route returns 404.
    expect(res.status).toBe(404);
  });

  it("OPERATOR passes the guard regardless of callerId — admin browsing preserved", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: operatorSession(),
    });

    const res = await snapshotGet(reqFor(`/api/callers/${VICTIM_CALLER_ID}/snapshot`), {
      params: Promise.resolve({ callerId: VICTIM_CALLER_ID }),
    });

    // Past the guard. Prisma mock returns null → 404 (not 403).
    expect(res.status).toBe(404);
  });

  it("STUDENT with no learnerCallerId claim is denied (defence-in-depth)", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        user: {
          id: "user-student-broken",
          role: "STUDENT" as const,
          learnerCallerId: null,
        },
        expires: "2099-01-01T00:00:00Z",
      },
    });

    const res = await snapshotGet(reqFor(`/api/callers/${VICTIM_CALLER_ID}/snapshot`), {
      params: Promise.resolve({ callerId: VICTIM_CALLER_ID }),
    });

    expect(res.status).toBe(403);
  });
});
