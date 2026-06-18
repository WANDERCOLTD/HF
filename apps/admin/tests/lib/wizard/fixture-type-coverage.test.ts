/**
 * Fixture-YAML ↔ AuthoredModuleSettings bidirectional coverage (#1910).
 *
 * **What this test pins:**
 *  Every settings-block key authored in any `course-reference-ielts-v*.md`
 *  fixture under `lib/wizard/__tests__/fixtures/` MUST EITHER:
 *    (a) be a known member of the `AuthoredModuleSettings` TypeScript
 *        interface in `lib/types/json-fields.ts`, OR
 *    (b) appear in `FIXTURE_KEY_EXEMPT` with a one-line reason (≥10 chars).
 *
 *  Bidirectionally, every member of `AuthoredModuleSettings` MUST EITHER:
 *    (a) be exercised by at least one fixture file, OR
 *    (b) appear in `TYPE_MEMBER_EXEMPT` with a one-line reason.
 *
 *  Ratchets pin the current state; new untyped keys / unexercised members
 *  fail CI unless the operator consciously bumps the count.
 *
 * **Why this exists:**
 *  Closes the drift class surfaced by the 2026-06-18 #1903 / #1904 grooming
 *  audit: 5 fixture YAML keys present in `v2.3` but absent from the
 *  TypeScript type — the wizard parser silently drops them. Without this
 *  gate the next course-ref doc revision (or a new doc for a new course)
 *  re-introduces the same shape of bug.
 *
 *  Parent epic: #1909 (Lattice Coverage extensions).
 *  Sibling template: `tests/lib/journey/registry-schema-coverage.test.ts`.
 *
 * **How to fix a failure:**
 *  - "Fixture key X has no type member and is not exempt":
 *      Best — add `X?: ...` to `AuthoredModuleSettings` in
 *      `lib/types/json-fields.ts`.
 *      Acceptable — add to `FIXTURE_KEY_EXEMPT` with reason (≥10 chars),
 *      bump `EXPECTED_FIXTURE_KEY_EXEMPT_COUNT`.
 *  - "Type member Y is never exercised by any fixture":
 *      Best — add a usage example to `v2.3` (or current) fixture.
 *      Acceptable — add to `TYPE_MEMBER_EXEMPT` with reason, bump
 *      `EXPECTED_TYPE_MEMBER_EXEMPT_COUNT`.
 *  - "Exempt entry no longer present":
 *      Remove the stale id from the exempt list and drop the ratchet.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TYPES_PATH = path.join(REPO_ROOT, "lib", "types", "json-fields.ts");
const FIXTURES_DIR = path.join(
  REPO_ROOT,
  "lib",
  "wizard",
  "__tests__",
  "fixtures",
);

/** Fixture YAML keys deliberately not (yet) typed on `AuthoredModuleSettings`.
 *  Each entry is a structural debt marker — adding the field to the type is
 *  the preferred resolution; the exempt entry is the recorded gap. */
const FIXTURE_KEY_EXEMPT: Record<string, string> = {
  prepSilenceSec:
    "examiner-mode prep-phase silence threshold (sec). Type addition deferred — read by cue-scheduler runtime; consumer pending.",
  incompleteThresholdSec:
    "module-scoped incomplete-attempt duration gate (sec). Type addition deferred to follow-on; sibling of minSpeakingSec.",
  scoringCriteria:
    "per-module whitelist of scoring criteria (e.g. [FC, LR, GRA, Pron]). Type addition deferred — pairs with Theme 6 segmentKey work.",
  scoreReadoutMode:
    "per-module score readout policy (on-screen / end-of-module-on-screen / aloud). Type addition deferred — paired with Mock Results screen.",
};

/** `AuthoredModuleSettings` type members deliberately not exercised by any
 *  fixture file. Empty at land time — every member is exercised by v2.3. */
const TYPE_MEMBER_EXEMPT: Record<string, string> = {};

/** Pin current state; new additions fail CI until consciously bumped. */
// #1932 (epic #1931 S0): dropped from 5 → 4 — `topicPool` joined
// `AuthoredModuleSettings` with a full type + registry + consumer
// + resolver wiring; it is no longer exempt.
const EXPECTED_FIXTURE_KEY_EXEMPT_COUNT = 4;
const EXPECTED_TYPE_MEMBER_EXEMPT_COUNT = 0;

// ────────────────────────────────────────────────────────────────────
// Parsers
// ────────────────────────────────────────────────────────────────────

/** Extract the names of every optional member declared inside
 *  `export interface AuthoredModuleSettings { ... }`. Source-text parse
 *  (same approach as `coverage-producer-consumer.test.ts`) — no TS
 *  reflection. */
