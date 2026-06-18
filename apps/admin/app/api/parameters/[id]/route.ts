import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/parameters/:id
 * @visibility public
 * @scope parameters:read
 * @auth session
 * @tags parameters
 * @description Get a single parameter by UUID with tags and prompt slug links (React-Admin compatible)
 * @pathParam id string - Parameter UUID
 * @response 200 Parameter
 * @response 404 { error: "Parameter not found" }
 * @response 500 { error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;
    const parameter = await prisma.parameter.findUnique({
      where: { id },
      include: {
        tags: {
          include: {
            tag: true
          }
        },
        promptSlugLinks: {
          include: {
            slug: {
              select: {
                id: true,
                slug: true,
                name: true,
                sourceType: true,
                isActive: true
              }
            }
          }
        }
      }
    });

    if (!parameter) {
      return NextResponse.json(
        { error: 'Parameter not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(parameter);
  } catch (error: any) {
    const { id } = await params;
    console.error(`GET /api/parameters/${id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch parameter' },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/parameters/:id
 * @visibility public
 * @scope parameters:write
 * @auth session
 * @tags parameters
 * @description Update a parameter's fields (React-Admin compatible). parameterId is immutable.
 *   #1947 — auth tier raised from OPERATOR to SUPERADMIN. The body accepts
 *   `definition`, `interpretationLow`, and `interpretationHigh` — HF-canonical
 *   pedagogical IP (per epic #1946 "Foundation = Spec, Storage = DB"). Tenant
 *   OPERATORs tune VALUES via the BehaviorTarget cascade; they do NOT mutate
 *   parameter SEMANTICS. Pre-#1947, an OPERATOR could overwrite the canonical
 *   spec's interpretation text.
 * @pathParam id string - Parameter UUID
 * @body name string - Display name
 * @body domainGroup string - Domain group
 * @body sectionId string - Section ID
 * @body scaleType string - Scale type
 * @body directionality string - Directionality
 * @body computedBy string - Computed by
 * @body definition string - Parameter definition (HF-canonical)
 * @body interpretationLow string - Low-score interpretation (HF-canonical)
 * @body interpretationHigh string - High-score interpretation (HF-canonical)
 * @response 200 Parameter
 * @response 403 { error: "..." } when caller is below SUPERADMIN
 * @response 500 { error: "..." }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // #1947 — SUPERADMIN required for canonical-spec writes. OPERATOR tier
    // still reads via GET; cohort tuning happens via BehaviorTarget cascade,
    // not by mutating the parameter row itself.
    const authResult = await requireAuth("SUPERADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;
    const body = await request.json();

    const parameter = await prisma.parameter.update({
      where: { id },
      data: {
        name: body.name || null,
        domainGroup: body.domainGroup || null,
        sectionId: body.sectionId || null,
        scaleType: body.scaleType || null,
        directionality: body.directionality || null,
        computedBy: body.computedBy || null,
        definition: body.definition || null,
        interpretationLow: body.interpretationLow || null,
        interpretationHigh: body.interpretationHigh || null,
        measurementMvp: body.measurementMvp || null,
        measurementVoiceOnly: body.measurementVoiceOnly || null,
        // parameterId is immutable, don't update it
        // Note: isMvpCore and isActive are managed via tags, not direct fields
      },
      include: {
        tags: {
          include: {
            tag: true
          }
        }
      }
    });

    return NextResponse.json(parameter);
  } catch (error: any) {
    const { id } = await params;
    console.error(`PUT /api/parameters/${id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to update parameter' },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/parameters/:id
 * @visibility public
 * @scope parameters:write
 * @auth session
 * @tags parameters
 * @description Delete a parameter permanently (React-Admin compatible).
 *   #1947 — auth tier raised from OPERATOR to SUPERADMIN. Deleting a
 *   canonical-spec parameter is a destructive IP action — only HF can.
 *   Tenant operators who want to retire a parameter should request
 *   deprecation via the canonical spec process.
 * @pathParam id string - Parameter UUID
 * @response 200 Parameter (the deleted record)
 * @response 403 { error: "..." } when caller is below SUPERADMIN
 * @response 500 { error: "..." }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // #1947 — SUPERADMIN required. Canonical spec deletions are an HF
    // action, not a tenant action.
    const authResult = await requireAuth("SUPERADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;
    const parameter = await prisma.parameter.delete({
      where: { id },
    });

    return NextResponse.json(parameter);
  } catch (error: any) {
    const { id } = await params;
    console.error(`DELETE /api/parameters/${id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete parameter' },
      { status: 500 }
    );
  }
}
