/**
 * MemoryCategory enum — adoption + size pin.
 *
 * **What this test pins:**
 *  1. The 6-member Prisma enum doesn't silently grow/shrink without a
 *     test author noticing — a new member means new validator coverage
 *     across consumers.
 *  2. No call site under `apps/admin/app` or `apps/admin/lib`
 *     reconstructs the enum as a hand-written string array (the
 *     `commands.ts:197` regression class — the validator's string list
 *     diverged silently from the Prisma enum for months).
 *
 *  See `.claude/rules/ai-to-db-guard.md` — when a Prisma enum exists,
 *  prefer `Object.values(<Enum>)` over a hand-typed array. Hand-typed
 *  arrays diverge when the schema gains a member.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { MemoryCategory } from "@prisma/client";

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

describe("MemoryCategory — enum adoption", () => {
  it("Prisma enum has exactly 6 members", () => {
    expect(Object.values(MemoryCategory).sort()).toEqual([
      "CONTEXT",
      "EVENT",
      "FACT",
      "PREFERENCE",
      "RELATIONSHIP",
      "TOPIC",
    ]);
  });

  it("no consumer reconstructs the full enum as a string array literal", () => {
    // Match the specific 6-element shape — any permutation is suspicious.
    // Subset arrays (e.g. `["FACT", "PREFERENCE", "TOPIC"]`) are
    // intentional filters and not the regression class this rule pins.
    const FULL_ENUM_PATTERN =
      /\[\s*"(FACT|PREFERENCE|EVENT|TOPIC|RELATIONSHIP|CONTEXT)"(\s*,\s*"(FACT|PREFERENCE|EVENT|TOPIC|RELATIONSHIP|CONTEXT)"){5}\s*\]/;
    const offenders: { file: string; line: number; text: string }[] = [];
    const roots = ["app", "lib"];
    for (const root of roots) {
      const rootDir = join(REPO_ADMIN, root);
      for (const file of walk(rootDir)) {
        const src = readFileSync(file, "utf8");
        if (!FULL_ENUM_PATTERN.test(src)) continue;
        src.split("\n").forEach((line, idx) => {
          if (FULL_ENUM_PATTERN.test(line)) {
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
      `Reconstructed MemoryCategory enum as a hand-written array — use \`Object.values(MemoryCategory)\` from @prisma/client:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
