/**
 * Section-staleness bridge — Phase 2B of epic #1675 (story #1687).
 *
 * Source-of-truth helpers deriving the setting ↔ ComposeSectionKey map
 * from the Phase 0 registry. The journey-setting PATCH route uses these
 * to know which sections to `bumpSectionHash` after a write.
 *
 * Tech Lead Q2 (2026-06-15) rules: the registry is the single source
 * of truth for the config-key → compose-section relation. Before this
 * file landed, the relation was implicit in callers passing `inputs`
 * to `bumpSectionHash` — every call site duplicated knowledge that the
 * registry now codifies in `composeImpact.sections`.
 *
 * Phase 4 follow-up: Inspector renderers will use
 * `getSettingsForSection(sectionKey)` to populate a section panel from
 * the section's clicked bubble.
 */

import type { ComposeSectionKey } from "@/lib/compose";

import type { JourneySettingContract } from "./setting-contracts";
import {
  JOURNEY_SETTINGS,
  JOURNEY_SETTINGS_BY_ID,
} from "./setting-contracts.entries";
import { VOICE_SETTINGS, VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";

/** Which ComposeSectionKeys does this setting feed? Returns [] for
 *  runtime / scheduling / post-call settings whose composeImpact.sections
 *  is empty. */
export function getSectionsForSetting(
  settingId: string,
): readonly ComposeSectionKey[] {
  const contract =
    JOURNEY_SETTINGS_BY_ID[settingId] ?? VOICE_SETTINGS_BY_ID[settingId];
  return contract?.composeImpact.sections ?? [];
}

/** Which settings feed this ComposeSectionKey? Includes voice entries
 *  that also write to a compose section (e.g. interruptSensitivity →
 *  `personality`). */
export function getSettingsForSection(
  sectionKey: ComposeSectionKey,
): readonly JourneySettingContract[] {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  return all.filter((s) => s.composeImpact.sections.includes(sectionKey));
}

/** Returns true when the setting affects ANY compose section. */
export function isComposeAffecting(settingId: string): boolean {
  return getSectionsForSetting(settingId).length > 0;
}

/** Returns true when the setting affects an AI-touching section that
 *  needs `requiresReprompt`. The PATCH route uses this to decide
 *  whether to emit a "live diff" or "save & reprompt" response hint. */
export function requiresReprompt(settingId: string): boolean {
  const contract =
    JOURNEY_SETTINGS_BY_ID[settingId] ?? VOICE_SETTINGS_BY_ID[settingId];
  return contract?.composeImpact.requiresReprompt === true;
}
