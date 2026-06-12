// POST /api/intake/bootstrap
//
// Phase 1 bootstrap — opens a new IntakeSession for the
// EnrollmentIntake spec. Emits the two required Disclosures (GDPR
// Art 13 + EU AI Act Art 50) as DisclosureDelivered events. Returns
// initial session state for the chat UI to render.
//
// Phase 1 storage: in-memory session-store (see lib/intake/session-store.ts).
// PrismaEventStore wiring is Phase 1.5 (lib/intake/hf-adapter/event-store.ts).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveTenantCtx } from "@/lib/intake/hf-adapter/auth";
import { loadDisclosureCopy } from "@/lib/intake/hf-adapter/disclosure-content";
import {
  getDisclosureStore,
  deriveDisclosureId,
} from "@/lib/intake/hf-adapter/disclosure-store";
import {
  openSession,
  appendEvent,
  appendMessage,
  setValue,
  PURPOSE,
} from "@/lib/intake/session-store";
import { setIntakeSidCookie } from "@/lib/intake/intake-session-cookie";
import type {
  IntentKey,
  ProjectionName,
  SubjectId,
} from "@/lib/intake/tallyseal";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  chatSessionId: z.string().min(1).max(120),
  specKey: z.literal("EnrollmentIntake"),
  classroomToken: z.string().min(1).max(120).optional(),
  // V2 path support: when set, these field values are pre-populated on the
  // intent at bootstrap time so the spec-driven chat (#1130) skips asking
  // for them. Used by /intake/v2 where email is captured BEFORE the chat
  // starts (auth-first flow). Only string-valued fields are accepted —
  // sufficient for the current spec fields (firstName, lastName, email,
  // ageRange, phone, etc.); booleans/numbers can be added later.
  prefilledValues: z.record(z.string(), z.string()).optional(),
});

const INTAKE_KEY = "EnrollmentIntake" as IntentKey;
const PROJECTION = "IntakeApplication" as ProjectionName;

const ART13_REQUIREMENT_ID = "gdpr.art13.privacy-notice";
const ART50_REQUIREMENT_ID = "eu-ai-act.art50.ai-interaction-disclosure";

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const ctx = await resolveTenantCtx(body.chatSessionId);
  const session = openSession({
    tenant: ctx.tenant,
    actor: ctx.actor,
    key: INTAKE_KEY,
    projection: PROJECTION,
  });

  // The chat session ID becomes the SubjectId for events fired during
  // this intake — it's stable across the conversation and lets the
  // audit bundle attribute disclosures + consents to one data subject.
  const subjectId = `intake-subject-${body.chatSessionId}` as SubjectId;

  // Deliver the two required disclosures. Each fires a
  // DisclosureDelivered event referencing the requirementId + the
  // copy's contentHash. The runtime safety belt in
  // disclosure-content.ts throws DraftCopyInProductionError if any
  // copy is status=DRAFT and NODE_ENV=production.
  for (const requirementId of [ART13_REQUIREMENT_ID, ART50_REQUIREMENT_ID]) {
    let copy;
    try {
      copy = await loadDisclosureCopy(requirementId);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "disclosure copy missing" },
        { status: 500 },
      );
    }
    const deliveredAt = new Date();
    appendEvent(session, {
      kind: "DisclosureDelivered",
      payload: {
        requirementId,
        contentHash: copy.contentHash,
        version: copy.meta.version,
        status: copy.meta.status,
        locale: copy.meta.locale,
        controller: copy.meta.controller,
        deliveredAt: deliveredAt.toISOString(),
      },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [subjectId],
    });

    // Q-CR9 write-path: populate tallyseal_disclosure alongside the
    // in-memory event. Best-effort — failure logs but doesn't block
    // intake (Q2 founder guidance; Q-BRIDGE-RECORDER-DURABILITY).
    // Note: passing Date (not ISO string) because the underlying
    // SQL column is `timestamptz` — the SDK's `Timestamp = Brand<string>`
    // type contract is structurally satisfied by Date at runtime via
    // Prisma's coercion; the cast bypasses the type-only mismatch.
    try {
      const store = await getDisclosureStore();
      await store.record({
        id: deriveDisclosureId(session.intentId, requirementId),
        tenantId: session.tenant.id,
        subject: subjectId,
        requirementId,
        content: copy.content,
        contentHash: copy.contentHash,
        deliveredAt,
        // 'in-app' per the SDK CHECK constraint
        // (delivery_method IN 'in-app','email','sms','mail','api').
        // HF delivers via TallysealBanner — closest semantic match.
        deliveryMethod: "in-app",
        acknowledgedAt: null,
        retractedAt: null,
      } as never);
    } catch (err) {
      console.error(
        "[intake/bootstrap] disclosureStore.record failed (continuing):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Resolve classroomToken (Option B routing): look up the cohort
  // directly, write classroomToken + classroomName into session values,
  // emit a ClassroomResolved custom event so the
  // enrollment.classroom-resolved post-Contract is satisfied.
  //
  // Was: HTTP-fetched /api/join/<token>. That route is rate-limited per
  // client IP — a learner triple-tapping the page or a dev demo would
  // 429 the bootstrap into a misleading "Invalid or expired classroom
  // token" 404. Direct query has no rate limit and one less network hop.
  let welcomeMessage =
    "Welcome — I'll get you enrolled. I'll need four things: your first name, last name, age range, and email. What's your first name?";
  if (body.classroomToken) {
    const cohort = await prisma.cohortGroup.findUnique({
      where: { joinToken: body.classroomToken },
      select: {
        name: true,
        isActive: true,
        joinTokenExp: true,
      },
    });
    if (!cohort || !cohort.isActive) {
      return NextResponse.json(
        { error: "Invalid or expired classroom token" },
        { status: 404 },
      );
    }
    if (cohort.joinTokenExp && cohort.joinTokenExp < new Date()) {
      return NextResponse.json(
        { error: "This classroom link has expired" },
        { status: 410 },
      );
    }
    const classroomName = cohort.name ?? body.classroomToken;
    setValue(session, "classroomToken", body.classroomToken);
    setValue(session, "classroomName", classroomName);
    appendEvent(session, {
      kind: "ClassroomResolved" as never,
      payload: {
        classroomToken: body.classroomToken,
        classroomName,
        resolvedAt: new Date().toISOString(),
      },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [subjectId],
    });
    welcomeMessage = `Welcome — you're enrolling in "${classroomName}". I'll need four things: your first name, last name, age range, and email. What's your first name?`;
  }

  // V2 path: pre-populate captured fields so the spec-driven chat skips
  // them. The chat AI sees the snapshot at first turn and asks only for
  // fields that are still missing per the spec's readiness gate.
  if (body.prefilledValues) {
    for (const [key, value] of Object.entries(body.prefilledValues)) {
      if (typeof value === "string" && value.trim().length > 0) {
        setValue(session, key, value);
      }
    }
  }

  appendMessage(session, "system", welcomeMessage);

  // HF-D P1: the intentId travels as an httpOnly cookie (see
  // lib/intake/intake-session-cookie.ts). The response body still
  // includes it because the EnrollmentChat client surfaces it for the
  // /api/join/[token] linkage step at end-of-flow and because tests
  // assert on it; the bearer transport for every subsequent route on
  // this surface is the cookie, not the body field.
  const response = NextResponse.json({
    intentId: session.intentId,
    events: session.events,
    suggestions: [],
    values: session.values,
    messages: session.messages,
  });
  setIntakeSidCookie(response, session.intentId);
  return response;
}
