import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/domains/:domainId/subjects
 * @auth ADMIN
 * @description Link a subject to this domain (creates SubjectDomain join row)
 * @body { subjectId: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const { domainId } = await params;
  const { subjectId } = await req.json();

  if (!subjectId) {
    return NextResponse.json({ ok: false, error: "subjectId is required" }, { status: 400 });
  }

  // Verify domain and subject exist
  const [domain, subject] = await Promise.all([
    prisma.domain.findUnique({ where: { id: domainId }, select: { id: true } }),
    prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }),
  ]);

  if (!domain) {
    return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
  }
  if (!subject) {
    return NextResponse.json({ ok: false, error: "Subject not found" }, { status: 404 });
  }

  // Upsert to handle idempotent link
  await prisma.subjectDomain.upsert({
    where: { subjectId_domainId: { subjectId, domainId } },
    create: { subjectId, domainId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}
