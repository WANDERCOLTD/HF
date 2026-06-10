import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { enrollCallerInCohortPlaybooks } from "@/lib/enrollment";
import { randomUUID } from "node:crypto";

const bodySchema = z
  .object({
    classroomToken: z.string().min(1).max(120),
  })
  .strict();

/**
 * @api POST /api/intake/v2/admin-test-enrol
 * @visibility internal (OPERATOR+)
 * @auth session (OPERATOR / EDUCATOR / ADMIN / SUPERADMIN)
 * @description Admin escape hatch on the V2 intake entry screen
 * (EnrolV2EntryClient). Creates a synthetic test User + Caller for
 * the given classroom token WITHOUT issuing a PIN, WITHOUT replacing
 * the admin's session cookie, and returns a redirect straight to
 * `/x/sim/<callerId>` so the admin can immediately browse the
 * resulting sim surface while staying authenticated as themselves.
 *
 * Synthetic identity shape:
 *   firstName: "Test"
 *   lastName:  "Admin-<short>" (8-char hex from UUID)
 *   email:     "test-admin-<short>@hf-admin.local"
 *
 * The `.local` TLD guarantees the email is non-routable — no real
 * deliverability risk if the row leaks into a mailing.
 *
 * Strictly OPERATOR+. STUDENT/VIEWER/TESTER refused 401 by
 * requireAuth. The route never sets a session cookie on the response,
 * so the admin's existing session is preserved.
 *
 * Audit: `console.warn("[intake-v2/admin-test-enrol] …")` so the
 * action is traceable.
 *
 * @response 200 { ok: true, callerId, redirect: "/x/sim/<callerId>" }
 * @response 400 { ok: false, error: string } — invalid body
 * @response 401 — caller not authenticated or not OPERATOR+
 * @response 404 { ok: false, error: "Invalid or expired classroom token" }
 */
export async function POST(req: Request) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }
  const { classroomToken } = parsed.data;

  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: classroomToken },
    select: {
      id: true,
      isActive: true,
      joinTokenExp: true,
      domainId: true,
      institutionId: true,
    },
  });
  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired classroom token" },
      { status: 404 },
    );
  }
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This classroom link has expired" },
      { status: 410 },
    );
  }

  // Synthetic identity. Short hex keeps the display name readable
  // ("warren-Admin-a3f9c2b1") while still avoiding email-uniqueness
  // collisions across many test runs.
  const short = randomUUID().replace(/-/g, "").slice(0, 8);
  const firstName = "Test";
  const lastName = `Admin-${short}`;
  const email = `test-admin-${short}@hf-admin.local`;
  const placeholderName = `${firstName} ${lastName}`;

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: placeholderName,
        displayName: firstName,
        role: "STUDENT",
        emailVerified: new Date(),
        isActive: true,
        assignedDomainId: cohort.domainId,
        institutionId: cohort.institutionId,
      },
    });
    const caller = await tx.caller.create({
      data: {
        name: placeholderName,
        email,
        role: "LEARNER",
        userId: user.id,
        domainId: cohort.domainId,
        cohortGroupId: cohort.id,
        externalId: `admin-test-${user.id}`,
      },
    });
    await tx.callerCohortMembership.create({
      data: { callerId: caller.id, cohortGroupId: cohort.id },
    });
    return { userId: user.id, callerId: caller.id };
  });

  if (cohort.domainId) {
    // #1429 — `policyMode: 'demo'` flags this synthetic caller for eager
    // reprompt-on-bump (see `lib/compose/eager-reprompt-on-bump.ts`).
    // A test call made seconds after an educator tweaks a setting will
    // see the new config — no waiting for next-call-but-one.
    await enrollCallerInCohortPlaybooks(
      result.callerId,
      cohort.id,
      cohort.domainId,
      "admin-test-enrol",
      undefined,
      { policyMode: "demo" },
    );
  }

  console.warn(
    `[intake-v2/admin-test-enrol] OPERATOR+ created test caller ${result.callerId} (user ${result.userId}, email ${email}) — admin=${auth.session.user.id} (${auth.session.user.role}) cohort=${cohort.id} at ${new Date().toISOString()}`,
  );

  // No session cookie minted on this response — the admin keeps their
  // own session. They'll browse /x/sim/<callerId> as themselves
  // (OPERATOR+ may read any caller per RBAC).
  return NextResponse.json({
    ok: true,
    callerId: result.callerId,
    redirect: `/x/sim/${result.callerId}`,
  });
}
