/**
 * LearnerShell typed-primitive sanity (#2163 Slice 1).
 *
 * **What this test pins:**
 *  The three pieces of the LearnerShell primitive declared in
 *  `apps/admin/lib/types/json-fields.ts` stay in lockstep:
 *    1. The `LearnerShellKind` union type literal members.
 *    2. The runtime const array `LEARNER_SHELL_KIND_VALUES`.
 *    3. The default-capability map `SHELL_DEFAULTS` keyed by every
 *       shell kind, with every `LearnerShellCapabilities` field
 *       populated (no `undefined` / missing).
 *
 *  Catches the failure mode where one of (1)/(2)/(3) is updated and
 *  the others drift — e.g. a new shell kind added to the union but
 *  the const array forgets it, or the defaults map adds a shell row
 *  without populating every capability field.
 *
 * **How matching works:**
 *  - The source-vs-const sanity test reads `lib/types/json-fields.ts`,
 *    regex-extracts the `LearnerShellKind` union members, and asserts
 *    they match `LEARNER_SHELL_KIND_VALUES` set-equality. Same shape
 *    as `mode-ui-coverage.test.ts`'s
 *    "test matrix matches the source-of-truth type union" vitest.
 *  - The Cartesian-completeness test asserts every kind has an entry
 *    in `SHELL_DEFAULTS` AND every entry has every capability field
 *    defined (non-undefined).
 *
 * **How to fix a failure:**
 *  - "Source union diverged from const array": the union and the
 *    const list disagree. Update whichever you forgot.
 *  - "Shell kind X missing from SHELL_DEFAULTS": you added a kind to
 *    the union but forgot the defaults row.
 *  - "Shell kind X missing capability field Y": you added a field to
 *    `LearnerShellCapabilities` but didn't populate it for every
 *    shell. Decide the default for X.Y and add it.
 *
 *  Subsequent slices (S2 selection function + Coverage gate, S3
 *  ExamModeShell refactor) build on these invariants — they assume
 *  every shell kind has a complete capability map at compile time.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEARNER_SHELL_KIND_VALUES,
  SHELL_DEFAULTS,
  type LearnerShellKind,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";

const TYPE_SOURCE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "types",
  "json-fields.ts",
);

/**
 * Capability field set — the source-of-truth list of keys the test
 * walks. If you add a field to `LearnerShellCapabilities`, add it
 * here too; the Cartesian-completeness test then enforces every
 * shell populates it.
 */
const CAPABILITY_FIELDS: readonly (keyof LearnerShellCapabilities)[] = [
  "allowModuleSwitch",
  "showTimer",
  "showProgressBar",
  "chatFeedVisibility",
  "allowBackToHome",
  "colourTheme",
  "modePillKey",
  "dismissOnEnd",
  "stallChipBehaviour",
] as const;

describe("LearnerShell typed-primitive sanity (#2163 S1)", () => {
  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(TYPE_SOURCE_PATH, "utf8");
    const m = src.match(/export\s+type\s+LearnerShellKind\s*=\s*([^;]+);/m);
    expect(
      m,
      "LearnerShellKind export not found in json-fields.ts",
    ).toBeTruthy();
    const sourceValues = (m![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sorted = [...sourceValues].sort();
    const local = [...LEARNER_SHELL_KIND_VALUES].sort();
    expect(
      sorted,
      `Source type union diverged from LEARNER_SHELL_KIND_VALUES. Source: ${sorted.join(", ")}; const: ${local.join(", ")}. Update one to match the other.`,
    ).toEqual(local);
  });

  it("every LearnerShellKind has a SHELL_DEFAULTS entry", () => {
    const missing: LearnerShellKind[] = [];
    for (const kind of LEARNER_SHELL_KIND_VALUES) {
      if (!(kind in SHELL_DEFAULTS)) {
        missing.push(kind);
      }
    }
    expect(
      missing,
      `Shell kinds missing from SHELL_DEFAULTS:\n  ${missing.join("\n  ")}\nFix: add a default capability row for each.`,
    ).toEqual([]);
  });

  it("every SHELL_DEFAULTS entry has every capability field defined", () => {
    const gaps: string[] = [];
    for (const kind of LEARNER_SHELL_KIND_VALUES) {
      const row = SHELL_DEFAULTS[kind];
      for (const field of CAPABILITY_FIELDS) {
        // `modePillKey` is nullable by design — null is a valid value
        // (results-readout + intake-wizard render no pill). The check
        // is whether the field is *present*, not whether it's truthy.
        if (!(field in row)) {
          gaps.push(`${kind}.${field}`);
        }
      }
    }
    expect(
      gaps,
      `SHELL_DEFAULTS entries missing capability fields:\n  ${gaps.join("\n  ")}\nFix: populate every field for every shell kind.`,
    ).toEqual([]);
  });

  it("no SHELL_DEFAULTS entry references an unknown shell kind", () => {
    const known = new Set<string>(LEARNER_SHELL_KIND_VALUES);
    const stale = Object.keys(SHELL_DEFAULTS).filter((k) => !known.has(k));
    expect(
      stale,
      `Stale SHELL_DEFAULTS entries (no matching shell kind in the union): ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("Cartesian count sanity — shells × fields", () => {
    let populated = 0;
    for (const kind of LEARNER_SHELL_KIND_VALUES) {
      const row = SHELL_DEFAULTS[kind];
      for (const field of CAPABILITY_FIELDS) {
        if (field in row) populated++;
      }
    }
    expect(populated).toBe(
      LEARNER_SHELL_KIND_VALUES.length * CAPABILITY_FIELDS.length,
    );
  });
});
