/**
 * Tests for the Preview-lens annotation routes (#1493, Epic #1442 Layer 4).
 *
 *   - GET    /api/courses/[courseId]/demo-script
 *   - POST   /api/courses/[courseId]/demo-script
 *   - DELETE /api/courses/[courseId]/demo-script/[bubbleRef]
 *
 * Plus the composition-leak guard (R3 in #1493) — a structural assertion
 * that no transform under `lib/prompt/composition/` reads `demoScript`.
 * The whole point of the NEVER-COMPOSE tag is that no composer ever picks
 * up an operator's presenter notes; if a future change forgets and adds
 * one, this test fails before the regression ships.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const requireAuth = vi.fn();
const isAuthError = vi.fn();
const updatePlaybookConfigMock = vi.fn();
const bumpPlaybookComposeTimestampMock = vi.fn();

const prismaMock = {
  playbook: { findUnique: vi.fn() },
};

vi.mock("@/lib/permissions", () => ({ requireAuth, isAuthError }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: (...args: unknown[]) =>
    updatePlaybookConfigMock(...args),
}));
vi.mock("@/lib/compose/bump-timestamp", () => ({
  bumpPlaybookComposeTimestamp: (...args: unknown[]) =>
    bumpPlaybookComposeTimestampMock(...args),
}));

const PARAMS = { params: Promise.resolve({ courseId: "c1" }) };
const BUBBLE_PARAMS = {
  params: Promise.resolve({
    courseId: "c1",
    bubbleRef: "intake__bot__goals-question__0",
  }),
};

function makeRequest(
  method: string,
  body?: unknown,
): import("next/server").NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(
    "http://localhost:3000/api/courses/c1/demo-script",
    init,
  ) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthError.mockReturnValue(false);
  requireAuth.mockResolvedValue({ session: { user: { id: "u1" } } });
});

describe("POST /api/courses/[courseId]/demo-script — #1493", () => {
  it("appends a new annotation when no entry exists for the bubbleRef", async () => {
    // updatePlaybookConfig invokes the transformer with the current config
    // — simulate an empty `demoScript` and capture the new shape.
    let nextConfig: Record<string, unknown> | null = null;
    updatePlaybookConfigMock.mockImplementation(async (_id, transformer) => {
      nextConfig = transformer({});
      return { playbook: { id: "c1" }, composeAffectingChanged: false, timestampBumped: false, fanoutScope: "none" };
    });

    const { POST } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await POST(
      makeRequest("POST", {
        bubbleRef: "intake__bot__goals-question__0",
        presenterNote: "Pause here — let the audience guess what comes next.",
        isWowMoment: true,
        durationSecOnStep: 30,
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.annotation).toMatchObject({
      bubbleRef: "intake__bot__goals-question__0",
      presenterNote: expect.stringContaining("Pause here"),
      isWowMoment: true,
      durationSecOnStep: 30,
    });
    // The transformer must have produced a NEVER-COMPOSE structure.
    expect(nextConfig).not.toBeNull();
    expect(
      (nextConfig as { demoScript: { annotations: unknown[] } }).demoScript
        .annotations,
    ).toHaveLength(1);
    // composeInputsUpdatedAt bumped as the operator-touch signal.
    expect(bumpPlaybookComposeTimestampMock).toHaveBeenCalledWith("c1");
  });

  it("UPDATES rather than duplicates when bubbleRef already exists", async () => {
    let nextConfig: { demoScript: { annotations: Array<{ bubbleRef: string; presenterNote: string; isWowMoment: boolean }> } } | null = null;
    updatePlaybookConfigMock.mockImplementation(async (_id, transformer) => {
      nextConfig = transformer({
        demoScript: {
          annotations: [
            {
              bubbleRef: "intake__bot__goals-question__0",
              presenterNote: "Old note.",
              isWowMoment: false,
            },
          ],
        },
      });
      return { playbook: { id: "c1" }, composeAffectingChanged: false, timestampBumped: false, fanoutScope: "none" };
    });

    const { POST } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await POST(
      makeRequest("POST", {
        bubbleRef: "intake__bot__goals-question__0",
        presenterNote: "New note.",
        isWowMoment: true,
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1); // still 1 — replaced not appended
    expect(nextConfig).not.toBeNull();
    expect(nextConfig!.demoScript.annotations).toHaveLength(1);
    expect(nextConfig!.demoScript.annotations[0].presenterNote).toBe("New note.");
    expect(nextConfig!.demoScript.annotations[0].isWowMoment).toBe(true);
  });

  it("returns 400 on invalid body shape", async () => {
    const { POST } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await POST(
      // missing presenterNote + isWowMoment
      makeRequest("POST", { bubbleRef: "ref-1" }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Invalid body/i);
    // No write should have happened.
    expect(updatePlaybookConfigMock).not.toHaveBeenCalled();
    expect(bumpPlaybookComposeTimestampMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the course is missing", async () => {
    updatePlaybookConfigMock.mockRejectedValueOnce(
      new Error("updatePlaybookConfig: playbook c1 not found"),
    );
    const { POST } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await POST(
      makeRequest("POST", {
        bubbleRef: "intake__bot__goals-question__0",
        presenterNote: "note",
        isWowMoment: false,
      }),
      PARAMS,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/Course not found/i);
    expect(bumpPlaybookComposeTimestampMock).not.toHaveBeenCalled();
  });

  it("blocks non-OPERATOR sessions via requireAuth", async () => {
    const forbidden = new Response("Forbidden", { status: 403 });
    requireAuth.mockResolvedValueOnce({ error: forbidden });
    isAuthError.mockReturnValueOnce(true);
    const { POST } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await POST(
      makeRequest("POST", {
        bubbleRef: "ref-1",
        presenterNote: "n",
        isWowMoment: false,
      }),
      PARAMS,
    );
    expect(res.status).toBe(403);
    expect(updatePlaybookConfigMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/courses/[courseId]/demo-script — #1493", () => {
  it("returns the persisted demoScript when present", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      config: {
        demoScript: {
          annotations: [
            {
              bubbleRef: "intake__bot__goals-question__0",
              presenterNote: "note",
              isWowMoment: true,
            },
          ],
        },
      },
    });
    const { GET } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await GET(makeRequest("GET"), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.demoScript.annotations).toHaveLength(1);
  });

  it("returns an empty demoScript when none is set", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({ config: {} });
    const { GET } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await GET(makeRequest("GET"), PARAMS);
    const body = await res.json();
    expect(body.demoScript).toEqual({ annotations: [] });
  });

  it("returns 404 when the playbook does not exist", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce(null);
    const { GET } = await import(
      "@/app/api/courses/[courseId]/demo-script/route"
    );
    const res = await GET(makeRequest("GET"), PARAMS);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/courses/[courseId]/demo-script/[bubbleRef] — #1493", () => {
  it("removes the matching annotation and reports removed: true", async () => {
    let nextConfig: { demoScript: { annotations: unknown[] } } | null = null;
    updatePlaybookConfigMock.mockImplementation(async (_id, transformer) => {
      nextConfig = transformer({
        demoScript: {
          annotations: [
            {
              bubbleRef: "intake__bot__goals-question__0",
              presenterNote: "x",
              isWowMoment: false,
            },
            {
              bubbleRef: "welcome__bot__welcome-message__0",
              presenterNote: "y",
              isWowMoment: false,
            },
          ],
        },
      });
      return { playbook: { id: "c1" }, composeAffectingChanged: false, timestampBumped: false, fanoutScope: "none" };
    });

    const { DELETE } = await import(
      "@/app/api/courses/[courseId]/demo-script/[bubbleRef]/route"
    );
    const res = await DELETE(
      makeRequest("DELETE"),
      BUBBLE_PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(true);
    expect(body.count).toBe(1);
    expect(nextConfig!.demoScript.annotations).toHaveLength(1);
    expect(bumpPlaybookComposeTimestampMock).toHaveBeenCalledWith("c1");
  });

  it("is idempotent — returns removed: false when bubbleRef is missing", async () => {
    updatePlaybookConfigMock.mockImplementation(async (_id, transformer) => {
      transformer({ demoScript: { annotations: [] } });
      return { playbook: { id: "c1" }, composeAffectingChanged: false, timestampBumped: false, fanoutScope: "none" };
    });
    const { DELETE } = await import(
      "@/app/api/courses/[courseId]/demo-script/[bubbleRef]/route"
    );
    const res = await DELETE(makeRequest("DELETE"), BUBBLE_PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(false);
    expect(body.count).toBe(0);
    // Idempotent — bump still fires so the UI staleness signal remains
    // consistent (operator-touch happened).
    expect(bumpPlaybookComposeTimestampMock).toHaveBeenCalledWith("c1");
  });
});

describe("Composition-leak guard (#1493 R3) — `demoScript` is NEVER-COMPOSE", () => {
  /**
   * Structural assertion: no source file under
   * `apps/admin/lib/prompt/composition/` may read `demoScript`. The type
   * `DemoScript` is allowed only because composition has no business
   * importing the type either — the test reads raw text to catch both.
   */
  it("no file under lib/prompt/composition/ references demoScript / DemoScript / DemoAnnotation", () => {
    const ROOT = join(
      process.cwd(),
      "lib",
      "prompt",
      "composition",
    );
    const offenders: Array<{ file: string; matches: string[] }> = [];
    const banned = ["demoScript", "DemoScript", "DemoAnnotation"];

    function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = join(dir, entry);
        let s;
        try {
          s = statSync(p);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry)) continue;
        const text = readFileSync(p, "utf8");
        const matches = banned.filter((b) => text.includes(b));
        if (matches.length > 0) offenders.push({ file: p, matches });
      }
    }

    walk(ROOT);

    expect(
      offenders,
      `Composition surface must not read or import demo-script types. Offenders:\n${offenders
        .map((o) => `  ${o.file} (matched: ${o.matches.join(", ")})`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
