/**
 * Barrel export — `lib/compose/` public surface.
 *
 * Importers should pull `ComposeSection` / `ComposeSectionKey` /
 * `PIPELINE_STATE_SECTION_LOADERS` from here, not from `./section` directly,
 * so that the three affecting-keys + section maps stay reachable from a
 * single import.
 */

// Section taxonomy (#1556)
export type { ComposeSection, ComposeSectionKey } from "./section";
export {
  COMPOSE_SECTION_KEYS,
  PIPELINE_STATE_SECTION_LOADERS,
} from "./section";

// Playbook config — compose-affecting keys + section attribution
export {
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS,
  COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEY_SECTIONS,
  composeAffectingChanged,
} from "./affecting-keys";
export type { ComposeAffectingPlaybookConfigKey } from "./affecting-keys";

// Domain — compose-affecting fields + section attribution
export {
  COMPOSE_AFFECTING_DOMAIN_FIELDS,
  COMPOSE_AFFECTING_DOMAIN_FIELD_SECTIONS,
  composeAffectingDomainChanged,
} from "./affecting-keys-domain";
export type { ComposeAffectingDomainField } from "./affecting-keys-domain";

// AnalysisSpec — compose-affecting fields + section attribution
export {
  COMPOSE_AFFECTING_SPEC_FIELDS,
  COMPOSE_AFFECTING_SPEC_FIELD_SECTIONS,
  composeAffectingSpecChanged,
} from "./affecting-keys-spec";
export type { ComposeAffectingSpecField } from "./affecting-keys-spec";
