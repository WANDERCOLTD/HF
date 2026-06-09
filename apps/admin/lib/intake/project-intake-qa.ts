// Project an intake-chat snapshot into CallerAttribute rows.
//
// Epic #1338 Slice 2 (#1343). The cross-surface win: after the learner
// commits an intake-chat session, surface the captured Q&A on the Tune
// tab via the existing `SurveySection` reader, which already iterates
// `CallerAttribute(scope='INTAKE_CHAT')` rows.
//
// Each captured field K yields up to TWO `CallerAttribute` rows for
// the caller:
//
//   - `q:<K>` = the field's English label (the AI's prompt for that
//     field). Pulled from the spec's `.label({ en: '...' })`. Falls
//     back to the bare field-key when no label is registered.
//   - `a:<K>` = the learner's response, coerced to a UTF-8 string.
//
// The TWO-key shape mirrors `SurveySection`'s render: Q on the left,
// A on the right. Single source of truth — the labels live on the
// spec, the answers come from `session.values`.
//
// Internal fields (`processesArt9`, `classroomToken`, etc.) are
// excluded — they're system-set, not learner-answered, and have no
// meaningful Q for a Q-and-A display.
//
// Idempotent — uses `upsert` keyed on `(callerId, key, scope)`. Safe
// to re-run when the learner edits and re-commits (Phase 2 feature).

import type { Prisma } from "@prisma/client";
import { EnrollmentIntake, INTERNAL_FIELDS } from "./specs/enrollment.intent";

/**
 * Tx-aware Prisma client. Accept either the top-level client or a
 * transaction so callers can fold this into an existing `$transaction`.
 */
type CallerAttributeWriter = {
  readonly callerAttribute: Prisma.CallerAttributeDelegate;
};

export interface IntakeQAProjection {
  readonly key: string;
  readonly scope: "INTAKE_CHAT";
  readonly stringValue: string;
}

/**
 * Build the list of CallerAttribute rows to write (q:* + a:* pairs).
 * Pure function — callers test this in isolation, then the writer
 * call is a simple loop.
 */
export function buildIntakeQAProjections(
  values: Readonly<Record<string, unknown>>,
): readonly IntakeQAProjection[] {
  const internal = new Set<string>(INTERNAL_FIELDS);
  const rows: IntakeQAProjection[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (internal.has(key)) continue;
    const answer = coerceToString(value);
    if (answer === null) continue; // null / undefined / empty string — skip
    rows.push({
      key: `q:${key}`,
      scope: "INTAKE_CHAT",
      stringValue: labelFor(key),
    });
    rows.push({
      key: `a:${key}`,
      scope: "INTAKE_CHAT",
      stringValue: answer,
    });
  }
  return rows;
}

/**
 * Write the projections to the DB. Idempotent — upserts on the
 * canonical `(callerId, key, scope)` unique index.
 *
 * `sourceSpecSlug` is hard-coded to `EnrollmentIntake` because that's
 * the only intake spec in scope today; widen when the spec set grows.
 */
export async function writeIntakeQAProjections(
  prisma: CallerAttributeWriter,
  callerId: string,
  values: Readonly<Record<string, unknown>>,
): Promise<number> {
  const projections = buildIntakeQAProjections(values);
  for (const row of projections) {
    await prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: row.key, scope: row.scope } },
      create: {
        callerId,
        key: row.key,
        scope: row.scope,
        valueType: "STRING",
        stringValue: row.stringValue,
        sourceSpecSlug: "EnrollmentIntake",
      },
      update: {
        stringValue: row.stringValue,
        valueType: "STRING",
      },
    });
  }
  return projections.length;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Look up the human-readable label registered on the spec field.
 * Falls back to the bare key when the spec has no label registered
 * (e.g. fields added without a `.label({...})` call).
 */
function labelFor(fieldKey: string): string {
  const fields = EnrollmentIntake.fields as Readonly<Record<string, unknown>>;
  const spec = fields[fieldKey];
  if (spec === undefined || spec === null) return fieldKey;
  // FieldSpec exposes its label via `.metadata.label.en` on the built
  // form. The shape on disk is a `FieldSpec<T>` — internal Tallyseal
  // detail — so the read is best-effort and never throws.
  const metadata =
    typeof spec === "object" && spec !== null && "metadata" in spec
      ? (spec as { readonly metadata?: { readonly label?: { readonly en?: string } } }).metadata
      : undefined;
  const labelEn = metadata?.label?.en;
  return typeof labelEn === "string" && labelEn.length > 0 ? labelEn : fieldKey;
}

/**
 * Coerce an arbitrary `values[k]` to a non-empty string. Returns null
 * (caller skips) for empty / nullish / un-serialisable shapes.
 */
function coerceToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  // Arrays / objects intentionally skipped from the Q&A row set — the
  // EnrollmentIntake fields don't currently use composite types. Add
  // bespoke serialisation here if a future spec introduces one.
  return null;
}
