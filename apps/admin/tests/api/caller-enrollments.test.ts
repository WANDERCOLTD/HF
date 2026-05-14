/**
 * Tests for /api/callers/:callerId/enrollments routes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock auth
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-1", role: "ADMIN" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// Mock enrollment helpers
const mockGetAllEnrollments = vi.fn();
const mockEnrollCaller = vi.fn();
const mockUnenrollCaller = vi.fn();
const mockCompleteEnrollment = vi.fn();
const mockPauseEnrollment = vi.fn();
const mockResumeEnrollment = vi.fn();

vi.mock("@/lib/enrollment", () => ({
  getAllEnrollments: (...args: any[]) => mockGetAllEnrollments(...args),
  enrollCaller: (...args: any[]) => mockEnrollCaller(...args),
  unenrollCaller: (...args: any[]) => mockUnenrollCaller(...args),
  completeEnrollment: (...args: any[]) => mockCompleteEnrollment(...args),
  pauseEnrollment: (...args: any[]) => mockPauseEnrollment(...args),
  resumeEnrollment: (...args: any[]) => mockResumeEnrollment(...args),
}));

// Mock prisma for enrollment detail routes
const mockPrisma = vi.hoisted(() => ({
  callerPlaybook: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import { GET, POST } from "@/app/api/callers/[callerId]/enrollments/route";
import { PATCH, DELETE } from "@/app/api/callers/[callerId]/enrollments/[enrollmentId]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/callers/:callerId/enrollments", () => {
  it("returns all enrollments for a caller", async () => {
    const enrollments = [
      { id: "enr-1", playbookId: "pb-1", status: "ACTIVE", playbook: { name: "Class A" } },
    ];
    mockGetAllEnrollments.mockResolvedValue(enrollments);

    const req = new Request("http://localhost/api/callers/caller-1/enrollments");
    const res = await GET(req, { params: Promise.resolve({ callerId: "caller-1" }) });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollments).toEqual(enrollments);
    expect(mockGetAllEnrollments).toHaveBeenCalledWith("caller-1");
  });
});

describe("POST /api/callers/:callerId/enrollments", () => {
  it("enrolls a caller in a playbook", async () => {
    const enrollment = { id: "enr-1", callerId: "caller-1", playbookId: "pb-1", status: "ACTIVE" };
    mockEnrollCaller.mockResolvedValue(enrollment);

    const req = new Request("http://localhost/api/callers/caller-1/enrollments", {
      method: "POST",
      body: JSON.stringify({ playbookId: "pb-1" }),
    });
    const res = await POST(req, { params: Promise.resolve({ callerId: "caller-1" }) });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.enrollment).toEqual(enrollment);
    expect(mockEnrollCaller).toHaveBeenCalledWith("caller-1", "pb-1", "manual");
  });

  it("returns 400 when playbookId is missing", async () => {
    const req = new Request("http://localhost/api/callers/caller-1/enrollments", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ callerId: "caller-1" }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
  });
});

describe("PATCH /api/callers/:callerId/enrollments/:enrollmentId", () => {
  it("pauses an enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });
    mockPauseEnrollment.mockResolvedValue({ id: "enr-1", status: "PAUSED" });

    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "PAUSED" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ callerId: "caller-1", enrollmentId: "enr-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(mockPauseEnrollment).toHaveBeenCalledWith("caller-1", "pb-1");
  });

  it("returns 404 for non-existent enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue(null);

    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "PAUSED" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ callerId: "caller-1", enrollmentId: "nope" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });

    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ status: "INVALID" }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ callerId: "caller-1", enrollmentId: "enr-1" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/callers/:callerId/enrollments/:enrollmentId", () => {
  it("deletes an enrollment", async () => {
    mockPrisma.callerPlaybook.findUnique.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });
    mockPrisma.callerPlaybook.delete.mockResolvedValue({});

    const req = new Request("http://localhost", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ callerId: "caller-1", enrollmentId: "enr-1" }),
    });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(mockPrisma.callerPlaybook.delete).toHaveBeenCalledWith({
      where: { id: "enr-1" },
    });
  });
});
