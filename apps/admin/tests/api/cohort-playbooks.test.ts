/**
 * Tests for /api/cohorts/:cohortId/playbooks routes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock auth
vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    scope: "ALL",
    session: { user: { id: "user-1", role: "ADMIN" } },
  }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/cohort-access", () => ({
  requireCohortOwnership: vi.fn().mockResolvedValue({
    cohort: {
      id: "cohort-1",
      domainId: "domain-1",
      domain: { id: "domain-1", slug: "test-domain", name: "Test Domain" },
      owner: { id: "owner-1", name: "Owner" },
      _count: { members: 5 },
    },
  }),
  isCohortOwnershipError: vi.fn().mockReturnValue(false),
}));

// Mock enrollment helpers
const mockAssignPlaybookToCohort = vi.fn();
const mockRemovePlaybookFromCohort = vi.fn();
const mockGetCohortPlaybookIds = vi.fn();
const mockEnrollCohortMembersInPlaybook = vi.fn();

vi.mock("@/lib/enrollment", () => ({
  assignPlaybookToCohort: (...args: any[]) =>
    mockAssignPlaybookToCohort(...args),
  removePlaybookFromCohort: (...args: any[]) =>
    mockRemovePlaybookFromCohort(...args),
  getCohortPlaybookIds: (...args: any[]) => mockGetCohortPlaybookIds(...args),
  enrollCohortMembersInPlaybook: (...args: any[]) =>
    mockEnrollCohortMembersInPlaybook(...args),
}));

// Mock prisma
const mockPrisma = vi.hoisted(() => ({
  cohortPlaybook: {
    findMany: vi.fn(),
  },
  playbook: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import { GET, POST } from "@/app/api/cohorts/[cohortId]/playbooks/route";
import { DELETE } from "@/app/api/cohorts/[cohortId]/playbooks/[playbookId]/route";
import { POST as SYNC } from "@/app/api/cohorts/[cohortId]/playbooks/sync/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cohorts/:cohortId/playbooks", () => {
  it("returns assigned and available playbooks", async () => {
    mockPrisma.cohortPlaybook.findMany.mockResolvedValue([
      {
        playbookId: "pb-1",
        createdAt: new Date(),
        assignedBy: "manual",
        playbook: {
          id: "pb-1",
          name: "Course A",
          status: "PUBLISHED",
          version: 1,
          _count: { enrollments: 3 },
        },
      },
    ]);
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-2", name: "Course B", status: "PUBLISHED", version: 1 },
    ]);

    const req = new Request("http://localhost/api/cohorts/cohort-1/playbooks");
    const res = await GET(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.playbooks).toHaveLength(1);
    expect(data.playbooks[0].name).toBe("Course A");
    expect(data.playbooks[0].enrolledCount).toBe(3);
    expect(data.available).toHaveLength(1);
    expect(data.available[0].name).toBe("Course B");
  });

  it("returns empty arrays when no playbooks", async () => {
    mockPrisma.cohortPlaybook.findMany.mockResolvedValue([]);
    mockPrisma.playbook.findMany.mockResolvedValue([]);

    const req = new Request("http://localhost/api/cohorts/cohort-1/playbooks");
    const res = await GET(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.playbooks).toHaveLength(0);
    expect(data.available).toHaveLength(0);
  });
});

describe("POST /api/cohorts/:cohortId/playbooks", () => {
  it("assigns playbooks to cohort", async () => {
    mockAssignPlaybookToCohort.mockResolvedValue({
      assignment: { id: "cp-1" },
      enrolled: 0,
    });

    const req = new Request("http://localhost/api/cohorts/cohort-1/playbooks", {
      method: "POST",
      body: JSON.stringify({ playbookIds: ["pb-1", "pb-2"] }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.assigned).toBe(2);
    expect(data.enrolled).toBe(0);
    expect(mockAssignPlaybookToCohort).toHaveBeenCalledTimes(2);
  });

  it("auto-enrolls members when requested", async () => {
    mockAssignPlaybookToCohort.mockResolvedValue({
      assignment: { id: "cp-1" },
      enrolled: 5,
    });

    const req = new Request("http://localhost/api/cohorts/cohort-1/playbooks", {
      method: "POST",
      body: JSON.stringify({
        playbookIds: ["pb-1"],
        autoEnrollMembers: true,
      }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrolled).toBe(5);
    expect(mockAssignPlaybookToCohort).toHaveBeenCalledWith(
      "cohort-1",
      "pb-1",
      "user-1",
      true
    );
  });

  it("returns 400 when playbookIds is missing", async () => {
    const req = new Request("http://localhost/api/cohorts/cohort-1/playbooks", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/cohorts/:cohortId/playbooks/:playbookId", () => {
  it("removes playbook from cohort", async () => {
    mockRemovePlaybookFromCohort.mockResolvedValue({
      removed: true,
      dropped: 0,
    });

    const req = new Request(
      "http://localhost/api/cohorts/cohort-1/playbooks/pb-1",
      { method: "DELETE" }
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ cohortId: "cohort-1", playbookId: "pb-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.removed).toBe(true);
    expect(data.dropped).toBe(0);
  });

  it("drops enrollments when requested", async () => {
    mockRemovePlaybookFromCohort.mockResolvedValue({
      removed: true,
      dropped: 3,
    });

    const req = new Request(
      "http://localhost/api/cohorts/cohort-1/playbooks/pb-1?dropEnrollments=true",
      { method: "DELETE" }
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ cohortId: "cohort-1", playbookId: "pb-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.dropped).toBe(3);
    expect(mockRemovePlaybookFromCohort).toHaveBeenCalledWith(
      "cohort-1",
      "pb-1",
      true
    );
  });
});

describe("POST /api/cohorts/:cohortId/playbooks/sync", () => {
  it("syncs all members to cohort playbooks", async () => {
    mockGetCohortPlaybookIds.mockResolvedValue(["pb-1", "pb-2"]);
    mockEnrollCohortMembersInPlaybook
      .mockResolvedValueOnce({ enrolled: 3, errors: [] })
      .mockResolvedValueOnce({ enrolled: 2, errors: [] });

    const req = new Request(
      "http://localhost/api/cohorts/cohort-1/playbooks/sync",
      { method: "POST" }
    );
    const res = await SYNC(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.synced).toBe(5);
    expect(data.errors).toHaveLength(0);
  });

  it("returns zero when no playbooks assigned", async () => {
    mockGetCohortPlaybookIds.mockResolvedValue([]);

    const req = new Request(
      "http://localhost/api/cohorts/cohort-1/playbooks/sync",
      { method: "POST" }
    );
    const res = await SYNC(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.synced).toBe(0);
  });

  it("collects errors from individual enrollments", async () => {
    mockGetCohortPlaybookIds.mockResolvedValue(["pb-1"]);
    mockEnrollCohortMembersInPlaybook.mockResolvedValue({
      enrolled: 2,
      errors: ["c-3: Constraint violation"],
    });

    const req = new Request(
      "http://localhost/api/cohorts/cohort-1/playbooks/sync",
      { method: "POST" }
    );
    const res = await SYNC(req, {
      params: Promise.resolve({ cohortId: "cohort-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.synced).toBe(2);
    expect(data.errors).toHaveLength(1);
  });
});
