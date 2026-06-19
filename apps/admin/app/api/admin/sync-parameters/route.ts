/**
 * POST /api/admin/sync-parameters
 *
 * Detect and fix missing parameters:
 * - Find all specs with triggers/actions that reference parameter IDs
 * - Check if those parameters exist in the Parameter table
 * - Create missing parameters from spec definitions
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFileSync } from "fs";
import { join } from "path";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveParameterIds } from "@/lib/registry/resolve";
import { resolveCanonicalDomainGroup } from "@/lib/registry/canonical-domain-group";

/**
 * @api POST /api/admin/sync-parameters
 * @visibility internal
 * @auth session
 * @tags admin, parameters
 * @description Detect and create missing parameters referenced by spec triggers/actions
 * @body dryRun boolean - If true, only report without making changes (default: false)
 * @response 200 { ok: true, specsScanned: number, parametersReferenced: number, parametersExist: number, parametersMissing: number, parametersCreated: number, errors: string[], missingParameters: Array }
 * @response 500 { ok: false, error: string }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { dryRun = false } = await req.json();

    const results = {
      specsScanned: 0,
      parametersReferenced: 0,
      parametersExist: 0,
      parametersMissing: 0,
      parametersCreated: 0,
      errors: [] as string[],
      missingParameters: [] as Array<{
        parameterId: string;
        specSlug: string;
        specName: string;
      }>,
    };

    // 1. Find all active specs with triggers/actions
    const specs = await prisma.analysisSpec.findMany({
      where: { isActive: true },
      include: {
        triggers: {
          include: {
            actions: {
              select: {
                parameterId: true,
              },
            },
          },
        },
        sourceFeatureSet: {
          select: {
            featureId: true,
            parameters: true,
            rawSpec: true,
          },
        },
      },
    });

    results.specsScanned = specs.length;

    // 2. Extract all referenced parameter IDs
    const paramReferences = new Map<
      string,
      Array<{ specSlug: string; specName: string }>
    >();

    for (const spec of specs) {
      for (const trigger of spec.triggers) {
        for (const action of trigger.actions) {
          if (action.parameterId) {
            if (!paramReferences.has(action.parameterId)) {
              paramReferences.set(action.parameterId, []);
            }
            paramReferences
              .get(action.parameterId)!
              .push({ specSlug: spec.slug, specName: spec.name });
          }
        }
      }
    }

    results.parametersReferenced = paramReferences.size;

    // 3. Check which parameters exist
    const referencedIds = Array.from(paramReferences.keys());

    // #1950 — Resolve each referenced id through the alias map so a spec
    // written against a legacy snake_case id is recognised as already-existing
    // when the canonical row sits at the BEH-* form. Without this, the
    // route's "missing" logic would try to CREATE a duplicate Parameter row
    // (which then collides on the unique constraint of the legacy id stored
    // in `aliases[]`).
    const aliasResolved = await resolveParameterIds(referencedIds);
    const referencedCanonicalIds = referencedIds.map(
      (id) => aliasResolved.get(id)?.canonicalId ?? id,
    );

    const existingParams = await prisma.parameter.findMany({
      where: {
        parameterId: { in: referencedCanonicalIds },
      },
      select: { parameterId: true },
    });

    const existingCanonicalIds = new Set(existingParams.map((p) => p.parameterId));
    results.parametersExist = existingCanonicalIds.size;

    const missingIds = referencedIds.filter((id) => {
      const canonical = aliasResolved.get(id)?.canonicalId ?? id;
      return !existingCanonicalIds.has(canonical);
    });
    results.parametersMissing = missingIds.length;

    // Build list of missing parameters with context
    for (const missingId of missingIds) {
      const refs = paramReferences.get(missingId)!;
      for (const ref of refs) {
        results.missingParameters.push({
          parameterId: missingId,
          specSlug: ref.specSlug,
          specName: ref.specName,
        });
      }
    }

    // If dry run, stop here
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        ...results,
      });
    }

    // 4. Create missing parameters from spec definitions
    for (const missingId of missingIds) {
      const refs = paramReferences.get(missingId)!;
      const firstRef = refs[0];

      // Find the spec that defines this parameter
      const spec = specs.find((s) => s.slug === firstRef.specSlug);
      if (!spec?.sourceFeatureSet) {
        results.errors.push(
          `No source feature set for ${missingId} (spec: ${firstRef.specSlug})`
        );
        continue;
      }

      // Try to find parameter definition in sourceFeatureSet.parameters
      const compiledParams = (spec.sourceFeatureSet.parameters as any[]) || [];
      const paramDef = compiledParams.find(
        (p: any) => p.id === missingId || p.parameterId === missingId
      );

      // Also check rawSpec.parameters if available
      let rawParam: any = null;
      const rawSpec = spec.sourceFeatureSet.rawSpec as any;
      if (rawSpec?.parameters) {
        rawParam = rawSpec.parameters.find(
          (p: any) => p.id === missingId || p.parameterId === missingId
        );
      }

      const paramData = paramDef || rawParam;

      if (!paramData) {
        results.errors.push(
          `Parameter definition not found for ${missingId} in spec ${firstRef.specSlug}`
        );
        continue;
      }

      // #2030 — REFUSE silent off-taxonomy creates. The DB has no CHECK
      // constraint on Parameter.domainGroup; the taxonomy ratchet test
      // is the only gate. A row written here with an unknown group
      // would land cleanly and silently break the next CI run that
      // touches the registry. Better to error here than corrupt later.
      const canonicalGroup = resolveCanonicalDomainGroup(paramData);
      if (!canonicalGroup) {
        results.errors.push(
          `Refused to auto-create ${missingId} from spec ${firstRef.specSlug}: ` +
            `cannot resolve a canonical domainGroup (paramData.domainGroup=` +
            `${JSON.stringify(paramData.domainGroup)} paramData.section=` +
            `${JSON.stringify(paramData.section)}). ` +
            `Operator must add this parameter to ` +
            `\`docs-archive/bdd-specs/behavior-parameters.registry.json\` ` +
            `with a domainGroup from the canonical v1.0 taxonomy.`
        );
        continue;
      }

      try {
        // Create the parameter
        await prisma.parameter.create({
          data: {
            parameterId: missingId,
            name: paramData.name || missingId,
            definition: paramData.description || paramData.definition || null,
            sectionId: paramData.section || spec.domain || "imported",
            domainGroup: canonicalGroup,
            scaleType: "continuous",
            directionality: "bidirectional",
            computedBy: "pipeline",
            parameterType: paramData.parameterType || "BEHAVIOR",
            isAdjustable: paramData.isAdjustable ?? false,
            interpretationLow:
              paramData.interpretationScale?.[0]?.label || null,
            interpretationHigh:
              paramData.interpretationScale?.[
                paramData.interpretationScale.length - 1
              ]?.label || null,
            sourceFeatureSetId: spec.sourceFeatureSet?.featureId,
          },
        });

        results.parametersCreated++;
      } catch (error: any) {
        results.errors.push(
          `Failed to create ${missingId}: ${error.message}`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error: any) {
    console.error("[sync-parameters] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/admin/sync-parameters
 * @visibility internal
 * @auth session
 * @tags admin, parameters
 * @description Dry-run check for missing parameters - reports what would be fixed without making changes
 * @response 200 { ok: true, specsScanned: number, parametersReferenced: number, parametersExist: number, parametersMissing: number, missingParameters: Array }
 * @response 500 { ok: false, error: string }
 */
