/**
 * #948 — L9 chain contract: learner-facing module-picker reachability.
 *
 * Acceptance criteria pinned by these tests (per the bank entry D003):
 *   1. URL override always wins, even when enrollments differ.
 *   2. 1 ACTIVE enrollment → that playbookId.
 *   3. 2+ ACTIVE → most-recently-enrolled (sort by enrolledAt DESC).
 *   4. 0 ACTIVE → null (NOT undefined, NOT a crash — page renders empty state).
 *   5. Non-ACTIVE enrollments (PAUSED, COMPLETED, DROPPED) excluded from
 *      the candidate pool (the SQL `where: { status: 'ACTIVE' }` filter does
 *      this; we assert by spying on the prisma call).
 *   6. Empty / undefined / null urlOverride → falls through to enrollment
 *      branch (not treated as a literal override).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerPlaybook: { findMany: findManyMock },
  },
  db: () => ({ callerPlaybook: { findMany: findManyMock } }),
}));

beforeEach(() => {
  findManyMock.mockReset();
});

describe("#948 / L9 — resolveActivePlaybookId", () => {
  describe("URL override branch", () => {
    it("returns the urlOverride verbatim when non-empty (single ACTIVE enrollment ignored)", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([
        { playbookId: "enrolled-pb-1" },
      ]);

      const result = await resolveActivePlaybookId("caller-1", "url-pb-99");

      expect(result).toBe("url-pb-99");
      // Override wins — no DB read needed.
      expect(findManyMock).not.toHaveBeenCalled();
    });

    it("returns the urlOverride even when MULTIPLE ACTIVE enrollments exist", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([
        { playbookId: "enrolled-pb-1" },
        { playbookId: "enrolled-pb-2" },
      ]);

      const result = await resolveActivePlaybookId("caller-1", "deep-link-pb");

      expect(result).toBe("deep-link-pb");
      expect(findManyMock).not.toHaveBeenCalled();
    });

    it("returns the urlOverride even when ZERO active enrollments exist (legit preview deep-link)", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([]);

      const result = await resolveActivePlaybookId("caller-1", "preview-pb");

      expect(result).toBe("preview-pb");
      expect(findManyMock).not.toHaveBeenCalled();
    });
  });

  describe("Empty / nullish urlOverride falls through", () => {
    it("treats undefined urlOverride as 'no override' and reads enrollments", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "enrolled-pb-1" }]);

      const result = await resolveActivePlaybookId("caller-1", undefined);

      expect(result).toBe("enrolled-pb-1");
      expect(findManyMock).toHaveBeenCalledOnce();
    });

    it("treats null urlOverride as 'no override' and reads enrollments", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "enrolled-pb-1" }]);

      const result = await resolveActivePlaybookId("caller-1", null);

      expect(result).toBe("enrolled-pb-1");
      expect(findManyMock).toHaveBeenCalledOnce();
    });

    it("treats empty-string urlOverride as 'no override' and reads enrollments", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "enrolled-pb-1" }]);

      const result = await resolveActivePlaybookId("caller-1", "");

      expect(result).toBe("enrolled-pb-1");
      expect(findManyMock).toHaveBeenCalledOnce();
    });

    it("omitted urlOverride argument falls through to enrollments", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "enrolled-pb-1" }]);

      const result = await resolveActivePlaybookId("caller-1");

      expect(result).toBe("enrolled-pb-1");
      expect(findManyMock).toHaveBeenCalledOnce();
    });
  });

  describe("Enrollment fallback branch — SQL filter shape", () => {
    it("scopes the findMany call to callerId + status=ACTIVE + ordered by enrolledAt DESC", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "pb-1" }]);

      await resolveActivePlaybookId("caller-xyz");

      expect(findManyMock).toHaveBeenCalledWith({
        where: { callerId: "caller-xyz", status: "ACTIVE" },
        orderBy: { enrolledAt: "desc" },
        select: { playbookId: true },
      });
    });
  });

  describe("Enrollment fallback branch — pick rules", () => {
    it("1 ACTIVE enrollment → returns that playbookId", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "single-pb" }]);

      const result = await resolveActivePlaybookId("caller-1");

      expect(result).toBe("single-pb");
    });

    it("2+ ACTIVE → returns most-recently-enrolled (prisma returns DESC; index 0 wins)", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      // The helper relies on `orderBy: { enrolledAt: 'desc' }` to surface
      // the newest at index 0 — so the mock returns rows in that order.
      findManyMock.mockResolvedValue([
        { playbookId: "newest-pb" },     // most-recently enrolled
        { playbookId: "older-pb" },
        { playbookId: "oldest-pb" },
      ]);

      const result = await resolveActivePlaybookId("caller-1");

      expect(result).toBe("newest-pb");
    });

    it("0 ACTIVE → null (never undefined, never a crash)", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([]);

      const result = await resolveActivePlaybookId("caller-orphan");

      expect(result).toBeNull();
    });
  });

  describe("Non-ACTIVE statuses excluded from candidate pool", () => {
    it("PAUSED / COMPLETED / DROPPED rows do not reach the helper because the SQL filter excludes them", async () => {
      // The `where: { status: 'ACTIVE' }` clause is what does the filtering
      // server-side. Verify by passing only ACTIVE rows to the helper (as
      // Prisma would) AND asserting the where clause carries the filter.
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      findManyMock.mockResolvedValue([{ playbookId: "active-pb" }]);

      const result = await resolveActivePlaybookId("caller-mixed");

      // Helper picked the ACTIVE row (PAUSED/COMPLETED never returned by SQL).
      expect(result).toBe("active-pb");
      // And the SQL guarantees the filter applies.
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });

    it("returns null when EVERY enrollment is non-ACTIVE (SQL returns empty)", async () => {
      const { resolveActivePlaybookId } = await import(
        "@/lib/caller/resolve-active-playbook"
      );
      // In real life prisma would return [] because the WHERE filters them.
      findManyMock.mockResolvedValue([]);

      const result = await resolveActivePlaybookId("caller-all-paused");

      expect(result).toBeNull();
    });
  });
});
