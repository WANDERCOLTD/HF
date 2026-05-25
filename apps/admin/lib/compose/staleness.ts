/**
 * Prompt-input staleness check — #825 (Story 1 of EPIC #832).
 *
 * Decides whether a cached `ComposedPrompt` row is still valid by comparing
 * its `composedAt` against the latest write timestamp on every scope row
 * that flows into composition:
 *
 *   - Playbook.composeInputsUpdatedAt   (course-scope)
 *   - Caller.composeInputsUpdatedAt     (caller-scope)
 *   - Domain.composeInputsUpdatedAt     (domain-scope)
 *   - SystemSetting key "compose_inputs_updated_at" (system-scope)
 *
 * Null timestamps are treated as **epoch (1970-01-01)**, NOT as always-stale.
 * Until Stories 2–8 land their writer migrations, all four scope timestamps
 * are null → epoch → less than any real `composedAt` → not stale → cached
 * prompt is served instead of recomposed. Output is byte-identical because
 * composition is deterministic (same inputs → same prompt text).
 *
 * ## Race-window — intentional, do NOT lock-fix
 *
 * There is a small window where a write that commits BETWEEN
 * `isPromptStale` reading upstream timestamps and `persistComposedPrompt`
 * writing the new `composedAt` is silently missed for ONE compose cycle:
 *
 *   T0  read playbook.composeInputsUpdatedAt = 2026-05-25T10:00:00Z
 *   T1  read composedPrompt.composedAt        = 2026-05-25T09:59:00Z  → stale
 *   T2  compose runs…
 *   T3  EDUCATOR saves a setting             → bumps timestamp to 10:00:30Z
 *   T4  persistComposedPrompt sets composedAt = 2026-05-25T10:01:00Z
 *
 * Next compose check sees `10:00:30 > 10:01:00 = false` → cached prompt
 * served, which contains T0 inputs but NOT the T3 save.
 *
 * **Why accepted:**
 *   - Self-heals on the very next save (any later T > the cached composedAt
 *     forces a recompose)
 *   - Requires a save during the ~500ms compose window for the same caller
 *     — vanishingly rare in practice
 *   - Worst-case latency is "next-call-but-one"
 *
 * **Alternative fixes** (distributed locks, advisory locks, serialised
 * compose) all introduce queue-up-on-save problems that are objectively
 * worse than the trade-off. See `docs/CHAIN-CONTRACTS.md` §3 Link 3
 * sub-contract for full rationale.
 *
 * Future engineer reading this: do NOT add row-level locks. Do NOT
 * serialise compose. If you need stronger guarantees, surface the
 * staleness in the UI (Story 7's <StalePromptPill /> already does this).
 */

import { prisma } from "@/lib/prisma";

/**
 * Single epoch instance reused across calls (no allocation per check).
 * `new Date(0)` is 1970-01-01T00:00:00.000Z.
 */
const EPOCH = new Date(0);

/**
 * SystemSetting key holding the global "compose-inputs-updated" timestamp
 * (bumped by SYSTEM-scope AnalysisSpec writes — e.g. INIT-001 mutation).
 * Value stored as ISO 8601 string.
 */
export const SYSTEM_COMPOSE_TIMESTAMP_KEY = "compose_inputs_updated_at";

export interface StalenessInputs {
  /** `ComposedPrompt.composedAt` for the cached row, or null if no cached row exists. */
  composedAt: Date | null;
  /** Playbook id for the cached prompt. */
  playbookId: string;
  /** Caller id for the cached prompt. */
  callerId: string;
  /**
   * Domain id resolved from the caller. Optional — if omitted, the domain
   * scope is treated as epoch (never-stale on the domain axis).
   */
  domainId?: string | null;
}

/**
 * Returns true when the cached prompt is stale (must recompose), false when
 * it is fresh (can be served from cache).
 *
 *   - Returns **true** if `composedAt` is null — no cached prompt exists,
 *     so we must compose. First-enrollment / first-call path.
 *   - Returns **true** if MAX(upstream timestamps) > `composedAt`.
 *   - Returns **false** otherwise. All null upstreams → epoch → not stale
 *     (preserves byte-identical OUTPUT before Stories 2–8 land — see file
 *     header).
 */
export async function isPromptStale(inputs: StalenessInputs): Promise<boolean> {
  if (inputs.composedAt == null) {
    return true;
  }

  const [playbook, caller, domain, systemSettingRow] = await Promise.all([
    prisma.playbook.findUnique({
      where: { id: inputs.playbookId },
      select: { composeInputsUpdatedAt: true },
    }),
    prisma.caller.findUnique({
      where: { id: inputs.callerId },
      select: { composeInputsUpdatedAt: true },
    }),
    inputs.domainId
      ? prisma.domain.findUnique({
          where: { id: inputs.domainId },
          select: { composeInputsUpdatedAt: true },
        })
      : Promise.resolve(null),
    prisma.systemSetting.findUnique({
      where: { key: SYSTEM_COMPOSE_TIMESTAMP_KEY },
      select: { value: true },
    }),
  ]);

  const systemTimestamp = parseSystemSettingTimestamp(systemSettingRow?.value);

  const upstreams: Date[] = [
    playbook?.composeInputsUpdatedAt ?? EPOCH,
    caller?.composeInputsUpdatedAt ?? EPOCH,
    domain?.composeInputsUpdatedAt ?? EPOCH,
    systemTimestamp,
  ];

  const latestUpstream = upstreams.reduce(
    (acc, t) => (t.getTime() > acc.getTime() ? t : acc),
    EPOCH,
  );

  return latestUpstream.getTime() > inputs.composedAt.getTime();
}

/**
 * Parse the SystemSetting JSON value into a Date. Handles:
 *   - undefined / null → epoch
 *   - ISO 8601 string → Date
 *   - JsonValue wrapping a string → string → Date
 *   - any malformed shape → epoch (fail-safe: treat as not-yet-set)
 */
function parseSystemSettingTimestamp(value: unknown): Date {
  if (value == null) return EPOCH;
  // SystemSetting.value is Prisma's `Json` type. The convention for this
  // key (set by Story 5) is to store an ISO 8601 string. Handle the
  // common shapes defensively.
  const raw = typeof value === "string" ? value : String(value);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return EPOCH;
  return parsed;
}