export async function GET(req: Request) {
  // Dry run check - just report what would be fixed
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const results = {
      specsScanned: 0,
      parametersReferenced: 0,
      parametersExist: 0,
      parametersMissing: 0,
      missingParameters: [] as Array<{
        parameterId: string;
        specSlug: string;
        specName: string;
      }>,
    };

    // Find all active specs with triggers/actions
    const specs = await prisma.analysisSpec.findMany({
      where: { isActive: true },
      include: {
        triggers: {
          include: {
            actions: {
              select: {
                parameterId: true,
              },
            },
          },
        },
      },
    });

    results.specsScanned = specs.length;

    // Extract all referenced parameter IDs
    const paramReferences = new Map<
      string,
      Array<{ specSlug: string; specName: string }>
    >();

    for (const spec of specs) {
      for (const trigger of spec.triggers) {
        for (const action of trigger.actions) {
          if (action.parameterId) {
            if (!paramReferences.has(action.parameterId)) {
              paramReferences.set(action.parameterId, []);
            }
            paramReferences
              .get(action.parameterId)!
              .push({ specSlug: spec.slug, specName: spec.name });
          }
        }
      }
    }

    results.parametersReferenced = paramReferences.size;

    // Check which parameters exist
    const referencedIds = Array.from(paramReferences.keys());
    const existingParams = await prisma.parameter.findMany({
      where: {
        parameterId: { in: referencedIds },
      },
      select: { parameterId: true },
    });

    const existingIds = new Set(existingParams.map((p) => p.parameterId));
    results.parametersExist = existingIds.size;

    const missingIds = referencedIds.filter((id) => !existingIds.has(id));
    results.parametersMissing = missingIds.length;

    // Build list of missing parameters with context
    for (const missingId of missingIds) {
      const refs = paramReferences.get(missingId)!;
      for (const ref of refs) {
        results.missingParameters.push({
          parameterId: missingId,
          specSlug: ref.specSlug,
          specName: ref.specName,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error: any) {
    console.error("[sync-parameters] GET Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
