/**
 * Domain writer — #828 (Story 4 of EPIC #832).
 *
 * Central enforcement point for writes to compose-affecting Domain
 * fields. Every route / chat tool / lib that mutates
 * `Domain.onboardingFlowPhases`, `Domain.onboardingDefaultTargets`,
 * `Domain.onboardingWelcome`, or `Domain.onboardingIdentitySpecId`
 * MUST go through this helper. The ESLint rule
 * `hf-domain/no-direct-onboarding-write` blocks direct writes.
 *
 * Mechanism — stamp on write, lazy recompose on read (per
 * `docs/CHAIN-CONTRACTS.md` §3 Link 3 sub-contract):
 *
 *   1. findUnique current Domain row
 *   2. apply transformer to a deep clone
 *   3. diff against COMPOSE_AFFECTING_DOMAIN_FIELDS
 *   4. write new fields; if any compose-affecting field changed AND
 *      `skipTimestamp` is not set, ALSO bump
 *      `Domain.composeInputsUpdatedAt = NOW()`
 *
 * Blast radius: every caller in every playbook in this domain. The
 * staleness check at `lib/compose/staleness.ts::isPromptStale` reads
 * `Domain.composeInputsUpdatedAt` for the caller's domain, so this is
 * picked up automatically — no roster fan-out needed.
 *
 * skipTimestamp: true is for seed scripts / domain-create paths where
 * no callers exist yet.
 */

import { prisma } from "@/lib/prisma";
import type { Domain } from "@prisma/client";
import {
  composeAffectingDomainChanged,
  COMPOSE_AFFECTING_DOMAIN_FIELDS,
} from "@/lib/compose/affecting-keys-domain";

/** Subset of Domain that this helper is allowed to mutate. */
export type DomainUpdatable = Partial<Pick<
  Domain,
  | "onboardingFlowPhases"
  | "onboardingDefaultTargets"
  | "onboardingWelcome"
  | "onboardingIdentitySpecId"
>>;

export interface UpdateDomainConfigOptions {
  /** Skip the composeInputsUpdatedAt bump (seed/migration/pre-enrol paths). */
  skipTimestamp?: boolean;
  /** Diagnostic label for the bump log line. */
  reason?: string;
}

export interface UpdateDomainConfigResult {
  domain: Domain;
  composeAffectingChanged: boolean;
  timestampBumped: boolean;
}

export type DomainConfigTransformer = (
  current: DomainUpdatable,
) => DomainUpdatable;

export async function updateDomainConfig(
  domainId: string,
  transformer: DomainConfigTransformer,
  options: UpdateDomainConfigOptions = {},
): Promise<UpdateDomainConfigResult> {
  if (!domainId) {
    throw new Error("updateDomainConfig: domainId is required");
  }

  const current = await prisma.domain.findUnique({
    where: { id: domainId },
    select: {
      onboardingFlowPhases: true,
      onboardingDefaultTargets: true,
      onboardingWelcome: true,
      onboardingIdentitySpecId: true,
    },
  });
  if (!current) {
    throw new Error(`updateDomainConfig: domain ${domainId} not found`);
  }

  const currentFields = current as DomainUpdatable;
  const nextFields = transformer(
    JSON.parse(JSON.stringify(currentFields)) as DomainUpdatable,
  );

  const composeAffected = composeAffectingDomainChanged(
    currentFields as Record<string, unknown>,
    nextFields as Record<string, unknown>,
  );
  const shouldBumpTimestamp = composeAffected && !options.skipTimestamp;

  const domain = await prisma.domain.update({
    where: { id: domainId },
    data: {
      ...nextFields,
      ...(shouldBumpTimestamp && { composeInputsUpdatedAt: new Date() }),
    },
  });

  if (shouldBumpTimestamp) {
    console.log(
      `[updateDomainConfig] composeInputsUpdatedAt bumped for ${domainId}${options.reason ? ` (reason: ${options.reason})` : ""}`,
    );
  }

  return {
    domain,
    composeAffectingChanged: composeAffected,
    timestampBumped: shouldBumpTimestamp,
  };
}

export { COMPOSE_AFFECTING_DOMAIN_FIELDS };
