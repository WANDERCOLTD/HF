import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { randomUUID } from "crypto";
import { resolveCanonicalDomainGroup } from "@/lib/registry/canonical-domain-group";

export const runtime = "nodejs";

function normalizeTagName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function flattenParameter(p: any) {
  // Convert join rows -> Tag[]
  const tags = Array.isArray(p?.tags) ? p.tags.map((pt: any) => pt?.tag).filter(Boolean) : [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tags: _join, ...rest } = p as any;
  return { ...rest, tags };
}

// Allow-list fields to prevent SQL injection via dynamic orderBy keys.
const ALLOWED_SORT_FIELDS = new Set([
  "updatedAt",
  "createdAt",
  "parameterId",
  "name",
  "sectionId",
  "domainGroup",
  "scaleType",
  "directionality",
  "computedBy",
]);

function jsonParam<T>(sp: URLSearchParams, key: string, fallback: T): T {
  const raw = sp.get(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function asSortDir(v: unknown): "ASC" | "DESC" {
  return v === "ASC" || v === "DESC" ? v : "DESC";
}

function normalizeSort(raw: unknown): Array<[string, "ASC" | "DESC"]> {
  // Supports:
  // 1) React Admin simple-rest: sort=["field","ASC"]
  // 2) Multi-sort: sort=[["field","ASC"],["field2","DESC"]]
  // Falls back to updatedAt DESC.

  const fallback: Array<[string, "ASC" | "DESC"]> = [["updatedAt", "DESC"]];

  if (!raw) return fallback;

  // Case 1: [field, dir]
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === "string") {
    const field = raw[0];
    const dir = asSortDir(raw[1]);
    if (!ALLOWED_SORT_FIELDS.has(field)) return fallback;
    return [[field, dir]];
  }

  // Case 2: [[field, dir], ...]
  if (Array.isArray(raw) && raw.length > 0) {
    const out: Array<[string, "ASC" | "DESC"]> = [];
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const field = item[0];
      const dir = asSortDir(item[1]);
      if (typeof field !== "string") continue;
      if (!ALLOWED_SORT_FIELDS.has(field)) continue;
      out.push([field, dir]);
    }
    return out.length ? out : fallback;
  }

  return fallback;
}

/**
 * @api GET /api/ops/:opid/parameters
 * @visibility internal
 * @scope ops:read
 * @auth session
 * @tags ops
 * @description List parameters with pagination, sorting, filtering, and tag support (React Admin compatible).
 *   Supports sort, range, filter query params in React Admin simple-rest format.
 * @query sort string - JSON sort spec: ["field","ASC"] or [["field","ASC"],["field2","DESC"]]
 * @query range string - JSON range: [start, end] (default: [0, 24])
 * @query filter string - JSON filter: { q?, sectionId?, tags?, tag? }
 * @response 200 Parameter[] (with Content-Range header)
 */
export async function GET(req: Request) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const url = new URL(req.url);
  const sp = url.searchParams;

  // React Admin simple-rest params:
  // ?sort=["field","ASC"]&range=[0,24]&filter={}
  // Multi-sort supported:
  // ?sort=[["field","ASC"],["field2","DESC"]]&range=[0,24]&filter={}
  const sortRaw = jsonParam<any>(sp, "sort", null);
  const sort = normalizeSort(sortRaw);
  const range = jsonParam<[number, number]>(sp, "range", [0, 24]);
  const filter = jsonParam<Record<string, any>>(sp, "filter", {});

  const [start, end] = range;
  const take = end - start + 1;
  const skip = start;

  // Note: legacy boolean flags (isActive / isMvpCore) were replaced by tags.
  // Minimal filtering support (extend later)
  const where: any = {};
  if (filter.q && typeof filter.q === "string") {
    where.OR = [
      { name: { contains: filter.q, mode: "insensitive" } },
      { parameterId: { contains: filter.q, mode: "insensitive" } },
      { domainGroup: { contains: filter.q, mode: "insensitive" } },
      { sectionId: { contains: filter.q, mode: "insensitive" } },
    ];
  }
  if (filter.sectionId) where.sectionId = String(filter.sectionId);

  // Tag filtering (AND semantics)
  // Accepts: filter.tags = ["Active","MVP"] or filter.tags = "Active" or filter.tag = "Active"
  const rawTags = (filter as any).tags ?? (filter as any).tag;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t)).filter(Boolean)
    : rawTags
      ? [String(rawTags)]
      : [];

  if (tags.length) {
    where.AND = (where.AND || []).concat(
      tags.map((name) => ({
        tags: {
          some: {
            tag: {
              // case-insensitive exact match on name
              name: { equals: name, mode: "insensitive" },
            },
          },
        },
      }))
    );
  }

  const total = await prisma.parameter.count({ where });

  const data = await prisma.parameter.findMany({
    where,
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
    orderBy: sort.map(([field, dir]) => ({ [field]: dir.toLowerCase() as any })),
    skip,
    take,
  });

  const flat = data.map(flattenParameter);

  const res = NextResponse.json(flat);

  // React Admin expects Content-Range + exposed header
  res.headers.set("Content-Range", `parameters ${start}-${Math.min(end, start + data.length - 1)}/${total}`);
  res.headers.set("Access-Control-Expose-Headers", "Content-Range");

  return res;
}

