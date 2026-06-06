/**
 * #1182 Phase 2b-prep — SpecStore adapter contract tests.
 *
 * Proves the adapter implements the locked SpecStore contract before
 * @tallyseal/admin-editor@0.1.0 arrives (tarball ETA EOD Tue 2026-06-09).
 *
 * Mocks the Phase 2a spec-store.ts helpers directly via `vi.mock` so
 * the test exercises the adapter's projection / upsert / P2002 logic
 * without touching Prisma. When the tarball lands and we replace the
 * inline SpecStore interface with the imported one, these tests stay
 * green because the contract shape doesn't change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IntakeSpec } from "@prisma/client";

// The global vi.mock("@prisma/client") at tests/setup.ts strips the
// Prisma namespace, so we construct a duck-typed P2002 error here
// matching what Prisma.PrismaClientKnownRequestError exposes. The
// adapter catches via `err.code === "P2002"` (HF's canonical pattern
// per lib/chat/admin-tool-handlers.ts), so the duck shape is enough.
function makeP2002Error(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "P2002" });
}
function makeOtherPrismaError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "P2010" });
}

// Mock the underlying spec-store helpers BEFORE importing the adapter.
vi.mock("@/lib/intake/spec-store", () => ({
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  publish: vi.fn(),
  findPublished: vi.fn(),
  findById: vi.fn(),
  findByKeyVersion: vi.fn(),
  list: vi.fn(),
}));

import * as store from "@/lib/intake/spec-store";
import { createSpecStoreAdapter, ConflictError } from "@/lib/intake/spec-store-adapter";

// Shorthand cast for mocked helpers.
const mocked = store as unknown as {
  createDraft: ReturnType<typeof vi.fn>;
  updateDraft: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  findPublished: ReturnType<typeof vi.fn>;
  findByKeyVersion: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

function makeRow(overrides: Partial<IntakeSpec> = {}): IntakeSpec {
  return {
    id: "spec-row-id",
    key: "CreateRecipe",
    version: "1.0.0",
    body: {
      key: "CreateRecipe",
      version: "1.0.0",
      fields: { recipeName: { type: "string", required: true } },
      contracts: { invariants: [] },
      readiness: { kind: "all-required" },
    } as object,
    source: null, // #1194 — added in Phase 2b
    status: "DRAFT",
    parentKey: null,
    createdById: null,
    publishedById: null,
    publishedAt: null,
    createdAt: new Date("2026-06-06T10:00:00Z"),
    updatedAt: new Date("2026-06-06T11:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSpecStoreAdapter — load", () => {
  it("returns null when no row exists for the key", async () => {
    mocked.findPublished.mockResolvedValueOnce(null);
    const adapter = createSpecStoreAdapter();
    const result = await adapter.load("MissingSpec");
    expect(result).toBeNull();
    expect(mocked.findPublished).toHaveBeenCalledWith("MissingSpec");
  });

  it("uses findPublished when version is omitted", async () => {
    const row = makeRow({ status: "PUBLISHED" });
    mocked.findPublished.mockResolvedValueOnce(row);
    const adapter = createSpecStoreAdapter();
    const result = await adapter.load("CreateRecipe");
    expect(result).not.toBeNull();
    expect(mocked.findPublished).toHaveBeenCalledWith("CreateRecipe");
    expect(mocked.findByKeyVersion).not.toHaveBeenCalled();
  });

  it("uses findByKeyVersion when version is supplied", async () => {
    const row = makeRow({ version: "0.1.0", status: "DRAFT" });
    mocked.findByKeyVersion.mockResolvedValueOnce(row);
    const adapter = createSpecStoreAdapter();
    await adapter.load("CreateRecipe", "0.1.0");
    expect(mocked.findByKeyVersion).toHaveBeenCalledWith("CreateRecipe", "0.1.0");
    expect(mocked.findPublished).not.toHaveBeenCalled();
  });

  it("deserialises the row body into a CrawcusSpec-shaped object", async () => {
    const row = makeRow({ status: "PUBLISHED" });
    mocked.findPublished.mockResolvedValueOnce(row);
    const adapter = createSpecStoreAdapter();
    const result = await adapter.load("CreateRecipe");
    expect(result).toEqual(row.body);
  });
});

describe("createSpecStoreAdapter — saveDraft (upsert)", () => {
  const spec = {
    key: "NewSpec",
    version: "1.0.0",
    fields: { name: { type: "string", required: true } },
  } as unknown as Parameters<ReturnType<typeof createSpecStoreAdapter>["saveDraft"]>[0];

  it("creates a new DRAFT row when no existing row matches (key, version)", async () => {
    mocked.findByKeyVersion.mockResolvedValueOnce(null);
    mocked.createDraft.mockResolvedValueOnce(makeRow({ id: "new-id", key: "NewSpec" }));
    const adapter = createSpecStoreAdapter();
    const result = await adapter.saveDraft(spec);
    expect(result).toEqual({ id: "new-id", version: "1.0.0" });
    expect(mocked.createDraft).toHaveBeenCalledTimes(1);
    expect(mocked.updateDraft).not.toHaveBeenCalled();
  });

  it("updates an existing DRAFT row when (key, version) matches", async () => {
    mocked.findByKeyVersion.mockResolvedValueOnce(makeRow({ id: "existing-id", status: "DRAFT" }));
    mocked.updateDraft.mockResolvedValueOnce(makeRow({ id: "existing-id" }));
    const adapter = createSpecStoreAdapter();
    const result = await adapter.saveDraft(spec);
    expect(result).toEqual({ id: "existing-id", version: "1.0.0" });
    expect(mocked.updateDraft).toHaveBeenCalledTimes(1);
    expect(mocked.createDraft).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the existing row is PUBLISHED", async () => {
    mocked.findByKeyVersion.mockResolvedValueOnce(makeRow({ status: "PUBLISHED" }));
    const adapter = createSpecStoreAdapter();
    await expect(adapter.saveDraft(spec)).rejects.toBeInstanceOf(ConflictError);
    expect(mocked.createDraft).not.toHaveBeenCalled();
    expect(mocked.updateDraft).not.toHaveBeenCalled();
  });

  it("converts Prisma P2002 (concurrent-tab race) into ConflictError", async () => {
    mocked.findByKeyVersion.mockResolvedValueOnce(null);
    mocked.createDraft.mockRejectedValueOnce(
      makeP2002Error("Unique constraint failed on the fields: (`key`,`version`)"),
    );
    const adapter = createSpecStoreAdapter();
    await expect(adapter.saveDraft(spec)).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not catch non-P2002 Prisma errors", async () => {
    mocked.findByKeyVersion.mockResolvedValueOnce(null);
    mocked.createDraft.mockRejectedValueOnce(makeOtherPrismaError("Some other DB failure"));
    const adapter = createSpecStoreAdapter();
    await expect(adapter.saveDraft(spec)).rejects.not.toBeInstanceOf(ConflictError);
  });
});

describe("createSpecStoreAdapter — publish", () => {
  it("delegates to existing publish helper and synthesises a SpecDeployOutcome", async () => {
    mocked.publish.mockResolvedValueOnce(makeRow({ id: "published-id", status: "PUBLISHED" }));
    const adapter = createSpecStoreAdapter();
    const { deployOutcome } = await adapter.publish("published-id");
    expect(mocked.publish).toHaveBeenCalledWith({ id: "published-id" });
    expect(deployOutcome).toMatchObject({
      kind: "ok",
      prUrl: "",
      prNumber: 0,
      commitSha: expect.stringContaining("host-synthesised:"),
      bridgeAccessEventId: "",
    });
  });
});

describe("createSpecStoreAdapter — list", () => {
  it("projects the Phase 2a SpecSummary down to the 4-field tallyseal shape", async () => {
    mocked.list.mockResolvedValueOnce([
      {
        id: "row-id",
        key: "CreateRecipe",
        version: "1.0.0",
        status: "PUBLISHED",
        fieldCount: 4, // present on Phase 2a SpecSummary, MUST be projected away
        parentKey: null, // ditto
        updatedAt: new Date("2026-06-06T11:00:00Z"),
        publishedAt: new Date("2026-06-06T11:00:00Z"),
      },
    ]);
    const adapter = createSpecStoreAdapter();
    const result = await adapter.list();
    expect(result).toEqual([
      {
        key: "CreateRecipe",
        version: "1.0.0",
        status: "PUBLISHED",
        updatedAt: "2026-06-06T11:00:00.000Z",
      },
    ]);
    // Phase 2a-only fields must NOT leak into the tallyseal-contract SpecSummary.
    expect(result[0]).not.toHaveProperty("id");
    expect(result[0]).not.toHaveProperty("fieldCount");
  });

  it("passes the status filter through to the underlying list helper", async () => {
    mocked.list.mockResolvedValueOnce([]);
    const adapter = createSpecStoreAdapter();
    await adapter.list({ status: "DRAFT" });
    expect(mocked.list).toHaveBeenCalledWith({ status: "DRAFT" });
  });
});
