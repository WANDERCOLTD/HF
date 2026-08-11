/**
 * POST /api/admin/pilot/nudge-inactive
 *
 * Cloud Scheduler-triggered retention email for pilot learners.
 *
 * Fires a "come back" email to every LEARNER whose last real session
 * (VOICE_CALL / SIM_CALL) ended between 48h and 168h ago, unless they
 * were already nudged in the last 7 days.
 *
 * Auth: x-internal-secret header must match config.security.internalApiSecret.
 *
 * Dedup: CallerAttribute key = "pilot:last_nudge_at", scope = "GLOBAL".
 * Written after every successful email send.
 *
 * Environment:
 *   INTERNAL_API_SECRET  — required (already set for the admin service)
 *   RESEND_API_KEY       — required for email delivery (skips send if unset)
 *   PILOT_NUDGE_FROM     — sender address (default: resend@thewanders.com)
 *   PILOT_NUDGE_REPLY_TO — Reply-To address (default: hfpw@thewanders.com)
 *
 * Manual smoke test:
 *   curl -X POST https://dev.humanfirstfoundation.com/api/admin/pilot/nudge-inactive \
 *     -H "x-internal-secret: <INTERNAL_API_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"dryRun":true}'
 *
 * Cloud Scheduler wire-up:
 *   gcloud scheduler jobs create http pilot-nudge-inactive \
 *     --project=hf-admin-prod --location=europe-west2 \
 *     --schedule="0 15 * * *" --time-zone="Europe/London" \
 *     --uri="https://dev.humanfirstfoundation.com/api/admin/pilot/nudge-inactive" \
 *     --http-method=POST \
 *     --headers="x-internal-secret=<INTERNAL_API_SECRET>,Content-Type=application/json" \
 *     --message-body='{}'
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

interface RequestBody {
  dryRun?: boolean;
  inactiveHoursMin?: number; // default 48
  inactiveHoursMax?: number; // default 168 (7 days)
  cooldownHours?: number; // default 168 (don't nudge same caller more than weekly)
}

const NUDGE_ATTR_KEY = "pilot:last_nudge_at";

export async function POST(req: Request) {
  const secretHeader = req.headers.get("x-internal-secret");
  if (!secretHeader || secretHeader !== config.security.internalApiSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body: RequestBody = await parseBody(req);
  const dryRun = body.dryRun === true;
  const inactiveHoursMin = body.inactiveHoursMin ?? 48;
  const inactiveHoursMax = body.inactiveHoursMax ?? 168;
  const cooldownHours = body.cooldownHours ?? 168;

  const now = new Date();
  const windowStart = new Date(now.getTime() - inactiveHoursMax * 3_600_000);
  const windowEnd = new Date(now.getTime() - inactiveHoursMin * 3_600_000);
  const cooldownCutoff = new Date(now.getTime() - cooldownHours * 3_600_000);

  // Candidate learners: LEARNER role, not deleted, has email.
  const candidates = await prisma.caller.findMany({
    where: {
      role: "LEARNER",
      archivedAt: null,
      email: { not: null },
      sessions: {
        some: {
          kind: { in: ["VOICE_CALL", "SIM_CALL"] },
          endedAt: { gte: windowStart, lte: windowEnd },
        },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      callerAttributes: {
        where: { key: NUDGE_ATTR_KEY, scope: "GLOBAL" },
        take: 1,
      },
      sessions: {
        where: {
          kind: { in: ["VOICE_CALL", "SIM_CALL"] },
          endedAt: { not: null },
        },
        orderBy: { endedAt: "desc" },
        take: 1,
        select: { endedAt: true },
      },
    },
  });

  const eligible = candidates.filter((c) => {
    const lastNudge = c.callerAttributes[0];
    if (!lastNudge) return true;
    const lastNudgeAt = lastNudge.stringValue
      ? new Date(lastNudge.stringValue)
      : null;
    if (!lastNudgeAt) return true;
    return lastNudgeAt < cooldownCutoff;
  });

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.PILOT_NUDGE_FROM ?? "resend@thewanders.com";
  const replyTo = process.env.PILOT_NUDGE_REPLY_TO ?? "hfpw@thewanders.com";

  const results: Array<{
    callerId: string;
    email: string;
    status: "sent" | "dry-run" | "failed" | "skipped-no-key";
    error?: string;
  }> = [];

  for (const caller of eligible) {
    if (!caller.email) continue;
    const lastEnd = caller.sessions[0]?.endedAt;
    const hoursAgo = lastEnd
      ? Math.round((now.getTime() - lastEnd.getTime()) / 3_600_000)
      : null;

    if (dryRun) {
      results.push({ callerId: caller.id, email: caller.email, status: "dry-run" });
      continue;
    }
    if (!apiKey) {
      results.push({
        callerId: caller.id,
        email: caller.email,
        status: "skipped-no-key",
      });
      continue;
    }

    try {
      await resendSend(apiKey, {
        from: `HumanFirst <${fromEmail}>`,
        to: [caller.email],
        reply_to: replyTo,
        subject: "One more session? — HumanFirst",
        text: formatNudge(caller.name, hoursAgo),
      });
      // Write dedup marker only after successful send.
      await upsertNudgeAttribute(caller.id, now);
      results.push({ callerId: caller.id, email: caller.email, status: "sent" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        callerId: caller.id,
        email: caller.email,
        status: "failed",
        error: message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    window: {
      inactiveHoursMin,
      inactiveHoursMax,
      startedAt: now.toISOString(),
    },
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    sentCount: results.filter((r) => r.status === "sent").length,
    dryRunCount: results.filter((r) => r.status === "dry-run").length,
    skippedNoKeyCount: results.filter((r) => r.status === "skipped-no-key").length,
    failedCount: results.filter((r) => r.status === "failed").length,
    results,
  });
}

// ----- helpers -----

async function parseBody(req: Request): Promise<RequestBody> {
  try {
    const body = (await req.json()) as unknown;
    if (typeof body === "object" && body !== null) {
      return body as RequestBody;
    }
  } catch {
    // empty body is fine
  }
  return {};
}

async function upsertNudgeAttribute(callerId: string, at: Date): Promise<void> {
  const iso = at.toISOString();
  const existing = await prisma.callerAttribute.findFirst({
    where: { callerId, key: NUDGE_ATTR_KEY, scope: "GLOBAL" },
    select: { id: true },
  });
  if (existing) {
    await prisma.callerAttribute.update({
      where: { id: existing.id },
      data: { stringValue: iso, valueType: "STRING" },
    });
    return;
  }
  await prisma.callerAttribute.create({
    data: {
      callerId,
      key: NUDGE_ATTR_KEY,
      scope: "GLOBAL",
      valueType: "STRING",
      stringValue: iso,
      sourceSpecSlug: "pilot-nudge",
    },
  });
}

async function resendSend(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
}

function formatNudge(name: string | null, hoursAgo: number | null): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const timeNote = hoursAgo
    ? `It's been ${Math.round(hoursAgo / 24)} day${hoursAgo >= 48 ? "s" : ""} since your last session.`
    : "It's been a few days since your last session.";
  return [
    greeting,
    ``,
    timeNote,
    ``,
    `Mastery is built by short, regular practice — even 15 minutes today`,
    `will keep the momentum going.`,
    ``,
    `Your dashboard is where you left it — pick up wherever feels right:`,
    ``,
    `  https://dev.humanfirstfoundation.com/`,
    ``,
    `If life got in the way, no worries. If you want out of these nudges`,
    `entirely, just reply "stop" and I'll take you off the list.`,
    ``,
    `— Paul`,
    `HumanFirst Foundation`,
  ].join("\n");
}
