/**
 * AI-to-DB / Operator-to-DB guard — LO ref shape (#1117).
 *
 * Sits at every LearningObjective write site (wizard projection, authored
 * sync, curriculum sync, direct module API). Rejects ref shapes that would
 * silently break per-LO mastery scoring downstream:
 *
 *   1. **Placeholder pattern `/^LO\d+$/`** — `validateLoScores` rejects these
 *      at the write boundary so no `lo_mastery:*` writes ever land. The
 *      qualification dashboard then sits at "Not yet assessed" forever.
 *      Reject at WRITE time so the operator gets a clear error instead of a
 *      silent zero-data symptom.
 *
 *   2. **Duplicates within a batch** — the readiness rollup dedupes by
 *      `loRef` across sibling Curricula, so cross-module ref collisions
 *      silently merge unrelated LOs.
 *
 * Applies equally to CERTIFIED Curricula (with `qualificationAnchor`) and
 * UNCERTIFIED Curricula (without). The guard only cares about ref shape +
 * uniqueness, not certification state. Real regulated refs (e.g. SIAS
 * "STD-04-01", IELTS "OUT-01", SIAS apprenticeship "R04-LO2-AC2.3") pass.
 *
 * See also:
 *   - `lib/curriculum/track-progress.ts::validateLoScores` — write-boundary
 *     guard for AI-returned LO refs (the LAST defence layer).
 *   - `app/api/playbooks/[playbookId]/publish/route.ts` rule 7 — publish-
 *     time gate; catches anything that slips through these write-site checks.
 */

const PLACEHOLDER = /^LO\d+$/;

export class InvalidLoRefError extends Error {
  readonly ref: string;
  readonly reason: string;
  constructor(ref: string, reason: string) {
    super(`Invalid LO ref "${ref}" — ${reason}`);
    this.name = "InvalidLoRefError";
    this.ref = ref;
    this.reason = reason;
  }
}

/**
 * Throw if a single ref is unfit for the DB. `moduleSlug` is optional; when
 * provided, the error message suggests the canonical fix (`{moduleSlug}-LO{n}`).
 */
export function assertValidLoRef(ref: unknown, moduleSlug?: string): void {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new InvalidLoRefError(
      String(ref ?? ""),
      "ref must be a non-empty string",
    );
  }
  if (PLACEHOLDER.test(ref)) {
    const suggestion = moduleSlug ? `"${moduleSlug}-${ref}"` : `"{moduleSlug}-${ref}"`;
    throw new InvalidLoRefError(
      ref,
      `matches placeholder pattern /^LO\\d+$/. The AI ignores these and per-LO mastery is silently dropped at the write boundary (#1117 validateLoScores). Use a module-scoped form like ${suggestion} instead.`,
    );
  }
}

/**
 * Throw if any ref in `refs` is unfit OR if the batch contains duplicates.
 * Batch-level uniqueness check is per-module (callers already scope the batch
 * to a single Module). Cross-module uniqueness within a Curriculum is enforced
 * at publish time (see publish/route.ts rule 7).
 */
export function assertValidLoRefBatch(
  refs: readonly unknown[],
  moduleSlug?: string,
): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    assertValidLoRef(ref, moduleSlug);
    const r = ref as string;
    if (seen.has(r)) {
      throw new InvalidLoRefError(
        r,
        `duplicate within this module's LO batch — refs must be unique within a Module (publish-time gate also enforces uniqueness across modules within a Curriculum).`,
      );
    }
    seen.add(r);
  }
}

/** Pure check (no throw) — for callers that want a fall-through instead. */
export function isValidLoRef(ref: unknown): boolean {
  return typeof ref === "string" && ref.length > 0 && !PLACEHOLDER.test(ref);
}
