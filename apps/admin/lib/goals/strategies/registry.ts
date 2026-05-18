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

export function registerStrategy(key: StrategyKey | string, fn: StrategyFn): void {
  if (STRATEGY_REGISTRY.has(key)) {
    throw new Error(`[strategy-registry] Duplicate registration for "${key}"`);
  }
  STRATEGY_REGISTRY.set(key, fn);
}

export function getStrategy(key: string | null | undefined): StrategyFn {
  const resolved = key ?? "manual_only";
  const fn = STRATEGY_REGISTRY.get(resolved);
  if (fn) return fn;
  const fallback = STRATEGY_REGISTRY.get("manual_only");
  if (!fallback) {
    throw new Error(
      `[strategy-registry] manual_only fallback not registered — strategy "${resolved}" requested`,
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
