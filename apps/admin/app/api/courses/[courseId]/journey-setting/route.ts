/**
 * Journey setting PATCH — Phase 2A of epic #1675 (story #1687).
 *
 * Single OPERATOR-gated endpoint covering all 45 journey settings + the
 * 11 voice settings. Replaces the dispatch logic that would otherwise
 * have lived in 45 route files. Architecture per ADR
 * `docs/decisions/2026-06-15-journey-setting-contracts.md` Decision 5
 * + Tech Lead Q3.
 *
 * Body: `{ settingId: string, value: unknown, arraySelector?: string }`.
 *
 * `arraySelector` is the per-call selector VALUE used when the contract's
 * `storagePath` declares `arrayKey` without a fixed `selectorValue` —
 * the per-instance case (G8 module-scoped settings keyed on each
 * AuthoredModule's `id`). The selector KEY stays defined in the
 * contract (`arrayKey: "id"`); the caller supplies the runtime id.
 * Fixed-selector contracts (e.g. JourneyStop `arrayKey: "kind"` +
 * `selectorValue: "pre_test"`) ignore the body field and use the
 * contract's `selectorValue`. P3c (#1850).
 *
 * Behaviour:
 *   1. Auth: `requireAuth("OPERATOR")`. Pipeline-service-token writes
 *      hit a stricter gate when `writeGate === "operator-only"`.
 *   2. Lookup contract in journey or voice registries.
 *   3. Resolve `storagePath` to a `PlaybookConfig` mutation point.
 *      When the contract carries `arrayKey` with no fixed selectorValue,
 *      thread the body's `arraySelector` through as the per-call value.
 *   4. Apply parent write + any `autoEnableLinks` matching `whenValue`
 *      in the SAME `updatePlaybookConfig` transformer (one transaction).
 *   5. Return updated effective value + autoEnableLinks fan-out summary.
 *
 * Storage roots:
 *   - `config.*` / `sessionFlow.*` / `tolerances.*` / `playbook.voiceConfig.*`
 *     → Playbook.config mutation via `updatePlaybookConfig`
 *   - `behaviorTargets[…]` → 200 + `compoundOwnedSave: true` (Phase 3 —
 *     the FirstSessionSettings compound editor owns the save via
 *     `/api/courses/[courseId]/first-session`)
 *   - `domain.<scalar>` (today only `domain.onboardingIdentitySpecId`
 *     via the `intakeSpecId` contract) → A4 of #2225 — write through
 *     `updateDomainConfig`, fan out section-staleness to every
 *     dependent Playbook in the Domain. The Domain timestamp bump
 *     (done by `updateDomainConfig`) covers prompt-level staleness;
 *     this route handles section-grain staleness fanout.
 *
 * Not handled yet (returned as 501):
 *   - storage root `domain.config.*` (no contract uses this shape today;
 *     when one lands, branch on `resolved.segments[0] === "config"` and
 *     route through `updateDomainConfig` with a `config` transformer)
 *   - storage root `unknown` (typo / drift — 501)
 *
 * Auto-enable cycle protection: only 1 hop is permitted per ADR L3.
 * If the enforce-target itself has autoEnableLinks, those are NOT
 * recursively applied — would require Phase 5 work to add cycle detection.
 *
 * @api OPERATOR
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  JOURNEY_SETTINGS_BY_ID,
} from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import {
  applyAtPath,
  resolveStoragePath,
} from "@/lib/journey/storage-path-applier";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import { bumpSectionHash } from "@/lib/compose/section-staleness";
import { bumpDomainSectionStaleness } from "@/lib/compose/bump-domain-staleness";
import { getSectionsForSetting } from "@/lib/journey/section-staleness-bridge";
import type { PlaybookConfig } from "@/lib/types/json-fields";

const bodySchema = z.object({
  settingId: z.string().min(1),
  value: z.unknown(),
  /** Per-call selector VALUE for contracts whose storagePath declares
   *  `arrayKey` without a fixed `selectorValue` (G8 module-scoped
   *  settings — the moduleId). Ignored by fixed-selector contracts. */
  arraySelector: z.string().min(1).optional(),
});

interface PatchResponse {
  ok: true;
  effectiveValue: unknown;
  /** Settings that were also written via `autoEnableLinks`. */
  autoEnabled: Array<{ targetId: string; enforce: unknown }>;
  /** Compose sections whose staleness hash was bumped. */
  bumpedSections: string[];
  /** Phase 3 (#1693): true when the storage root is `behaviorTargets` —
   *  the wrapped compound editor (FirstSessionSettings) owns the save
   *  via its own internal save loop. */
  compoundOwnedSave?: boolean;
}

