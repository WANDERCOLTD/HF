/**
 * Lattice chain closure — 6th Coverage pillar (story #2057).
 *
 * **What this test pins:**
 *
 * Per-link Coverage gates pin each step individually — but a chain can
 * pass every link gate yet die semantically because adjacent links use
 * mismatched keys.
 *
 * Example (real risk):
 *
 *   MEASURE writes:    CallScore.parameterId = "BEH-ABSTRACT-CONCRETE"
 *   AGGREGATE reads:   sourceParameter = "BEH-ABSTRACT-CONCRETE"     ✓
 *   AGGREGATE writes:  behavior_profile:engagement:abstract_concrete
 *   ADAPT reads:       behavior_profile:engagement:abstractness      ✗ DRIFT
 *   ADAPT writes:      directive in instructions section
 *   Renderer pushes:   instructions section                          ✓ but empty
 *
 * Every link passes its individual Coverage gate. The chain semantically
 * dies between AGGREGATE → ADAPT because of one renamed key. None of
 * the existing gates catch it.
 *
 * **How this test catches it:**
 *
 * Walks `docs/lattice-chains.json` chain-by-chain, link-by-link.
 * For each link N → link N+1:
 *
 *   1. **File existence** — each cited producer / consumer / runner
 *      path must exist on disk.
 *   2. **Producer-consumer key consistency** — sample output keys from
 *      link N must literally appear in link N+1's consumer file as
 *      string references (allow-listed naming patterns when the key is
 *      templated).
 *   3. **Known gaps tolerated** — chains declare known-gap ratchet
 *      keys. Each ratcheted gap must remain known; new gaps fail the
 *      test.
 *
 * **Catalogued by:** `.claude/rules/lattice-chain-closure.md` +
 * `docs/kb/guard-registry.md` (Coverage pillar 6th member).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "docs", "lattice-chains.json");

// ────────────────────────────────────────────────────────────
// Manifest shape
// ────────────────────────────────────────────────────────────

interface ChainLink {
  stage: string;
  producer?: string;
  consumer?: string;
  runner?: string;
  consumesKey?: string;
  consumesKeySamples?: string[];
  outputKey: string;
  outputKeySamples?: string[];
  outputNotes?: string;
  kind: string;
  method?: string;
}

interface KnownGap {
  stage: string;
  description: string;
  tolerated: boolean;
  ratchetKey: string;
}

interface Chain {
  id: string;
  title: string;
  description: string;
  links: ChainLink[];
  knownGaps?: KnownGap[];
}

interface Manifest {
  version: number;
  chains: Chain[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

// ────────────────────────────────────────────────────────────
// File / source helpers
// ────────────────────────────────────────────────────────────

function fileExists(relPath: string): boolean {
  try {
    statSync(join(REPO_ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

function readSource(relPath: string): string {
  try {
    return readFileSync(join(REPO_ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

// ────────────────────────────────────────────────────────────
// Producer-consumer key consistency
// ────────────────────────────────────────────────────────────

interface KeyMatch {
  sample: string;
  consumerFile: string;
  found: boolean;
}

function checkKeyConsistency(
  producerSamples: string[] | undefined,
  consumerPath: string | undefined,
): KeyMatch[] {
  if (!consumerPath || !producerSamples || producerSamples.length === 0) {
    return [];
  }
  const consumerSource = readSource(consumerPath);
  return producerSamples.map((sample) => ({
    sample,
    consumerFile: consumerPath,
    found: consumerSource.includes(sample),
  }));
}

// ────────────────────────────────────────────────────────────
// Ratchet for tolerated gaps
// ────────────────────────────────────────────────────────────

/**
 * Chains with tolerated open links. Each key MUST appear in some
 * chain's `knownGaps[].ratchetKey`. New gaps fail the test until
 * they're either fixed (close the link) or tolerated (add to the
 * chain's `knownGaps[]`).
 *
 * 2026-06-19 — story #2074 closed `beh-aggregate-cascade:adapt-leg`
 * by shipping ADAPT-BEH-001 + the adapt-runner `callerAttribute`
 * dataSource extension. The chain now walks end-to-end MEASURE →
 * AGGREGATE → ADAPT → COMPOSE with zero tolerated drift.
 */
