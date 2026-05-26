/**
 * Apply pending changes from the PendingChangesTray (epic #854 / Story #857).
 *
 * The tray accumulates compose-affecting settings edits across surfaces.
 * Underlying writes happen at push time (each surface writes immediately
 * — this is the simplified v1 model documented in the epic body). The
 * tray's Save & apply button calls THIS endpoint to act on the toggle
 * decisions:
 *
 *   • Toggle 1 (per-caller): call `autoComposeForCaller(callerId, playbookId)`
 *     — recomposes only the caller-in-context, single network operation.
 *
 *   • Toggle 2 (cohort fan-out): POST to
 *     `/api/playbooks/[playbookId]/recompose-all` for each unique
 *     playbook scope referenced by the entries. Story #858 wraps this
 *     with a UserTask job record + progress toast.
 *
 *   • PENDING_CHANGES_APPLIED audit row is written regardless of which
 *     toggles fired — gives an auditable record of every Save & apply,
 *     including the decision to NOT fan out.
 *
 * AI-safety server-side enforcement (defence-in-depth):
 *   If ANY entry in the payload has `aiSuggested: true`, the cohort
 *   fan-out (Toggle 2) is rejected. The ESLint rule
 *   `hf-recompose/no-ai-fanout-all` is the build-time guard; this is
 *   the runtime guard for the case where an AI somehow bypasses the
 *   rule (variable-assembled options, dynamic imports, etc.).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { auditLog, AuditAction } from "@/lib/audit";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";

export const runtime = "nodejs";

const trayEntrySchema = z
  .object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
    scopeLabel: z.string(),
    beforeValue: z.string(),
    afterValue: z.string(),
    scope: z.enum(["playbook", "domain", "system"]),
    scopeId: z.string().nullable(),
    aiSuggested: z.boolean(),
    fanoutScope: z.enum(["none", "caller", "all"]),
  })
  .strict();

const callerInContextSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

const bodySchema = z
  .object({
    entries: z.array(trayEntrySchema).min(1),
    toggleCaller: z.boolean(),
    toggleAll: z.boolean(),
    callerInContext: callerInContextSchema.nullable(),
  })
  .strict();

type ApplyResult = {
  ok: true;
  audited: boolean;
  callerRecomposed: boolean;
  cohortRecomposeAttempts: Array<{
    playbookId: string;
    ok: boolean;
    total?: number;
    succeeded?: number;
    failed?: number;
    error?: string;
  }>;
};

function uniquePlaybookScopeIds(entries: z.infer<typeof trayEntrySchema>[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.scope === "playbook" && e.scopeId) ids.add(e.scopeId);
  }
  return [...ids];
}

/**
 * @api POST /api/recompose/apply
 * @visibility internal
 * @scope recompose:write
 * @auth session OPERATOR
 * @tags recompose
 * @description Acts on the toggle decisions from the PendingChangesTray's
 *   Save & apply button. Underlying writes already happened at push time;
 *   this endpoint only triggers recompose paths + emits the audit row.
 * @body { entries: TrayEntry[]; toggleCaller: bool; toggleAll: bool; callerInContext: {id,name}|null }
 * @response 200 { ok, audited, callerRecomposed, cohortRecomposeAttempts[] }
 * @response 400 { ok: false, error } — invalid body or AI-safety violation
 * @response 401/403 via requireAuth
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.message },
        { status: 400 },
      );
    }
    const { entries, toggleCaller, toggleAll, callerInContext } = parsed.data;

    // AI-safety defence-in-depth — block cohort fan-out when any entry
    // came from an AI surface. The ESLint rule blocks `fanoutScope: 'all'`
    // at AI tool call sites; this catches the case where AI-sourced
    // entries land in the tray and a (compromised or buggy) UI tries to
    // sneak Toggle 2 ON.
    const hasAiSuggested = entries.some((e) => e.aiSuggested);
    if (hasAiSuggested && toggleAll) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cohort fan-out is disabled when any pending change is AI-suggested. Save with Toggle 2 off, then enable manually if needed.",
        },
        { status: 400 },
      );
    }

    const result: ApplyResult = {
      ok: true,
      audited: false,
      callerRecomposed: false,
      cohortRecomposeAttempts: [],
    };

    // ── Toggle 1: per-caller recompose ───────────────────────────────
    if (toggleCaller && callerInContext) {
      // Prefer a playbook id from the entries to scope the recompose;
      // fall back to no playbook id (autoComposeForCaller handles both).
      const firstPlaybookId =
        entries.find((e) => e.scope === "playbook" && e.scopeId)?.scopeId ?? null;
      try {
        await autoComposeForCaller(callerInContext.id, firstPlaybookId);
        result.callerRecomposed = true;
      } catch (err: unknown) {
        // Non-fatal — log + audit, return false so the client can show a
        // partial-success message instead of failing the whole save.
        console.warn(
          "[recompose/apply] autoComposeForCaller failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Toggle 2: cohort fan-out per unique playbook scope ───────────
    if (toggleAll) {
      const playbookIds = uniquePlaybookScopeIds(entries);
      for (const playbookId of playbookIds) {
        try {
          const url = new URL(
            `/api/playbooks/${playbookId}/recompose-all`,
            request.url,
          );
          const res = await fetch(url, {
            method: "POST",
            // Forward auth cookies so the downstream route sees the
            // same session as this one.
            headers: { cookie: request.headers.get("cookie") ?? "" },
          });
          const json = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          result.cohortRecomposeAttempts.push({
            playbookId,
            ok: Boolean(json.ok),
            total: typeof json.total === "number" ? json.total : undefined,
            succeeded:
              typeof json.succeeded === "number" ? json.succeeded : undefined,
            failed: typeof json.failed === "number" ? json.failed : undefined,
            error:
              typeof json.error === "string" ? json.error : undefined,
          });
        } catch (err: unknown) {
          result.cohortRecomposeAttempts.push({
            playbookId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Audit (always) — A9 ──────────────────────────────────────────
    try {
      await auditLog({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: AuditAction.PENDING_CHANGES_APPLIED,
        entityType: "PendingChanges",
        entityId: undefined,
        metadata: {
          entryCount: entries.length,
          aiSuggestedCount: entries.filter((e) => e.aiSuggested).length,
          toggleCaller,
          toggleAll,
          callerRecomposed: result.callerRecomposed,
          cohortRecomposePlaybookIds: uniquePlaybookScopeIds(entries),
          callerInContextId: callerInContext?.id ?? null,
        },
      });
      result.audited = true;
    } catch (err: unknown) {
      // Audit failures should not block the user — log and move on.
      console.warn(
        "[recompose/apply] audit log failed:",
        err instanceof Error ? err.message : err,
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/recompose/apply] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
