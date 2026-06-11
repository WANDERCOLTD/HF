/**
 * Pins `lib/curriculum/resolve-module.ts` — the #407/#611 slug-scoping guard
 * (documented in .claude/rules/ai-to-db-guard.md but previously unpinned by a
 * dedicated test; audit HF-L).
 *
 * The load-bearing invariant: a slug/ref lookup on CurriculumModule MUST be scoped
 * by curriculumId. Slugs are per-parent unique, not global — an unscoped lookup can
 * resolve to a cross-playbook module and corrupt the FK (#407 Opal/Freya/Tessa).
 * These tests assert (a) the functions throw on an empty curriculumId, and (b) every
 * Prisma where-clause carries curriculumId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    curriculumModule: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import {
  resolveModuleByLogicalId,
  resolveModuleSlug,
} from "@/lib/curriculum/resolve-module";

const CURRICULUM = "11111111-1111-1111-1111-111111111111";

describe("resolveModuleByLogicalId — #407 scoping guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({ id: "mod-1" });
  });

  it("throws when curriculumId is empty (no unscoped lookups)", async () => {
    await expect(resolveModuleByLogicalId("", "part1")).rejects.toThrow(/curriculumId is required/);
  });

  it("returns null for an empty slug without touching the DB", async () => {
    expect(await resolveModuleByLogicalId(CURRICULUM, "")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("scopes the slug lookup by curriculumId", async () => {
    await resolveModuleByLogicalId(CURRICULUM, "part1");
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ curriculumId: CURRICULUM, slug: "part1" });
  });

  it("scopes the UUID lookup by curriculumId too", async () => {
    const moduleUuid = "22222222-2222-2222-2222-222222222222";
    await resolveModuleByLogicalId(CURRICULUM, moduleUuid);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: moduleUuid, curriculumId: CURRICULUM });
  });
});

describe("resolveModuleSlug — #611 canonical-slug guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when curriculumId is empty", async () => {
    await expect(resolveModuleSlug("", "part1")).rejects.toThrow(/curriculumId is required/);
  });

  it("returns the verified slug, scoped by curriculumId", async () => {
    findFirst.mockResolvedValue({ slug: "part1" });
    const slug = await resolveModuleSlug(CURRICULUM, "part1");
    expect(slug).toBe("part1");
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ curriculumId: CURRICULUM, slug: "part1" });
  });

  it("falls back to a title match (scoped) only when exactly one module matches", async () => {
    findFirst.mockResolvedValue(null); // slug miss
    findMany.mockResolvedValue([{ slug: "part1" }]);
    const slug = await resolveModuleSlug(CURRICULUM, "Part 1: Familiar Topics");
    expect(slug).toBe("part1");
    expect(findMany.mock.calls[0][0].where).toMatchObject({ curriculumId: CURRICULUM });
  });

  it("refuses (null) when a title matches multiple modules — never guesses", async () => {
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([{ slug: "part1" }, { slug: "part1b" }]);
    expect(await resolveModuleSlug(CURRICULUM, "Ambiguous Title")).toBeNull();
  });
});
