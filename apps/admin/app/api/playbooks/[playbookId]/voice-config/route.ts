/**
 * Course (Playbook) voice-config GET + PATCH (#1271 Slice C).
 *
 * GET returns the resolved 4-layer cascade for the playbook so the
 * Course Voice section can render each field with its current value
 * and provenance badge.
 *
 * PATCH writes / clears a single key in `Playbook.config.voice`. Goes
 * through `updatePlaybookConfig` so the compose-input timestamp bump
 * (#878) keeps downstream readers fresh, and emits a pending-change
 * tray entry tagged `aiSuggested: false` (operator-driven write).
 *
 * @api GET /api/playbooks/:playbookId/voice-config
 * @api PATCH /api/playbooks/:playbookId/voice-config
 * @visibility internal
 * @scope playbooks:write
 * @auth session
 * @tags playbooks, voice
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";
import { cascadeableKeys, LOCKED_KEYS, SECRET_KEYS } from "@/lib/voice/config";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;
  const { playbookId } = await params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, domainId: true, config: true },
  });
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "Playbook not found" }, { status: 404 });
  }

  // Find a caller in this playbook so we can pull the Domain layer
  // through the existing loader. If none exists yet, resolve with caller
  // null — Domain layer is then absent from the cascade.
  const aCaller = await prisma.caller.findFirst({
    where: { playbookId },
    select: { id: true },
  });

  const resolved = await loadResolvedVoiceConfig({
    callerId: aCaller?.id ?? null,
    playbookId,
  });

  const sys = await getVoiceSystemSettings();
  const adapter = await getVoiceProvider(sys.defaultProviderSlug || "vapi");
  const schema = adapter.getConfigSchema();
  const allowedKeys = cascadeableKeys(schema);

  return NextResponse.json({
    ok: true,
    playbookId,
    playbookName: playbook.name,
    enabledProviderSlug: sys.defaultProviderSlug || "vapi",
    resolved,
    allowedKeys,
    schemaFields: schema.fields
      .filter((f) => !f.sensitive)
      .filter((f) => !LOCKED_KEYS.includes(f.key))
      .filter((f) => !SECRET_KEYS.includes(f.key)),
    courseOverrides: (((playbook.config as Record<string, unknown> | null) ?? {})
      .voice ?? {}) as Record<string, unknown>,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;
  const { playbookId } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Body must be JSON object" }, { status: 400 });
  }
  const key = (body as Record<string, unknown>).key as string | undefined;
  const value = (body as Record<string, unknown>).value;
  if (typeof key !== "string" || !key.length) {
    return NextResponse.json({ ok: false, error: "`key` is required" }, { status: 400 });
  }

  if (SECRET_KEYS.includes(key) || LOCKED_KEYS.includes(key)) {
    return NextResponse.json(
      { ok: false, error: `Field "${key}" is not overrideable at course level` },
      { status: 400 },
    );
  }

  const sys = await getVoiceSystemSettings();
  const adapter = await getVoiceProvider(sys.defaultProviderSlug || "vapi");
  const allowedKeys = new Set(cascadeableKeys(adapter.getConfigSchema()));
  if (!allowedKeys.has(key)) {
    return NextResponse.json(
      { ok: false, error: `Field "${key}" is not a cascadeable voice key for ${sys.defaultProviderSlug}` },
      { status: 400 },
    );
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, config: true },
  });
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "Playbook not found" }, { status: 404 });
  }

  const existingConfig = (playbook.config as PlaybookConfig | null) ?? {};
  const existingVoice = ((existingConfig as Record<string, unknown>).voice ?? {}) as Record<
    string,
    unknown
  >;
  // `value === null` (or undefined) clears the override — resolver treats
  // null as "fall through to next layer".
  const nextVoice = { ...existingVoice };
  if (value === null || value === undefined) {
    delete nextVoice[key];
  } else {
    nextVoice[key] = value;
  }
  await updatePlaybookConfig(playbookId, { voice: nextVoice } as Partial<PlaybookConfig>);

  return NextResponse.json({ ok: true, key, applied: value === null ? "cleared" : "set" });
}
