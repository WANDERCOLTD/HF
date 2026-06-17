/**
 * PlaybookCurriculumRole enum — adoption + drift ratchet.
 *
 * **What this test pins:**
 *  1. The Prisma enum has exactly the 2 documented members
 *     (`primary` / `linked`) — schema additions force a test update.
 *  2. No code under `apps/admin/{app,lib,scripts}` falls back to the
 *     bare string literal `role: "primary"` or `role: "linked"` for
 *     `PlaybookCurriculum` writes/reads — every site MUST go through
 *     `PlaybookCurriculumRole.<member>` from `@prisma/client`.
 *
 *  See `.claude/rules/ai-to-db-guard.md` — when a Prisma enum exists,
 *  prefer the generated const value over a hand-typed literal. Bare
 *  literals diverge on rename and produce no compile error.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { PlaybookCurriculumRole } from "@prisma/client";

const REPO_ADMIN = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("PlaybookCurriculumRole — enum adoption", () => {
  it("Prisma enum has exactly 2 members", () => {
    expect(Object.values(PlaybookCurriculumRole).sort()).toEqual([
      "linked",
      "primary",
    ]);
  });

  it("no consumer uses bare `role: \"primary\"` or `role: \"linked\"` literal", () => {
    const PATTERN = /role:\s*"(primary|linked)"/;
    const offenders: { file: string; line: number; text: string }[] = [];
    const roots = ["app", "lib", "scripts"];
    for (const root of roots) {
      const rootDir = join(REPO_ADMIN, root);
      for (const file of walk(rootDir)) {
        const src = readFileSync(file, "utf8");
        if (!PATTERN.test(src)) continue;
        src.split("\n").forEach((line, idx) => {
          if (PATTERN.test(line)) {
            offenders.push({
              file: file.replace(REPO_ADMIN + "/", ""),
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }
    expect(
      offenders,
      `Bare \`role: "primary"\` / \`role: "linked"\` literal — replace with \`PlaybookCurriculumRole.<member>\` from @prisma/client:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
