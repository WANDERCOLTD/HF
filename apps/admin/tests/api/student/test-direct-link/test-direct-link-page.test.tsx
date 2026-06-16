/**
 * Tests for /x/test/[playbookSlug]/[moduleSlug] — tester direct-link
 * route (#1750 follow-on, epic #1700 Theme 12).
 *
 * Server-component page. We mock `redirect` from next/navigation, the
 * permissions helper, prisma, and `cloneDemoCaller`. The tests assert
 * the resolution order and the redirect target.
 *
 * Pinned acceptance:
 *   1. Unknown playbookSlug → renders "Course not found" panel
 *   2. Playbook found but no primary curriculum → "No primary curriculum"
 *   3. Module slug not on curriculum → "Module not found"
 *   4. No demo CallerPlaybook on the playbook → "No demo caller available"
 *   5. Happy path → invokes `cloneDemoCaller` with the resolved
 *      `sourceCallerId` / `playbookId` / tester email; redirects to
 *      `/x/callers/<callerId>/sim?module=<moduleId>`
 *   6. `learnerMode=return` is propagated to the helper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const { mockPrisma, mockRedirect, mockCloneDemoCaller } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn(), findMany: vi.fn() },
    curriculum: { findFirst: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
    callerPlaybook: { findFirst: vi.fn() },
  },
  mockRedirect: vi.fn((target: string) => {
    // Mirror Next.js: throw a marker so execution halts the way it does
    // in production.
    const err = new Error(`NEXT_REDIRECT:${target}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
    throw err;
  }),
  mockCloneDemoCaller: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR", email: "tester@hf-admin.local" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/test-harness/clone-demo-caller", () => ({
  cloneDemoCaller: mockCloneDemoCaller,
}));

async function loadPage() {
  return import("@/app/x/test/[playbookSlug]/[moduleSlug]/page");
}

function makeProps(playbookSlug: string, moduleSlug: string, learnerMode?: string) {
  return {
    params: Promise.resolve({ playbookSlug, moduleSlug }),
    searchParams: Promise.resolve(learnerMode ? { learnerMode } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TesterDirectLinkPage", () => {
  it("renders 'Course not found' when slug does not resolve", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "Some Other Course" },
    ]);
    const { default: Page } = await loadPage();
    const node = await Page(makeProps("ielts-speaking-practice", "mock") as never);
    render(node as React.ReactElement);
    expect(screen.getByText("Course not found")).toBeInTheDocument();
  });

  it("renders 'No primary curriculum' when playbook resolves but no curriculum linked", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "IELTS Speaking Practice" },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);
    const { default: Page } = await loadPage();
    const node = await Page(makeProps("ielts-speaking-practice", "mock") as never);
    render(node as React.ReactElement);
    expect(screen.getByText("No primary curriculum")).toBeInTheDocument();
  });

  it("renders 'Module not found' when slug does not match any sub-module", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "IELTS Speaking Practice" },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "cur-1" });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue(null);
    const { default: Page } = await loadPage();
    const node = await Page(makeProps("ielts-speaking-practice", "ghost-module") as never);
    render(node as React.ReactElement);
    expect(screen.getByText("Module not found")).toBeInTheDocument();
  });

  it("renders 'No demo caller available' when no demo CallerPlaybook on the playbook", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "IELTS Speaking Practice" },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "cur-1" });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({ id: "mod-1", slug: "mock" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const { default: Page } = await loadPage();
    const node = await Page(makeProps("ielts-speaking-practice", "mock") as never);
    render(node as React.ReactElement);
    expect(screen.getByText("No demo caller available")).toBeInTheDocument();
  });

  it("redirects to /x/callers/<callerId>/sim?module=<moduleId> on happy path", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "IELTS Speaking Practice" },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "cur-1" });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({ id: "mod-1", slug: "mock" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: "src-caller-1" });
    mockCloneDemoCaller.mockResolvedValue({
      callerId: "new-caller-1",
      callerName: "Test Bertie",
      isNew: true,
      sourceCallerId: "src-caller-1",
    });

    const { default: Page } = await loadPage();
    await expect(Page(makeProps("ielts-speaking-practice", "mock") as never)).rejects.toThrow(
      /NEXT_REDIRECT:\/x\/callers\/new-caller-1\/sim\?module=mod-1/,
    );

    expect(mockCloneDemoCaller).toHaveBeenCalledWith(mockPrisma, {
      sourceCallerId: "src-caller-1",
      playbookId: "pb-1",
      testerEmail: "tester@hf-admin.local",
      mode: "fresh",
    });
  });

  it("propagates learnerMode=return to cloneDemoCaller", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "IELTS Speaking Practice" },
    ]);
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "cur-1" });
    mockPrisma.curriculumModule.findFirst.mockResolvedValue({ id: "mod-1", slug: "mock" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ callerId: "src-caller-1" });
    mockCloneDemoCaller.mockResolvedValue({
      callerId: "returning-caller-1",
      callerName: "Test Bertie",
      isNew: false,
      sourceCallerId: "src-caller-1",
    });

    const { default: Page } = await loadPage();
    await expect(
      Page(makeProps("ielts-speaking-practice", "mock", "return") as never),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const args = mockCloneDemoCaller.mock.calls[0][1];
    expect(args.mode).toBe("return");
  });
});
