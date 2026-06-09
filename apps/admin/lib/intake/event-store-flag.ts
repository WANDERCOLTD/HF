// Event-store mode flag for epic #1338 Slice 2 (#1343).
//
// `HF_FLAG_INTAKE_EVENT_STORE` env var:
//   - `memory` (default, current behaviour) — in-memory `session-store.ts`
//     Map. Wipes on process restart. Suitable for dev/sandbox.
//   - `prisma` — durable `PrismaEventStore` (#1343). Suitable for staging
//     and prod once the contract test passes consistently.
//
// The flag default flips to `prisma` once Slice 2 ships clean and the
// smoke run on hf-dev confirms `runHashChainContract` passes against
// a populated DB. Until then both paths coexist behind this single env
// var; switching is one-line.
//
// Why two surfaces, not one: the in-memory store has nine months of
// vitest coverage + composes the audit-bundle through a known good
// shape. The Prisma path is new; we don't blast through the cutover.
// The hash-chain contract test guarantees byte-identical output from
// either store, so callers downstream of `appendEvent` don't care.

export type IntakeEventStoreMode = "memory" | "prisma";

const DEFAULT_MODE: IntakeEventStoreMode = "memory";

/**
 * Resolve the event-store mode from the environment. Pure read — safe
 * to call at module-init time. Unknown values log a warning and fall
 * back to the default rather than throwing, so a typo doesn't take
 * down the intake flow.
 */
export function resolveIntakeEventStoreMode(
  env: NodeJS.ProcessEnv = process.env,
): IntakeEventStoreMode {
  const raw = env.HF_FLAG_INTAKE_EVENT_STORE?.trim().toLowerCase();
  if (raw === undefined || raw === "") return DEFAULT_MODE;
  if (raw === "memory" || raw === "prisma") return raw;
  console.warn(
    `[intake] HF_FLAG_INTAKE_EVENT_STORE='${raw}' is not recognised; ` +
      `falling back to '${DEFAULT_MODE}'. Valid values: 'memory' | 'prisma'.`,
  );
  return DEFAULT_MODE;
}
