/**
 * @api GET /api/calls/:callId/pinned-card
 * @visibility internal
 * @scope calls:read
 * @auth VIEWER (STUDENT scoped to own caller; OPERATOR+ unrestricted)
 * @tags calls, voice, ielts
 * @description #1744 (epic #1700 Theme 3) — read the persisted
 * `Session.metadata.pinnedCard` so `<PinnedCardSlot>` can render the
 * Part 2 / Part 3 / Mock cue card above SimChat. The write happens at
 * session-start in `createSession` (#1733) under the same selection
 * policy the prompt-side composer uses, so the UI card and the
 * composed CUE CARD directive agree byte-for-byte.
 *
 * Returns `{ ok: true, card: null }` when:
 *   - `HF_FLAG_IELTS_MODULE_SETTINGS` is off
 *   - the call has no `sessionId` (legacy)
 *   - the Session has no `metadata.pinnedCard` (no cueCardPool / non-IELTS)
 *
 * @response 200 { ok: true, card: PinnedCardContent | null }
 * @response 403 { ok: false, error: "STUDENT cannot read a different caller" }
 * @response 404 { ok: false, error: "Call not found" }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import type { PinnedCardContent, SessionMetadata } from "@/lib/types/json-fields";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callId } = await params;

  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      callerId: true,
      session: { select: { metadata: true } },
    },
  });
  if (!call) {
    return NextResponse.json({ ok: false, error: "Call not found" }, { status: 404 });
  }

  if (!studentAllowedToReadCaller(auth.session, call.callerId ?? "")) {
    return callerScopeMismatchResponse();
  }

  if (!isIeltsModuleSettingsEnabled()) {
    return NextResponse.json({ ok: true, card: null });
  }

  const metadata = (call.session?.metadata ?? null) as SessionMetadata | null;
  const card: PinnedCardContent | null = metadata?.pinnedCard ?? null;

  return NextResponse.json({ ok: true, card });
}
