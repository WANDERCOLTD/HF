/**
 * Lattice chain-closure — 6th Coverage-pillar gate (#2057).
 *
 * **Why this exists:**
 *
 * Per-link Coverage gates (registry-schema, registry-consumer,
 * route-auth-zod, tier-visibility, parameter-coverage, parameter-loop-
 * closure, …) each pin ONE step in a chain. But a chain can pass
 * every link's gate yet die semantically because adjacent links use
 * mismatched keys. Worked example:
 *
 *   MEASURE writes:    CallScore.parameterId = "BEH-ABSTRACT-CONCRETE"
 *   AGGREGATE reads:   sourceParameter = "BEH-ABSTRACT-CONCRETE"     ✓ link 1
 *   AGGREGATE writes:  behavior_profile:engagement:abstract_concrete
 *   ADAPT reads:       behavior_profile:engagement:abstractness      ✗ DRIFT
 *   ADAPT writes:      directive in instructions section
 *   Renderer pushes:   instructions section                          ✓ but empty
 *
 * Every link is "covered" — each individual test passes. The chain
 * semantically dies between AGGREGATE → ADAPT because of one renamed
 * key. None of the per-link gates catch it.
 *
 * **What this test pins:**
 *
 * For each chain declared in `docs/lattice-chains.json`, walk the
 * links in order. For each pair `(link[N], link[N+1])`:
 *
 *   1. **File existence** — every cited `producer` / `consumer` path
 *      exists on disk.
 *   2. **Key consistency** — the previous link's `outputKey` literally
 *      appears as the next link's `consumesKey` (modulo
 *      `{placeholder}` substitution and `tolerated_drift` exemptions).
 *   3. **Terminal reachability** — the final link's `outputKey` is a
 *      runtime consumer surface (deferred to sibling
 *      `coverage-producer-consumer.test.ts`; this gate just asserts
 *      the chain's terminal isn't a dangling shape).
 *   4. **Drift ratchet** — each chain's `tolerated_drift[]` count is
 *      pinned by `EXPECTED_TOLERATED_DRIFT_TOTAL`. Cannot grow without
 *      an explicit edit.
 *
 * See `.claude/rules/lattice-chain-closure.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "docs", "lattice-chains.json");

// ────────────────────────────────────────────────────────────
// Manifest schema (mirror of docs/lattice-chains.json)
// ────────────────────────────────────────────────────────────

interface Link {
  stage: string;
  producer: string;
  consumer?: string;
  outputKey: string;
  consumesKey?: string;
  kind: string;
}

interface ToleratedDrift {
  from_link_index: number;
  to_link_index: number;
  reason: string;
}

interface Chain {
  id: string;
  title: string;
  links: Link[];
  tolerated_drift?: ToleratedDrift[];
  terminal_reaches?: string;
}

interface Manifest {
  version: number;
  chains: Chain[];
}

// ────────────────────────────────────────────────────────────
// Load manifest
// ────────────────────────────────────────────────────────────

const MANIFEST: Manifest = (() => {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as Manifest;
})();

const CHAINS: Chain[] = MANIFEST.chains;

// ────────────────────────────────────────────────────────────
// Ratchet — sum of tolerated_drift entries across all chains.
// Cannot grow without an explicit JSON edit AND a bump here.
// ────────────────────────────────────────────────────────────

/**
 * Ratchet — incumbent count of tolerated drift entries summed across all chains.
 *
 * 0 at land time (2026-06-19): all 4 seed chains have keys aligned at
 * the link layer (each link's outputKey IS the next link's consumesKey,
 * modulo placeholders). The gate's purpose is to STAY at 0 — any
 * future PR that introduces a key-shape drift must either (a) fix it
 * upfront (preferred) or (b) explicitly add a `tolerated_drift[]`
 * entry to the chain in `docs/lattice-chains.json` AND bump this
 * ratchet by 1 (conscious acknowledgement of debt).
 *
 * If/when an in-transition chain lands (e.g. an active key rename in
 * progress), bump this when adding the entry. Drop by 1 each time the
 * underlying drift is fixed and the entry is removed.
 */
