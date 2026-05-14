/**
 * Tests for Student Teacher API:
 *   GET /api/student/teacher — Teacher info and classroom details
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  cohortGroup: { findUnique: vi.fn(), findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/student-access", () => ({
  requireStudent: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: { user: { id: "stu-user-1", role: "STUDENT" } },
    callerId: "stu-caller-1",
    cohortGroupId: "cohort-1",
    cohortGroupIds: ["cohort-1"],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

describe("GET /api/student/teacher", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/teacher/route");
    GET = mod.GET;
  });

  it("returns teacher info for authenticated student", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([{
      id: "cohort-1",
      name: "Year 9 English",
      owner: { name: "Ms Smith", email: "smith@school.com" },
      domain: { name: "English" },
      institution: { name: "Riverside Academy", logoUrl: "https://example.com/logo.png" },
    }]);

    const req = new NextRequest("http://localhost/api/student/teacher");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.teacher.name).toBe("Ms Smith");
    expect(body.teacher.email).toBe("smith@school.com");
    expect(body.classroom).toBe("Year 9 English");
    expect(body.domain).toBe("English");
    expect(body.institution.name).toBe("Riverside Academy");
  });

  it("returns null institution when cohort has none", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([{
      id: "cohort-1",
      name: "Year 10 Maths",
      owner: { name: "Mr Jones", email: null },
      domain: { name: "Maths" },
      institution: null,
    }]);

    const req = new NextRequest("http://localhost/api/student/teacher");
    const res = await GET(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.institution).toBeNull();
    expect(body.teacher.name).toBe("Mr Jones");
  });

  it("returns 404 when cohort not found", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/student/teacher");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Classroom not found");
  });
});
