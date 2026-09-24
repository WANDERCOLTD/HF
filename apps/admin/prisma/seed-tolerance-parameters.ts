/**
 * Tolerance Parameter Seed (#598 Slice 1)
 *
 * One-off parameter rows that the tolerance cascade FKs to but that do not
 * originate from a `.spec.json` (they are pure system knobs, not measurement
 * parameters). Idempotent — re-running `npm run db:seed` is a no-op when
 * rows already exist.
 *
 * Scope is intentionally narrow: only parameters that need a `Parameter` row
 * because a `BehaviorTarget` row will FK to `Parameter.parameterId`. Bucket-2
 * defaults (the contract registry, hardcoded fallback) do not need a row.
 *
 * @see docs/decisions/2026-05-22-tolerance-placement.md
 */

import { PrismaClient } from "@prisma/client";
import { resolveCanonicalDomainGroup } from "../lib/registry/canonical-domain-group";

interface ToleranceParameterSeed {
  parameterId: string;
  name: string;
  definition: string;
  sectionId: string;
  domainGroup: string;
  scaleType: string;
  directionality: string;
  computedBy: string;
}

const TOLERANCE_PARAMETERS: ToleranceParameterSeed[] = [
  {
    parameterId: "TOL-MASTERY-THRESHOLD",
    name: "Mastery Threshold (Tolerance)",
    definition:
      "Per-learner or per-playbook override for the learning-objective " +
      "mastery threshold used by the scheduler and module-completion guards. " +
      "Resolved via lib/tolerance/resolve-tolerance.ts (7-layer cascade).",
    sectionId: "tolerance",
    domainGroup: "tolerance",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "tolerance-cascade",
  },
];

export async function seedToleranceParameters(prisma: PrismaClient): Promise<{
  created: number;
  updated: number;
}> {
  let created = 0;
  let updated = 0;

  for (const param of TOLERANCE_PARAMETERS) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });

    // #2031 follow-on — route every Parameter.domainGroup write
    // through the canonical resolver. The hardcoded `"tolerance"` value
    // is OFF-canonical; per Group C in
    // docs/decisions/2026-06-19-parameter-domain-group-mapping.md
    // tolerance rows map to `curriculum-adaptation` (mastery threshold
    // is curriculum-sequencing config). The resolver provides
    // structural defence; canonical fallback matches the mapping.
    const canonicalDomainGroup =
      resolveCanonicalDomainGroup({ domainGroup: param.domainGroup }) ??
      "curriculum-adaptation";

    const data = {
      parameterId: param.parameterId,
      name: param.name,
      definition: param.definition,
      sectionId: param.sectionId,
      domainGroup: canonicalDomainGroup,
      scaleType: param.scaleType,
      directionality: param.directionality,
      computedBy: param.computedBy,
      parameterType: "BEHAVIOR" as const,
      isAdjustable: true,
    };

    if (existing) {
      await prisma.parameter.update({
        where: { parameterId: param.parameterId },
        data,
      });
      updated++;
    } else {
      await prisma.parameter.create({ data });
      created++;
    }
  }

  return { created, updated };
}