interface PatchError {
  ok: false;
  error: string;
  code?: string;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ courseId: string }> },
): Promise<NextResponse<PatchResponse | PatchError>> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    // requireAuth returns a NextResponse<unknown>; the call signature is
    // narrowed elsewhere — cast to the concrete error shape.
    return auth.error as NextResponse<PatchError>;
  }

  const { courseId } = await ctx.params;
  if (!courseId) {
    return NextResponse.json(
      { ok: false, error: "courseId required" },
      { status: 400 },
    );
  }

  // Body parse + zod
  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message, code: "BAD_BODY" },
      { status: 400 },
    );
  }
  const { settingId, value, arraySelector } = parsed.data;

  // Lookup contract
  const contract: JourneySettingContract | undefined =
    JOURNEY_SETTINGS_BY_ID[settingId] ?? VOICE_SETTINGS_BY_ID[settingId];
  if (!contract) {
    return NextResponse.json(
      { ok: false, error: `Unknown settingId: ${settingId}`, code: "UNKNOWN_SETTING" },
      { status: 400 },
    );
  }

  // writeGate enforcement — operator-only settings reject pipeline writes.
  // The OPERATOR auth above already excludes pipeline service tokens
  // (which authenticate as TESTER or below per `lib/permissions.ts`),
  // so this is belt-and-braces: explicit header check.
  if (contract.writeGate === "operator-only") {
    const pipelineHeader = req.headers.get("x-pipeline-actor");
    if (pipelineHeader) {
      return NextResponse.json(
        {
          ok: false,
          error: `Setting ${settingId} is operator-only; pipeline writes rejected.`,
          code: "OPERATOR_ONLY",
        },
        { status: 403 },
      );
    }
  }

  // Resolve storage root
  let resolved = resolveStoragePath(contract.storagePath);

  // P3c (#1850): per-instance array selector. When the contract's
  // storagePath declares `arrayKey` but no fixed `selectorValue` (e.g.
  // G8 `config.modules[].settings.*` with `arrayKey: "id"`), the caller
  // supplies the runtime selector via the body's `arraySelector` field.
  // Fixed-selector contracts (storagePath carries `selectorValue`) ignore
  // the body field — `resolved.arraySelector` is already non-null with
  // the fixed value baked in.
  if (
    arraySelector !== undefined &&
    typeof contract.storagePath !== "string" &&
    contract.storagePath.arrayKey &&
    contract.storagePath.selectorValue === undefined
  ) {
    resolved = {
      ...resolved,
      arraySelector: {
        key: contract.storagePath.arrayKey,
        value: arraySelector,
      },
    };
  }

  // Per-instance array contracts (G8) REQUIRE arraySelector — without
  // it the write would target index 0 / push a new element, neither of
  // which the caller intended. Reject explicitly so the surface tells
  // the operator what's missing.
  if (
    typeof contract.storagePath !== "string" &&
    contract.storagePath.arrayKey &&
    contract.storagePath.selectorValue === undefined &&
    resolved.arraySelector === null
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Setting ${settingId} requires arraySelector in body (contract storagePath has arrayKey="${contract.storagePath.arrayKey}" with no fixed selectorValue).`,
        code: "ARRAY_SELECTOR_REQUIRED",
      },
      { status: 400 },
    );
  }

  // Phase 3 (#1693): behaviorTargets is a separate model — the storage
  // path applier doesn't write to it. The existing FirstSessionSettings
  // editor mounted via JourneyTargets has its own internal save loop
  // hitting /api/courses/[courseId]/first-session route, so the journey-
  // setting PATCH route SHOULDN'T intercept it. Return a documented
  // 200 + nothing-applied response so the client can detect this code
  // path and let the compound editor own the save.
  if (resolved.root === "behaviorTargets") {
    return NextResponse.json({
      ok: true,
      effectiveValue: value,
      autoEnabled: [],
      bumpedSections: [],
      compoundOwnedSave: true,
    });
  }

  if (resolved.root === "unknown") {
    return NextResponse.json(
      {
        ok: false,
        error: `Storage root 'unknown' not supported (storagePath: ${typeof contract.storagePath === "string" ? contract.storagePath : contract.storagePath.path}).`,
        code: "STORAGE_ROOT_NOT_SUPPORTED",
      },
      { status: 501 },
    );
  }

  // A4 of #2225 — Domain-rooted writes. Today there is exactly ONE
  // contract whose primary storagePath lives under `domain.*`:
  // `intakeSpecId` → `domain.onboardingIdentitySpecId` (a scalar column,
  // not a JSON blob key). When a future contract lands on
  // `domain.config.*`, branch here on `resolved.segments[0] === "config"`
  // and route through `updateDomainConfig` with a `config` transformer.
  if (resolved.root === "domain") {
    if (resolved.segments.length !== 1) {
      // Nested domain paths (e.g. `domain.config.foo`) — not wired yet.
      return NextResponse.json(
        {
          ok: false,
          error: `Domain-rooted storagePath '${typeof contract.storagePath === "string" ? contract.storagePath : contract.storagePath.path}' is nested; only single-segment scalar Domain columns are wired today.`,
          code: "STORAGE_ROOT_NOT_SUPPORTED",
        },
        { status: 501 },
      );
    }
    const scalarKey = resolved.segments[0];

    // Resolve Domain id via Course (Playbook) → Domain.
    const course = await prisma.playbook.findFirst({
      where: { id: courseId },
      select: { id: true, domainId: true },
    });
    if (!course) {
      return NextResponse.json(
        { ok: false, error: `Playbook ${courseId} not found` },
        { status: 404 },
      );
    }

    // updateDomainConfig is the canonical writer for the 4 compose-
    // affecting Domain fields (onboardingFlowPhases, onboardingDefaultTargets,
    // onboardingWelcome, onboardingIdentitySpecId). It bumps
    // `Domain.composeInputsUpdatedAt` which the staleness check reads —
    // every dependent Playbook sees the stale signal automatically.
    type DomainUpdatableKey =
      | "onboardingFlowPhases"
      | "onboardingDefaultTargets"
      | "onboardingWelcome"
      | "onboardingIdentitySpecId";
    const ALLOWED_DOMAIN_KEYS: ReadonlySet<DomainUpdatableKey> = new Set([
      "onboardingFlowPhases",
      "onboardingDefaultTargets",
      "onboardingWelcome",
      "onboardingIdentitySpecId",
    ]);
    if (!ALLOWED_DOMAIN_KEYS.has(scalarKey as DomainUpdatableKey)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Domain column '${scalarKey}' is not in the updateDomainConfig allow-list. Add it to COMPOSE_AFFECTING_DOMAIN_FIELDS + DomainUpdatable first.`,
          code: "DOMAIN_KEY_NOT_ALLOWED",
        },
        { status: 400 },
      );
    }
    const domainKey = scalarKey as DomainUpdatableKey;

    await updateDomainConfig(
      course.domainId,
      (cur) => ({ ...cur, [domainKey]: value as never }),
      { reason: `journey-setting:${settingId}` },
    );

    // Section-grain staleness fanout: bump each affected section on
    // every Playbook in this Domain. Fire-and-forget; the prompt-grain
    // `Domain.composeInputsUpdatedAt` bump from `updateDomainConfig`
    // above is the primary signal.
    const bumpedSections = Array.from(
      new Set<string>(getSectionsForSetting(settingId)),
    );
    if (bumpedSections.length > 0) {
      void bumpDomainSectionStaleness(
        course.domainId,
        bumpedSections as Parameters<typeof bumpDomainSectionStaleness>[1],
        { settingId, value },
      );
    }

    return NextResponse.json({
      ok: true,
      effectiveValue: value,
      autoEnabled: [],
      bumpedSections,
    });
  }

  // Find the playbook for this course
  const playbook = await prisma.playbook.findFirst({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, error: `Playbook ${courseId} not found` },
      { status: 404 },
    );
  }

  // Compute auto-enable fan-out (1-hop only per ADR L3).
  const autoEnabled: Array<{ targetId: string; enforce: unknown }> = [];
  const links = contract.autoEnableLinks ?? [];
  for (const link of links) {
    if (deepEqual(link.whenValue, value)) {
      const target =
        JOURNEY_SETTINGS_BY_ID[link.targetId] ?? VOICE_SETTINGS_BY_ID[link.targetId];
      if (!target) continue; // dangling target — completeness vitest catches at CI
      autoEnabled.push({ targetId: link.targetId, enforce: link.enforce });
    }
  }

  // Apply parent + auto-enable writes inside the same updatePlaybookConfig
  // transformer (one transaction; bumps composeInputsUpdatedAt once if any
  // compose-affecting key changed).
  await updatePlaybookConfig(playbook.id, (config) => {
    const next: PlaybookConfig = config;
    applyAtPath(next, resolved, value);
    for (const en of autoEnabled) {
      const targetContract =
        JOURNEY_SETTINGS_BY_ID[en.targetId] ?? VOICE_SETTINGS_BY_ID[en.targetId];
      if (!targetContract) continue;
      const targetResolved = resolveStoragePath(targetContract.storagePath);
      if (
        targetResolved.root === "domain" ||
        targetResolved.root === "behaviorTargets" ||
        targetResolved.root === "unknown"
      ) {
        // Cannot enforce — skip (operator sees the partial fan-out in
        // the response).
        continue;
      }
      applyAtPath(next, targetResolved, en.enforce);
    }
    return next;
  }, { reason: `journey-setting:${settingId}` });

  // Bump section-grain staleness for every section the setting feeds
  // PLUS sections fed by any auto-enabled targets. Fire-and-forget — the
  // PATCH response doesn't block on these.
  const sectionsToBump = new Set<string>();
  for (const sec of getSectionsForSetting(settingId)) sectionsToBump.add(sec);
  for (const en of autoEnabled) {
    for (const sec of getSectionsForSetting(en.targetId)) sectionsToBump.add(sec);
  }
  const bumpedSections: string[] = Array.from(sectionsToBump);
  for (const sec of bumpedSections) {
    void bumpSectionHash(
      playbook.id,
      sec as Parameters<typeof bumpSectionHash>[1],
      { settingId, value },
    );
  }

  return NextResponse.json({
    ok: true,
    effectiveValue: value,
    autoEnabled,
    bumpedSections,
  });
}

/** Cheap structural equality for the autoEnableLinks whenValue check. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}