/**
 * @api POST /api/ops/:opid/parameters
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Create a new parameter with optional tag associations
 * @body parameterId string - Unique parameter identifier
 * @body name string - Parameter display name
 * @body sectionId string - Section identifier
 * @body domainGroup string - Domain group
 * @body scaleType string - Scale type
 * @body directionality string - Directionality
 * @body computedBy string - Computed by method
 * @body tags string[] - Optional tag names to associate
 * @response 200 Parameter (with flattened tags)
 */
export async function POST(req: Request) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const body = await req.json();

  // Allow optional tags: string[]
  const tagNames: string[] = Array.isArray(body?.tags)
    ? body.tags.map((t: any) => (typeof t === "string" ? normalizeTagName(t) : "")).filter(Boolean)
    : [];

  // Remove tags from scalar create payload
  const { tags: _tags, ...scalar } = body || {};

  // #2031 follow-on — route operator-supplied domainGroup through the
  // canonical resolver. Off-canonical input falls back to
  // `behavior-core` (catch-all canonical default per Group A in
  // docs/decisions/2026-06-19-parameter-domain-group-mapping.md);
  // schema requires non-null.
  if (scalar.domainGroup !== undefined && scalar.domainGroup !== null) {
    scalar.domainGroup =
      resolveCanonicalDomainGroup({ domainGroup: scalar.domainGroup }) ??
      "behavior-core";
  }

  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.parameter.create({
      data: scalar,
      include: { tags: { include: { tag: true } } },
    });

    if (!tagNames.length) return p;

    const tags = await Promise.all(
      tagNames.map((name) =>
        tx.tag.upsert({
          where: { name },
          update: {},
          create: { id: randomUUID(), name },
        })
      )
    );

    await tx.parameterTag.createMany({
      data: tags.map((tag) => ({ id: randomUUID(), parameterId: p.parameterId, tagId: tag.id })),
      skipDuplicates: true,
    });

    return tx.parameter.findUnique({
      where: { parameterId: p.parameterId },
      include: { tags: { include: { tag: true } } },
    });
  });

  return NextResponse.json(created ? flattenParameter(created) : created);
}

// NOTE: Updates and deletes are handled in /api/parameters/[id]/route.ts.
// Keeping this route limited to collection operations avoids ambiguous path parsing.

/**
 * @api PATCH /api/ops/:opid/parameters
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Not supported on collection route - use /api/ops/:opid/parameters/:id instead
 * @response 405 { error: "PATCH not supported on collection route..." }
 */
export async function PATCH() {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  return NextResponse.json(
    { error: "PATCH not supported on collection route. Use /api/parameters/:id" },
    { status: 405 }
  );
}

/**
 * @api DELETE /api/ops/:opid/parameters
 * @visibility internal
 * @scope ops:write
 * @auth session
 * @tags ops
 * @description Not supported on collection route - use /api/ops/:opid/parameters/:id instead
 * @response 405 { error: "DELETE not supported on collection route..." }
 */
export async function DELETE() {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  return NextResponse.json(
    { error: "DELETE not supported on collection route. Use /api/parameters/:id" },
    { status: 405 }
  );
}