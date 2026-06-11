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
import type { Domain, Prisma } from "@prisma/client";
import {
  composeAffectingDomainChanged,
  COMPOSE_AFFECTING_DOMAIN_FIELDS,
} from "@/lib/compose/affecting-keys-domain";
import { invalidateAll } from "@/lib/cascade/effective-value";

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
  /**
   * Recompose fan-out scope for this write. See `update-playbook-config.ts`
   * for the full contract. AI tool executors MUST NOT pass `'all'`.
   */
  fanoutScope?: 'none' | 'caller' | 'all';
}

export interface UpdateDomainConfigResult {
  domain: Domain;
  composeAffectingChanged: boolean;
  timestampBumped: boolean;
  /** Echoes the requested fanout scope so callers can branch (default 'none'). */
  fanoutScope: 'none' | 'caller' | 'all';
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

  // Cast to satisfy Prisma's stricter `JsonValue` → `InputJsonValue` typing
  // on the JSON columns (`onboardingFlowPhases`, `onboardingDefaultTargets`).
  // The transformer-supplied values are already validated by upstream zod
  // schemas at the route level.
  const domain = await prisma.domain.update({
    where: { id: domainId },
    data: {
      ...nextFields,
      ...(shouldBumpTimestamp && { composeInputsUpdatedAt: new Date() }),
    } as Prisma.DomainUpdateInput,
  });

  if (shouldBumpTimestamp) {
    console.log(
      `[updateDomainConfig] composeInputsUpdatedAt bumped for ${domainId}${options.reason ? ` (reason: ${options.reason})` : ""}`,
    );
  }

  // #1454 Slice 2 — drop every cascade-cache entry so the next
  // `resolveEffective` re-reads fresh. See `update-playbook-config.ts`
  // for the same wiring rationale.
  invalidateAll();

  return {
    domain,
    composeAffectingChanged: composeAffected,
    timestampBumped: shouldBumpTimestamp,
    fanoutScope: options.fanoutScope ?? 'none',
  };
}

export { COMPOSE_AFFECTING_DOMAIN_FIELDS };
