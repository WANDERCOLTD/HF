/**
 * isGatedBy — Phase 0 of the Journey-Design tab refactor.
 *
 * Returns the parent setting id (+ educator label) that gates this
 * setting to "off", or null if not gated.
 *
 * Two sources of gating, checked in priority order:
 *   1. Explicit `setting.gatedBy = { parentId, inactiveValues }` —
 *      the canonical form for cases where the gating relationship is
 *      a UX concept rather than a server-side coupling.
 *   2. Derived from sibling-writer `autoEnableLinks` — when ANOTHER
 *      contract in the registry has an autoEnableLink that forces
 *      THIS setting to its "off" value (e.g. `enforce: false` for a
 *      toggle, `enforce: ""` for a text field) when the parent has a
 *      specific value, we treat that as a gate.
 *
 * Returns `null` when neither source applies.
 *
 * Sibling to `.claude/rules/cascade-reuse.md` — both are read-side
 * disciplines for the Journey Inspector. Cascade-reuse handles layer
 * provenance; this handles parent-relevance gating.
 */

import type { PlaybookConfig } from "../types/json-fields";
import type { JourneySettingContract } from "./setting-contracts";

/** Helper return shape. `parentId` is the contract id; `parentLabel`
 *  is the educator-facing label of the parent (for chip text). */
export interface GatedByResult {
  parentId: string;
  parentLabel: string;
}

/**
 * Resolve `playbookConfig.<storagePath>` for the simple bare-string
 * path case used by gating-parent settings (all current gating parents
 * are top-level config booleans / strings, not array-addressed).
 *
 * Returns `undefined` if the path doesn't resolve. Structured
 * StoragePath (`{path, arrayKey, selectorValue}`) is NOT supported here
 * — gating parents in scope today are bare-string paths.
 */
function readByDotPath(config: PlaybookConfig, path: string): unknown {
  // Strip a leading "config." prefix when present — registry entries
  // use both `config.foo` (Playbook envelope) and `foo` (bare).
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

/**
 * Returns the parent setting that holds `setting` in its inactive
 * state, or `null` when not gated.
 *
 * @param setting     The contract whose gating we're checking.
 * @param playbookConfig The PlaybookConfig snapshot to read parent
 *                    values from.
 * @param registry    The full registry of contracts (used to resolve
 *                    parent ids → labels + storage paths). Pass the
 *                    union of `JOURNEY_SETTINGS` + `VOICE_SETTINGS`
 *                    when in doubt — the function only follows ids it
 *                    actually finds.
 */
export function isGatedBy(
  setting: JourneySettingContract,
  playbookConfig: PlaybookConfig,
  registry: readonly JourneySettingContract[],
): GatedByResult | null {
  // 1) Explicit `gatedBy` declaration — preferred.
  if (setting.gatedBy) {
    const parent = registry.find((c) => c.id === setting.gatedBy!.parentId);
    if (!parent) return null;
    const parentPath =
      typeof parent.storagePath === "string"
        ? parent.storagePath
        : parent.storagePath.path;
    const parentValue = readByDotPath(playbookConfig, parentPath);
    const isInactive = setting.gatedBy.inactiveValues.some(
      (v) => v === parentValue,
    );
    return isInactive
      ? { parentId: parent.id, parentLabel: parent.educatorLabel }
      : null;
  }

  // 2) Derive from sibling `autoEnableLinks` — when a peer in the
  // registry has an autoEnableLink that targets `setting.id` and
  // forces it into a "noop" / "off" value, we treat the peer as a
  // gating parent.
  //
  // Noop shapes we recognise:
  //   - `enforce === false` (toggles)
  //   - `enforce === ""` (text/select cleared)
  //   - `enforce === 0` (numeric zeroed)
  //   - `enforce === null` (any "cleared" sentinel)
  for (const peer of registry) {
    if (peer.id === setting.id) continue;
    if (!peer.autoEnableLinks) continue;
    for (const link of peer.autoEnableLinks) {
      if (link.targetId !== setting.id) continue;
      if (!isNoopEnforce(link.enforce)) continue;
      const peerPath =
        typeof peer.storagePath === "string"
          ? peer.storagePath
          : peer.storagePath.path;
      const peerValue = readByDotPath(playbookConfig, peerPath);
      if (peerValue === link.whenValue) {
        return { parentId: peer.id, parentLabel: peer.educatorLabel };
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
