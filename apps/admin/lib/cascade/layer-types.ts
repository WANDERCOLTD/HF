/**
 * Cascade-honesty display-layer types (Epic #1442 Layer 2 — see
 * `docs/decisions/2026-06-10-cascade-honesty-ux.md`).
 *
 * **Display-layer type only.** For DB writes that need a Prisma enum,
 * use `BehaviorTargetScope` from `@prisma/client` (values:
 * `SYSTEM | PLAYBOOK | SEGMENT | CALLER`). The two vocabularies overlap
 * but are structurally distinct — `Layer` is a 6-token UI string union
 * used by `resolveEffective` / `<LayerBadge>` / `<CascadeInspectorTray>` /
 * `<ScopePicker>` for chain provenance; `BehaviorTargetScope` is the
 * Prisma-generated enum used at the DB write boundary.
 */

/**
 * Ordered from outermost (least specific) to innermost (most specific).
 * The cascade resolves the innermost set value as the winner.
 *
 * - `SYSTEM`  — global default (SystemSetting, INIT-001 spec defaults)
 * - `DOMAIN`  — Domain-level override (e.g., Education vs Finance)
 * - `PLAYBOOK` — course-level override (Playbook.config.* or
 *   BehaviorTarget.scope=PLAYBOOK)
 * - `SEGMENT` — cohort-level override (reserved; not wired in Sprint 1)
 * - `CALLER`  — per-learner override (CallerIdentity-fanned BehaviorTarget
 *   rows; Caller.config.*)
 * - `CALL`    — per-call override (reserved; not wired in Sprint 1)
 */
export type Layer =
  | "SYSTEM"
  | "DOMAIN"
  | "PLAYBOOK"
  | "SEGMENT"
  | "CALLER"
  | "CALL";

/**
 * Canonical SYSTEM→CALL ordering. Exported for resolvers that need to sort
 * raw layer hits before returning.
 */
export const LAYER_ORDER: readonly Layer[] = [
  "SYSTEM",
  "DOMAIN",
  "PLAYBOOK",
  "SEGMENT",
  "CALLER",
  "CALL",
] as const;

/**
 * One layer's contribution to a cascade lookup. A resolver returns an
 * array of these (only layers that have a value set) so the UI can render
 * the full chain in the inspector tray, identify the winner, and surface
 * provenance metadata.
 *
 * - `setAt`/`setBy` are best-effort. When the underlying DB row has no
 *   authorship metadata (e.g., `Playbook.config` blob has no
 *   `configUpdatedBy` column), resolvers MUST return `null` rather than
 *   inventing a value from the current session.
 */
export interface LayerHit<T = unknown> {
  layer: Layer;
  /** Null for SYSTEM-level hits (no row id). */
  scopeId: string | null;
  /** Human label rendered in the inspector tray (e.g., "OCEAN (Big Five)",
   *  "Education domain", "System default"). */
  scopeLabel: string;
  value: T;
  /** Null when the underlying row has no `updatedAt` (or none reachable). */
  setAt: Date | null;
  /** Null when the underlying row has no `setBy` userId column. The tray
   *  renders "Set by (unknown)" in that case. */
  setBy: string | null;
}

/**
 * Return shape of `resolveEffective` and every per-knob resolver. The UI
 * reads `value` for display and `layers` for the chain inspector.
 *
 * - `source` is the winning `Layer` (always present in `layers`).
 * - `isInherited` is true when `source` sits above the operator's current
 *   editing scope — the badge renders as e.g. `[DOM]` on a Playbook page
 *   to signal "inherited from above".
 * - `recommendedLayerForEdit` is the scope-picker default — usually the
 *   operator's current page scope (e.g., PLAYBOOK when viewing a course),
 *   never a deeper scope unless the operator explicitly opts in.
 */
export interface Effective<T> {
  value: T;
  source: Layer;
  layers: LayerHit<T>[];
  isInherited: boolean;
  recommendedLayerForEdit: Layer;
}
