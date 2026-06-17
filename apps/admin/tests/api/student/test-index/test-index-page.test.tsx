/**
 * Tests for /x/test (tester index page).
 *
 * Pinned acceptance:
 *   1. Non-OPERATOR redirected to /login
 *   2. Empty state when no courses with a primary curriculum exist
 *   3. Renders one course block per Playbook with primary curriculum
 *   4. Each module shows Fresh + Return buttons pointing at
 *      /x/test/<playbookSlug>/<moduleSlug>?learnerMode=fresh|return
 *   5. playbookSlug is slugified from Playbook.name (lower-case, hyphenated)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const { mockPrisma, mockRedirect } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findMany: vi.fn() },
  },
  mockRedirect: vi.fn((target: string) => {
    const err = new Error(`NEXT_REDIRECT:${target}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
    throw err;
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
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

async function loadPage() {
  return import("@/app/x/test/page");
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("TesterIndexPage", () => {
  it("renders the empty state when no courses have a primary curriculum", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([]);
    const { default: Page } = await loadPage();
    const node = await Page();
    render(node as React.ReactElement);
    expect(screen.getByText(/no courses with a primary curriculum/i)).toBeInTheDocument();
  });

  it("renders one block per course with Fresh + Return buttons per module", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      {
        id: "pb-1",
        name: "IELTS Speaking Practice",
        playbookCurricula: [
          {
            curriculum: {
              modules: [
                { slug: "part1", title: "Part 1 — Familiar Topics" },
                { slug: "part2", title: "Part 2 — Cue Card" },
                { slug: "mock", title: "Mock Exam" },
              ],
            },
          },
        ],
      },
    ]);

    const { default: Page } = await loadPage();
    const node = await Page();
    render(node as React.ReactElement);

    expect(screen.getByText("IELTS Speaking Practice")).toBeInTheDocument();
    expect(screen.getByText("ielts-speaking-practice")).toBeInTheDocument();

    const fresh = screen.getByTestId("hf-test-fresh-ielts-speaking-practice-part2");
    expect(fresh).toHaveAttribute(
      "href",
      "/x/test/ielts-speaking-practice/part2?learnerMode=fresh",
    );
    const ret = screen.getByTestId("hf-test-return-ielts-speaking-practice-part2");
    expect(ret).toHaveAttribute(
      "href",
      "/x/test/ielts-speaking-practice/part2?learnerMode=return",
    );
  });

  it("filters out playbooks with no primary curriculum (no modules to test)", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "Course With Modules", playbookCurricula: [{ curriculum: { modules: [{ slug: "m1", title: "M1" }] } }] },
      { id: "pb-2", name: "Empty Course", playbookCurricula: [] },
    ]);
    const { default: Page } = await loadPage();
    const node = await Page();
    render(node as React.ReactElement);

    expect(screen.getByText("Course With Modules")).toBeInTheDocument();
    expect(screen.queryByText("Empty Course")).toBeNull();
  });
});
