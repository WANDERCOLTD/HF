import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSourceAuthority, hasSourceAuthority } from "@/lib/content-trust/validate-source-authority";
import { clearAIConfigCache } from "@/lib/ai/config-loader";
import { clearSystemSettingsCache } from "@/lib/system-settings";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updateAnalysisSpecConfig } from "@/lib/analysis-spec/update-analysis-spec-config";

export const runtime = "nodejs";

/**
 * @api GET /api/analysis-specs/:specId
 * @visibility internal
 * @scope analysis-specs:read
 * @auth session
 * @tags analysis-specs
 * @description Get a single analysis spec with full nested data including triggers, actions, parameters with scoring anchors, behavior targets, and linked BDDFeatureSet
 * @pathParam specId string - Spec UUID or slug
 * @response 200 { ok: true, spec: AnalysisSpec, featureSet: BDDFeatureSet|null }
 * @response 404 { ok: false, error: "Spec not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;

    const spec = await prisma.analysisSpec.findFirst({
      where: {
        OR: [{ id: specId }, { slug: specId }],
      },
      include: {
        triggers: {
          orderBy: { sortOrder: "asc" },
          include: {
            actions: {
              orderBy: { sortOrder: "asc" },
              include: {
                parameter: {
                  select: {
                    parameterId: true,
                    name: true,
                    definition: true,
                    scaleType: true,
                    interpretationHigh: true,
                    interpretationLow: true,
                    scoringAnchors: {
                      orderBy: [{ score: "asc" }, { sortOrder: "asc" }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Fetch the linked BDDFeatureSet if compiledSetId exists
    let featureSet = null;
    if (spec?.compiledSetId) {
      featureSet = await prisma.bDDFeatureSet.findUnique({
        where: { id: spec.compiledSetId },
        select: {
          id: true,
          featureId: true,
          name: true,
          description: true,
          version: true,
          specType: true,
          rawSpec: true,
          parameters: true,
          constraints: true,
          promptGuidance: true,
          scoringSpec: true,
          definitions: true,
          thresholds: true,
          parameterCount: true,
          constraintCount: true,
          definitionCount: true,
          isActive: true,
          activatedAt: true,
          validations: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }

    // Collect all parameter IDs from actions
    const parameterIds = new Set<string>();
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (action.parameterId) {
          parameterIds.add(action.parameterId);
        }
      }
    }

    // Fetch active behavior targets for these parameters
    const behaviorTargets = parameterIds.size > 0
      ? await prisma.behaviorTarget.findMany({
          where: {
            parameterId: { in: Array.from(parameterIds) },
            effectiveUntil: null, // Only active targets
          },
          orderBy: [{ parameterId: "asc" }, { scope: "asc" }],
          select: {
            id: true,
            parameterId: true,
            scope: true,
            targetValue: true,
            confidence: true,
            source: true,
            playbookId: true,
            playbook: {
              select: { id: true, name: true },
            },
          },
        })
      : [];

    // Group targets by parameterId for easy lookup
    const targetsByParameter = new Map<string, typeof behaviorTargets>();
    for (const target of behaviorTargets) {
      const existing = targetsByParameter.get(target.parameterId) || [];
      existing.push(target);
      targetsByParameter.set(target.parameterId, existing);
    }

    // Enhance spec with behavior targets on each action's parameter
    const enhancedSpec = {
      ...spec,
      triggers: spec.triggers.map((trigger) => ({
        ...trigger,
        actions: trigger.actions.map((action) => ({
          ...action,
          parameter: action.parameter
            ? {
                ...action.parameter,
                behaviorTargets: action.parameterId
                  ? targetsByParameter.get(action.parameterId) || []
                  : [],
              }
            : null,
        })),
      })),
    };

    return NextResponse.json({ ok: true, spec: enhancedSpec, featureSet });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch spec" },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/analysis-specs/:specId
 * @visibility internal
 * @scope analysis-specs:write
 * @auth session
 * @tags analysis-specs
 * @description Update an analysis spec's metadata. Respects lock status. Marks spec as dirty if content changes. Allows toggling isActive on locked specs.
 * @pathParam specId string - Spec UUID
 * @body name string - Updated name
 * @body description string - Updated description
 * @body outputType string - Updated output type
 * @body scope string - Updated scope
 * @body domain string - Updated domain
 * @body priority number - Updated priority
 * @body isActive boolean - Enable or disable spec
 * @body version string - Updated version
 * @body forceUnlock boolean - Override lock protection
 * @response 200 { ok: true, spec: AnalysisSpec, wasCompiled: boolean }
 * @response 404 { ok: false, error: "Spec not found" }
 * @response 423 { ok: false, error: "Spec is locked and cannot be modified", locked: true }
 * @response 500 { ok: false, error: "..." }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;
    const body = await req.json();
    const { name, description, outputType, scope, domain, priority, isActive, version, forceUnlock } = body;

    // Check if spec is locked
    const existing = await prisma.analysisSpec.findUnique({
      where: { id: specId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }

    // If locked and not just toggling isActive, block the edit
    if (existing.isLocked && !forceUnlock) {
      // Allow toggling isActive on locked specs (deactivating doesn't change the spec)
      if (isActive !== undefined && name === undefined && description === undefined && outputType === undefined && scope === undefined && domain === undefined && priority === undefined && version === undefined) {
        // Just toggling active status is OK
      } else {
        return NextResponse.json(
          {
            ok: false,
            error: "Spec is locked and cannot be modified",
            locked: true,
            lockedReason: existing.lockedReason,
            usageCount: existing.usageCount,
          },
          { status: 423 }
        );
      }
    }

    // Determine if this is a content change (marks spec as dirty)
    const isContentChange = name !== undefined || description !== undefined ||
                           outputType !== undefined || scope !== undefined ||
                           domain !== undefined || priority !== undefined || version !== undefined;

    // Check if spec was previously compiled (to warn user)
    const wasCompiled = existing.compiledAt !== null && !existing.isDirty;

    // If deactivating a SYSTEM spec, cascade to all PlaybookSystemSpec records
    // TODO: PlaybookSystemSpec model doesn't exist yet - cascade logic disabled
    const affectedPlaybooks: { id: string; name: string }[] = [];

    // #829 — central helper. Routes the timestamp bump by spec scope:
    //   SYSTEM → SystemSetting "compose_inputs_updated_at"
    //   DOMAIN → Domain.composeInputsUpdatedAt (requires domainId; not
    //           available on this surface today — helper warns + skips,
    //           cached prompts in the domain won't be marked stale by
    //           this write. UI will surface the staleness via Story 7
    //           pill once educator passes domainId here.)
    //   CALLER → no-op
    // allowLocked: we did our own narrower lock check above (isActive
    //   toggle is allowed on locked specs).
    const { spec } = await updateAnalysisSpecConfig(
      specId,
      (current) => ({
        ...current,
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(outputType !== undefined && { outputType }),
        ...(scope !== undefined && { scope }),
        ...(domain !== undefined && { domain }),
        ...(priority !== undefined && { priority }),
        ...(isActive !== undefined && { isActive }),
        ...(version !== undefined && { version }),
        ...(isContentChange && {
          isDirty: true,
          dirtyReason: "spec_metadata_modified",
        }),
      }),
      { allowLocked: true, reason: "PUT /api/analysis-specs/[specId]" },
    );

    // Invalidate caches so changes take effect immediately
    clearAIConfigCache();
    clearSystemSettingsCache();

    return NextResponse.json({
      ok: true,
      spec,
      wasCompiled,  // Let UI know if it should show a warning
      // Warn user about affected playbooks when deactivating
      ...(affectedPlaybooks.length > 0 && {
        affectedPlaybooks,
        cascadeWarning: `This spec has been disabled in ${affectedPlaybooks.length} playbook(s)`,
      }),
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update spec" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/analysis-specs/:specId
 * @visibility internal
 * @scope analysis-specs:write
 * @auth session
 * @tags analysis-specs
 * @description Partial update for promptTemplate, config, or specRole. Respects lock status. Marks spec as dirty.
 * @pathParam specId string - Spec UUID
 * @body promptTemplate string - Updated prompt template
 * @body config object - Updated config JSON
 * @body specRole string - Updated spec role
 * @response 200 { ok: true, spec: AnalysisSpec }
 * @response 404 { ok: false, error: "Spec not found" }
 * @response 423 { ok: false, error: "Spec is locked and cannot be modified", locked: true }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;
    const body = await req.json();
    const { promptTemplate, config, specRole, rawSpec } = body;

    // Check if spec exists and is not locked
    const existing = await prisma.analysisSpec.findUnique({
      where: { id: specId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }

    if (existing.isLocked) {
      return NextResponse.json(
        {
          ok: false,
          error: "Spec is locked and cannot be modified",
          locked: true,
          lockedReason: existing.lockedReason,
        },
        { status: 423 }
      );
    }

    // Validate sourceAuthority if config contains it
    let sourceValidation = null;
    if (config && hasSourceAuthority(config)) {
      sourceValidation = await validateSourceAuthority(config.sourceAuthority);
      if (!sourceValidation.valid) {
        return NextResponse.json(
          {
            ok: false,
            error: "Source authority validation failed",
            sourceErrors: sourceValidation.errors,
            sourceWarnings: sourceValidation.warnings,
          },
          { status: 422 }
        );
      }
      // Enrich config with DB-sourced metadata
      if (sourceValidation.enriched) {
        config.sourceAuthority = sourceValidation.enriched;
      }
    }

    // Determine what changed for dirty reason
    const changes: string[] = [];
    if (promptTemplate !== undefined) changes.push("prompt_template");
    if (config !== undefined) changes.push("config");
    if (specRole !== undefined) changes.push("spec_role");

    // #829 — central helper. Bumps SystemSetting / Domain / nothing per
    // spec scope (see PUT handler for full rationale).
    const { spec } = await updateAnalysisSpecConfig(
      specId,
      (current) => ({
        ...current,
        ...(promptTemplate !== undefined && { promptTemplate }),
        ...(config !== undefined && { config }),
        ...(specRole !== undefined && { specRole }),
        ...(changes.length > 0 && {
          isDirty: true,
          dirtyReason: changes.join("_") + "_modified",
        }),
      }),
      { reason: "PATCH /api/analysis-specs/[specId]" },
    );

    // Update linked BDDFeatureSet rawSpec if provided
    if (rawSpec !== undefined && existing.compiledSetId) {
      await prisma.bDDFeatureSet.update({
        where: { id: existing.compiledSetId },
        data: { rawSpec },
      });
      if (!changes.includes("config")) changes.push("raw_spec");
    }

    // Invalidate caches so changes take effect immediately
    clearAIConfigCache();
    clearSystemSettingsCache();

    return NextResponse.json({
      ok: true,
      spec,
      ...(sourceValidation?.warnings?.length && {
        sourceWarnings: sourceValidation.warnings,
      }),
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update spec" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/analysis-specs/:specId
 * @visibility internal
 * @scope analysis-specs:write
 * @auth session
 * @tags analysis-specs
 * @description Delete an analysis spec and all nested data (cascades triggers, actions, etc.)
 * @pathParam specId string - Spec UUID
 * @response 200 { ok: true, deleted: true }
 * @response 404 { ok: false, error: "Spec not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;

    await prisma.analysisSpec.delete({
      where: { id: specId },
    });

    // Invalidate caches so deletion takes effect immediately
    clearAIConfigCache();
    clearSystemSettingsCache();

    return NextResponse.json({ ok: true, deleted: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete spec" },
      { status: 500 }
    );
  }
}
