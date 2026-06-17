/**
 * lib/roles — pin level math + adoption ratchet for the new helpers.
 *
 * **What this test pins:**
 *  1. ROLE_LEVEL members + ordering (schema additions force a test
 *     update — surprising drift becomes loud).
 *  2. `isRoleAtOrAbove` answers correctly across the 9 roles.
 *  3. `rolesAtOrAbove` excludes the deprecated VIEWER alias.
 *  4. `isOperatorTrackAdmin` preserves the EDUCATOR exclusion that
 *     distinguishes "OPERATOR-track admin dashboard" from a pure level
 *     check.
 *  5. **Ratchet:** no consumer under `apps/admin/{app,lib,contexts}`
 *     reconstructs a role membership Set / array containing the
 *     SUPERADMIN+ADMIN+OPERATOR triplet — those should use
 *     `isOperatorTrackAdmin` from `@/lib/roles`.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ROLE_LEVEL,
  isRoleAtOrAbove,
  rolesAtOrAbove,
  isOperatorTrackAdmin,
} from "@/lib/roles";

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

describe("lib/roles — RBAC level math", () => {
  it("ROLE_LEVEL has 9 known members with the documented hierarchy", () => {
    expect(ROLE_LEVEL).toEqual({
      SUPERADMIN: 5,
      ADMIN: 4,
      OPERATOR: 3,
      EDUCATOR: 3,
      SUPER_TESTER: 2,
      TESTER: 1,
      STUDENT: 1,
      DEMO: 0,
      VIEWER: 1,
    });
  });

  it("isRoleAtOrAbove — OPERATOR threshold lets EDUCATOR through", () => {
    expect(isRoleAtOrAbove("EDUCATOR", "OPERATOR")).toBe(true);
    expect(isRoleAtOrAbove("OPERATOR", "OPERATOR")).toBe(true);
    expect(isRoleAtOrAbove("ADMIN", "OPERATOR")).toBe(true);
    expect(isRoleAtOrAbove("TESTER", "OPERATOR")).toBe(false);
    expect(isRoleAtOrAbove("STUDENT", "OPERATOR")).toBe(false);
    expect(isRoleAtOrAbove(undefined, "OPERATOR")).toBe(false);
  });

  it("rolesAtOrAbove excludes the deprecated VIEWER alias", () => {
    expect(rolesAtOrAbove("ADMIN").sort()).toEqual(["ADMIN", "SUPERADMIN"]);
    expect(rolesAtOrAbove("OPERATOR").sort()).toEqual([
      "ADMIN",
      "EDUCATOR",
      "OPERATOR",
      "SUPERADMIN",
    ]);
    expect(rolesAtOrAbove("TESTER")).not.toContain("VIEWER");
  });

  it("isOperatorTrackAdmin preserves the EDUCATOR-exclusion track distinction", () => {
    expect(isOperatorTrackAdmin("SUPERADMIN")).toBe(true);
    expect(isOperatorTrackAdmin("ADMIN")).toBe(true);
    expect(isOperatorTrackAdmin("OPERATOR")).toBe(true);
    // EDUCATOR is level 3 (same as OPERATOR) but excluded — separate portal.
    expect(isOperatorTrackAdmin("EDUCATOR")).toBe(false);
    expect(isOperatorTrackAdmin("TESTER")).toBe(false);
    expect(isOperatorTrackAdmin(undefined)).toBe(false);
  });

  it("no consumer reconstructs the OPERATOR-track role triplet inline", () => {
    // Looks for the specific 3-role inline set/array pattern. Subset arrays
    // (e.g. testing matrices, role-iteration loops) are excluded.
    const PATTERN =
      /\[\s*"SUPERADMIN"\s*,\s*"ADMIN"\s*,\s*"OPERATOR"\s*\]|new Set\(\s*\[\s*"SUPERADMIN"\s*,\s*"ADMIN"\s*,\s*"OPERATOR"\s*\]\s*\)/;
    const offenders: { file: string; line: number; text: string }[] = [];
    const roots = ["app", "lib", "contexts"];
    for (const root of roots) {
      const rootDir = join(REPO_ADMIN, root);
      try {
        statSync(rootDir);
      } catch {
        continue;
      }
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
      `OPERATOR-track triplet hardcoded — use \`isOperatorTrackAdmin\` from @/lib/roles:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
