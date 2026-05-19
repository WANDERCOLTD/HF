/**
 * Tests for lib/seed/find-or-create-seed-playbook.ts.
 *
 * Locks in the three-step resolution order:
 *   1. Cross-domain tag-based lookup wins.
 *   2. Legacy (domainId, name) fallback for pre-tag rows.
 *   3. Create with the tag baked into config.
 *
 * Also asserts that step-2 hits attach the tag for next time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import { findOrCreateSeedPlaybook } from "@/lib/seed/find-or-create-seed-playbook";

const baseCreateData = {
  name: "IELTS Speaking Practice",
  description: "x",
  domainId: "domain-1",
  status: "PUBLISHED" as const,
  version: "1.0",
  publishedAt: new Date(),
  validationPassed: true,
  measureSpecCount: 0,
  learnSpecCount: 0,
  adaptSpecCount: 0,
  parameterCount: 0,
  config: { teachingMode: "directive" },
};

describe("findOrCreateSeedPlaybook — tag-first resolution", () => {
  beforeEach(() => {
    mockPrisma.playbook.findFirst.mockReset();
    mockPrisma.playbook.update.mockReset();
    mockPrisma.playbook.create.mockReset();
  });

  it("returns the playbook found via seedSourceTag — no fallback, no create, even if domain differs", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValueOnce({
      id: "pb-tagged",
      name: "IELTS Speaking Practice",
    });

    const result = await findOrCreateSeedPlaybook(mockPrisma as any, {
      seedSourceTag: "ielts-seed-v1",
      domainId: "domain-different",
      name: "IELTS Speaking Practice",
      createData: baseCreateData,
    });

    expect(result).toEqual({ id: "pb-tagged", name: "IELTS Speaking Practice" });
    expect(mockPrisma.playbook.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
    expect(mockPrisma.playbook.create).not.toHaveBeenCalled();

    // The first lookup uses the JSON path filter
    const firstCallArgs = mockPrisma.playbook.findFirst.mock.calls[0][0];
    expect(firstCallArgs.where.config).toEqual({
      path: ["seedSourceTag"],
      equals: "ielts-seed-v1",
    });
  });
});

describe("findOrCreateSeedPlaybook — legacy fallback", () => {
  beforeEach(() => {
    mockPrisma.playbook.findFirst.mockReset();
    mockPrisma.playbook.update.mockReset();
    mockPrisma.playbook.create.mockReset();
  });

  it("falls back to (domainId, name) when no tagged row exists, and attaches the tag for next time", async () => {
    // First lookup (by tag) — miss
    mockPrisma.playbook.findFirst.mockResolvedValueOnce(null);
    // Second lookup (by domainId+name) — hit, legacy row without tag
    mockPrisma.playbook.findFirst.mockResolvedValueOnce({
      id: "pb-legacy",
      name: "IELTS Speaking Practice",
      config: { teachingMode: "directive" },
    });
    mockPrisma.playbook.update.mockResolvedValue({});

    const result = await findOrCreateSeedPlaybook(mockPrisma as any, {
      seedSourceTag: "ielts-seed-v1",
      domainId: "domain-1",
      name: "IELTS Speaking Practice",
      createData: baseCreateData,
    });

    expect(result).toEqual({ id: "pb-legacy", name: "IELTS Speaking Practice" });
    expect(mockPrisma.playbook.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.playbook.update).toHaveBeenCalledTimes(1);

    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "pb-legacy" });
    // The merged config preserves the original keys AND adds the tag
    expect(updateArgs.data.config).toEqual({
      teachingMode: "directive",
      seedSourceTag: "ielts-seed-v1",
    });

    expect(mockPrisma.playbook.create).not.toHaveBeenCalled();
  });

  it("falls back to legacy lookup even when the legacy row had no config at all", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValueOnce(null);
    mockPrisma.playbook.findFirst.mockResolvedValueOnce({
      id: "pb-no-config",
      name: "IELTS Speaking Practice",
      config: null,
    });
    mockPrisma.playbook.update.mockResolvedValue({});

    await findOrCreateSeedPlaybook(mockPrisma as any, {
      seedSourceTag: "ielts-seed-v1",
      domainId: "domain-1",
      name: "IELTS Speaking Practice",
      createData: baseCreateData,
    });

    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.data.config).toEqual({ seedSourceTag: "ielts-seed-v1" });
  });
});

describe("findOrCreateSeedPlaybook — create path", () => {
  beforeEach(() => {
    mockPrisma.playbook.findFirst.mockReset();
    mockPrisma.playbook.update.mockReset();
    mockPrisma.playbook.create.mockReset();
  });

  it("creates a new playbook with the tag merged into config", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue(null); // both lookups miss
    mockPrisma.playbook.create.mockResolvedValueOnce({
      id: "pb-new",
      name: "IELTS Speaking Practice",
    });

    const result = await findOrCreateSeedPlaybook(mockPrisma as any, {
      seedSourceTag: "ielts-seed-v1",
      domainId: "domain-1",
      name: "IELTS Speaking Practice",
      createData: baseCreateData,
    });

    expect(result).toEqual({ id: "pb-new", name: "IELTS Speaking Practice" });
    expect(mockPrisma.playbook.create).toHaveBeenCalledTimes(1);

    const createArgs = mockPrisma.playbook.create.mock.calls[0][0];
    // The tag must land in config alongside the caller-supplied keys
    expect(createArgs.data.config).toEqual({
      teachingMode: "directive",
      seedSourceTag: "ielts-seed-v1",
    });
    // Other create fields come straight through
    expect(createArgs.data.name).toBe("IELTS Speaking Practice");
    expect(createArgs.data.status).toBe("PUBLISHED");
  });

  it("creates with just the tag when caller supplied no config", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValue(null);
    mockPrisma.playbook.create.mockResolvedValueOnce({
      id: "pb-new",
      name: "Test Playbook",
    });

    await findOrCreateSeedPlaybook(mockPrisma as any, {
      seedSourceTag: "test-tag",
      domainId: "domain-1",
      name: "Test Playbook",
      createData: {
        ...baseCreateData,
        config: undefined,
      } as any,
    });

    const createArgs = mockPrisma.playbook.create.mock.calls[0][0];
    expect(createArgs.data.config).toEqual({ seedSourceTag: "test-tag" });
  });
});
