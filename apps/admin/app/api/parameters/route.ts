import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/parameters
 * @visibility public
 * @scope parameters:read
 * @auth session
 * @tags parameters
 * @description List parameters with React-Admin compatible pagination, sorting, and filtering. Includes tags, prompt slug links, and source feature set.
 * @query sort string - JSON array [field, order] e.g. ["parameterId", "ASC"]
 * @query range string - JSON array [start, end] e.g. [0, 24]
 * @query filter string - JSON object e.g. {"q": "search term", "isActive": true, "parameterType": "BEHAVIOR"}
 * @response 200 Parameter[] (with Content-Range header for pagination)
 * @response 500 { error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = request.url ? new URL(request.url) : { searchParams: new URLSearchParams() };

    // Parse React-Admin query params
    const sortParam = searchParams.get("sort");
    const rangeParam = searchParams.get("range");
    const filterParam = searchParams.get("filter");

    const sort = sortParam ? JSON.parse(sortParam) : ["parameterId", "ASC"];
    const range = rangeParam ? JSON.parse(rangeParam) : [0, 24];
    const filter = filterParam ? JSON.parse(filterParam) : {};

    const [sortField, sortOrder] = sort;
    const [start, end] = range;
    const limit = end - start + 1;

    // Build where clause for filtering
    const where: any = {};

    // Search filter (searches across multiple fields)
    if (filter.q) {
      where.OR = [
        { parameterId: { contains: filter.q, mode: 'insensitive' } },
        { name: { contains: filter.q, mode: 'insensitive' } },
        { domainGroup: { contains: filter.q, mode: 'insensitive' } },
        { sectionId: { contains: filter.q, mode: 'insensitive' } },
      ];
    }

    // Boolean filters
    if (typeof filter.isActive === 'boolean') {
      where.isActive = filter.isActive;
    }
    if (typeof filter.isMvpCore === 'boolean') {
      where.isMvpCore = filter.isMvpCore;
    }

    // Parameter type filter
    if (filter.parameterType) {
      where.parameterType = filter.parameterType;
    }

    // Get total count
    const total = await prisma.parameter.count({ where });

    // Get paginated data with tags, prompt slug links, and source feature set
    const data = await prisma.parameter.findMany({
      where,
      orderBy: { [sortField]: sortOrder.toLowerCase() },
      skip: start,
      take: limit,
      include: {
        sourceFeatureSet: {
          select: { id: true, featureId: true, name: true, version: true }
        },
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

    // React-Admin expects Content-Range header for pagination
    const response = NextResponse.json(data);
    response.headers.set('Content-Range', `parameters ${start}-${end}/${total}`);
    response.headers.set('Access-Control-Expose-Headers', 'Content-Range');

    return response;
  } catch (error: any) {
    console.error('GET /api/parameters error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch parameters' },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/parameters
 * @visibility public
 * @scope parameters:write
 * @auth session
 * @tags parameters
 * @description Create a new parameter (React-Admin compatible)
 * @body parameterId string - Unique semantic parameter ID (e.g. "B5-O", "VARK-V")
 * @body name string - Display name
 * @body domainGroup string - Domain group
 * @body sectionId string - Section ID
 * @body scaleType string - Scale type
 * @body directionality string - Directionality
 * @body computedBy string - Computed by
 * @body definition string - Parameter definition
 * @body interpretationLow string - Low-score interpretation
 * @body interpretationHigh string - High-score interpretation
 * @response 201 Parameter
 * @response 500 { error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();

    // #1984 — spec-readonly boundary. `definition`,
    // `interpretationHigh`, `interpretationLow` are HF-canonical IP
    // and must NOT flow from this OPERATOR-tier customer-facing route
    // (they appear verbatim in the composed prompt's
    // behavior_targets_semantics block; a customer write corrupts
    // every other tenant). HF authors set them via the canonical
    // seed (apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json
    // → npm run db:seed). The fields are silently dropped here;
    // operators who supplied them via React-Admin form see no update.
    // See .claude/rules/spec-readonly-boundary.md.
    const parameter = await prisma.parameter.create({
      data: {
        parameterId: body.parameterId,
        name: body.name || null,
        domainGroup: body.domainGroup || null,
        sectionId: body.sectionId || null,
        scaleType: body.scaleType || null,
        directionality: body.directionality || null,
        computedBy: body.computedBy || null,
        measurementMvp: body.measurementMvp || null,
        measurementVoiceOnly: body.measurementVoiceOnly || null,
        // Note: isMvpCore and isActive are managed via tags, not direct fields
      },
    });

    return NextResponse.json(parameter, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/parameters error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create parameter' },
      { status: 500 }
    );
  }
}
