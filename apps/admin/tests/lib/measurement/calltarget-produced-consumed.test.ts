/**
 * CallerTarget produced ↔ consumed Coverage (Data Presence sub-pillar)
 *
 * #2284 (umbrella #2279) — cascade reachability shape.
 *
 * Catches: an ADAPT spec writes a `targetParameter` to `CallerTarget`
 * but NO compose-side reader picks the value up at next-call time. The
 * adaptive loop runs end-to-end, the row gets written, and no consumer
 * reads it — silent dead branch in the cascade.
 *
 * **DATA-first framing**: the question is *"does the CallerTarget data
 * row written by ADAPT actually get consumed by COMPOSE?"* — not *"is
 * the code correctly wired?"*. Orphan DATA rows are the failure mode.
 *
 * Sibling Data Presence Coverage gates:
 * - `parser-roundtrip-coverage.md` (#2283) — authored-vs-projected parity
 * - `spec-params-canonical-presence-coverage.md` (#2280) — soft-FK resolvability
 * - `aggregate-output-consumer-coverage.test.ts` (#1967 M2) —
 *   sibling on the AGGREGATE side (this gate is the ADAPT side)
 *
 * **What counts as a consumer:**
 *
 * Any reference to the `targetParameter` value (literal id OR any of
 * its registry aliases) found under:
 *   - `lib/prompt/composition/**` (canonical loop-closing surface)
 *   - `lib/cascade/**` (cascade resolvers reading adapted state)
 *   - `lib/pipeline/**` (downstream SUPERVISE / COMPOSE stages)
 *   - `lib/voice/**`, `lib/curriculum/**`, `lib/goals/**`
 *
 * Alias resolution via `behavior-parameters.registry.json` —
 * ADAPT specs often use legacy UPPER-SNAKE IDs (`BEH-ENGAGEMENT`)
 * while modern compose code uses canonical lower-snake forms
 * (`engagement`). Without alias resolution, every legacy ref would
 * falsely classify as a gap.
 *
 * **Ratchet:** `EXPECTED_GAP_COUNT` freezes the incumbent gap count
 * at land. Compose-side ADAPT-reader implementation is a separate
 * pedagogy-led epic — this gate freezes the floor and prevents
 * further drift. Won't reach 0 without that follow-on.
 *
 * Rule: `.claude/rules/calltarget-produced-consumed-coverage.md`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ADMIN = resolve(__dirname, "..", "..", "..");
const SPECS_DIR = join(APPS_ADMIN, "docs-archive", "bdd-specs");
const LIB_DIR = join(APPS_ADMIN, "lib");

const REGISTRY_PATH = join(SPECS_DIR, "behavior-parameters.registry.json");

const CONSUMER_DIRS = [
  "prompt/composition",
  "cascade",
  "pipeline",
  "voice",
  "curriculum",
  "goals",
];

// =====================================================================
// Load registry for alias resolution
// =====================================================================

interface RegistryEntry {
  parameterId: string;
  aliases?: string[];
}

interface Registry {
  parameters: RegistryEntry[];
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as Registry;

const aliasIndex = new Map<string, string[]>();
for (const p of registry.parameters) {
  aliasIndex.set(p.parameterId, [p.parameterId, ...(p.aliases ?? [])]);
}

function resolveAliases(targetParameter: string): string[] {
  const direct = aliasIndex.get(targetParameter);
  if (direct) return direct;
  for (const [canonical, aliases] of aliasIndex) {
    if (aliases.includes(targetParameter)) return aliases;
  }
  return [targetParameter];
}

// =====================================================================
// Collect ADAPT spec writes
// =====================================================================

interface AdaptTarget {
  specFile: string;
  specId: string;
  targetParameter: string;
}

interface AdaptSpec {
  id: string;
  specRole?: string;
  outputType?: string;
  acceptanceCriteria?: Array<{
    config?: {
      adaptationRules?: Array<{
        action?: {
          targetParameter?: string;
          targetParameterId?: string;
        };
      }>;
    };
  }>;
  triggers?: Array<{
    actions?: Array<{
      config?: {
        adaptationRules?: Array<{
          action?: {
            targetParameter?: string;
            targetParameterId?: string;
          };
        }>;
      };
    }>;
  }>;
}

function collectAdaptTargets(): AdaptTarget[] {
  const targets: AdaptTarget[] = [];
  const files = readdirSync(SPECS_DIR).filter(
    (f) =>
      f.endsWith(".spec.json") &&
      f !== "behavior-parameters.registry.json",
  );
  for (const file of files) {
    try {
      const raw = readFileSync(join(SPECS_DIR, file), "utf8");
      const spec = JSON.parse(raw) as AdaptSpec;
      // Only ADAPT specs write to CallerTarget via adaptationRules
      const isAdapt =
        spec.specRole === "ADAPT" || spec.outputType === "ADAPT";
      if (!isAdapt) continue;
      // Walk every adaptationRules carrying targetParameter in either
      // top-level config (some specs) or trigger.actions[].config
      // (others). The raw JSON shapes vary; do a recursive walk.
      walkForTargetParameter(spec, (tp) => {
        targets.push({
          specFile: file,
          specId: spec.id,
          targetParameter: tp,
        });
      });
    } catch {
      // Skip malformed; not our concern
    }
  }
  return targets;
}

function walkForTargetParameter(
  node: unknown,
  onFound: (tp: string) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) walkForTargetParameter(item, onFound);
    return;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (
        (key === "targetParameter" || key === "targetParameterId") &&
        typeof value === "string" &&
        value
      ) {
        onFound(value);
        continue;
      }
      walkForTargetParameter(value, onFound);
    }
  }
}

const adaptTargets = collectAdaptTargets();

// =====================================================================
// Build searchable consumer-source corpus once
// =====================================================================

function collectFiles(dir: string, accum: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return accum;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectFiles(full, accum);
    } else if (
      stat.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx") &&
      !full.includes("__tests__")
    ) {
      accum.push(full);
    }
  }
  return accum;
}

const consumerFiles: string[] = [];
for (const sub of CONSUMER_DIRS) {
  collectFiles(join(LIB_DIR, sub), consumerFiles);
}

const consumerCorpus = consumerFiles
  .map((f) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return "";
    }
  })
  .join("\n--FILE--\n");

// =====================================================================
// Classify each target
// =====================================================================

type Classification = "covered" | "exempt" | "gap";

interface ClassifiedTarget extends AdaptTarget {
  classification: Classification;
  matchedAlias?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasFoundInCorpus(alias: string): boolean {
  // Look for the alias as a quoted-string literal in source
  // (catches references in maps, branches, registry keys, etc.)
  const pattern = new RegExp(`["'\`]${escapeRegex(alias)}["'\`]`);
  return pattern.test(consumerCorpus);
}

// =====================================================================
// Exempt list — targets with documented compose-side absence
// =====================================================================

const CALLTARGET_EXEMPT: Record<string, { reason: string }> = {};

function classifyAll(): ClassifiedTarget[] {
  return adaptTargets.map((t) => {
    const exemptKey = `${t.specFile}::${t.targetParameter}`;
    if (CALLTARGET_EXEMPT[exemptKey]) {
      return { ...t, classification: "exempt" };
    }
    const aliases = resolveAliases(t.targetParameter);
    const hit = aliases.find((a) => aliasFoundInCorpus(a));
    if (hit) {
      return { ...t, classification: "covered", matchedAlias: hit };
    }
    return { ...t, classification: "gap" };
  });
}

const classified = classifyAll();

// =====================================================================
// Ratchets — freeze incumbent gap count at land (2026-06-24).
//
// Compose-side ADAPT-reader implementation is a separate pedagogy-led
// epic (per TL on #2284). This gate's purpose is to FREEZE the floor
// at incumbent — future PRs can DROP the count by wiring readers, but
// any new gap fails CI.
//
// Initial breakdown (land-time): 235 total ADAPT targetParameter refs,
// 99 covered, 136 gap. Top offenders:
//   72 ADAPT-LEARN-001 (learner-profile-adaptation)
//   25 ADAPT-VARK-001 (modality-adaptation)
//   13 ADAPT-BEH-001 (behavior-adaptation)
//    8 ADAPT-CURR-001 (curriculum-adaptation)
//    6 COMP-ADAPT-001 (comprehension-adaptation)
//    5 ADAPT-PERS-001 (personality-adaptation)
//    3 COACH-ADAPT-001 (coaching-adaptation)
//    2 ADAPT-ENG-001 (engagement-adaptation)
//    2 DISC-ADAPT-001 (discussion-adaptation)
// =====================================================================

const EXPECTED_GAP_COUNT = 136;
const EXPECTED_EXEMPT_COUNT = 0;

// =====================================================================
// Tests
// =====================================================================

describe("#2284 — CallerTarget produced ↔ consumed (Data Presence cascade reachability)", () => {
  it("walker finds ADAPT specs", () => {
    const distinctSpecs = new Set(adaptTargets.map((t) => t.specFile));
    expect(distinctSpecs.size).toBeGreaterThan(0);
  });

  it("walker extracts targetParameter values", () => {
    expect(adaptTargets.length).toBeGreaterThan(0);
  });

  it("consumer-corpus loaded from consumer dirs", () => {
    expect(consumerFiles.length).toBeGreaterThan(0);
    expect(consumerCorpus.length).toBeGreaterThan(0);
  });

  it("registry loaded for alias resolution", () => {
    expect(aliasIndex.size).toBeGreaterThan(0);
  });

  it("gap count is at or below the incumbent ratchet (Data Presence)", () => {
    const gaps = classified.filter((t) => t.classification === "gap");
    expect(
      gaps.length,
      `Gap count rose above ratchet (incumbent ${EXPECTED_GAP_COUNT}, now ${gaps.length}). ` +
        `A new ADAPT targetParameter ref has no compose-side consumer. ` +
        `Either wire a reader in lib/prompt/composition/ (or sibling consumer dirs), ` +
        `OR add to CALLTARGET_EXEMPT with a >20-char reason explaining why no reader is required.\n\n` +
        `Sample gaps: ${gaps
          .slice(0, 5)
          .map((g) => `${g.specFile}::${g.targetParameter}`)
          .join(", ")}${gaps.length > 5 ? ` (+${gaps.length - 5} more)` : ""}.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet should be dropped if gap count fell (encourage forward progress)", () => {
    const gaps = classified.filter((t) => t.classification === "gap");
    // Soft signal — fail if the constant is way behind the live count.
    // 5-gap margin so small clean-ups don't break the test, but a
    // 10+-gap improvement nudges the author to lower EXPECTED_GAP_COUNT.
    expect(
      gaps.length,
      `Gap count is ${gaps.length}, well below the ratchet of ${EXPECTED_GAP_COUNT}. ` +
        `Drop EXPECTED_GAP_COUNT to ${gaps.length} so the floor moves forward.`,
    ).toBeGreaterThan(EXPECTED_GAP_COUNT - 10);
  });

  it("exempt list ratchet", () => {
    expect(Object.keys(CALLTARGET_EXEMPT).length).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a >20-char reason", () => {
    for (const [key, entry] of Object.entries(CALLTARGET_EXEMPT)) {
      expect(
        entry.reason.length,
        `Exempt entry '${key}' has reason '${entry.reason}' — must be >20 chars.`,
      ).toBeGreaterThan(20);
    }
  });

  it("no stale exempt entry (target not in current spec catalog)", () => {
    const liveKeys = new Set(
      adaptTargets.map((t) => `${t.specFile}::${t.targetParameter}`),
    );
    const orphans = Object.keys(CALLTARGET_EXEMPT).filter(
      (k) => !liveKeys.has(k),
    );
    expect(orphans).toEqual([]);
  });

  it("distribution sanity — every target classifies", () => {
    const total = classified.length;
    const covered = classified.filter((t) => t.classification === "covered").length;
    const exempt = classified.filter((t) => t.classification === "exempt").length;
    const gap = classified.filter((t) => t.classification === "gap").length;
    expect(covered + exempt + gap).toBe(total);
  });
});
