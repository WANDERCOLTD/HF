/**
 * Prompt staleness probe — #831 (Story 7 of EPIC #832).
 *
 * Surfaces compose-input staleness to educator UI. Powers
 * `<StalePromptPill />` in `/x/callers/[callerId]?tab=calls|tune`.
 *
 * For each caller:
 *   1. Find the most recent active ComposedPrompt → composedAt
 *   2. Read every upstream timestamp:
 *      - Playbook.composeInputsUpdatedAt across ALL playbooks the caller
 *        is enrolled in (max of N playbooks)
 *      - Caller.composeInputsUpdatedAt
 *      - Domain.composeInputsUpdatedAt
 *      - SystemSetting "compose_inputs_updated_at"
 *   3. isStale = MAX(upstreams) > composedAt (or composedAt is null)
 *   4. upstreamChanges[] lists sources newer than composedAt for tooltip
 *
 * Cheap probe — 5 indexed reads. Safe to poll-on-mount in the UI.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { SYSTEM_COMPOSE_TIMESTAMP_KEY } from "@/lib/compose/staleness";

export const runtime = "nodejs";

const EPOCH = new Date(0);

interface UpstreamChange {
  source: "playbook" | "caller" | "domain" | "system";
  changedAt: string;
  label: string;
}

/**
 * @api GET /api/callers/:callerId/prompt-staleness
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, composition
 * @description Returns whether the active composed prompt for this caller is stale (upstream compose-affecting writes newer than the cached `ComposedPrompt.composedAt`). Powers the `<StalePromptPill />` UI.
 * @pathParam callerId string - Caller UUID
 * @response 200 { ok: true, isStale: boolean, composedAt: string|null, upstreamChanges: Array<{ source: string, changedAt: string, label: string }> }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { callerId } = await params;

    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: {
        id: true,
        composeInputsUpdatedAt: true,
        domainId: true,
        domain: {
          select: { composeInputsUpdatedAt: true, name: true },
        },
        enrollments: {
          where: { status: "ACTIVE" },
          select: {
            playbookId: true,
            playbook: {
              select: { composeInputsUpdatedAt: true, name: true },
            },
          },
        },
      },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 },
      );
    }

    const [latestPrompt, systemSettingRow] = await Promise.all([
      prisma.composedPrompt.findFirst({
        where: { callerId, status: "active" },
        orderBy: { composedAt: "desc" },
        select: { composedAt: true },
      }),
      prisma.systemSetting.findUnique({
        where: { key: SYSTEM_COMPOSE_TIMESTAMP_KEY },
        select: { value: true },
      }),
    ]);

    const composedAt = latestPrompt?.composedAt ?? null;

    // System timestamp is stored as ISO string in SystemSetting.value (Story 5).
    const systemRaw = systemSettingRow?.value;
    const systemTimestamp = parseSystemSettingTimestamp(systemRaw);

    // Find the newest playbook bump across all enrolled playbooks.
    let playbookMax: Date = EPOCH;
    let playbookLabel = "";
    for (const cp of caller.enrollments) {
      const t = cp.playbook.composeInputsUpdatedAt ?? EPOCH;
      if (t.getTime() > playbookMax.getTime()) {
        playbookMax = t;
        playbookLabel = cp.playbook.name;
      }
    }

    const callerTimestamp = caller.composeInputsUpdatedAt ?? EPOCH;
    const domainTimestamp = caller.domain?.composeInputsUpdatedAt ?? EPOCH;

    // composedAt == null → no cached prompt, definitionally stale.
    const composedRef = composedAt?.getTime() ?? 0;
    const upstreamChanges: UpstreamChange[] = [];

    if (playbookMax.getTime() > composedRef && playbookMax.getTime() > 0) {
      upstreamChanges.push({
        source: "playbook",
        changedAt: playbookMax.toISOString(),
        label: playbookLabel
          ? `Course settings (${playbookLabel})`
          : "Course settings",
      });
    }
    if (callerTimestamp.getTime() > composedRef && callerTimestamp.getTime() > 0) {
      upstreamChanges.push({
        source: "caller",
        changedAt: callerTimestamp.toISOString(),
        label: "Caller targets / profile",
      });
    }
    if (domainTimestamp.getTime() > composedRef && domainTimestamp.getTime() > 0) {
      upstreamChanges.push({
        source: "domain",
        changedAt: domainTimestamp.toISOString(),
        label: caller.domain?.name
          ? `Domain config (${caller.domain.name})`
          : "Domain config",
      });
    }
    if (systemTimestamp.getTime() > composedRef && systemTimestamp.getTime() > 0) {
      upstreamChanges.push({
        source: "system",
        changedAt: systemTimestamp.toISOString(),
        label: "System config",
      });
    }

    const isStale = composedAt == null || upstreamChanges.length > 0;

    return NextResponse.json({
      ok: true,
      isStale,
      composedAt: composedAt?.toISOString() ?? null,
      upstreamChanges,
    });
  } catch (err: any) {
    console.error("[prompt-staleness] error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to compute prompt staleness" },
      { status: 500 },
    );
  }
}

function parseSystemSettingTimestamp(value: unknown): Date {
  if (value == null) return EPOCH;
  const raw = typeof value === "string" ? value : String(value);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return EPOCH;
  return parsed;
}
