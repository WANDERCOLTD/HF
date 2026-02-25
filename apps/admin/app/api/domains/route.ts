import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains
 * @visibility public
 * @scope domains:read
 * @auth session
 * @tags domains
 * @description List all domains with caller counts and playbook info
 * @query includeInactive boolean - Include inactive domains (default: false)
 * @query onlyInstitution boolean - Only return domains linked to an institution (default: false)
 * @query kind string - Filter by domain kind (INSTITUTION | COMMUNITY)
 * @response 200 { ok: true, domains: Domain[], count: number }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";
    const onlyInstitution = searchParams.get("onlyInstitution") === "true";
    const kind = searchParams.get("kind");

    const domains = await prisma.domain.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(onlyInstitution ? { institutionId: { not: null } } : {}),
        ...(kind ? { kind: kind as any } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            callers: true,
            playbooks: true,
          },
        },
        playbooks: {
          where: { status: "PUBLISHED" },
          take: 1,
          select: {
            id: true,
            name: true,
            version: true,
            publishedAt: true,
          },
        },
        institution: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                slug: true,
                name: true,
                defaultArchetypeSlug: true,
              },
            },
          },
        },
      },
    });

    // Transform to include published playbook info + institution type
    const domainsWithInfo = domains.map((domain) => ({
      ...domain,
      callerCount: domain._count.callers,
      playbookCount: domain._count.playbooks,
      publishedPlaybook: domain.playbooks[0] || null,
      _count: undefined,
      playbooks: undefined,
      institutionId: domain.institutionId,
      institution: domain.institution || null,
    }));

    return NextResponse.json({
      ok: true,
      domains: domainsWithInfo,
      count: domains.length,
    });
  } catch (error: any) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch domains" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/domains
 * @visibility public
 * @scope domains:write
 * @auth session
 * @tags domains
 * @description Create a new domain
 * @body slug string - Unique domain slug
 * @body name string - Display name
 * @body description string - Optional description
 * @body isDefault boolean - Set as default domain
 * @body institutionId string - Optional institution ID to link this domain to
 * @body institutionTypeSlug string - Optional institution type slug; auto-creates Institution linked to this type
 * @response 200 { ok: true, domain: Domain }
 * @response 400 { ok: false, error: "slug and name are required" }
 * @response 409 { ok: false, error: "Domain with slug ... already exists" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const body = await request.json();
    const { slug, name, description, isDefault, institutionId, institutionTypeSlug } = body;

    if (!slug || !name) {
      return NextResponse.json(
        { ok: false, error: "slug and name are required" },
        { status: 400 }
      );
    }

    // Check for duplicate slug
    const existing = await prisma.domain.findUnique({
      where: { slug },
    });

    if (existing) {
      return NextResponse.json(
        { ok: false, error: `Domain with slug "${slug}" already exists` },
        { status: 409 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.domain.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // Auto-create Institution from type slug if provided and no explicit institutionId
    let resolvedInstitutionId = institutionId || session?.user?.institutionId || undefined;
    if (!resolvedInstitutionId && institutionTypeSlug) {
      const instType = await prisma.institutionType.findUnique({
        where: { slug: institutionTypeSlug },
        select: { id: true },
      });
      if (instType) {
        const institution = await prisma.institution.create({
          data: { name, slug, typeId: instType.id },
        });
        resolvedInstitutionId = institution.id;
      }
    }

    const domain = await prisma.domain.create({
      data: {
        slug,
        name,
        description: description || null,
        isDefault: isDefault || false,
        isActive: true,
        institutionId: resolvedInstitutionId,
      },
    });

    return NextResponse.json({
      ok: true,
      domain,
    });
  } catch (error: any) {
    console.error("Error creating domain:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create domain" },
      { status: 500 }
    );
  }
}
