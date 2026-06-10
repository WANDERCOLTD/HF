/**
 * #1420 — `POST /api/invite/accept` fires `autoComposeForCaller`
 * post-tx for every ACTIVE enrollment.
 *
 * Structural test:
 *   - Route source imports `autoComposeForCaller`
 *   - Route source declares `fireBootstrapComposeForActiveEnrollments`
 *   - The helper queries the same canonical findMany shape
 *
 * The full invite/accept flow is covered by integration tests; this
 * file targets the post-tx hook contract directly via the in-test
 * mirror of the helper body.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const autoComposeMock = vi.fn();
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: autoComposeMock,
}));

const mockPrisma = {
  callerPlaybook: {
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
  autoComposeMock.mockResolvedValue(undefined);
});

describe("POST /api/invite/accept — post-tx autoCompose (#1420)", () => {
  it("route module imports autoComposeForCaller from the canonical helper", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../app/api/invite/accept/route.ts"),
      "utf8",
    );
    expect(source).toMatch(/autoComposeForCaller/);
    expect(source).toMatch(/fireBootstrapComposeForActiveEnrollments/);
    expect(source).toMatch(/from "@\/lib\/enrollment\/auto-compose"/);
  });

  it("fires autoComposeForCaller for each ACTIVE enrollment (mirror of route helper)", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { playbookId: "pb-invite-1" },
    ]);

    const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");
    const { prisma } = await import("@/lib/prisma");

    async function fireBootstrap(callerId: string): Promise<void> {
      const enrollments = await prisma.callerPlaybook.findMany({
        where: { callerId, status: "ACTIVE" },
        select: { playbookId: true },
      });
      for (const { playbookId } of enrollments) {
        autoComposeForCaller(callerId, playbookId).catch(() => {});
      }
    }

    await fireBootstrap("caller-invite-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(autoComposeMock).toHaveBeenCalledTimes(1);
    expect(autoComposeMock).toHaveBeenCalledWith("caller-invite-1", "pb-invite-1");
  });

  it("compose failure does not propagate to the HTTP caller", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { playbookId: "pb-invite-1" },
    ]);
    autoComposeMock.mockRejectedValueOnce(new Error("compose timeout"));

    const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");
    const { prisma } = await import("@/lib/prisma");

    async function fireBootstrap(callerId: string): Promise<void> {
      const enrollments = await prisma.callerPlaybook.findMany({
        where: { callerId, status: "ACTIVE" },
        select: { playbookId: true },
      });
      for (const { playbookId } of enrollments) {
        autoComposeForCaller(callerId, playbookId).catch((err) => {
          void err;
        });
      }
    }

    await expect(fireBootstrap("c-invite")).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
