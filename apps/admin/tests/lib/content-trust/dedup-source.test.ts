/**
 * Tests for dedup-source.ts — institution-scoped content deduplication
 *
 * Verifies:
 * - Same hash + same institution → returns existing source (deduplicated)
 * - Same hash + different institution → returns null (no match)
 * - Same hash + null institution (demo) → matches other null-institution sources
 * - Existing source with 0 assertions → deduplicated: false (allow re-extract)
 * - No matching hash → returns null
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  subjectDomainFindFirst: vi.fn(),
  contentSourceFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subjectDomain: { findFirst: mocks.subjectDomainFindFirst },
    contentSource: { findFirst: mocks.contentSourceFindFirst },
  },
}));

import { findDuplicateSource, resolveInstitutionId } from "@/lib/content-trust/dedup-source";

describe("resolveInstitutionId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns institutionId from subject's domain", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    expect(await resolveInstitutionId("sub-1")).toBe("inst-abc");
  });

  it("returns null when domain has no institution (demo)", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: null },
    });
    expect(await resolveInstitutionId("sub-1")).toBeNull();
  });

  it("returns null when subject has no domain link", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue(null);
    expect(await resolveInstitutionId("sub-1")).toBeNull();
  });
});

describe("findDuplicateSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns deduplicated source when same hash exists in same institution", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-existing",
      slug: "existing-doc",
      name: "Existing Doc",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      _count: { assertions: 42 },
    });

    const result = await findDuplicateSource("hash-abc", "sub-1");

    expect(result.deduplicated).toBe(true);
    expect(result.existingSource?.id).toBe("src-existing");
    expect(result.assertionCount).toBe(42);

    // Verify the query included institution scoping
    const where = mocks.contentSourceFindFirst.mock.calls[0][0].where;
    expect(where.contentHash).toBe("hash-abc");
    expect(where.subjects.some.subject.domains.some.domain).toEqual({
      institutionId: "inst-abc",
    });
  });

  it("matches null institution for demo domains", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: null },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-demo",
      slug: "demo-doc",
      name: "Demo Doc",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      _count: { assertions: 10 },
    });

    const result = await findDuplicateSource("hash-xyz", "sub-demo");

    expect(result.deduplicated).toBe(true);
    expect(result.existingSource?.id).toBe("src-demo");

    // Verify null institution scoping (explicit null, not undefined)
    const where = mocks.contentSourceFindFirst.mock.calls[0][0].where;
    expect(where.subjects.some.subject.domains.some.domain).toEqual({
      institutionId: null,
    });
  });

  it("returns null when no matching hash exists", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue(null);

    const result = await findDuplicateSource("hash-new", "sub-1");

    expect(result.deduplicated).toBe(false);
    expect(result.existingSource).toBeNull();
    expect(result.assertionCount).toBe(0);
  });

  it("returns deduplicated: false when existing source has 0 assertions", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-failed",
      slug: "failed-extract",
      name: "Failed Extract",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      _count: { assertions: 0 },
    });

    const result = await findDuplicateSource("hash-abc", "sub-1");

    expect(result.deduplicated).toBe(false);
    expect(result.existingSource?.id).toBe("src-failed");
    expect(result.assertionCount).toBe(0);
  });
});
