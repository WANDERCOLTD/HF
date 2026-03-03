/**
 * @api POST /api/wizard/resolve-institution
 * @auth OPERATOR+
 * @desc Client-side fallback for resolving/creating an institution when domainId is missing.
 *       Used by PackUploadStep when the server-side safety net doesn't trigger due to stale setupData.
 *       Supports two modes:
 *       1. With institutionName: resolves by name (exact → partial → create)
 *       2. Without institutionName: resolves from user's active institution
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import slugify from "slugify";

export async function POST(req: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth;

  const body = await req.json();
  const { institutionName } = body;

  try {
    // ── Mode 1: Resolve by name ──────────────────────────
    if (institutionName && typeof institutionName === "string") {
      // 1. Try to find existing institution by name (case-insensitive)
      let institution = await prisma.institution.findFirst({
        where: { name: { equals: institutionName, mode: "insensitive" } },
        include: { domains: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
      });

      // 2. Partial match fallback
      if (!institution && institutionName.trim().length >= 3) {
        const candidates = await prisma.institution.findMany({
          where: { name: { contains: institutionName, mode: "insensitive" } },
          include: { domains: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } },
          take: 5,
        });
        if (candidates.length > 0) {
          institution = candidates.sort((a, b) => a.name.length - b.name.length)[0];
        }
      }

      if (institution && institution.domains.length > 0) {
        return NextResponse.json({
          ok: true,
          institutionId: institution.id,
          domainId: institution.domains[0].id,
          created: false,
        });
      }

      // 3. Institution exists but has no domain — create one
      if (institution && institution.domains.length === 0) {
        const domain = await prisma.domain.create({
          data: {
            name: institution.name,
            slug: slugify(institution.name, { lower: true, strict: true }) + "-d",
            institutionId: institution.id,
            kind: "INSTITUTION",
          },
        });
        console.log(`[resolve-institution] Created missing domain (${domain.id}) for existing institution "${institution.name}"`);
        return NextResponse.json({
          ok: true,
          institutionId: institution.id,
          domainId: domain.id,
          created: false,
        });
      }

      // 4. Not found — create institution + domain
      const slug = slugify(institutionName, { lower: true, strict: true });

      const newInstitution = await prisma.institution.create({
        data: { name: institutionName, slug },
      });

      const domain = await prisma.domain.create({
        data: {
          name: institutionName,
          slug,
          institutionId: newInstitution.id,
          kind: "INSTITUTION",
        },
      });

      // Set as user's active institution
      await prisma.user.update({
        where: { id: auth.userId },
        data: { activeInstitutionId: newInstitution.id },
      });

      console.log(`[resolve-institution] Created institution "${institutionName}" (${newInstitution.id}) + domain (${domain.id})`);

      return NextResponse.json({
        ok: true,
        institutionId: newInstitution.id,
        domainId: domain.id,
        created: true,
      });
    }

    // ── Mode 2: Resolve from user's active institution ───
    // Last resort when institutionName is not available (stale closure)
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        activeInstitutionId: true,
        activeInstitution: {
          select: {
            id: true,
            domains: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } },
          },
        },
      },
    });

    if (user?.activeInstitution?.domains?.[0]?.id) {
      console.log(`[resolve-institution] Resolved from user's active institution (${user.activeInstitutionId})`);
      return NextResponse.json({
        ok: true,
        institutionId: user.activeInstitutionId,
        domainId: user.activeInstitution.domains[0].id,
        created: false,
      });
    }

    // No active institution either — cannot resolve
    return NextResponse.json(
      { error: "No institution name provided and no active institution found" },
      { status: 400 },
    );
  } catch (err) {
    console.error("[resolve-institution] Failed:", err);
    return NextResponse.json({ error: "Failed to resolve institution" }, { status: 500 });
  }
}
