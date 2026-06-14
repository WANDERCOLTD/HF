/**
 * Tests for #1657's deploy-readiness invariant.
 *
 * Pins the three verdict classes:
 *   - safe-pre-1657 (contract still IELTS-shaped)
 *   - safe-post-1657 (contract Generic + no unsafe playbooks)
 *   - UNSAFE-MIGRATION-MISSED (contract Generic + IELTS playbook with null mapping)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
    playbook: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  },
}));

import { checkSkillTierDeployReadiness } from "@/lib/banding/skill-tier-deploy-invariant";

const IELTS_CONTRACT = JSON.stringify({
  thresholds: { approachingEmerging: 0.3, emerging: 0.55, developing: 0.7, secure: 1.0 },
  tierBands: { approachingEmerging: 3, emerging: 4, developing: 5.5, secure: 7 },
});

const GENERIC_CONTRACT = JSON.stringify({
  thresholds: { approachingEmerging: 0.25, emerging: 0.5, developing: 0.75, secure: 1.0 },
  tierBands: { approachingEmerging: 1, emerging: 2, developing: 3, secure: 4 },
});

const IELTS_MAPPING = {
  thresholds: { approachingEmerging: 0.3, emerging: 0.55, developing: 0.7, secure: 1.0 },
  tierBands: { approachingEmerging: 3, emerging: 4, developing: 5.5, secure: 7 },
};

describe("checkSkillTierDeployReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns safe-pre-1657 when contract is still IELTS-shaped", async () => {
    mockFindUnique.mockResolvedValue({ value: IELTS_CONTRACT });

    const v = await checkSkillTierDeployReadiness();

    expect(v.status).toBe("safe-pre-1657");
    expect(v.contractShape).toBe("ielts-3-4-5.5-7");
    expect(v.unsafePlaybookCount).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns safe-pre-1657 when contract is missing entirely", async () => {
    mockFindUnique.mockResolvedValue(null);

    const v = await checkSkillTierDeployReadiness();

    expect(v.status).toBe("safe-pre-1657");
    expect(v.contractShape).toBe("missing");
  });

  it("returns safe-post-1657 when contract is Generic and no IELTS playbooks have null mapping", async () => {
    mockFindUnique.mockResolvedValue({ value: GENERIC_CONTRACT });
    mockFindMany.mockResolvedValue([
      {
        id: "pb-ielts-1",
        name: "IELTS Speaking Course",
        config: { skillTierMapping: IELTS_MAPPING },
        subjects: [{ subject: { name: "IELTS Speaking" } }],
      },
      {
        id: "pb-non-ielts",
        name: "CTO Standard",
        config: { skillTierMapping: null },
        subjects: [{ subject: { name: "CTO Standard – Revision Aid" } }],
      },
    ]);

    const v = await checkSkillTierDeployReadiness();

    expect(v.status).toBe("safe-post-1657");
    expect(v.contractShape).toBe("generic-1-2-3-4");
    expect(v.unsafePlaybookCount).toBe(0);
  });

  it("returns UNSAFE-MIGRATION-MISSED when contract is Generic but IELTS-signal playbook has null mapping", async () => {
    mockFindUnique.mockResolvedValue({ value: GENERIC_CONTRACT });
    mockFindMany.mockResolvedValue([
      {
        id: "pb-ielts-unsafe",
        name: "IELTS Speaking PAW",
        config: { skillTierMapping: null },
        subjects: [{ subject: { name: "IELTS Speaking PAW" } }],
      },
    ]);

    const v = await checkSkillTierDeployReadiness();

    expect(v.status).toBe("UNSAFE-MIGRATION-MISSED");
    expect(v.unsafePlaybookCount).toBe(1);
    expect(v.unsafePlaybookSample[0].ieltsSignal).toContain("subject:IELTS Speaking PAW");
    expect(v.summary).toContain("migrate-ielts-playbook-mapping");
  });

  it("detects IELTS signal via config.tierPresetId", async () => {
    mockFindUnique.mockResolvedValue({ value: GENERIC_CONTRACT });
    mockFindMany.mockResolvedValue([
      {
        id: "pb-tier-preset",
        name: "Custom course",
        config: { tierPresetId: "ielts-speaking" },
        subjects: [{ subject: { name: "Some other subject" } }],
      },
    ]);

    const v = await checkSkillTierDeployReadiness();

    expect(v.status).toBe("UNSAFE-MIGRATION-MISSED");
    expect(v.unsafePlaybookSample[0].ieltsSignal).toBe("config.tierPresetId=ielts-speaking");
  });

  it("caps unsafePlaybookSample at 5 entries even with more unsafe rows", async () => {
    mockFindUnique.mockResolvedValue({ value: GENERIC_CONTRACT });
    mockFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `pb-${i}`,
        name: `IELTS Course ${i}`,
        config: { skillTierMapping: null },
        subjects: [{ subject: { name: "IELTS Speaking" } }],
      })),
    );

    const v = await checkSkillTierDeployReadiness();

    expect(v.unsafePlaybookCount).toBe(12);
    expect(v.unsafePlaybookSample).toHaveLength(5);
  });
});
