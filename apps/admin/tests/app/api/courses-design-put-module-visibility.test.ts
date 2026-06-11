/**
 * Tests for PUT /api/courses/[courseId]/design — #1405 module-visibility.
 *
 * The PUT handler delegates the actual mutation to `updatePlaybookConfig`
 * via a mutator callback. These tests invoke that callback against a
 * synthetic `pbConfig` to assert the partial-merge semantics on the
 * `firstCall.firstCallModuleVisibility` field:
 *
 *   - sets the value when valid
 *   - rejects unknown enum values
 *   - clears the key (and drops the `firstCall` namespace when empty)
 *   - preserves sibling `firstCall.*` fields (partial-merge)
 *   - leaves config untouched when body field is absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const requireAuth = vi.fn();
const isAuthError = vi.fn();
const updatePlaybookConfigMock = vi.fn();

vi.mock("@/lib/permissions", () => ({ requireAuth, isAuthError }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: updatePlaybookConfigMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  isAuthError.mockReturnValue(false);
  requireAuth.mockResolvedValue({ session: { user: { id: "u1" } } });
});

interface MutationRecord {
  before: PlaybookConfig;
  after: PlaybookConfig;
  threwWith?: string;
}

async function runPut(
  body: Record<string, unknown>,
  initialConfig: PlaybookConfig,
): Promise<MutationRecord> {
  const record: MutationRecord = {
    before: structuredClone(initialConfig),
    after: structuredClone(initialConfig),
  };
  updatePlaybookConfigMock.mockImplementationOnce(
    async (_id: string, mutate: (cfg: PlaybookConfig) => PlaybookConfig) => {
      try {
        record.after = mutate(structuredClone(initialConfig));
      } catch (e) {
        record.threwWith = e instanceof Error ? e.message : String(e);
        throw e;
      }
      return { composeAffectingChanged: false };
    },
  );

  const req = new Request(
    "http://localhost:3000/api/courses/c1/design",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;

  const { PUT } = await import("@/app/api/courses/[courseId]/design/route");
  await PUT(req, { params: Promise.resolve({ courseId: "c1" }) });
  return record;
}

describe("PUT /api/courses/[courseId]/design — module-visibility (#1405)", () => {
  it("sets firstCall.firstCallModuleVisibility when given a valid enum value", async () => {
    const rec = await runPut(
      { firstCall: { firstCallModuleVisibility: "hide_until_call_2" } },
      {},
    );
    expect(rec.after.firstCall?.firstCallModuleVisibility).toBe(
      "hide_until_call_2",
    );
  });

  it("preserves sibling firstCall fields (partial-merge)", async () => {
    const rec = await runPut(
      { firstCall: { firstCallModuleVisibility: "hide_until_learner_picks" } },
      {
        firstCall: {
          durationMinsOverride: 12,
          introducePedagogy: false,
        },
      },
    );
    expect(rec.after.firstCall).toEqual({
      durationMinsOverride: 12,
      introducePedagogy: false,
      firstCallModuleVisibility: "hide_until_learner_picks",
    });
  });

  it("clears only the visibility key with null, leaves siblings intact", async () => {
    const rec = await runPut(
      { firstCall: { firstCallModuleVisibility: null } },
      {
        firstCall: {
          durationMinsOverride: 10,
          firstCallModuleVisibility: "hide_until_call_2",
        },
      },
    );
    expect(rec.after.firstCall?.firstCallModuleVisibility).toBeUndefined();
    expect(rec.after.firstCall?.durationMinsOverride).toBe(10);
  });

  it("drops the firstCall namespace when clearing the only key", async () => {
    const rec = await runPut(
      { firstCall: { firstCallModuleVisibility: null } },
      {
        firstCall: { firstCallModuleVisibility: "hide_until_call_2" },
      },
    );
    expect(rec.after.firstCall).toBeUndefined();
  });

  it("rejects unknown enum values", async () => {
    const rec = await runPut(
      { firstCall: { firstCallModuleVisibility: "bogus_mode" } },
      {},
    );
    expect(rec.threwWith ?? "").toContain("Invalid firstCall.firstCallModuleVisibility");
  });

  it("does NOT modify config when body field is absent", async () => {
    const rec = await runPut(
      { firstCallMode: "teach_immediately" },
      {
        firstCall: { firstCallModuleVisibility: "hide_until_call_2" },
      },
    );
    expect(rec.after.firstCall?.firstCallModuleVisibility).toBe(
      "hide_until_call_2",
    );
  });
});
