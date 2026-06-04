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
        deliveryMethod: "banner",
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

  // Resolve classroomToken (Option B routing): call the existing
  // /api/join/:token endpoint, write classroomToken + classroomName
  // into session values, emit a ClassroomResolved custom event so the
  // enrollment.classroom-resolved post-Contract is satisfied.
  let welcomeMessage =
    "Welcome — I'll get you enrolled. I'll need four things: your first name, last name, age range, and email. What's your first name?";
  if (body.classroomToken) {
    const origin = req.nextUrl.origin;
    const joinRes = await fetch(`${origin}/api/join/${body.classroomToken}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!joinRes.ok) {
      return NextResponse.json(
        { error: "Invalid or expired classroom token" },
        { status: 404 },
      );
    }
    const joinData = (await joinRes.json()) as {
      ok?: boolean;
      classroom?: { name?: string; domain?: string };
    };
    const classroomName = joinData.classroom?.name ?? body.classroomToken;
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

  appendMessage(session, "system", welcomeMessage);

  return NextResponse.json({
    intentId: session.intentId,
    events: session.events,
    suggestions: [],
    values: session.values,
    messages: session.messages,
  });
}
