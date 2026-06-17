/**
 * TEACHING_CALLER_ROLES + isTeachingCallerRole — pin + adoption ratchet.
 *
 * **What this test pins:**
 *  1. The const matches CallerRole.TEACHER + CallerRole.TUTOR exactly.
 *  2. The predicate returns true only for those two members.
 *  3. **Ratchet:** no consumer under `apps/admin/{app,lib}` falls back
 *     to a bare `["TEACHER", "TUTOR"]` array or hand-rolled
 *     `role === "TEACHER" || role === "TUTOR"` chain.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { CallerRole } from "@prisma/client";

import {
  TEACHING_CALLER_ROLES,
  isTeachingCallerRole,
} from "@/lib/caller-roles";

const REPO_ADMIN = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("TEACHING_CALLER_ROLES — Prisma-enum subset", () => {
  it("contains exactly TEACHER and TUTOR", () => {
    expect([...TEACHING_CALLER_ROLES].sort()).toEqual(
      [CallerRole.TEACHER, CallerRole.TUTOR].sort(),
    );
  });

  it("isTeachingCallerRole matches TEACHER/TUTOR only", () => {
    expect(isTeachingCallerRole(CallerRole.TEACHER)).toBe(true);
    expect(isTeachingCallerRole(CallerRole.TUTOR)).toBe(true);
    expect(isTeachingCallerRole(CallerRole.LEARNER)).toBe(false);
    expect(isTeachingCallerRole(CallerRole.PARENT)).toBe(false);
    expect(isTeachingCallerRole(CallerRole.MENTOR)).toBe(false);
    expect(isTeachingCallerRole(undefined)).toBe(false);
  });

  it("no consumer hand-rolls the TEACHER/TUTOR subset", () => {
    const PATTERNS = [
      /\[\s*"TEACHER"\s*,\s*"TUTOR"\s*\]/,
      /"TEACHER"\s*\|\|\s*role\s*===\s*"TUTOR"|"TUTOR"\s*\|\|\s*role\s*===\s*"TEACHER"/,
      /role\s*!==\s*"TEACHER"\s*&&\s*role\s*!==\s*"TUTOR"/,
    ];
    const offenders: { file: string; line: number; text: string }[] = [];
    const roots = ["app", "lib"];
    // The source file documents the pattern it forbids — exclude it.
    const EXCLUDE = new Set(["lib/caller-roles.ts"]);
    for (const root of roots) {
      const rootDir = join(REPO_ADMIN, root);
      for (const file of walk(rootDir)) {
        const rel = file.replace(REPO_ADMIN + "/", "");
        if (EXCLUDE.has(rel)) continue;
        const src = readFileSync(file, "utf8");
        if (!PATTERNS.some((p) => p.test(src))) continue;
        src.split("\n").forEach((line, idx) => {
          if (PATTERNS.some((p) => p.test(line))) {
            offenders.push({
              file: rel,
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }
    expect(
      offenders,
      `TEACHING_CALLER_ROLES inlined — use TEACHING_CALLER_ROLES / isTeachingCallerRole from @/lib/caller-roles:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
