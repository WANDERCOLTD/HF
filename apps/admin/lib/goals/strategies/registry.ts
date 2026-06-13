/**
 * Strategy registry (#444). Mirrors lib/prompt/composition/TransformRegistry.
 *
 * Strategies register themselves at module-load time via `registerStrategy`.
 * Dispatch sites call `getStrategy(key)` and invoke the returned function.
 * Unknown keys fall back to `manual_only` so a typo in the spec or DB
 * never crashes the pipeline — the goal sits at 0 with awaiting-evidence
 * affordance instead.
 */

import type { StrategyFn, StrategyKey } from "./types";

const STRATEGY_REGISTRY = new Map<string, StrategyFn>();

/**
 * Historical strategy-key aliases. `Goal.progressStrategy` was written as
 * uppercase `LO_MASTERY` by `scripts/fix-cio-cto-playbooks.ts:234` and a
 * few other early seed scripts; the registered key is `lo_rollup`. Without
 * an alias the lookup silently falls through to `manual_only` and every
 * LEARN goal on those playbooks sits at 0% forever.
 *
 * Lookup is case-insensitive: keys are lowercased before alias resolution
 * and before the registry probe.
 */
const STRATEGY_ALIASES: Record<string, string> = {
  lo_mastery: "lo_rollup",
};

export function registerStrategy(key: StrategyKey | string, fn: StrategyFn): void {
  if (STRATEGY_REGISTRY.has(key)) {
    throw new Error(`[strategy-registry] Duplicate registration for "${key}"`);
  }
  STRATEGY_REGISTRY.set(key, fn);
}

export function getStrategy(key: string | null | undefined): StrategyFn {
  const raw = key ?? "manual_only";
  const normalized = raw.toLowerCase();
  const resolved = STRATEGY_ALIASES[normalized] ?? normalized;
  const fn = STRATEGY_REGISTRY.get(resolved);
  if (fn) return fn;
  const fallback = STRATEGY_REGISTRY.get("manual_only");
  if (!fallback) {
    throw new Error(
      `[strategy-registry] manual_only fallback not registered — strategy "${raw}" requested`,
    );
  }
  return fallback;
}

export function registeredKeys(): string[] {
  return Array.from(STRATEGY_REGISTRY.keys());
}

/** Test helper — clears the registry. Production code must never call this. */
export function _resetRegistryForTests(): void {
  STRATEGY_REGISTRY.clear();
}
