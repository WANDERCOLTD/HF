import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

function jsonError(status: number, message: string, extra?: any) {
  return NextResponse.json({ error: message, ...(extra ? { details: extra } : {}) }, { status });
}

function normalizeSlug(name: string) {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return s.length ? s : null;
}

function normalizeTagName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function coerceNullableString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined; // not provided
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : null;
}

async function getParameterFlat(parameterId: string) {
  const p = await prisma.parameter.findUnique({
    where: { parameterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!p) return null;

  const tags = p.tags.map((pt) => pt.tag);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tags: _join, ...rest } = p as any;
  return { ...rest, tags };
}

/**
 * @api GET /api/ops/:opid/parameters/:id
 * @visibility internal
 * @scope ops:read
 * @auth session
 * @tags ops
 * @description Get a single parameter by parameterId with tags and mappings
 * @pathParam opid string - Operation identifier (unused, for route grouping)
 * @pathParam id string - Parameter ID (parameterId)
 * @response 200 Parameter (with flattened tags and mappings)
 * @response 400 { error: "Missing id" }
 * @response 404 { error: "Not found" }
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "Missing id");

  const p = await getParameterFlat(id);
  if (!p) return jsonError(404, "Not found");
  return NextResponse.json(p);
}

/**
 * @api PATCH /api/ops/:opid/parameters/:id
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Update a parameter's scalar fields and/or tags (partial update with tag reconciliation)
 * @pathParam opid string - Operation identifier (unused, for route grouping)
 * @pathParam id string - Parameter ID (parameterId)
 * @body name string - Parameter display name
 * @body sectionId string - Section identifier
 * @body domainGroup string - Domain group
 * @body definition string - Parameter definition text
 * @body scaleType string - Scale type
 * @body directionality string - Directionality
 * @body computedBy string - Computed by method
 * @body tags string[]|object[] - Tag names or objects to set (replaces all existing tags)
 * @response 200 Parameter (with flattened tags)
 * @response 400 { error: "Missing id" }
 * @response 400 { error: "Invalid JSON body" }
 * @response 400 { error: "tags must be an array of strings" }
 * @response 404 { error: "Not found" }
 * @response 500 { error: "..." }
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "Missing id");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  if (!isPlainObject(body)) return jsonError(400, "Body must be a JSON object");

  // scalar patch (no IDs)
  const patch: any = {};
  if (isString(body.name)) patch.name = body.name;
  if (isString(body.sectionId)) patch.sectionId = body.sectionId;
  if (isString(body.domainGroup)) patch.domainGroup = body.domainGroup;
  if (isStringOrNull(body.definition)) patch.definition = coerceNullableString(body.definition);
  if (isString(body.scaleType)) patch.scaleType = body.scaleType;
  if (isString(body.directionality)) patch.directionality = body.directionality;
  if (isString(body.computedBy)) patch.computedBy = body.computedBy;

  if ((body as any).measurementMvp !== undefined) patch.measurementMvp = coerceNullableString((body as any).measurementMvp);
  if ((body as any).measurementVoiceOnly !== undefined) patch.measurementVoiceOnly = coerceNullableString((body as any).measurementVoiceOnly);
  if ((body as any).interpretationLow !== undefined) patch.interpretationLow = coerceNullableString((body as any).interpretationLow);
  if ((body as any).interpretationHigh !== undefined) patch.interpretationHigh = coerceNullableString((body as any).interpretationHigh);

  const tagsProvided = Object.prototype.hasOwnProperty.call(body, "tags");
  const tagsVal = (body as any).tags;

  if (tagsProvided && tagsVal !== null && !Array.isArray(tagsVal)) {
    return jsonError(400, "tags must be an array of strings", { receivedType: typeof tagsVal });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.parameter.findUnique({ where: { parameterId: id }, select: { parameterId: true } });
      if (!existing) throw Object.assign(new Error("Not found"), { status: 404 });

      if (Object.keys(patch).length) {
        await tx.parameter.update({ where: { parameterId: id }, data: patch });
      }

      if (tagsProvided) {
        // normalize + de-dupe case-insensitively
        const seen = new Set<string>();
        const normalized: string[] = [];
        const names = Array.isArray(tagsVal) ? (tagsVal as unknown[]) : [];

        for (const raw of names) {
          let candidate = "";
          if (isString(raw)) {
            candidate = raw;
          } else if (isPlainObject(raw) && isString((raw as any).name)) {
            // UI may send { name, ... }
            candidate = String((raw as any).name);
          }

          const n = normalizeTagName(candidate);
          if (!n) continue;
          const key = n.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          normalized.push(n);
        }

        // Upsert tags. Prefer slug as the stable unique key (handles casing changes in name).
        const tags = await Promise.all(
          normalized.map(async (name) => {
            const slug = normalizeSlug(name);

            if (slug) {
              return tx.tag.upsert({
                where: { slug },
                create: { id: randomUUID(), name, slug, tone: null },
                update: { name, tone: null },
              });
            }

            // Fallback to name (should be rare)
            return tx.tag.upsert({
              where: { name },
              create: { id: randomUUID(), name, slug: null, tone: null },
              update: { tone: null },
            });
          })
        );

        const desiredTagIds = tags.map((t) => t.id);

        const current = await tx.parameterTag.findMany({
          where: { parameterId: id },
          select: { tagId: true },
        });

        const currentSet = new Set(current.map((x) => x.tagId));
        const desiredSet = new Set(desiredTagIds);

        const toCreate = desiredTagIds.filter((tid) => !currentSet.has(tid));
        const toDelete = current.map((x) => x.tagId).filter((tid) => !desiredSet.has(tid));

        if (toDelete.length) {
          await tx.parameterTag.deleteMany({ where: { parameterId: id, tagId: { in: toDelete } } });
        }
        if (toCreate.length) {
          await tx.parameterTag.createMany({
            data: toCreate.map((tagId) => ({ id: randomUUID(), parameterId: id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      const full = await tx.parameter.findUnique({
        where: { parameterId: id },
        include: { tags: { include: { tag: true } } },
      });
      if (!full) throw Object.assign(new Error("Not found"), { status: 404 });

      const flattenedTags = full.tags.map((pt) => pt.tag);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tags: _join, ...rest } = full as any;
      return { ...rest, tags: flattenedTags };
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return jsonError(status, e?.message || "Failed to update", {
      code: e?.code,
      meta: e?.meta,
    });
  }
}

/**
 * @api DELETE /api/ops/:opid/parameters/:id
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Delete a parameter by parameterId
 * @pathParam opid string - Operation identifier (unused, for route grouping)
 * @pathParam id string - Parameter ID (parameterId)
 * @response 200 { ok: true }
 * @response 400 { error: "Missing id" }
 * @response 404 { error: "Not found" }
 * @response 500 { error: "..." }
 */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await ctx.params;
  if (!id) return jsonError(400, "Missing id");

  try {
    await prisma.parameter.delete({ where: { parameterId: id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.code || "").toUpperCase() === "P2025") return jsonError(404, "Not found");
    return jsonError(500, e?.message || "Failed to delete");
  }
}