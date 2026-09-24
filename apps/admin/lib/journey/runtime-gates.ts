/**
 * runtime-gates — resolves the 3 runtime-gate JourneySettingContracts
 * that previously landed as producer-only (sub-epic G of #2049 / #2056).
 *
 * Each gate has a contract entry in `setting-contracts.entries.ts`,
 * an Inspector editor, and (post-#2056) a real runtime consumer:
 *
 *   - `agentTunerNlpEnabled` — gates the operator-facing AgentTuner UI
 *     mount on the Course Detail page (`<AgentTunerNlpGate>`).
 *   - `callCountPolicy` — `hard_cap | soft_cap | unlimited`; selects the
 *     enforcement behaviour at session-start in `createSession`.
 *   - `maxCallsPerDay` — numeric cap consulted by the policy above.
 *
 * The helpers are pure: `(PlaybookConfig | null | undefined) → resolved`.
 * Defaults preserve pre-#2056 behaviour byte-for-byte so playbooks that
 * have never touched these knobs are unaffected (`agentTunerNlpEnabled`
 * defaults to `false` because the panel is opt-in operator-only;
 * `callCountPolicy` defaults to `unlimited`; `maxCallsPerDay` is
 * treated as absent when unset, zero, or negative).
 *
 * @see lib/journey/setting-contracts.entries.ts — contract definitions
 * @see lib/journey/producer-only-registry.ts — removed entries on the
 *      same PR.
 * @see CHAIN-CONTRACTS.md — gates are runtime-effect, no compose impact.
 */

import type { PlaybookConfig } from "@/lib/types/json-fields";

export type CallCountPolicy = "hard_cap" | "soft_cap" | "unlimited";

/**
 * Resolves whether the AgentTuner NLP UI mounts. Defaults to `false`
 * (opt-in) so a freshly-seeded playbook does not surface the panel
 * until the operator explicitly enables it on the Inspector.
 */
export function isAgentTunerNlpEnabled(
  config: PlaybookConfig | null | undefined,
): boolean {
  return config?.agentTunerNlpEnabled === true;
}

/**
 * Resolves the call-counter policy. Defaults to `"unlimited"` so
 * existing playbooks remain rate-limit-free until they opt in.
 */
export function resolveCallCountPolicy(
  config: PlaybookConfig | null | undefined,
): CallCountPolicy {
  const raw = config?.callCountPolicy;
  if (raw === "hard_cap" || raw === "soft_cap" || raw === "unlimited") {
    return raw;
  }
  return "unlimited";
}

/**
 * Resolves the per-day session-count cap. Returns `null` (cap absent)
 * when the field is unset OR the value is non-positive. Callers
 * combine this with `resolveCallCountPolicy` to decide enforcement.
 */
export function getMaxCallsPerDay(
  config: PlaybookConfig | null | undefined,
): number | null {
  const raw = config?.maxCallsPerDay;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return Math.floor(raw);
}

/**
 * Decision shape returned by `evaluateCallRateLimit`. The caller acts
 * on `decision`:
 *   - `allow`: proceed without logging.
 *   - `allow-soft-cap-hit`: proceed but emit a soft-cap AppLog row.
 *   - `block-over-cap`: refuse the create; emit an over-cap AppLog row.
 */
export type CallRateLimitDecision =
  | { decision: "allow"; policy: CallCountPolicy; cap: number | null; usedToday: number }
  | { decision: "allow-soft-cap-hit"; policy: "soft_cap"; cap: number; usedToday: number }
  | { decision: "block-over-cap"; policy: "hard_cap"; cap: number; usedToday: number };

/**
 * Pure evaluator for the per-day session cap.
 *
 * - `unlimited` policy → always `allow` regardless of `usedToday`.
 * - cap absent (`null`) → always `allow` regardless of policy (no cap
 *   to enforce — degenerate config).
 * - `usedToday < cap` → `allow`.
 * - `usedToday >= cap` AND policy = `hard_cap` → `block-over-cap`.
 * - `usedToday >= cap` AND policy = `soft_cap` → `allow-soft-cap-hit`.
 */
export function evaluateCallRateLimit(args: {
  policy: CallCountPolicy;
  maxCallsPerDay: number | null;
  usedToday: number;
}): CallRateLimitDecision {
  const { policy, maxCallsPerDay, usedToday } = args;

  if (policy === "unlimited" || maxCallsPerDay === null) {
    return { decision: "allow", policy, cap: maxCallsPerDay, usedToday };
  }

  if (usedToday < maxCallsPerDay) {
    return { decision: "allow", policy, cap: maxCallsPerDay, usedToday };
  }

  if (policy === "hard_cap") {
    return {
      decision: "block-over-cap",
      policy: "hard_cap",
      cap: maxCallsPerDay,
      usedToday,
    };
  }

  // policy === "soft_cap" and usedToday >= cap.
  return {
    decision: "allow-soft-cap-hit",
    policy: "soft_cap",
    cap: maxCallsPerDay,
    usedToday,
  };
}

/**
 * Thrown by `createSession` when the per-day cap is reached and the
 * policy is `hard_cap`. Routes catch this and respond 429.
 */
export class CallRateLimitError extends Error {
  readonly code = "CALL_RATE_LIMIT_OVER_CAP" as const;
  readonly cap: number;
  readonly usedToday: number;
  readonly callerId: string;
  readonly playbookId: string | null;

  constructor(args: {
    callerId: string;
    playbookId: string | null;
    cap: number;
    usedToday: number;
  }) {
    super(
      `Caller ${args.callerId.slice(0, 8)} has reached the per-day session cap ` +
        `(${args.usedToday} of ${args.cap}) under hard_cap policy.`,
    );
    this.name = "CallRateLimitError";
    this.cap = args.cap;
    this.usedToday = args.usedToday;
    this.callerId = args.callerId;
    this.playbookId = args.playbookId;
  }
}
