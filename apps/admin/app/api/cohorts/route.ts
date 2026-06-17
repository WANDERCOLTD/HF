import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireEntityAccess,
  isEntityAuthError,
  buildScopeFilter,
} from "@/lib/access-control";
import { parsePagination } from "@/lib/api-utils";
import { isTeachingCallerRole } from "@/lib/caller-roles";

/**
 * @api GET /api/cohorts
 * @visibility public
 * @scope cohorts:read
 * @auth session
 * @tags cohorts
 * @description List cohort groups. Admins see all; teachers see only owned cohorts.
 * @query domainId string - Filter by domain (optional)
 * @query ownerId string - Filter by owner caller ID (optional)
 * @query isActive boolean - Filter by active status (optional, default true)
 * @query limit number - Max results (default 100, max 500)
 * @query offset number - Pagination offset (default 0)
 * @response 200 { ok: true, cohorts: CohortGroup[], total: number, limit: number, offset: number }
 * @response 500 { ok: false, error: "Failed to fetch cohorts" }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireEntityAccess("cohorts", "R");
    if (isEntityAuthError(authResult)) return authResult.error;
    const { scope, session } = authResult;

    const url = new URL(req.url);
    const domainId = url.searchParams.get("domainId");
    const ownerId = url.searchParams.get("ownerId");
    const isActive = url.searchParams.get("isActive") !== "false";
    const { limit, offset } = parsePagination(url.searchParams);

    // For OWN scope, find the caller linked to this user
    let ownerFilter: Record<string, string> = {};
    if (scope === "OWN") {
      const caller = await prisma.caller.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!caller) {
        return NextResponse.json({ ok: true, cohorts: [], total: 0, limit, offset });
      }
      ownerFilter = { ownerId: caller.id };
    } else if (scope === "DOMAIN") {
      const userDomainId = (session.user as any).assignedDomainId;
      if (userDomainId) {
        ownerFilter = { domainId: userDomainId };
      }
    }

    const whereClause: any = {
      ...ownerFilter,
      isActive,
      ...(domainId ? { domainId } : {}),
      ...(ownerId ? { ownerId } : {}),
    };

    const [cohorts, total] = await Promise.all([
      prisma.cohortGroup.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          domain: { select: { id: true, slug: true, name: true } },
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.cohortGroup.count({ where: whereClause }),
    ]);

    return NextResponse.json({ ok: true, cohorts, total, limit, offset });
  } catch (error: any) {
    console.error("Error fetching cohorts:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch cohorts" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/cohorts
 * @visibility public
 * @scope cohorts:write
 * @auth session
 * @tags cohorts
 * @description Create a new cohort group. The authenticated user's linked caller becomes the owner.
 * @body name string - Cohort name (required)
 * @body description string - Cohort description (optional)
 * @body domainId string - Domain ID (required)
 * @body ownerId string - Owner caller ID (optional, defaults to user's linked caller)
 * @body maxMembers number - Maximum member count (optional, default 50)
 * @note institutionId is automatically inherited from the domain — no need to pass it explicitly
 * @response 200 { ok: true, cohort: CohortGroup }
 * @response 400 { ok: false, error: "..." }
 * @response 500 { ok: false, error: "Failed to create cohort" }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireEntityAccess("cohorts", "C");
    if (isEntityAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const body = await req.json();
    const { name, description, domainId, maxMembers } = body;
    let { ownerId } = body;

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Name is required" },
        { status: 400 }
      );
    }

    if (!domainId) {
      return NextResponse.json(
        { ok: false, error: "Domain ID is required" },
        { status: 400 }
      );
    }

    // Verify domain exists (also fetch institutionId so we can propagate it to the cohort)
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, institutionId: true },
    });
    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // If no ownerId provided, use the caller linked to the authenticated user
    if (!ownerId) {
      const caller = await prisma.caller.findFirst({
        where: { userId: session.user.id },
        select: { id: true, role: true },
      });
      if (!caller) {
        return NextResponse.json(
          { ok: false, error: "No caller linked to your account. Provide an ownerId." },
          { status: 400 }
        );
      }
      ownerId = caller.id;
    }

    // Verify owner exists and has a teacher/tutor role
    const owner = await prisma.caller.findUnique({
      where: { id: ownerId },
      select: { id: true, role: true },
    });
    if (!owner) {
      return NextResponse.json(
        { ok: false, error: "Owner caller not found" },
        { status: 404 }
      );
    }
    if (!isTeachingCallerRole(owner.role)) {
      return NextResponse.json(
        { ok: false, error: "Owner must have TEACHER or TUTOR role" },
        { status: 400 }
      );
    }

    const cohort = await prisma.cohortGroup.create({
      data: {
        name,
        description: description || null,
        domainId,
        ownerId,
        maxMembers: maxMembers || 50,
        institutionId: domain.institutionId || null,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        domain: { select: { id: true, slug: true, name: true } },
        _count: { select: { members: true } },
      },
    });

    return NextResponse.json({ ok: true, cohort });
  } catch (error: any) {
    console.error("Error creating cohort:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create cohort" },
      { status: 500 }
    );
  }
}
