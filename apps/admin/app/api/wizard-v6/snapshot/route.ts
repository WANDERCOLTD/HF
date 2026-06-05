// #1078 — V6 wizard Phase 1 spike.
//
// GET /api/wizard-v6/snapshot?sessionId=...
//   → { sessionId, specKey, specVersion, answeredFields, lastEventSequence }
//
// Read-side projector — surfaces the materialised `Playbook.config.__v6`
// snapshot for the panel to render. SUPERADMIN only in P1.

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = await prisma.wizardSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      playbookId: true,
      specKey: true,
      specVersion: true,
      status: true,
      Playbook: { select: { config: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const v6 =
    (session.Playbook.config as
      | {
          __v6?: {
            answeredFields?: Record<string, unknown>;
            lastEventSequence?: number;
          };
        }
      | null)?.__v6 ?? null;

  return NextResponse.json({
    sessionId: session.id,
    playbookId: session.playbookId,
    specKey: session.specKey,
    specVersion: session.specVersion,
    status: session.status,
    answeredFields: v6?.answeredFields ?? {},
    lastEventSequence: v6?.lastEventSequence ?? 0,
  });
}