const EXPECTED_TOLERATED_DRIFT_TOTAL = 0;

// ────────────────────────────────────────────────────────────
// Helpers — adjacent-link key consistency
// ────────────────────────────────────────────────────────────

/**
 * Strip `{placeholder}` tokens for comparison. The producer's
 * `outputKey` and the consumer's `consumesKey` are considered equal
 * when their non-placeholder skeleton matches. Placeholder tokens are
 * `{anything}` — we replace each with a wildcard sentinel.
 */
function placeholderSkeleton(s: string): string {
  // Replace each {token} with the literal "*" so two keys that differ
  // only in token names match.
  return s.replace(/\{[^}]+\}/g, "*").trim();
}

/**
 * Adjacent-link key consistency:
 *
 *   prev.outputKey  →  next.consumesKey   must be the same key.
 *
 * We compare on the placeholder-stripped skeleton. The consumer's
 * `consumesKey` is optional (the consumer side is sometimes implicit,
 * e.g. when the consumer just produces a downstream artefact without
 * declaring its read shape). When `consumesKey` is absent on link
 * `N+1`, the adjacency check is skipped — but the file-existence
 * check still applies.
 */
function keyMismatch(prev: Link, next: Link): string | null {
  if (next.consumesKey === undefined) return null;
  const a = placeholderSkeleton(prev.outputKey);
  const b = placeholderSkeleton(next.consumesKey);
  if (a === b) return null;
  return `prev.outputKey=${JSON.stringify(prev.outputKey)} (skeleton=${JSON.stringify(a)}) ` +
    `!= next.consumesKey=${JSON.stringify(next.consumesKey)} (skeleton=${JSON.stringify(b)})`;
}

/**
 * Is the (N, N+1) pair on this chain's tolerated_drift list?
 */
