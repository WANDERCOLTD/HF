import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updateAnalysisSpecConfig } from "@/lib/analysis-spec/update-analysis-spec-config";

/**
 * @api GET /api/specs/:specId
 * @visibility public
 * @scope specs:read
 * @auth session
 * @tags specs
 * @description Get a single spec by ID with triggers, actions, parameters, and prompt slug data
 * @pathParam specId string - Spec UUID
 * @response 200 { ok: true, spec: AnalysisSpec }
 * @response 404 { ok: false, error: "Spec not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;

    const spec = await prisma.analysisSpec.findUnique({
      where: { id: specId },
      include: {
        triggers: {
          include: {
            actions: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        promptSlug: {
          include: {
            parameters: {
              include: {
                parameter: {
                  select: {
                    parameterId: true,
                    name: true,
                    definition: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "Spec not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, spec });
  } catch (error: any) {
    console.error("[api/specs/[specId]] Error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch spec" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/specs/:specId
 * @visibility public
 * @scope specs:write
 * @auth session
 * @tags specs
 * @description Update a spec's metadata (name, description, isActive, isDirty, priority, config, promptTemplate)
 * @pathParam specId string - Spec UUID
 * @body name string - Updated display name
 * @body description string - Updated description
 * @body isActive boolean - Enable or disable spec
 * @body isDirty boolean - Mark spec as dirty
 * @body priority number - Spec priority
 * @body config object - Spec configuration
 * @body promptTemplate string - Prompt template text
 * @response 200 { ok: true, spec: AnalysisSpec }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;
    const body = await req.json();

    // #829 — central helper. Routes the bump by spec scope:
    //   SYSTEM → SystemSetting "compose_inputs_updated_at"
    //   DOMAIN → Domain.composeInputsUpdatedAt (helper warns + skips
    //           without domainId; this surface doesn't carry one yet)
    //   CALLER → no-op
    // allowLocked: legacy route currently has no lock check; preserve
    // existing behaviour rather than introducing a 423 on locked specs.
    const { spec } = await updateAnalysisSpecConfig(
      specId,
      (current) => ({
        ...current,
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.isDirty !== undefined && { isDirty: body.isDirty }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.promptTemplate !== undefined && {
          promptTemplate: body.promptTemplate,
        }),
      }),
      { allowLocked: true, reason: "PATCH /api/specs/[specId]" },
    );

    return NextResponse.json({ ok: true, spec });
  } catch (error: any) {
    console.error("[api/specs/[specId]] Update error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to update spec" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/specs/:specId
 * @visibility public
 * @scope specs:write
 * @auth session
 * @tags specs
 * @description Delete a spec permanently
 * @pathParam specId string - Spec UUID
 * @response 200 { ok: true }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ specId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { specId } = await params;

    await prisma.analysisSpec.delete({
      where: { id: specId },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[api/specs/[specId]] Delete error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to delete spec" },
      { status: 500 }
    );
  }
}
