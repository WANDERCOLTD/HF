import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TERM_KEYS } from "@/lib/terminology/types";

/**
 * @api GET /api/admin/institution-types
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin
 * @description List all institution types with terminology and config (ADMIN role required)
 * @response 200 { ok: true, types: InstitutionType[] }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const types = await prisma.institutionType.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { institutions: true } },
    },
  });

  return NextResponse.json({ ok: true, types });
}

/**
 * @api POST /api/admin/institution-types
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin
 * @description Create a new institution type with terminology preset (ADMIN role required)
 * @body name string - Display name (required)
 * @body slug string - URL-safe identifier (required, unique)
 * @body description string - Optional description
 * @body terminology object - 11-key TermMap (domain, playbook, spec, caller, cohort, instructor, session, persona, supervisor, teach_action, learning_noun)
 * @body setupSpecSlug string - Wizard spec slug for setup flow (optional)
 * @body defaultDomainKind string - INSTITUTION or COMMUNITY (default: INSTITUTION)
 * @response 201 { ok: true, type: InstitutionType }
 * @response 400 { ok: false, error: "..." }
 * @response 409 { ok: false, error: "Slug already exists" }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const body = await req.json();
  const { name, slug, description, terminology, setupSpecSlug, defaultDomainKind, defaultArchetypeSlug } = body;

  if (!name?.trim()) {
    return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
  }
  if (!slug?.trim()) {
    return NextResponse.json({ ok: false, error: "Slug is required" }, { status: 400 });
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { ok: false, error: "Slug must be lowercase alphanumeric with hyphens" },
      { status: 400 },
    );
  }

  // Validate terminology has all required keys
  if (!terminology || typeof terminology !== "object") {
    return NextResponse.json({ ok: false, error: "Terminology map is required" }, { status: 400 });
  }
  const missingKeys = TERM_KEYS.filter((k) => !terminology[k]?.trim());
  if (missingKeys.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Missing terminology keys: ${missingKeys.join(", ")}` },
      { status: 400 },
    );
  }

  // Check slug uniqueness
  const existing = await prisma.institutionType.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ ok: false, error: "Slug already exists" }, { status: 409 });
  }

  const type = await prisma.institutionType.create({
    data: {
      name: name.trim(),
      slug: slug.trim(),
      description: description?.trim() || null,
      terminology,
      setupSpecSlug: setupSpecSlug?.trim() || null,
      defaultDomainKind: defaultDomainKind === "COMMUNITY" ? "COMMUNITY" : "INSTITUTION",
      defaultArchetypeSlug: defaultArchetypeSlug?.trim() || null,
    },
  });

  return NextResponse.json({ ok: true, type }, { status: 201 });
}
