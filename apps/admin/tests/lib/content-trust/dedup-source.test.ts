/**
 * Tests for dedup-source.ts — institution-scoped content deduplication
 *
 * Verifies:
 * - Same hash + same institution + same subject → returns existing source (deduplicated)
 * - Same hash + different subject → not deduplicated (epic #94)
 * - Same hash + null institution (demo) → matches other null-institution sources
 * - Existing source with 0 assertions → deduplicated: false (allow re-extract)
 * - No matching hash → returns null
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  subjectDomainFindFirst: vi.fn(),
  contentSourceFindFirst: vi.fn(),
  contentAssertionCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subjectDomain: { findFirst: mocks.subjectDomainFindFirst },
    contentSource: { findFirst: mocks.contentSourceFindFirst },
    contentAssertion: { count: mocks.contentAssertionCount },
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

  it("returns deduplicated source when same hash + same subject has assertions", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-existing",
      slug: "existing-doc",
      name: "Existing Doc",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      subjects: [{ id: "ss-1" }],
      _count: { assertions: 42 },
    });
    mocks.contentAssertionCount.mockResolvedValue(42);

    const result = await findDuplicateSource("hash-abc", "sub-1");

    expect(result.deduplicated).toBe(true);
    expect(result.existingSource?.id).toBe("src-existing");
    expect(result.assertionCount).toBe(42);
    expect(result.subjectSourceId).toBe("ss-1");

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
      subjects: [{ id: "ss-demo" }],
      _count: { assertions: 10 },
    });
    mocks.contentAssertionCount.mockResolvedValue(10);

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
    expect(result.subjectSourceId).toBeNull();
  });

  it("returns deduplicated: false when existing source has 0 scoped assertions", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-failed",
      slug: "failed-extract",
      name: "Failed Extract",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      subjects: [{ id: "ss-fail" }],
      _count: { assertions: 0 },
    });
    // Both subject-scoped and legacy counts return 0
    mocks.contentAssertionCount.mockResolvedValue(0);

    const result = await findDuplicateSource("hash-abc", "sub-1");

    expect(result.deduplicated).toBe(false);
    expect(result.existingSource?.id).toBe("src-failed");
    expect(result.assertionCount).toBe(0);
  });

  it("returns not-deduplicated when source exists but subject has no SubjectSource link", async () => {
    mocks.subjectDomainFindFirst.mockResolvedValue({
      domain: { institutionId: "inst-abc" },
    });
    mocks.contentSourceFindFirst.mockResolvedValue({
      id: "src-other",
      slug: "other-doc",
      name: "Other Doc",
      documentType: "TEXTBOOK",
      trustLevel: "UNVERIFIED",
      subjects: [],  // no SubjectSource for this subject
      _count: { assertions: 20 },
    });

    const result = await findDuplicateSource("hash-abc", "sub-new");

    expect(result.deduplicated).toBe(false);
    expect(result.subjectSourceId).toBeNull();
  });
});
