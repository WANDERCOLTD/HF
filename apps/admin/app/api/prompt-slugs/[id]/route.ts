import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * @api GET /api/prompt-slugs/:id
 * @visibility internal
 * @scope prompts:read
 * @auth session
 * @tags prompts
 * @description Get a single dynamic prompt by ID or slug with all parameters, ranges, and stack usage
 * @pathParam id string - Prompt slug UUID or slug string
 * @response 200 { ok: true, slug: PromptSlug }
 * @response 404 { ok: false, error: "Dynamic prompt not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;

    // Stacks model was removed from the schema; `usedInStacks` is now always
    // empty. Kept in the response shape for backward compatibility with
    // clients that still read it.
    const promptSlug = await prisma.promptSlug.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
      include: {
        parameters: {
          include: {
            parameter: {
              select: {
                parameterId: true,
                name: true,
                domainGroup: true,
                definition: true,
                interpretationHigh: true,
                interpretationLow: true,
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

    if (!promptSlug) {
      return NextResponse.json(
        { ok: false, error: "Dynamic prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      slug: {
        ...promptSlug,
        usedInStacks: [],
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch dynamic prompt" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/prompt-slugs/:id
 * @visibility internal
 * @scope prompts:write
 * @auth session
 * @tags prompts
 * @description Update a dynamic prompt, its parameters, and ranges. Replaces parameter
 *   links and ranges entirely when provided.
 * @pathParam id string - Prompt slug UUID or slug string
 * @body name string - Updated name
 * @body description string - Updated description
 * @body sourceType string - Updated source type
 * @body parameters Array<{ parameterId, weight, mode, sortOrder }> - Replacement parameter bindings
 * @body parameterId string - Legacy single parameter ID
 * @body mode string - Legacy parameter mode
 * @body memoryCategory string - Updated memory category
 * @body memoryMode string - Updated memory mode
 * @body fallbackPrompt string - Updated fallback prompt
 * @body priority number - Updated priority
 * @body isActive boolean - Updated active status
 * @body ranges Array<{ minValue, maxValue, condition, prompt, label, metadata }> - Replacement ranges
 * @response 200 { ok: true, slug: PromptSlug }
 * @response 404 { ok: false, error: "Dynamic prompt not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;
    const body = await req.json();
    const {
      name,
      description,
      sourceType,
      // New: array of parameters with weights and modes
      parameters: parameterInputs,
      // Legacy single parameter support
      parameterId,
      mode,
      memoryCategory,
      memoryMode,
      fallbackPrompt,
      priority,
      isActive,
      ranges,
    } = body;

    const existing = await prisma.promptSlug.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Dynamic prompt not found" },
        { status: 404 }
      );
    }

    // Update in transaction
    const promptSlug = await prisma.$transaction(async (tx) => {
      const updatedSlug = await tx.promptSlug.update({
        where: { id: existing.id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(sourceType && { sourceType }),
          ...(memoryCategory !== undefined && { memoryCategory }),
          ...(memoryMode !== undefined && { memoryMode }),
          ...(fallbackPrompt !== undefined && { fallbackPrompt }),
          ...(priority !== undefined && { priority }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      // Handle parameters update
      if (parameterInputs !== undefined || parameterId !== undefined) {
        // Build parameter list
        let parameterList = parameterInputs || [];
        if (parameterId && parameterList.length === 0) {
          parameterList = [{ parameterId, mode: mode || "ABSOLUTE", weight: 1.0 }];
        }

        // Delete existing parameter links
        await tx.promptSlugParameter.deleteMany({
          where: { slugId: existing.id },
        });

        // Create new parameter links
        if (parameterList.length > 0) {
          await tx.promptSlugParameter.createMany({
            data: parameterList.map((p: any, index: number) => ({
              slugId: existing.id,
              parameterId: p.parameterId,
              weight: p.weight ?? 1.0,
              mode: p.mode || "ABSOLUTE",
              sortOrder: p.sortOrder ?? index,
            })),
          });
        }
      }

      // If ranges are provided, replace all ranges
      if (ranges !== undefined) {
        // Delete existing ranges
        await tx.promptSlugRange.deleteMany({
          where: { slugId: existing.id },
        });

        // Create new ranges
        if (ranges.length > 0) {
          await tx.promptSlugRange.createMany({
            data: ranges.map((r: any, index: number) => ({
              slugId: existing.id,
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
      }

      return tx.promptSlug.findUnique({
        where: { id: existing.id },
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

    return NextResponse.json({ ok: true, slug: promptSlug });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update dynamic prompt" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/prompt-slugs/:id
 * @visibility internal
 * @scope prompts:write
 * @auth session
 * @tags prompts
 * @description Delete a dynamic prompt and its parameter links/ranges. Fails if used in any stacks.
 * @pathParam id string - Prompt slug UUID or slug string
 * @response 200 { ok: true, deleted: true }
 * @response 400 { ok: false, error: "Cannot delete dynamic prompt used in N stack(s)..." }
 * @response 404 { ok: false, error: "Dynamic prompt not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;

    // Stacks model was removed from the schema, so there is no longer a
    // "slug is in use" gate — DELETE is unconditional.
    const existing = await prisma.promptSlug.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Dynamic prompt not found" },
        { status: 404 }
      );
    }

    // Delete slug, parameter links, and ranges (cascade)
    await prisma.promptSlug.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ ok: true, deleted: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete dynamic prompt" },
      { status: 500 }
    );
  }
}