const EXPECTED_TOLERATED_GAPS = new Set<string>([]);

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Lattice chain closure (#2057 — Coverage pillar 6th member)", () => {
  it("manifest is non-empty and schema-shaped", () => {
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.chains)).toBe(true);
    expect(manifest.chains.length).toBeGreaterThan(0);
    for (const chain of manifest.chains) {
      expect(chain.id, "chain.id required").toBeTruthy();
      expect(chain.title, "chain.title required").toBeTruthy();
      expect(chain.description, "chain.description required").toBeTruthy();
      expect(
        Array.isArray(chain.links),
        `${chain.id}: chain.links must be array`,
      ).toBe(true);
      expect(
        chain.links.length,
        `${chain.id}: chain.links must be >= 2`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("every chain link has a stage + kind + outputKey", () => {
    for (const chain of manifest.chains) {
      for (let i = 0; i < chain.links.length; i++) {
        const link = chain.links[i];
        expect(link.stage, `${chain.id} link[${i}]: stage`).toBeTruthy();
        expect(link.kind, `${chain.id} link[${i}]: kind`).toBeTruthy();
        expect(link.outputKey, `${chain.id} link[${i}]: outputKey`).toBeTruthy();
      }
    }
  });

  it("every cited producer / consumer / runner file exists on disk", () => {
    const missing: string[] = [];
    for (const chain of manifest.chains) {
      for (const link of chain.links) {
        for (const field of ["producer", "consumer", "runner"] as const) {
          const path = link[field];
          if (typeof path === "string" && path.length > 0 && !fileExists(path)) {
            missing.push(`${chain.id} link(${link.stage}) ${field}: ${path}`);
          }
        }
      }
    }
    expect(
      missing,
      `Cited files do not exist on disk:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("each link's consumesKeySamples literally appear in its consumer source (the consumer reads what it claims to read)", () => {
    const failures: string[] = [];
    for (const chain of manifest.chains) {
      for (const link of chain.links) {
        if (!link.consumer || !link.consumesKeySamples?.length) continue;
        const source = readSource(link.consumer);
        for (const sample of link.consumesKeySamples) {
          if (!source.includes(sample)) {
            failures.push(
              `${chain.id} ${link.stage} (${link.consumer}) — claims consumesKeySample '${sample}' but not present in source`,
            );
          }
        }
      }
    }
    expect(
      failures,
      `Consumer-side drift detected (manifest says the consumer reads X but source doesn't reference X):\n  ${failures.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * Producer-side outputKeySamples are intentionally NOT asserted to
   * appear in source — for runtime-driven keys (CallScore.parameterId
   * etc.) the producer file (e.g. write-call-score.ts) is parameterised
   * and doesn't carry literal BEH-* / COACH_* / skill_* tokens. The
   * literals live in the consuming spec.json files (asserted via
   * consumesKeySamples on the NEXT link) and in the registry
   * (asserted by parameter-coverage / parameter-measurement-coverage).
   * The actual drift catch is adjacent-link sample overlap below.
   */

  it("adjacent-link sample overlap — at least one of producer's outputKeySamples must overlap with consumer's consumesKeySamples (or consumer is scope-based)", () => {
    const failures: string[] = [];
    for (const chain of manifest.chains) {
      for (let i = 0; i < chain.links.length - 1; i++) {
        const producer = chain.links[i];
        const consumer = chain.links[i + 1];
        if (!producer.outputKeySamples?.length || !consumer.consumesKeySamples?.length) {
          continue;
        }
        // Scope-based consumer? Skip per-sample overlap check.
        const scopeBased =
          (consumer.consumesKey?.toLowerCase().includes("scope") ?? false) ||
          (consumer.kind?.toLowerCase().includes("scope") ?? false);
        if (scopeBased) continue;
        // Pattern-based consumer? Skip — the consumer uses a wildcard
        // and we can't literal-match.
        const patternBased = (consumer.consumesKey?.toLowerCase().includes("pattern") ?? false);
        if (patternBased) continue;

        const overlap = producer.outputKeySamples.some((s) =>
          consumer.consumesKeySamples!.includes(s),
        );
        if (!overlap) {
          failures.push(
            `${chain.id}: ${producer.stage} → ${consumer.stage} — no overlap between producer outputKeySamples [${producer.outputKeySamples.join(", ")}] and consumer consumesKeySamples [${consumer.consumesKeySamples.join(", ")}]`,
          );
        }
      }
    }
    expect(
      failures,
      `Adjacent-link KEY DRIFT (the very class story #2057 was filed to catch — producer writes one set, consumer reads a different set):\n  ${failures.join("\n  ")}`,
    ).toEqual([]);
  });

  it("ratcheted gaps are stable — tolerated gaps match manifest declarations", () => {
    const declared = new Set<string>();
    for (const chain of manifest.chains) {
      for (const gap of chain.knownGaps ?? []) {
        if (gap.tolerated) declared.add(gap.ratchetKey);
      }
    }
    // Every expected gap must be declared
    const missing = Array.from(EXPECTED_TOLERATED_GAPS).filter(
      (g) => !declared.has(g),
    );
    expect(
      missing,
      `EXPECTED_TOLERATED_GAPS entries not declared in any chain's knownGaps[]:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
    // Every declared gap must be in EXPECTED_TOLERATED_GAPS
    const undeclared = Array.from(declared).filter(
      (g) => !EXPECTED_TOLERATED_GAPS.has(g),
    );
    expect(
      undeclared,
      `Chains declare ratchetKey not in EXPECTED_TOLERATED_GAPS — either bump the set or remove the gap:\n  ${undeclared.join("\n  ")}`,
    ).toEqual([]);
  });

  it("publishes the distribution (operator log)", () => {
    const totalChains = manifest.chains.length;
    const totalLinks = manifest.chains.reduce(
      (acc, c) => acc + c.links.length,
      0,
    );
    const totalGaps = manifest.chains.reduce(
      (acc, c) => acc + (c.knownGaps?.length ?? 0),
      0,
    );
    expect(totalChains).toBeGreaterThan(0);
    expect(totalLinks).toBeGreaterThan(0);
    // Test name carries the data — operator reads it in CI.
    void totalGaps;
  });
});
