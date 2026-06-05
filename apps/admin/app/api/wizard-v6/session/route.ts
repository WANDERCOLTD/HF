// #1078 — V6 wizard Phase 1 spike.
//
// POST /api/wizard-v6/session
//   { playbookId, specKey, specVersion } → { sessionId }
//
// Creates a WizardSession in ACTIVE status for the playground. SUPERADMIN
// only — the route is the SUPERADMIN-gated playground entry; production
// flows graduate to OPERATOR in P2 once the chat surface is real.

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) return auth.error;

  let body: { playbookId?: string; specKey?: string; specVersion?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { playbookId, specKey, specVersion } = body;
  if (!playbookId || !specKey || typeof specVersion !== "number") {
    return NextResponse.json(
      { error: "playbookId, specKey, specVersion required" },
      { status: 400 },
    );
  }

  // Cap to one ACTIVE session per playbook — abandon any prior ACTIVE
  // rows. This is the application-layer enforcement of the
  // "at most one active session" invariant noted in the schema
  // comment (no DB unique index because COMPLETED / ABANDONED rows
  // accumulate).
  await prisma.wizardSession.updateMany({
    where: { playbookId, status: "ACTIVE" },
    data: { status: "ABANDONED" },
  });

  const session = await prisma.wizardSession.create({
    data: {
      playbookId,
      specKey,
      specVersion,
      status: "ACTIVE",
    },
  });

  return NextResponse.json({ sessionId: session.id });
}
