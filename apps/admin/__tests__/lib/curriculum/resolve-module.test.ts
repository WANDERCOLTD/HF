/**
 * Regression tests for the scoped curriculum-module resolver (#409 / #407).
 *
 * The bug class these tests prevent: unscoped `findFirst({where: {slug}})`
 * picking a CurriculumModule from a different curriculum because slugs
 * like "part1" / "MOD-1" are NOT globally unique. Three callers had
 * their CallerModuleProgress corrupted across playbooks before this
 * helper landed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma module BEFORE importing the helper so the helper picks
// up the mocked client at import time.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    curriculumModule: { findFirst: vi.fn() },
    curriculum: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  resolveModuleByLogicalId,
  resolveCurriculumIdForPlaybook,
} from "@/lib/curriculum/resolve-module";

const mockedFindFirst = prisma.curriculumModule.findFirst as ReturnType<typeof vi.fn>;
const mockedCurriculumFindFirst = prisma.curriculum.findFirst as ReturnType<
  typeof vi.fn
>;

describe("resolveModuleByLogicalId", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
  });

  it("scopes slug lookup by curriculumId — refuses to leak across curricula", async () => {
    // Two curricula both have a `part1` module. The resolver MUST return only
    // the one belonging to the requested curriculum.
    mockedFindFirst.mockImplementation((args: any) => {
      // Simulate the DB: returns the row matching BOTH curriculumId AND slug
      if (
        args.where.curriculumId === "curr-NEW" &&
        args.where.slug === "part1"
      ) {
        return Promise.resolve({ id: "module-NEW-part1" });
      }
      if (
        args.where.curriculumId === "curr-OLD" &&
        args.where.slug === "part1"
      ) {
        return Promise.resolve({ id: "module-OLD-part1" });
      }
      return Promise.resolve(null);
    });

    const newResult = await resolveModuleByLogicalId("curr-NEW", "part1");
    const oldResult = await resolveModuleByLogicalId("curr-OLD", "part1");

    expect(newResult).toEqual({ id: "module-NEW-part1" });
    expect(oldResult).toEqual({ id: "module-OLD-part1" });
    // CRITICAL: the where clause MUST include curriculumId on every call
    for (const call of mockedFindFirst.mock.calls) {
      expect(call[0].where.curriculumId).toBeTruthy();
    }
  });

  it("throws when curriculumId is empty", async () => {
    await expect(resolveModuleByLogicalId("", "part1")).rejects.toThrow(
      /curriculumId is required/i,
    );
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("throws when curriculumId is undefined", async () => {
    await expect(
      // @ts-expect-error — runtime guard against undefined
      resolveModuleByLogicalId(undefined, "part1"),
    ).rejects.toThrow(/curriculumId is required/i);
  });

  it("returns null when module not in curriculum (no silent fallthrough)", async () => {
    mockedFindFirst.mockResolvedValue(null);
    const result = await resolveModuleByLogicalId("curr-X", "part1");
    expect(result).toBeNull();
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { curriculumId: "curr-X", slug: "part1" },
      select: { id: true },
    });
  });

  it("UUID path validates the module belongs to the curriculum", async () => {
    // When given a UUID, the helper validates curriculum scope. A UUID from
    // a different curriculum must return null, not blindly accept the ID.
    const VALID = "12345678-1234-1234-1234-1234567890ab";
    mockedFindFirst.mockImplementation((args: any) => {
      if (args.where.id === VALID && args.where.curriculumId === "curr-A") {
        return Promise.resolve({ id: VALID });
      }
      return Promise.resolve(null);
    });

    const hit = await resolveModuleByLogicalId("curr-A", VALID);
    const miss = await resolveModuleByLogicalId("curr-B", VALID);
    expect(hit).toEqual({ id: VALID });
    expect(miss).toBeNull();
  });

  it("returns null when slugOrId is empty", async () => {
    const result = await resolveModuleByLogicalId("curr-X", "");
    expect(result).toBeNull();
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });
});

describe("resolveCurriculumIdForPlaybook", () => {
  beforeEach(() => {
    mockedCurriculumFindFirst.mockReset();
  });

  it("returns the curriculum id when one is attached", async () => {
    mockedCurriculumFindFirst.mockResolvedValue({ id: "curr-1" });
    const result = await resolveCurriculumIdForPlaybook("pb-1");
    expect(result).toBe("curr-1");
    expect(mockedCurriculumFindFirst).toHaveBeenCalledWith({
      where: { playbookId: "pb-1" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  });

  it("returns null when the playbook has no curriculum", async () => {
    mockedCurriculumFindFirst.mockResolvedValue(null);
    const result = await resolveCurriculumIdForPlaybook("pb-empty");
    expect(result).toBeNull();
  });

  it("returns null when playbookId is falsy (no DB hit)", async () => {
    expect(await resolveCurriculumIdForPlaybook(null)).toBeNull();
    expect(await resolveCurriculumIdForPlaybook(undefined)).toBeNull();
    expect(await resolveCurriculumIdForPlaybook("")).toBeNull();
    expect(mockedCurriculumFindFirst).not.toHaveBeenCalled();
  });
});
