/**
 * Domain voice-config GET + PATCH (#1271 Slice D).
 *
 * Sibling of `/api/playbooks/[id]/voice-config` (#1271 Slice C). Reads
 * the resolved cascade with Domain as the bottom layer (no Course yet)
 * for the GET, and writes a single key into `Domain.config.voice` for
 * the PATCH. Domain.config is plain JSON on the existing column — no
 * migration needed.
 *
 * @api GET /api/domains/:domainId/voice-config
 * @api PATCH /api/domains/:domainId/voice-config
 * @visibility internal
 * @scope domains:write
 * @auth session
 * @tags domains, voice
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";
import { cascadeableKeys, LOCKED_KEYS, SECRET_KEYS } from "@/lib/voice/config";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getVoiceProvider } from "@/lib/voice/provider-factory";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;
  const { domainId } = await params;

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true, slug: true, config: true },
  });
  if (!domain) {
    return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
  }

  // Find a caller in this domain (no specific playbook) so the loader
  // can pull the Domain.config.voice layer through the resolver. If none
  // exists, resolve with caller null — Domain layer is then absent.
  const aCaller = await prisma.caller.findFirst({
    where: { domainId },
    select: { id: true },
  });

  const resolved = await loadResolvedVoiceConfig({
    callerId: aCaller?.id ?? null,
    playbookId: null,
  });

  const sys = await getVoiceSystemSettings();
  const slug = sys.defaultProviderSlug || "vapi";
  const adapter = await getVoiceProvider(slug);
  const schema = adapter.getConfigSchema();
  const allowedKeys = cascadeableKeys(schema);

  // #1421 — surface the VoiceProvider row's id so VoiceSampleButton can
  // POST /api/voice-providers/[id]/sample.
  const enabledProviderRow = await prisma.voiceProvider.findUnique({
    where: { slug },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    domainId,
    domainName: domain.name,
    enabledProviderSlug: slug,
    enabledProviderId: enabledProviderRow?.id ?? null,
    resolved,
    allowedKeys,
    schemaFields: schema.fields
      .filter((f) => !f.sensitive)
      .filter((f) => !LOCKED_KEYS.includes(f.key))
      .filter((f) => !SECRET_KEYS.includes(f.key)),
    domainOverrides: (((domain.config as Record<string, unknown> | null) ?? {})
      .voice ?? {}) as Record<string, unknown>,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;
  const { domainId } = await params;

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
      { ok: false, error: `Field "${key}" is not overrideable at domain level` },
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

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, config: true },
  });
  if (!domain) {
    return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
  }

  const existingConfig = ((domain.config as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;
  const existingVoice = ((existingConfig.voice ?? {}) as Record<string, unknown>);
  const nextVoice = { ...existingVoice };
  if (value === null || value === undefined) {
    delete nextVoice[key];
  } else {
    nextVoice[key] = value;
  }
  const nextConfig = { ...existingConfig, voice: nextVoice };

  await prisma.domain.update({
    where: { id: domainId },
    data: { config: nextConfig },
  });

  return NextResponse.json({ ok: true, key, applied: value === null ? "cleared" : "set" });
}
