import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";

/**
 * @api POST /api/wizard/discard-draft
 * @visibility internal
 * @scope wizard:write
 * @auth bearer (OPERATOR+)
 * @tags wizard, cleanup
 * @description Mark a partially-built wizard attempt as abandoned so the next
 * attempt cannot resume it via `resolveCourseByName`. Called fire-and-forget
 * from `handleStartOver` BEFORE `clearData()`.
 *
 * Behaviour by ID:
 *   - `draftPlaybookId`: status STAYS `DRAFT` (no migration), but
 *     `config.wizardAbandonedAt` is set and `name` gets an "[abandoned ...]"
 *     suffix so the exact-match resolver misses it. `resolveCourseByName`
 *     additionally filters out playbooks where this flag is non-null.
 *     PUBLISHED / ARCHIVED playbooks are skipped (defensive — they shouldn't
 *     be in the wizard bag, but a partial state shouldn't corrupt a live
 *     course).
 *   - `draftCallerId` / `draftDemoCallerId`: `archivedAt = NOW()`.
 *   - `draftInstitutionId` / `draftDomainId`: NOT touched (per AC — these
 *     are permanent records that may be shared).
 *
 * Returns 200 with `{ ok: true, discarded: {...} }` describing what was
 * touched. Returns 200 with `discarded: null` when no IDs were provided
 * (Start Over before `create_institution` ran — not an error).
 *
 * @response { ok: true, discarded: { playbookId?: string, callerIds?: string[] } | null }
 */
const bodySchema = z
  .object({
    draftPlaybookId: z.string().uuid().optional().nullable(),
    draftDomainId: z.string().uuid().optional().nullable(),
    draftInstitutionId: z.string().uuid().optional().nullable(),
    draftCallerId: z.string().uuid().optional().nullable(),
    draftDemoCallerId: z.string().uuid().optional().nullable(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { draftPlaybookId, draftCallerId, draftDemoCallerId } = parsed.data;

  const discarded: { playbookId?: string; callerIds?: string[] } = {};
  const touchedCallers: string[] = [];

  try {
    // ── Playbook: mark abandoned via config flag + name suffix ──
    if (draftPlaybookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: draftPlaybookId },
        select: { id: true, name: true, status: true, config: true, domainId: true },
      });

      if (pb && pb.status === "DRAFT") {
        // Optional defense-in-depth: only allow abandoning a draft whose
        // domain belongs to the caller's institution. SUPERADMIN can touch
        // any draft. For other roles, fetch the domain's institutionId and
        // compare.
        let allowed = session.user.role === "SUPERADMIN";
        if (!allowed) {
          const domain = await prisma.domain.findUnique({
            where: { id: pb.domainId },
            select: { institutionId: true },
          });
          allowed = domain?.institutionId === session.user.institutionId;
        }

        if (allowed) {
          const stamp = new Date().toISOString();
          // Config write goes through the helper so the
          // `hf-playbook/no-direct-config-write` lint rule passes. The
          // helper's staleness bump won't fire — `wizardAbandonedAt` is not
          // in COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS — which is correct:
          // an abandoned playbook should NOT trigger downstream recomposes.
          await updatePlaybookConfig(
            draftPlaybookId,
            (cfg) => ({ ...(cfg ?? {}), wizardAbandonedAt: stamp }),
            { reason: "wizard discard-draft (#929)" },
          );
          // Separate name-only update — the lint rule only blocks writes
          // that include `config`. Name suffix is for UI clarity in
          // playbook listings; the functional barrier is the config flag.
          const newName = /\[abandoned /.test(pb.name)
            ? pb.name
            : `${pb.name} [abandoned ${stamp}]`;
          if (newName !== pb.name) {
            await prisma.playbook.update({
              where: { id: draftPlaybookId },
              data: { name: newName },
            });
          }
          discarded.playbookId = draftPlaybookId;
          console.log(`[discard-draft] Marked playbook ${draftPlaybookId} abandoned (renamed to "${newName}")`);
        }
      }
    }

    // ── Callers: soft-delete via archivedAt ──
    for (const callerId of [draftCallerId, draftDemoCallerId]) {
      if (!callerId) continue;
      const caller = await prisma.caller.findUnique({
        where: { id: callerId },
        select: { id: true, archivedAt: true, domainId: true },
      });
      if (!caller || caller.archivedAt) continue;

      // Same defense-in-depth as playbook
      let allowed = session.user.role === "SUPERADMIN";
      if (!allowed && caller.domainId) {
        const domain = await prisma.domain.findUnique({
          where: { id: caller.domainId },
          select: { institutionId: true },
        });
        allowed = domain?.institutionId === session.user.institutionId;
      }

      if (allowed) {
        await prisma.caller.update({
          where: { id: callerId },
          data: { archivedAt: new Date() },
        });
        touchedCallers.push(callerId);
      }
    }
    if (touchedCallers.length > 0) discarded.callerIds = touchedCallers;

    if (!discarded.playbookId && touchedCallers.length === 0) {
      return NextResponse.json({ ok: true, discarded: null });
    }

    return NextResponse.json({ ok: true, discarded });
  } catch (err) {
    console.error("[discard-draft] Failed:", err);
    return NextResponse.json({ error: "Failed to discard draft" }, { status: 500 });
  }
}
