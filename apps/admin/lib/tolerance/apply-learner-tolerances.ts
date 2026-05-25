/**
 * Per-learner tolerance write path (#598 Slice 1 — bucket 3 from the ADR).
 *
 * Bucket 3 is where the runtime adapts knobs for a single learner. v1 ships
 * only `firstCall` overrides; the function is structured so adding new keys
 * (e.g. `pace`, `confidence`) is a one-line allowlist change.
 *
 * Storage shape:
 *   CallerAttribute(
 *     callerId,
 *     key   = "firstCall",   // one of the keys in ALLOWED_KEYS
 *     scope = "TOLERANCE",   // dedicated scope so a normal CURRICULUM scan
 *                            //   never picks these up by accident
 *     valueType = "JSON",
 *     jsonValue = <payload>,
 *   )
 *
 * The `@@unique([callerId, key, scope])` constraint at
 * `prisma/schema.prisma:1186` makes upsert safe — only one row per
 * (callerId, key) under the TOLERANCE scope.
 *
 * Every successful write emits an audit log row with action
 * `AuditAction.TOLERANCE_WRITE` so a post-mortem on a misbehaving cohort can
 * trace which override was applied when.
 *
 * @see docs/decisions/2026-05-22-tolerance-placement.md
 */

import { prisma } from "@/lib/prisma";
import { auditLog, AuditAction } from "@/lib/audit";

export const TOLERANCE_SCOPE = "TOLERANCE" as const;

/** Allowlist — extend cautiously. Every new key needs a typed payload below. */
export const ALLOWED_TOLERANCE_KEYS = ["firstCall"] as const;

export type ToleranceKey = (typeof ALLOWED_TOLERANCE_KEYS)[number];

/** v1 payload for the `firstCall` key. */
export interface FirstCallTolerancePayload {
  durationMinsOverride?: number;
  introducePedagogy?: boolean;
}

export type TolerancePayload = FirstCallTolerancePayload;

export interface ApplyLearnerToleranceInput {
  callerId: string;
  key: ToleranceKey;
  value: TolerancePayload;
  actor?: { userId?: string; userEmail?: string };
}

/**
 * Upsert a per-learner tolerance row + audit it. Unknown keys throw — the
 * allowlist exists so new tolerance shapes get an explicit type check before
 * landing in `CallerAttribute(scope=TOLERANCE)`.
 */
export async function applyLearnerTolerance(
  input: ApplyLearnerToleranceInput,
): Promise<void> {
  if (!(ALLOWED_TOLERANCE_KEYS as readonly string[]).includes(input.key)) {
    throw new Error(
      `[tolerance] applyLearnerTolerance: unknown key "${input.key}". ` +
        `Allowed keys: ${ALLOWED_TOLERANCE_KEYS.join(", ")}.`,
    );
  }

  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: {
        callerId: input.callerId,
        key: input.key,
        scope: TOLERANCE_SCOPE,
      },
    },
    create: {
      callerId: input.callerId,
      key: input.key,
      scope: TOLERANCE_SCOPE,
      valueType: "JSON",
      jsonValue: input.value as unknown as object,
      confidence: 1.0,
    },
    update: {
      valueType: "JSON",
      jsonValue: input.value as unknown as object,
      confidence: 1.0,
    },
  });

  await auditLog({
    userId: input.actor?.userId,
    userEmail: input.actor?.userEmail,
    action: AuditAction.TOLERANCE_WRITE,
    entityType: "Caller",
    entityId: input.callerId,
    metadata: { key: input.key, value: input.value as unknown as Record<string, unknown> },
  });
}
