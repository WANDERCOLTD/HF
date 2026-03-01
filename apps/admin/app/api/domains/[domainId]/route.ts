import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains/:domainId
 * @visibility public
 * @scope domains:read
 * @auth session
 * @tags domains
 * @description Get domain details with callers and playbooks
 * @pathParam domainId string - Domain UUID
 * @response 200 { ok: true, domain: Domain }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      include: {
        callers: {
          take: 50,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            externalId: true,
            createdAt: true,
            _count: {
              select: { calls: true },
            },
          },
        },
        playbooks: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            version: true,
            sortOrder: true,
            config: true,
            publishedAt: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: { items: true, enrollments: true },
            },
          },
        },
        subjects: {
          include: {
            subject: {
              include: {
                sources: {
                  include: {
                    source: {
                      select: {
                        id: true,
                        slug: true,
                        name: true,
                        trustLevel: true,
                        _count: { select: { assertions: true } },
                      },
                    },
                  },
                  orderBy: { sortOrder: "asc" },
                },
                _count: { select: { sources: true } },
              },
            },
          },
        },
        institution: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                id: true,
                slug: true,
                name: true,
                defaultArchetypeSlug: true,
              },
            },
          },
        },
        onboardingIdentitySpec: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        channelConfigs: {
          orderBy: { priority: "asc" },
          select: {
            id: true,
            channelType: true,
            isEnabled: true,
            priority: true,
          },
        },
        _count: {
          select: {
            callers: true,
            playbooks: true,
            subjects: true,
          },
        },
      },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      domain,
    });
  } catch (error: any) {
    console.error("Error fetching domain:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch domain" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/domains/:domainId
 * @visibility public
 * @scope domains:write
 * @auth session
 * @tags domains
 * @description Update a domain's name, description, default status, or active status
 * @pathParam domainId string - Domain UUID
 * @body name string - Updated display name
 * @body description string - Updated description
 * @body isDefault boolean - Set as default domain
 * @body isActive boolean - Enable or disable domain
 * @response 200 { ok: true, domain: Domain }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const body = await request.json();
    const { name, description, isDefault, isActive } = body;

    const existing = await prisma.domain.findUnique({
      where: { id: domainId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault && !existing.isDefault) {
      await prisma.domain.updateMany({
        where: { isDefault: true, id: { not: domainId } },
        data: { isDefault: false },
      });
    }

    const domain = await prisma.domain.update({
      where: { id: domainId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isDefault !== undefined && { isDefault }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({
      ok: true,
      domain,
    });
  } catch (error: any) {
    console.error("Error updating domain:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update domain" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/domains/:domainId
 * @visibility public
 * @scope domains:write
 * @auth session
 * @tags domains
 * @description Soft-delete a domain by setting isActive = false. Blocks if domain is default or has callers.
 * @pathParam domainId string - Domain UUID
 * @response 200 { ok: true, message: "Domain deactivated" }
 * @response 400 { ok: false, error: "Cannot delete the default domain" }
 * @response 400 { ok: false, error: "Cannot delete domain with N callers assigned..." }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    const existing = await prisma.domain.findUnique({
      where: { id: domainId },
      include: {
        _count: {
          select: { callers: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete the default domain" },
        { status: 400 }
      );
    }

    if (existing._count.callers > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot delete domain with ${existing._count.callers} callers assigned. Reassign callers first.`,
        },
        { status: 400 }
      );
    }

    // Soft delete
    await prisma.domain.update({
      where: { id: domainId },
      data: { isActive: false },
    });

    return NextResponse.json({
      ok: true,
      message: "Domain deactivated",
    });
  } catch (error: any) {
    console.error("Error deleting domain:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete domain" },
      { status: 500 }
    );
  }
}