function parseAuthoredModuleSettingsMembers(): string[] {
  const src = fs.readFileSync(TYPES_PATH, "utf8");
  const startRe = /export interface AuthoredModuleSettings \{/m;
  const startMatch = startRe.exec(src);
  if (!startMatch) {
    throw new Error(
      `Could not find 'export interface AuthoredModuleSettings' in ${TYPES_PATH}`,
    );
  }
  const startIdx = startMatch.index + startMatch[0].length;
  // Track brace depth so nested `{ ... }` (e.g. `questionTarget?: { min: number; target: number }`)
  // doesn't terminate the scan early.
  let depth = 1;
  let endIdx = startIdx;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  const body = src.slice(startIdx, endIdx);
  // Members look like `  name?: ...` or `  name: ...` at the top level
  // (depth-1) of the interface. Approximate by matching lines whose first
  // non-whitespace token is `<ident>?:` or `<ident>:` followed by content.
  // Filter out lines inside nested braces by tracking depth as we walk.
  const members = new Set<string>();
  const lines = body.split("\n");
  let lineDepth = 0;
  for (const raw of lines) {
    // Update depth based on braces in this line.
    const openCount = (raw.match(/\{/g) ?? []).length;
    const closeCount = (raw.match(/\}/g) ?? []).length;
    // Members live at lineDepth === 0 of the body (before any nested brace opens).
    if (lineDepth === 0) {
      const m = /^\s+(\w+)\??:/m.exec(raw);
      if (m) members.add(m[1]);
    }
    lineDepth += openCount - closeCount;
  }
  return Array.from(members).sort();
}

/** Scan a fixture markdown file for ```yaml blocks, find every `settings:`
 *  block within, and extract the 2-space-indented top-level setting keys.
 *  Multi-line values (e.g. `closingLine: |`) are handled naturally — only
 *  the first line carries the column-2 key prefix. */
function parseFixtureSettingsKeys(fixturePath: string): string[] {
  const src = fs.readFileSync(fixturePath, "utf8");
  const keys = new Set<string>();
  const lines = src.split("\n");

  let inYamlBlock = false;
  let inSettings = false;

  for (const raw of lines) {
    if (/^```yaml\s*$/.test(raw)) {
      inYamlBlock = true;
      inSettings = false;
      continue;
    }
    if (inYamlBlock && /^```\s*$/.test(raw)) {
      inYamlBlock = false;
      inSettings = false;
      continue;
    }
    if (!inYamlBlock) continue;

    // Top-level `settings:` line opens the scope; any other column-0 ident
    // closes it.
    if (/^settings:\s*$/.test(raw)) {
      inSettings = true;
      continue;
    }
    if (/^\S/.test(raw)) {
      inSettings = false;
      continue;
    }
    if (!inSettings) continue;

    // Column-2 setting key. Skip comments and blank lines.
    const m = /^  (\w+):/m.exec(raw);
    if (m) keys.add(m[1]);
  }
  return Array.from(keys).sort();
}

function listFixtureFiles(): string[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => /^course-reference-ielts-v[\d.]+\.md$/.test(f))
    .map((f) => path.join(FIXTURES_DIR, f))
    .sort();
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("fixture YAML ↔ AuthoredModuleSettings bidirectional coverage", () => {
  const typeMembers = parseAuthoredModuleSettingsMembers();
  const fixtureFiles = listFixtureFiles();

  // Union of every settings key seen across every fixture file.
  const fixtureKeys = new Set<string>();
  for (const f of fixtureFiles) {
    for (const k of parseFixtureSettingsKeys(f)) fixtureKeys.add(k);
  }

  it("parses non-empty type member set", () => {
    expect(typeMembers.length).toBeGreaterThan(0);
  });

  it("walks at least one fixture file", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it("walks at least one fixture YAML block with settings", () => {
    expect(fixtureKeys.size).toBeGreaterThan(0);
  });

  // Producer → consumer.
  it("every fixture YAML key is a type member OR is FIXTURE_KEY_EXEMPT", () => {
    const typeSet = new Set(typeMembers);
    const exemptSet = new Set(Object.keys(FIXTURE_KEY_EXEMPT));
    const orphans: string[] = [];
    for (const k of fixtureKeys) {
      if (typeSet.has(k)) continue;
      if (exemptSet.has(k)) continue;
      orphans.push(k);
    }
    if (orphans.length > 0) {
      throw new Error(
        `${orphans.length} fixture YAML key(s) lack a type member and are not exempt:\n` +
          orphans.map((k) => `  - ${k}`).join("\n") +
          `\n\nFix: add to AuthoredModuleSettings in lib/types/json-fields.ts ` +
          `OR add to FIXTURE_KEY_EXEMPT with a reason (≥10 chars) and bump ` +
          `EXPECTED_FIXTURE_KEY_EXEMPT_COUNT.`,
      );
    }
    expect(orphans).toEqual([]);
  });

  // Consumer → producer.
  it("every type member is exercised by at least one fixture OR is TYPE_MEMBER_EXEMPT", () => {
    const exemptSet = new Set(Object.keys(TYPE_MEMBER_EXEMPT));
    const unexercised: string[] = [];
    for (const m of typeMembers) {
      if (fixtureKeys.has(m)) continue;
      if (exemptSet.has(m)) continue;
      unexercised.push(m);
    }
    if (unexercised.length > 0) {
      throw new Error(
        `${unexercised.length} AuthoredModuleSettings member(s) not exercised by any fixture:\n` +
          unexercised.map((m) => `  - ${m}`).join("\n") +
          `\n\nFix: add a usage example to the current course-reference-ielts-v*.md fixture ` +
          `OR add to TYPE_MEMBER_EXEMPT with reason and bump ` +
          `EXPECTED_TYPE_MEMBER_EXEMPT_COUNT.`,
      );
    }
    expect(unexercised).toEqual([]);
  });

  // Ratchets.
  it("EXPECTED_FIXTURE_KEY_EXEMPT_COUNT matches current size (ratchet)", () => {
    const actual = Object.keys(FIXTURE_KEY_EXEMPT).length;
    if (actual !== EXPECTED_FIXTURE_KEY_EXEMPT_COUNT) {
      throw new Error(
        `FIXTURE_KEY_EXEMPT has ${actual} entries, EXPECTED_FIXTURE_KEY_EXEMPT_COUNT is ${EXPECTED_FIXTURE_KEY_EXEMPT_COUNT}. ` +
          `Each addition is a conscious debt acknowledgement — bump the constant after auditing.`,
      );
    }
    expect(actual).toBe(EXPECTED_FIXTURE_KEY_EXEMPT_COUNT);
  });

  it("EXPECTED_TYPE_MEMBER_EXEMPT_COUNT matches current size (ratchet)", () => {
    const actual = Object.keys(TYPE_MEMBER_EXEMPT).length;
    expect(actual).toBe(EXPECTED_TYPE_MEMBER_EXEMPT_COUNT);
  });

  // Non-empty reasons.
  it("every FIXTURE_KEY_EXEMPT entry has a reason ≥10 chars", () => {
    const tooShort: string[] = [];
    for (const [k, reason] of Object.entries(FIXTURE_KEY_EXEMPT)) {
      if (!reason || reason.trim().length < 10) tooShort.push(k);
    }
    expect(tooShort).toEqual([]);
  });

  it("every TYPE_MEMBER_EXEMPT entry has a reason ≥10 chars", () => {
    const tooShort: string[] = [];
    for (const [k, reason] of Object.entries(TYPE_MEMBER_EXEMPT)) {
      if (!reason || reason.trim().length < 10) tooShort.push(k);
    }
    expect(tooShort).toEqual([]);
  });

  // Non-stale checks.
  it("every FIXTURE_KEY_EXEMPT id is still present in at least one fixture", () => {
    const stale: string[] = [];
    for (const k of Object.keys(FIXTURE_KEY_EXEMPT)) {
      if (!fixtureKeys.has(k)) stale.push(k);
    }
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} FIXTURE_KEY_EXEMPT id(s) are no longer in any fixture:\n` +
          stale.map((k) => `  - ${k}`).join("\n") +
          `\nRemove from FIXTURE_KEY_EXEMPT and drop EXPECTED_FIXTURE_KEY_EXEMPT_COUNT.`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("every TYPE_MEMBER_EXEMPT id is still a type member", () => {
    const typeSet = new Set(typeMembers);
    const stale: string[] = [];
    for (const k of Object.keys(TYPE_MEMBER_EXEMPT)) {
      if (!typeSet.has(k)) stale.push(k);
    }
    expect(stale).toEqual([]);
  });

  // No contradictions.
  it("no key is both FIXTURE_KEY_EXEMPT and TYPE_MEMBER_EXEMPT", () => {
    const overlap = Object.keys(FIXTURE_KEY_EXEMPT).filter((k) =>
      Object.prototype.hasOwnProperty.call(TYPE_MEMBER_EXEMPT, k),
    );
    expect(overlap).toEqual([]);
  });
});