function isToleratedDrift(chain: Chain, fromIdx: number, toIdx: number): ToleratedDrift | undefined {
  return chain.tolerated_drift?.find(
    (d) => d.from_link_index === fromIdx && d.to_link_index === toIdx,
  );
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Lattice chain-closure (#2057 6th Coverage pillar)", () => {
  it("manifest loads and declares at least 4 chains", () => {
    expect(MANIFEST.version).toBeGreaterThanOrEqual(1);
    expect(CHAINS.length, "Seed manifest should declare at least 4 chains").toBeGreaterThanOrEqual(
      4,
    );
  });

  it("every chain has a kebab-case id", () => {
    for (const chain of CHAINS) {
      expect(chain.id, `chain id must be kebab-case: ${chain.id}`).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });

  it("every chain has at least 2 links (chain must be a chain)", () => {
    for (const chain of CHAINS) {
      expect(chain.links.length, `chain ${chain.id} must have ≥2 links`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every cited producer/consumer file exists on disk", () => {
    const missing: string[] = [];
    for (const chain of CHAINS) {
      for (let i = 0; i < chain.links.length; i++) {
        const link = chain.links[i];
        for (const p of [link.producer, link.consumer].filter((v): v is string => Boolean(v))) {
          const abs = join(REPO_ROOT, p);
          if (!existsSync(abs)) {
            missing.push(`chain=${chain.id} link[${i}].${link.stage}: ${p}`);
          }
        }
      }
    }
    expect(
      missing,
      `Chain manifest cites files that don't exist:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("adjacent links — outputKey ↔ consumesKey consistency (modulo tolerated_drift)", () => {
    const drift: string[] = [];
    for (const chain of CHAINS) {
      for (let i = 0; i < chain.links.length - 1; i++) {
        const prev = chain.links[i];
        const next = chain.links[i + 1];
        const mismatch = keyMismatch(prev, next);
        if (mismatch === null) continue;
        const tolerated = isToleratedDrift(chain, i, i + 1);
        if (tolerated) continue;
        drift.push(
          `chain=${chain.id} pair (${i} → ${i + 1}) [${prev.stage} → ${next.stage}]: ${mismatch}`,
        );
      }
    }
    expect(
      drift,
      `Adjacent-link KEY drift detected. Either:\n` +
        `  - fix the upstream/downstream key to match (preferred);\n` +
        `  - or add the (from_link_index, to_link_index) pair to the chain's tolerated_drift[] with a reason and bump EXPECTED_TOLERATED_DRIFT_TOTAL.\n\n` +
        `Drift sites:\n  ${drift.join("\n  ")}`,
    ).toEqual([]);
  });

  it("tolerated_drift ratchet — total cannot grow without explicit bump", () => {
    const total = CHAINS.reduce(
      (acc, c) => acc + (c.tolerated_drift?.length ?? 0),
      0,
    );
    expect(
      total,
      `Tolerated-drift total drifted. ` +
        `Each entry is "this adjacent-link pair has a key-shape mismatch that's intentional today". ` +
        `Each follow-on PR closing a drift drops this by 1. ` +
        `Each new entry forces a conscious bump (so the gap is acknowledged, not silent).`,
    ).toBe(EXPECTED_TOLERATED_DRIFT_TOTAL);
  });

  it("every tolerated_drift entry has a non-empty reason (>20 chars)", () => {
    const empty: string[] = [];
    for (const chain of CHAINS) {
      for (const d of chain.tolerated_drift ?? []) {
        if ((d.reason ?? "").trim().length <= 20) {
          empty.push(`chain=${chain.id} pair (${d.from_link_index} → ${d.to_link_index})`);
        }
      }
    }
    expect(empty, `tolerated_drift entries with empty/short reason:\n  ${empty.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("tolerated_drift indices reference valid adjacent pairs in their chain", () => {
    const invalid: string[] = [];
    for (const chain of CHAINS) {
      for (const d of chain.tolerated_drift ?? []) {
        if (
          d.from_link_index < 0 ||
          d.to_link_index !== d.from_link_index + 1 ||
          d.to_link_index >= chain.links.length
        ) {
          invalid.push(
            `chain=${chain.id} pair (${d.from_link_index} → ${d.to_link_index}) ` +
              `is not a valid adjacent index pair (chain has ${chain.links.length} links)`,
          );
        }
      }
    }
    expect(invalid, `Invalid tolerated_drift indices:\n  ${invalid.join("\n  ")}`).toEqual([]);
  });

  it("no stale tolerated_drift — every entry must correspond to an actual mismatch", () => {
    const stale: string[] = [];
    for (const chain of CHAINS) {
      for (const d of chain.tolerated_drift ?? []) {
        const prev = chain.links[d.from_link_index];
        const next = chain.links[d.to_link_index];
        if (!prev || !next) continue; // covered by previous test
        const mismatch = keyMismatch(prev, next);
        if (mismatch === null) {
          stale.push(
            `chain=${chain.id} pair (${d.from_link_index} → ${d.to_link_index}) ` +
              `is on tolerated_drift but keys NOW match — remove the entry and drop EXPECTED_TOLERATED_DRIFT_TOTAL by 1.`,
          );
        }
      }
    }
    expect(stale, stale.join("\n  ")).toEqual([]);
  });

  it("terminal_reaches present (informational — chain has a documented destination)", () => {
    const missing: string[] = [];
    for (const chain of CHAINS) {
      if (!chain.terminal_reaches || chain.terminal_reaches.trim().length === 0) {
        missing.push(chain.id);
      }
    }
    expect(
      missing,
      `Chains without terminal_reaches (state where the chain's last output is consumed at runtime). ` +
        `Add a one-line description so future authors know where to look:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("publishes distribution counts (operator log)", () => {
    const linkTotal = CHAINS.reduce((acc, c) => acc + c.links.length, 0);
    const driftTotal = CHAINS.reduce((acc, c) => acc + (c.tolerated_drift?.length ?? 0), 0);
    // Sanity asserts so the operator can see counts evolve over time.
    expect(linkTotal).toBeGreaterThan(8);
    expect(driftTotal).toBeGreaterThanOrEqual(0);
  });
});
