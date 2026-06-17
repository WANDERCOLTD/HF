/**
 * computeRelevanceState — Phase 0 of the Journey-Design tab refactor.
 *
 * Reads the contract + the current course-shape + cascade envelope
 * + PlaybookConfig and returns the relevance state the Inspector
 * should render the control in.
 *
 * Priority (highest first — `out-of-shape` shadows every other state):
 *
 *   1. out-of-shape   The contract's `appliesTo` excludes the
 *                     current course shape.
 *   2. gated-off      A parent setting holds this control to its
 *                     off-equivalent state (via explicit `gatedBy` or
 *                     a peer's noop `autoEnableLinks`).
 *   3. auto-derived   A peer's `autoEnableLinks` is currently FORCING
 *                     this control's value (parent value matches
 *                     `whenValue`, `decoupleAllowed` is true, and the
 *                     enforce value is not a noop — i.e. it's an
 *                     actual coupling, not a gate).
 *   4. inherited      The cascade envelope's effective value comes
 *                     from a layer other than the course (Domain or
 *                     System).
 *   5. active         Default — the control is editable here.
 *
 * Sibling to `<RelevanceWrapper>` (the render-side consumer of this
 * helper's output).
 */

import type { PlaybookConfig } from "../types/json-fields";
import { isGatedBy } from "./is-gated-by";
import type {
  CourseShape,
  JourneySettingContract,
} from "./setting-contracts";

export type RelevanceState =
  | "active"
  | "inherited"
  | "auto-derived"
  | "gated-off"
  | "out-of-shape";

/** Layer of the effective value — a thin mirror of the cascade
 *  `Layer` union for the inputs to this helper, kept independent so
 *  this lib doesn't import from `lib/cascade/` (cascade depends on
 *  setting contracts indirectly, not the other way around). */
export type EffectiveLayer = "system" | "domain" | "course" | "caller";

export interface ComputeRelevanceStateArgs {
  setting: JourneySettingContract;
  playbookConfig: PlaybookConfig;
  courseShape: CourseShape;
  /** The cascade-resolved effective value envelope. When the setting
   *  has no registered cascade family, callers should pass
   *  `{ layer: "course", value: <local-snapshot> }` so the helper's
   *  "inherited" branch never fires. */
  effectiveValue: { layer: EffectiveLayer; value: unknown };
  /** The full registry of contracts. Used by `isGatedBy` to resolve
   *  parent ids to labels + paths, and for auto-derive detection. */
  registry: readonly JourneySettingContract[];
}

export interface ComputeRelevanceStateResult {
  state: RelevanceState;
  /** Free-text rationale to surface in the overlay chip. */
  reason?: string;
  /** Gating / auto-derive parent id (when applicable). */
  parentId?: string;
  /** Educator-facing label of the parent (when applicable). */
  parentLabel?: string;
  /** Layer name for inherited state (e.g. "Domain"). */
  layerOrigin?: string;
}

/**
 * Resolve the relevance state in priority order. Stops at the first
 * match — never returns multiple states.
 */
export function computeRelevanceState(
  args: ComputeRelevanceStateArgs,
): ComputeRelevanceStateResult {
  const { setting, playbookConfig, courseShape, effectiveValue, registry } =
    args;

  // 1) out-of-shape — highest priority. When the contract declares
  // `appliesTo` and the current course shape isn't in the array, the
  // setting is irrelevant for this course. Educator should never edit
  // it (and downstream readers will ignore it).
  if (setting.appliesTo && !setting.appliesTo.includes(courseShape)) {
    return {
      state: "out-of-shape",
      reason: outOfShapeReason(setting.appliesTo, courseShape),
    };
  }

  // 2) gated-off — parent setting holds this control to its
  // off-equivalent state.
  const gate = isGatedBy(setting, playbookConfig, registry);
  if (gate) {
    return {
      state: "gated-off",
      parentId: gate.parentId,
      parentLabel: gate.parentLabel,
    };
  }

  // 3) auto-derived — a peer's autoEnableLink is currently FORCING
  // this control's value with a non-noop enforce. Operator may decouple
  // if the link declares `decoupleAllowed`.
  const autoLink = findActiveAutoEnable(setting, playbookConfig, registry);
  if (autoLink) {
    return {
      state: "auto-derived",
      reason: autoLink.reason,
      parentId: autoLink.parentId,
      parentLabel: autoLink.parentLabel,
    };
  }

  // 4) inherited — the cascade envelope's effective value resolves
  // from a layer other than the course.
  if (
    effectiveValue.layer === "domain" ||
    effectiveValue.layer === "system" ||
    effectiveValue.layer === "caller"
  ) {
    return {
      state: "inherited",
      layerOrigin: layerLabel(effectiveValue.layer),
    };
  }

  // 5) active — editable here.
  return { state: "active" };
}

function outOfShapeReason(
  appliesTo: readonly CourseShape[],
  current: CourseShape,
): string {
  // Friendly explanations per current shape. The educator clicked
  // into a control on a course shape that doesn't honour it.
  if (current === "continuous") {
    return "Continuous courses don't use modules";
  }
  if (current === "exam" && !appliesTo.includes("exam")) {
    return "Exam courses use a different setting for this";
  }
  if (current === "structured" && !appliesTo.includes("structured")) {
    return "Structured courses use a different setting for this";
  }
  const allowed = appliesTo.join(", ");
  return `Only applies to ${allowed} courses`;
}

function layerLabel(layer: EffectiveLayer): string {
  switch (layer) {
    case "system":
      return "System";
    case "domain":
      return "Domain";
    case "course":
      return "Course";
    case "caller":
      return "Caller";
  }
}

interface ActiveAutoEnable {
  parentId: string;
  parentLabel: string;
  reason: string;
}

function findActiveAutoEnable(
  setting: JourneySettingContract,
  playbookConfig: PlaybookConfig,
  registry: readonly JourneySettingContract[],
): ActiveAutoEnable | null {
  for (const peer of registry) {
    if (peer.id === setting.id) continue;
    if (!peer.autoEnableLinks) continue;
    for (const link of peer.autoEnableLinks) {
      if (link.targetId !== setting.id) continue;
      // Noop enforce values are handled by `isGatedBy` (gated-off
      // state). Auto-derive is the inverse: a real value forcing the
      // child to a non-default state.
      if (isNoopEnforce(link.enforce)) continue;
      const peerPath =
        typeof peer.storagePath === "string"
          ? peer.storagePath
          : peer.storagePath.path;
      const peerValue = readByDotPath(playbookConfig, peerPath);
      if (peerValue === link.whenValue) {
        return {
          parentId: peer.id,
          parentLabel: peer.educatorLabel,
          reason: link.reason,
        };
      }
    }
  }
  return null;
}

function isNoopEnforce(enforce: unknown): boolean {
  return (
    enforce === false ||
    enforce === "" ||
    enforce === 0 ||
    enforce === null
  );
}

function readByDotPath(config: PlaybookConfig, path: string): unknown {
  const trimmed = path.startsWith("config.") ? path.slice(7) : path;
  const parts = trimmed.split(".");
  let cur: unknown = config;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
