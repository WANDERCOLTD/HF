import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * @api GET /api/prompt-slugs
 * @visibility internal
 * @scope prompts:read
 * @auth session
 * @tags prompts
 * @description List all prompt slugs (dynamic prompts) with optional filtering by source type,
 *   parameter, and active status. Includes parameters, ranges, and usage counts.
 * @query sourceType string - Filter by source type (PARAMETER, COMPOSITE, MEMORY, etc.)
 * @query parameterId string - Filter slugs linked to a specific parameter
 * @query isActive string - Filter by active status ("true" or "false")
 * @response 200 { ok: true, slugs: PromptSlug[], parameters: Parameter[] }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(req.url);
    const sourceType = searchParams.get("sourceType");
    const parameterId = searchParams.get("parameterId");
    const isActive = searchParams.get("isActive");

    const where: any = {};
    if (sourceType) where.sourceType = sourceType;
    if (isActive !== null) where.isActive = isActive === "true";

    // Filter by parameter using the junction table
    if (parameterId) {
      where.parameters = {
        some: { parameterId },
      };
    }

    const slugs = await prisma.promptSlug.findMany({
      where,
      orderBy: [{ priority: "desc" }, { name: "asc" }],
      include: {
        sourceFeatureSet: {
          select: { id: true, featureId: true, name: true, version: true },
        },
        parameters: {
          include: {
            parameter: {
              select: {
                parameterId: true,
                name: true,
                domainGroup: true,
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
        ranges: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    // Get parameters for filter UI
    const parameters = await prisma.parameter.findMany({
      select: {
        parameterId: true,
        name: true,
        domainGroup: true,
      },
      orderBy: [{ domainGroup: "asc" }, { name: "asc" }],
    });

    // Stacks model was removed from the schema; usageCount is always 0.
    return NextResponse.json({
      ok: true,
      slugs: slugs.map((s) => ({
        ...s,
        usageCount: 0,
        rangeCount: s.ranges.length,
        parameterCount: s.parameters.length,
      })),
      parameters,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch dynamic prompts" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/prompt-slugs
 * @visibility internal
 * @scope prompts:write
 * @auth session
 * @tags prompts
 * @description Create a new prompt slug (dynamic prompt) with parameters and value ranges.
 *   Supports both multi-parameter array format and legacy single parameter format.
 * @body slug string - Unique slug identifier (required)
 * @body name string - Display name (required)
 * @body description string - Slug description
 * @body sourceType string - Source type: PARAMETER, COMPOSITE, MEMORY, etc. (required)
 * @body parameters Array<{ parameterId, weight, mode, sortOrder }> - Parameter bindings
 * @body parameterId string - Legacy single parameter ID
 * @body mode string - Legacy parameter mode
 * @body memoryCategory string - Memory category (required for MEMORY source type)
 * @body memoryMode string - Memory retrieval mode (default "latest")
 * @body fallbackPrompt string - Fallback prompt text
 * @body priority number - Priority ordering (default 0)
 * @body isActive boolean - Active status (default true)
 * @body ranges Array<{ minValue, maxValue, condition, prompt, label, metadata }> - Value ranges
 * @response 201 { ok: true, slug: PromptSlug }
 * @response 400 { ok: false, error: "..." }
 * @response 409 { ok: false, error: "Slug '...' already exists" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const {
      slug,
      name,
      description,
      sourceType,
      // New: array of parameters with weights and modes
      parameters: parameterInputs = [],
      // Legacy single parameter support (backwards compatible)
      parameterId,
      mode,
      memoryCategory,
      memoryMode,
      fallbackPrompt,
      priority = 0,
      isActive = true,
      ranges = [],
    } = body;

    if (!slug || !name || !sourceType) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: slug, name, sourceType" },
        { status: 400 }
      );
    }

    // Build parameter list (support both new array format and legacy single parameter)
    let parameterList = parameterInputs;
    if (parameterId && parameterList.length === 0) {
      // Legacy support: convert single parameterId to array format
      parameterList = [{ parameterId, mode: mode || "ABSOLUTE", weight: 1.0 }];
    }

    // Validate source type requirements
    if ((sourceType === "PARAMETER" || sourceType === "COMPOSITE") && parameterList.length === 0) {
      return NextResponse.json(
        { ok: false, error: "PARAMETER/COMPOSITE source type requires at least one parameter" },
        { status: 400 }
      );
    }

    if (sourceType === "MEMORY" && !memoryCategory) {
      return NextResponse.json(
        { ok: false, error: "MEMORY source type requires memoryCategory" },
        { status: 400 }
      );
    }

    // Check for duplicate slug
    const existing = await prisma.promptSlug.findUnique({
      where: { slug },
    });

    if (existing) {
      return NextResponse.json(
        { ok: false, error: `Slug '${slug}' already exists` },
        { status: 409 }
      );
    }

    // Create slug with parameters and ranges in a transaction
    const promptSlug = await prisma.$transaction(async (tx) => {
      const createdSlug = await tx.promptSlug.create({
        data: {
          slug,
          name,
          description,
          sourceType,
          memoryCategory: sourceType === "MEMORY" ? memoryCategory : null,
          memoryMode: sourceType === "MEMORY" ? memoryMode || "latest" : null,
          fallbackPrompt,
          priority,
          isActive,
        },
      });

      // Create parameter links
      if (parameterList.length > 0) {
        await tx.promptSlugParameter.createMany({
          data: parameterList.map((p: any, index: number) => ({
            slugId: createdSlug.id,
            parameterId: p.parameterId,
            weight: p.weight ?? 1.0,
            mode: p.mode || "ABSOLUTE",
            sortOrder: p.sortOrder ?? index,
          })),
        });
      }

      // Create ranges if provided
      if (ranges.length > 0) {
        await tx.promptSlugRange.createMany({
          data: ranges.map((r: any, index: number) => ({
            slugId: createdSlug.id,
            minValue: r.minValue,
            maxValue: r.maxValue,
            condition: r.condition,
            prompt: r.prompt,
            label: r.label,
            metadata: r.metadata,
            sortOrder: r.sortOrder ?? index,
          })),
        });
      }

      return tx.promptSlug.findUnique({
        where: { id: createdSlug.id },
        include: {
          parameters: {
            include: {
              parameter: {
                select: {
                  parameterId: true,
                  name: true,
                  domainGroup: true,
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
          ranges: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    });

    return NextResponse.json({ ok: true, slug: promptSlug }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create dynamic prompt" },
      { status: 500 }
    );
  }
}
