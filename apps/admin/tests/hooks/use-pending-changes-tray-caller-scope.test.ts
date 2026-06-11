/**
 * Regression test for TrayEntryScope "caller" enum addition (Slice 2 of
 * #1454). Ensures the reducer wiring at line ~240 of
 * `hooks/use-pending-changes-tray.tsx` accepts "caller" without falling
 * through to the "playbook" default.
 *
 * Verified via the union-type source-import. The full reducer behaviour
 * is exercised by integration tests in `tests/lib/admin-tools-*.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe('TrayEntryScope includes "caller"', () => {
  it('use-pending-changes-tray.tsx exports a "caller" union member', () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "hooks",
      "use-pending-changes-tray.tsx",
    );
    const src = readFileSync(filePath, "utf-8");
    expect(src).toMatch(
      /export type TrayEntryScope\s*=\s*"playbook"\s*\|\s*"domain"\s*\|\s*"system"\s*\|\s*"caller"/,
    );
  });

  it("reducer dispatch admits 'caller' without falling through to 'playbook' default", () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "hooks",
      "use-pending-changes-tray.tsx",
    );
    const src = readFileSync(filePath, "utf-8");
    // The reducer at line ~240 picks scope from the incoming event payload.
    // After Slice 2, the explicit allow-list must include "caller" alongside
    // "domain" and "system" to avoid defaulting to "playbook".
    expect(src).toMatch(
      /p\.scope === "domain" \|\| p\.scope === "system" \|\| p\.scope === "caller"/,
    );
  });

  it("recompose/apply route zod schema includes caller", () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "app",
      "api",
      "recompose",
      "apply",
      "route.ts",
    );
    const src = readFileSync(filePath, "utf-8");
    expect(src).toMatch(
      /z\.enum\(\["playbook", "domain", "system", "caller"\]\)/,
    );
  });
});
