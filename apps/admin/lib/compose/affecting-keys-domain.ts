/**
 * COMPOSE-affecting Domain fields — #828 (Story 4 of EPIC #832).
 *
 * Top-level fields on the `Domain` row that flow into prompt composition
 * (read by `transforms/pedagogy.ts` + `transforms/targets.ts` via the
 * domain join in SectionDataLoader). A write that changes any of these
 * MUST trigger a `Domain.composeInputsUpdatedAt` bump so the staleness
 * check (Story 1 #825) marks every caller in every playbook in this
 * domain stale.
 *
 * Domain blast radius is ALL playbooks-in-domain → all their callers.
 * Bigger than Playbook-scope writes (which are scoped to one playbook).
 *
 * Keys NOT in this list (e.g. `name`, `description`, `slug`, `isActive`,
 * `lessonPlanDefaults`, `config`, `institutionId`) don't affect the
 * composed prompt — they're metadata, runtime cascades for new course
 * creation, or community-domain config.
 */
export const COMPOSE_AFFECTING_DOMAIN_FIELDS = [
  // Read by transforms/pedagogy.ts::deriveSessionOverridePhases at
  // Layer 2 fallback (when Playbook.config.onboardingFlowPhases is unset)
  "onboardingFlowPhases",
  // Read by transforms/targets.ts::mergeAndGroupTargets at cascade
  // priority 2 (between Playbook.firstSessionTargets and INIT-001)
  "onboardingDefaultTargets",
  // Read by transforms/preamble.ts as the welcome greeting fallback
  "onboardingWelcome",
  // Read by transforms/identity.ts::resolveSpecs as the domain-level
  // identity overlay archetype
  "onboardingIdentitySpecId",
] as const;

export type ComposeAffectingDomainField =
  (typeof COMPOSE_AFFECTING_DOMAIN_FIELDS)[number];

/**
 * Returns true when any of the listed Domain fields differ between
 * `prev` and `next` by deep equality (JSON.stringify).
 */
export function composeAffectingDomainChanged(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const key of COMPOSE_AFFECTING_DOMAIN_FIELDS) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      return true;
    }
  }
  return false;
}
