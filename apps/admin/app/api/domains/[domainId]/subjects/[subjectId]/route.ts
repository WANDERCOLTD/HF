import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api DELETE /api/domains/:domainId/subjects/:subjectId
 * @auth ADMIN
 * @description Unlink a subject from this domain (deletes SubjectDomain join row)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ domainId: string; subjectId: string }> }
) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const { domainId, subjectId } = await params;

  await prisma.subjectDomain.deleteMany({
    where: { subjectId, domainId },
  });

  return NextResponse.json({ ok: true });
}
