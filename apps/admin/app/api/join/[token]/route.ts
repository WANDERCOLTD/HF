import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateBody, joinPostSchema } from "@/lib/validation";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";
import { enrollCaller, enrollCallerInCohortPlaybooks } from "@/lib/enrollment";
import { applySkipOnboarding } from "@/lib/enrollment/skip-onboarding";
import { mintAndSetSessionCookie } from "@/lib/auth-session-cookie";
import { issueFirstCallPin } from "@/lib/identity/issue-pin";
import { toE164 } from "@/lib/voice/phone-format";
import { hasHigherRoleSession } from "@/lib/auth/has-higher-role-session";
import { writeIntakeQAProjections } from "@/lib/intake/project-intake-qa";
import { isSessionModelV2Enabled } from "@/lib/voice/session-flag";
import { createSession } from "@/lib/voice/create-session";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";
import { pinFirstModuleForCaller } from "@/lib/enrollment/pin-first-module";

function missingSecretResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Server configuration error" },
    { status: 500 },
  );
}

/**
 * #1342 — write the ENROLLMENT Session row that opens the unified
 * narrative for this learner. Linked to the IntakeEvent hash chain via
 * `intentId` when one is supplied.
 *
 * Behind the `HF_FLAG_SESSION_MODEL_V2` flag; until it's enabled the
 * function is a no-op so the existing join flow is untouched. Best-
 * effort (never throws): a Session-create failure must NOT roll back
 * the just-committed Caller. Pre-#1342 the join handler had no Session
 * row at all, so this is strictly additive.
 */
