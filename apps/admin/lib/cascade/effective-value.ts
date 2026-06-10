/**
 * Cascade-honesty primitive (Epic #1442 Layer 2 — see
 * `docs/decisions/2026-06-10-cascade-honesty-ux.md`).
 *
 * `resolveEffective` is the single read entry-point for the cascade UX —
 * `<LayerBadge>`, `<CascadeInspectorTray>`, and `GET /api/cascade/resolve`
 * all route through here. It dispatches by knob key to the correct
 * per-family resolver, all of which WRAP existing cascade helpers
 * (`getEffectiveBehaviorTargetsForCaller`, `resolveSessionFlow`,
 * `voice-explain`, etc.) rather than duplicating their layer reads.
 *
 * Why no `hf-cascade/no-bare-resolve` ESLint rule: composition transforms
 * call the underlying helpers directly at >20 sites today and that is
 * legitimate — they want the winner, not the chain. A blanket rule would
 * generate false positives. The audience for `resolveEffective` is UI +
 * the cascade-resolve API route only.
 *
 * Per-page-load cache: a 30s TTL Map keyed on `(knobKey, scopeChain)`.
 * Mirrors the staleness pattern at `lib/compose/staleness.ts`. Invalidates
 * on any `setKnobAtLayer` call for the same `knobKey` so an operator who
 * writes an override sees the new effective value on the next read,
 * unaffected by the otherwise-30s window.
 */

import type { Effective, Layer } from "./layer-types";
import { resolveBehaviorTarget } from "./resolvers/behavior-target";
import { resolveSessionFlowKnob } from "./resolvers/session-flow";
import { resolveWelcomeMessage } from "./resolvers/welcome-message";
import { resolveVoiceConfigKnob } from "./resolvers/voice-config";
import { resolveIdentitySpec } from "./resolvers/identity-spec";

/**
 * Scope IDs the cascade can resolve against. SYSTEM is implicit (no id);
 * other layers require the id when present in the chain. Resolvers pick
 * the fields they need; missing-but-required fields produce a thrown
 * `Error` (cascade can't resolve without them) — callers (route handler,
 * components) decide whether to 400 or render a placeholder.
 */
export interface ScopeChain {
  domainId?: string;
  playbookId?: string;
  segmentId?: string;
  callerId?: string;
  callId?: string;
}

export interface ResolveArgs {
  knobKey: string;
  scopeChain: ScopeChain;
}

type AnyResolver = (scope: ScopeChain, knobKey: string) => Promise<Effective<unknown>>;

interface KnobFamily {
  /** Brief diagnostic name surfaced in error messages and cache stats. */
  name: string;
  match: (knobKey: string) => boolean;
  resolve: AnyResolver;
}

/**
 * Knob → resolver dispatch table. Each entry is `{ match, resolve }`.
 * First match wins — order matters when patterns could overlap (none do
 * today; behavior-target's `BEH-*` prefix and the explicit knob lists
 * below are disjoint).
 *
 * Adding a new cascade family: implement the resolver under
 * `lib/cascade/resolvers/`, then add one entry here. No ESLint rule
 * change required.
 */
const FAMILIES: readonly KnobFamily[] = [
  {
    name: "behavior-target",
    match: (k) => k.startsWith("BEH-"),
    resolve: (scope, knobKey) => resolveBehaviorTarget(scope, knobKey),
  },
  {
    name: "welcome-message",
    match: (k) => k === "welcomeMessage",
    resolve: (scope) => resolveWelcomeMessage(scope),
  },
  {
    name: "session-flow",
    match: (k) =>
      k === "onboarding" || k === "intake" || k === "stops" || k === "offboarding",
    resolve: (scope, knobKey) => resolveSessionFlowKnob(scope, knobKey),
  },
  {
    name: "voice-config",
    match: (k) =>
      k === "voiceProvider" ||
      k === "voiceId" ||
      k === "model" ||
      k === "modelTemp" ||
      k === "modelTopP" ||
      k === "language",
    resolve: (scope, knobKey) => resolveVoiceConfigKnob(scope, knobKey),
  },
  {
    name: "identity-spec",
    match: (k) => k === "identitySpecId",
    resolve: (scope) => resolveIdentitySpec(scope),
  },
];

function pickResolver(knobKey: string): AnyResolver {
  for (const fam of FAMILIES) {
    if (fam.match(knobKey)) return fam.resolve;
  }
  throw new Error(
    `Unknown cascade knob key: "${knobKey}". Known families: ${FAMILIES.map(
      (f) => f.name,
    ).join(", ")}`,
  );
}

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: Effective<unknown>;
  expiresAt: number;
}

/** Module-level cache — per-page-load on the client, per-process on the
 *  server. The 30s TTL matches `lib/compose/staleness.ts` so operators
 *  who write a config see the new effective value immediately (via
 *  invalidation) but in steady-state reads don't hit Prisma 20× per
 *  panel render. */
const cache = new Map<string, CacheEntry>();

function cacheKey(knobKey: string, scope: ScopeChain): string {
  // Stable JSON: object keys serialised in insertion order would be
  // fragile, so pull the well-known scope ids in fixed order.
  return [
    knobKey,
    scope.domainId ?? "",
    scope.playbookId ?? "",
    scope.segmentId ?? "",
    scope.callerId ?? "",
    scope.callId ?? "",
  ].join("|");
}

function cacheGet(knobKey: string, scope: ScopeChain): Effective<unknown> | null {
  const key = cacheKey(knobKey, scope);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(
  knobKey: string,
  scope: ScopeChain,
  value: Effective<unknown>,
): void {
  cache.set(cacheKey(knobKey, scope), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Drop every cache entry for the given `knobKey` (across all scope
 * chains). Called from `setKnobAtLayer` (Slice 2) after a successful
 * write so the next read returns the fresh winner.
 */
export function invalidateKnob(knobKey: string): void {
  const prefix = `${knobKey}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * Drop the entire cache. Used by tests and on rare cataclysmic events
 * (e.g., a system-setting blob rebuild) where every cached effective
 * value may have changed.
 */
export function invalidateAll(): void {
  cache.clear();
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Resolve the effective value of a cascade-eligible knob for the given
 * scope chain. Returns the winner + every contributing layer + provenance
 * metadata. Caches for 30s; cache invalidates on `invalidateKnob`.
 *
 * @example
 * const r = await resolveEffective<number>({
 *   knobKey: "BEH-WARMTH",
 *   scopeChain: { playbookId: "OCEAN-…", callerId: "smoke-test-…" },
 * });
 * // r.value === 0.6, r.source === "DOMAIN", r.layers === [{layer:"SYSTEM",...},{layer:"DOMAIN",...}]
 */
export async function resolveEffective<T>(
  args: ResolveArgs,
): Promise<Effective<T>> {
  const cached = cacheGet(args.knobKey, args.scopeChain);
  if (cached) return cached as Effective<T>;

  const resolve = pickResolver(args.knobKey);
  const result = (await resolve(args.scopeChain, args.knobKey)) as Effective<T>;
  cacheSet(args.knobKey, args.scopeChain, result);
  return result;
}

/** Pure helper exposed for the `<CascadeInspectorTray>` component when it
 *  already has an `Effective<T>` envelope in hand and just needs the
 *  "is this scope a winner?" check for CTA label flipping. */
export function isLayerHit(envelope: Effective<unknown>, layer: Layer): boolean {
  return envelope.layers.some((h) => h.layer === layer);
}