async function maybeWriteEnrollmentSession(
  callerId: string,
  intentId: string | undefined,
): Promise<void> {
  if (!isSessionModelV2Enabled()) return;
  try {
    await createSession({
      callerId,
      kind: "ENROLLMENT",
      source: "join",
      voiceProvider: null,
      ...(intentId ? { intentId } : {}),
    });
  } catch (err) {
    console.error(
      `[intake-join] ENROLLMENT createSession failed for caller=${callerId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * #1420 — fire `autoComposeForCaller` for every ACTIVE enrollment the
 * caller has, one fire-and-forget Promise per playbook. Called POST-tx
 * for paths where `enrollCaller(..., tx)` was used inside `$transaction`
 * — the `!tx` guard in `enrollCaller` suppresses the in-tx auto-compose
 * so the bootstrap prompt never landed and brand-new callers' Call 1
 * hit the `build-assistant-config.ts` hardcoded fallback (live "Welcome,
 * Blush" hallucination, 2026-06-09).
 *
 * Fire-and-forget: failures are logged but NEVER awaited and NEVER
 * propagate to the HTTP response. The reconciler backstop
 * (`reconcileMissingBootstrap`) re-fires for any ACTIVE enrollment that
 * still has no `ComposedPrompt(status='active')` 60s later.
 *
 * Called BEFORE `maybeWriteEnrollmentSession` to maximise the timing
 * window between compose-start and a "call now" click — see #1420 TL
 * review note.
 */
async function fireBootstrapComposeForActiveEnrollments(callerId: string): Promise<void> {
  try {
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { callerId, status: "ACTIVE" },
      select: { playbookId: true },
    });
    for (const { playbookId } of enrollments) {
      // Fire-and-forget — do not await. Errors are caught by
      // autoComposeForCaller's own try/catch and persisted to
      // CallerAttribute(key='compose_error'). The outer .catch here is
      // a safety net for any unhandled rejection escaping that boundary.
      autoComposeForCaller(callerId, playbookId).catch((err) => {
        console.error(
          `[intake-join] post-tx autoCompose failed for caller=${callerId.slice(0, 8)} ` +
            `playbook=${playbookId.slice(0, 8)}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  } catch (err) {
    // Lookup of ACTIVE enrollments failed (DB hiccup). Log and continue —
    // the reconciler backstop will pick this caller up within 60s.
    console.error(
      `[intake-join] post-tx enrollment lookup failed for caller=${callerId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Pin `Caller.lastSelectedModuleId` to the playbook's first module for every
 * ACTIVE enrolment the caller has — the magic-link counterpart of the same
 * call in `lib/enrollment/create-test-learner.ts`. Required so a real
 * magic-link learner's first call doesn't hit the racy
 * `resolveDefaultModuleForCaller` step-1 path (tied `updatedAt` timestamps
 * on bulk-created `CallerModuleProgress` rows → non-deterministic slug pick
 * → `Call.curriculumModuleId = NULL` ~80% of the time).
 *
 * Best-effort — failures here MUST NOT roll back the just-committed
 * Caller. Per-playbook errors are logged + skipped (one bad playbook
 * doesn't poison the rest). The `pinFirstModuleForCaller` helper is
 * idempotent + null-guarded, so re-entry for a returning caller is safe.
 */
async function pinFirstModuleForActiveEnrollments(callerId: string): Promise<void> {
  try {
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { callerId, status: "ACTIVE" },
      select: { playbookId: true },
    });
    for (const { playbookId } of enrollments) {
      await pinFirstModuleForCaller(callerId, playbookId).catch((err) => {
        console.error(
          `[intake-join] pinFirstModule failed for caller=${callerId.slice(0, 8)} ` +
            `playbook=${playbookId.slice(0, 8)}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  } catch (err) {
    console.error(
      `[intake-join] pinFirstModule enrollment lookup failed for caller=${callerId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Separate rate-limit key for GET (token probing) vs POST (account creation) */
const RATE_LIMIT_KEY_VERIFY = "join-verify";

/**
 * @api GET /api/join/[token]
 * @visibility public
 * @auth none
 * @description Verify a classroom/community join token. Returns group info if valid.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rl = checkRateLimit(getClientIP(request), RATE_LIMIT_KEY_VERIFY);
  if (!rl.ok) return rl.error;

  const { token } = await params;

  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: token },
    select: {
      id: true,
      name: true,
      isActive: true,
      joinTokenExp: true,
      domain: { select: { name: true, kind: true, onboardingWelcome: true } },
      owner: { select: { name: true } },
      institution: {
        select: {
          name: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          welcomeMessage: true,
        },
      },
      _count: { select: { members: true } },
    },
  });

  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired join link" },
      { status: 404 }
    );
  }

  // Check expiry
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This join link has expired" },
      { status: 410 }
    );
  }

  return NextResponse.json({
    ok: true,
    classroom: {
      name: cohort.name,
      domain: cohort.domain.name,
      teacher: cohort.owner.name ?? "Your teacher",
      memberCount: cohort._count.members,
      institutionName: cohort.institution?.name ?? null,
      institutionLogo: cohort.institution?.logoUrl ?? null,
      institutionPrimaryColor: cohort.institution?.primaryColor ?? null,
      institutionWelcome: cohort.institution?.welcomeMessage ?? null,
      domainWelcome: cohort.domain.onboardingWelcome ?? null,
      isCommunity: cohort.domain.kind === "COMMUNITY",
    },
  });
}

/**
 * @api POST /api/join/[token]
 * @visibility public
 * @auth none
 * @description Accept a classroom join link. Creates User + Caller + sets session.
 * @body firstName string (required)
 * @body lastName string (required)
 * @body email string (required)
 * @body playbookId string (optional) — enroll in a specific course instead of all cohort playbooks
 * @body skipOnboarding boolean (optional) — skip onboarding wizard + surveys
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const rl = checkRateLimit(getClientIP(request), "join");
  if (!rl.ok) return rl.error;

  const { token } = await params;
  const body = await request.json();
  const v = validateBody(joinPostSchema, body);
  if (!v.ok) return v.error;
  const { firstName, lastName, email, ageRange, playbookId, skipOnboarding, phone, intentId } = v.data;
  // Q&A projection source: the validated body itself. `buildJoinBody` in
  // `IntakeDoneClient` already iterates the EnrollmentIntake spec fields
  // and drops internal/empty entries, so every key landing here is a
  // legitimate captured-field value. See lib/intake/project-intake-qa.ts.
  const intakeQAValues: Readonly<Record<string, unknown>> = {
    firstName,
    lastName,
    email,
    ...(ageRange ? { ageRange } : {}),
    ...(phone ? { phone } : {}),
  };
  // `intentId` from the in-flight intake-chat session. The Session
  // model gained an `intentId` column in #1343 so a future Slice 3
  // `createSession({kind:'ENROLLMENT', intentId})` write here can link
  // the resulting Session row back to the IntakeEvent hash chain.
  // Slice 0 explicitly forbids any application Session writes from
  // landing in this slice — see `prisma/schema.prisma` Session model
  // header — so we observe the field, log it for forensic continuity,
  // and defer the write to Slice 3.
  if (intentId) {
    console.log(`[intake-join] intent=${intentId} committed for token=${token}`);
  }
  // E.164 normalisation via lib/voice/phone-format.ts — was a mechanical
  // strip which let `07…` UK domestic format through unchanged. VAPI
  // requires strict E.164 so the dialer was 502-ing on rural-UK numbers.
  const normalizedPhone = phone ? toE164(phone) : null;

  // Defence-in-depth against URL tampering. The intake spec's
  // `ageBand.adultOnly()` invariant already rejects `under-18` before
  // ProjectionCommit fires (see `apps/admin/lib/intake/specs/enrollment.intent.ts`
  // line ~186), so this should never legitimately reach the endpoint.
  // If it does, refuse the join — the compliance trail must record
  // adult declaration only. See #1036.
  if (ageRange === "under-18") {
    return NextResponse.json(
      { ok: false, error: "Under-18 enrollment is not supported via this flow." },
      { status: 400 }
    );
  }

  // Don't overwrite session cookie for admins/operators testing the join flow
  const skipCookie = await hasHigherRoleSession(request);

  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: token },
    select: {
      id: true,
      isActive: true,
      joinTokenExp: true,
      domainId: true,
      institutionId: true,
      domain: { select: { id: true } },
    },
  });

  if (!cohort || !cohort.isActive) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired join link" },
      { status: 404 }
    );
  }

  // Check expiry
  if (cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date()) {
    return NextResponse.json(
      { ok: false, error: "This join link has expired" },
      { status: 410 }
    );
  }

  // Validate playbookId belongs to the cohort's domain (prevent cross-domain enrollment)
  if (playbookId) {
    const playbook = await prisma.playbook.findFirst({
      where: { id: playbookId, domainId: cohort.domainId },
      select: { id: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found in this classroom" },
        { status: 400 }
      );
    }
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (existingUser) {
    // User exists — check if they already have a caller in this cohort
    // Check if user already has a membership in this cohort (via join table or legacy FK)
    const existingMembership = await prisma.callerCohortMembership.findFirst({
      where: {
        cohortGroupId: cohort.id,
        caller: { userId: existingUser.id },
      },
      select: { callerId: true },
    });
    const existingCallerDirect = !existingMembership
      ? await prisma.caller.findFirst({
          where: { userId: existingUser.id, cohortGroupId: cohort.id },
          select: { id: true },
        })
      : null;

    const returningCallerId = existingMembership?.callerId ?? existingCallerDirect?.id;

    if (returningCallerId) {
      // V2 (auth-first) finish: if the existing Caller has a placeholder
      // name (from /api/intake/v2/start) and the body supplies the real
      // values from the chat-to-complete step, backfill them now. Only
      // touch fields we can confidently set; do not OVERWRITE an existing
      // non-placeholder name. (#1141 Story 2.)
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const existingCaller = await prisma.caller.findUnique({
        where: { id: returningCallerId },
        select: { name: true, phone: true },
      });
      const looksPlaceholder =
        !existingCaller?.name ||
        existingCaller.name === existingUser.name ||
        existingCaller.name === existingUser.email?.split("@")[0] ||
        existingCaller.name.toLowerCase() === "learner";
      const updates: Record<string, string> = {};
      if (looksPlaceholder && firstName.trim() && lastName.trim()) {
        updates.name = fullName;
      }
      if (!existingCaller?.phone && normalizedPhone) {
        updates.phone = normalizedPhone;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.caller.update({
          where: { id: returningCallerId },
          data: updates,
        });
      }
      // ageRange always upserts (idempotent) so an updated declaration
      // overwrites the prior one — same as paths 2 + 3.
      if (ageRange) {
        await prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: {
              callerId: returningCallerId,
              key: "intake.ageRange",
              scope: "GLOBAL",
            },
          },
          create: {
            callerId: returningCallerId,
            key: "intake.ageRange",
            scope: "GLOBAL",
            valueType: "STRING",
            stringValue: ageRange,
            sourceSpecSlug: "EnrollmentIntake",
          },
          update: { stringValue: ageRange },
        });
      }

      // Project the intake Q&A pairs into CallerAttribute(scope='INTAKE_CHAT')
      // so the Tune tab's existing SurveySection reader can render them.
      // Idempotent — upserts on (callerId, key, scope). #1343.
      await writeIntakeQAProjections(prisma, returningCallerId, intakeQAValues);

      // #1342 — ENROLLMENT Session row for the returning learner. The
      // join is a fresh enrolment intent even though the User row
      // already exists; the IntakeEvent chain (if any) belongs to this
      // commit. Flag-gated; no-op when V2 is off.
      await maybeWriteEnrollmentSession(returningCallerId, intentId);

      // Backfill `lastSelectedModuleId` for any returning caller who
      // never made a successful call (the pin helper is null-guarded —
      // it's a no-op if the column is already set, so returning callers
      // with normal module continuity keep their pick).
      await pinFirstModuleForActiveEnrollments(returningCallerId);

      // Returning learner — sign them in and redirect to their journey
      const returningResponse = NextResponse.json({
        ok: true,
        alreadyEnrolled: true,
        message: "Welcome back! Picking up where you left off.",
        callerId: returningCallerId,
        redirect: `/x/sim/${returningCallerId}`,
      });

      try {
        await mintAndSetSessionCookie(returningResponse, existingUser, { skipCookie });
      } catch {
        return missingSecretResponse();
      }

      return returningResponse;
    }

    // Add existing user to this cohort
    const newCaller = await prisma.caller.create({
      data: {
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim().toLowerCase(),
        role: "LEARNER",
        userId: existingUser.id,
        domainId: cohort.domainId,
        cohortGroupId: cohort.id, // legacy FK
        externalId: `join-${existingUser.id}-${cohort.id}`,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      },
    });

    // Persist the declared age band as a CallerAttribute for the
    // compliance trail — #1036. The `intake.ageRange` key + GLOBAL
    // scope mirror existing person-level attributes; valueType STRING
    // because AGE_BAND_VALUES is an enum tuple of strings.
    if (ageRange) {
      await prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId: newCaller.id, key: "intake.ageRange", scope: "GLOBAL" } },
        create: {
          callerId: newCaller.id,
          key: "intake.ageRange",
          scope: "GLOBAL",
          valueType: "STRING",
          stringValue: ageRange,
          sourceSpecSlug: "EnrollmentIntake",
        },
        update: { stringValue: ageRange },
      });
    }

    // Project the intake Q&A pairs into CallerAttribute(scope='INTAKE_CHAT')
    // so the Tune tab's existing SurveySection reader can render them.
    // Idempotent — upserts on (callerId, key, scope). #1343.
    await writeIntakeQAProjections(prisma, newCaller.id, intakeQAValues);

    // #1342 — ENROLLMENT Session row + IntakeEvent linkage.
    await maybeWriteEnrollmentSession(newCaller.id, intentId);

    // Create join table membership
    await prisma.callerCohortMembership.create({
      data: { callerId: newCaller.id, cohortGroupId: cohort.id },
    });

    // Enroll — single course if specified, otherwise all cohort playbooks
    if (cohort.domainId) {
      if (playbookId) {
        await enrollCaller(newCaller.id, playbookId, "join");
      } else {
        await enrollCallerInCohortPlaybooks(newCaller.id, cohort.id, cohort.domainId, "join");
      }
    }

    // Pin first module for every fresh enrolment — sibling-of the
    // post-tx call below. See `pinFirstModuleForActiveEnrollments`
    // header for the rationale.
    await pinFirstModuleForActiveEnrollments(newCaller.id);

    // Skip onboarding if requested
    if (skipOnboarding && cohort.domainId) {
      await applySkipOnboarding(newCaller.id, cohort.domainId);
    }

    // Issue first-call PIN (#1101). Best-effort — SMTP failure won't roll
    // back the Caller; the learner can request a resend on the sim page.
    // originUrl ensures the email's button URL matches the env the learner
    // enrolled in (localhost vs Cloud Run dev vs prod) — hotfix for the
    // localhost-enrolment → dev.humanfirstfoundation.com link mismatch.
    await issueFirstCallPin({
      callerId: newCaller.id,
      email: email.trim().toLowerCase(),
      firstName: firstName.trim(),
      originUrl: request.nextUrl.origin,
    });

    const existingResponse = NextResponse.json({
      ok: true,
      message: "Joined classroom",
      callerId: newCaller.id,
      redirect: `/x/sim/${newCaller.id}`,
    });

    try {
      await mintAndSetSessionCookie(existingResponse, existingUser, { skipCookie });
    } catch {
      return missingSecretResponse();
    }

    return existingResponse;
  }

  // Create new user + caller in one transaction
  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: email.trim().toLowerCase(),
        name: `${firstName.trim()} ${lastName.trim()}`,
        displayName: firstName.trim(),
        role: "STUDENT",
        emailVerified: new Date(),
        isActive: true,
        assignedDomainId: cohort.domainId,
        institutionId: cohort.institutionId,
      },
    });

    const newCaller = await tx.caller.create({
      data: {
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim().toLowerCase(),
        role: "LEARNER",
        userId: newUser.id,
        domainId: cohort.domainId,
        cohortGroupId: cohort.id, // legacy FK
        externalId: `join-${newUser.id}`,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      },
    });

    // Persist the declared age band as a CallerAttribute for the
    // compliance trail — #1036. Same pattern as the existing-user path
    // above; here we write inside the user+caller transaction.
    if (ageRange) {
      await tx.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId: newCaller.id, key: "intake.ageRange", scope: "GLOBAL" } },
        create: {
          callerId: newCaller.id,
          key: "intake.ageRange",
          scope: "GLOBAL",
          valueType: "STRING",
          stringValue: ageRange,
          sourceSpecSlug: "EnrollmentIntake",
        },
        update: { stringValue: ageRange },
      });
    }

    // Project the intake Q&A pairs into CallerAttribute(scope='INTAKE_CHAT')
    // so the Tune tab's existing SurveySection reader can render them.
    // Idempotent — upserts on (callerId, key, scope). #1343.
    await writeIntakeQAProjections(tx, newCaller.id, intakeQAValues);

    // Create join table membership
    await tx.callerCohortMembership.create({
      data: { callerId: newCaller.id, cohortGroupId: cohort.id },
    });

    // Enroll — single course if specified, otherwise all cohort playbooks
    if (cohort.domainId) {
      if (playbookId) {
        await enrollCaller(newCaller.id, playbookId, "join", tx);
      } else {
        await enrollCallerInCohortPlaybooks(newCaller.id, cohort.id, cohort.domainId, "join", tx);
      }
    }

    return { newUser, newCallerId: newCaller.id };
  });

  // Pin `Caller.lastSelectedModuleId` for every fresh ACTIVE enrolment.
  // Closes the racy `resolveDefaultModuleForCaller` step-1 path that
  // produced `Call.curriculumModuleId = NULL` ~80% of the time for
  // magic-link learners. Runs awaited (cheap — one indexed UPDATE per
  // playbook) so the pin lands before any "call now" click can race the
  // resolver. Sibling of the same call in
  // `lib/enrollment/create-test-learner.ts`.
  await pinFirstModuleForActiveEnrollments(result.newCallerId);

  // #1420 — fire the bootstrap compose BEFORE writing the ENROLLMENT
  // Session row. `enrollCaller(..., tx)` inside the just-committed tx
  // tripped the `!tx` guard and silently skipped `autoComposeForCaller`,
  // leaving brand-new callers' Call 1 with no `ComposedPrompt(status='active')`
  // to resolve via I-CT2 step 2. The fire-and-forget compose populates
  // that row so step 2 returns a real prompt by the time the caller dials.
  // Ordering BEFORE `maybeWriteEnrollmentSession` maximises the timing
  // window between compose-start and a "call now" click.
  await fireBootstrapComposeForActiveEnrollments(result.newCallerId);

  // #1342 — ENROLLMENT Session row. Outside the user+caller tx by
  // design (same as the PIN email and `applySkipOnboarding`): a
  // Session-create failure must NOT roll back the just-committed
  // Caller. Flag-gated; no-op when V2 is off.
  await maybeWriteEnrollmentSession(result.newCallerId, intentId);

  // Skip onboarding after tx commits (applySkipOnboarding uses global prisma)
  if (skipOnboarding && cohort.domainId) {
    await applySkipOnboarding(result.newCallerId, cohort.domainId);
  }

  // Issue first-call PIN (#1101). Outside the transaction by design — SMTP
  // failure must not roll back the user+caller create. TL review note.
  // originUrl from the actual request so localhost enrollees get a localhost
  // link, dev.humanfirstfoundation.com enrollees get a dev link, etc.
  await issueFirstCallPin({
    callerId: result.newCallerId,
    email: email.trim().toLowerCase(),
    firstName: firstName.trim(),
    originUrl: request.nextUrl.origin,
  });

  const response = NextResponse.json({
    ok: true,
    message: "Welcome! You've joined the classroom.",
    callerId: result.newCallerId,
    redirect: `/x/sim/${result.newCallerId}`,
  });

  try {
    await mintAndSetSessionCookie(response, result.newUser, { skipCookie });
  } catch {
    return missingSecretResponse();
  }

  return response;
}
