/**
 * Cascade-write router (Epic #1442 Layer 2 — see
 * `docs/decisions/2026-06-10-cascade-honesty-ux.md` §3.3).
 *
 * Single chokepoint for cascade-scope writes — `<ScopePicker>` and the
 * upcoming Cmd+K scope-prefix tools both call through here. The router
 * dispatches by `(layer, knobKey)` to the canonical write helper for that
 * combination; it NEVER calls `prisma.*` directly and is NOT permitted in
 * the allowlist of `hf-playbook/no-direct-playbook-config-write` or
 * `hf-domain/no-direct-onboarding-write`.
 *
 * Routes per ADR §3.3:
 *   PLAYBOOK  → `updatePlaybookConfig` (welcomeMessage / voice / session-flow)
 *               or `writeBehaviorTarget` (BEH-* parameters)
 *   DOMAIN    → `updateDomainConfig` (welcomeMessage = onboardingWelcome,
 *               identitySpecId = onboardingIdentitySpecId)
 *   CALLER    → `writeCallerBehaviorTarget` (BEH-* only) + the bump helper
 *               is called transitively inside that function
 *   SEGMENT / CALL → throws (Sprint 2 deferred; ADR §4 OUT)
 *   SYSTEM    → throws (ADMIN-only, future sprint)
 *
 * After a successful write the router calls `invalidateKnob(knobKey)` so
 * any cached `Effective<T>` for that knob across all scope chains is
 * dropped — the next `resolveEffective` re-reads.
 *
 * No auto-creation of intermediate scope rows (ADR §6 non-goal — the
 * SharePoint "Limited Access" anti-pattern). The router writes exactly
 * one row at exactly the requested layer.
 *
 * Sprint 3 TODO: when Cmd+K domain writes ship, add `lib/cascade/
 * set-at-layer.ts` to `AI_TOOL_PATH_FRAGMENTS` in
 * `eslint-rules/no-ai-fanout-all.mjs`.
 */

import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import {
  writeBehaviorTarget,
  writeCallerBehaviorTarget,
} from "@/lib/agent-tuner/write-target";

import type { Layer } from "./layer-types";
import { invalidateKnob } from "./effective-value";

export interface SetKnobScopeIds {
  playbookId?: string;
  domainId?: string;
  callerId?: string;
}

export interface SetKnobArgs {
  knobKey: string;
  layer: Layer;
  scopeIds: SetKnobScopeIds;
  value: unknown;
  /** Optional diagnostic label propagated to bump-log lines + audit rows. */
  reason?: string;
}

export type SetKnobResult =
  | { ok: true; layer: Layer; knobKey: string }
  | { ok: false; layer: Layer; knobKey: string; reason: string };

// ── Knob family detection ──────────────────────────────────────────────

function isBehaviorParameter(knobKey: string): boolean {
  return knobKey.startsWith("BEH-");
}

function isWelcomeMessage(knobKey: string): boolean {
  return knobKey === "welcomeMessage";
}

function isIdentitySpecId(knobKey: string): boolean {
  return knobKey === "identitySpecId";
}

const VOICE_KEYS = new Set([
  "voiceProvider",
  "voiceId",
  "model",
  "modelTemp",
  "modelTopP",
  "language",
]);

const SESSION_FLOW_KEYS = new Set([
  "onboarding",
  "intake",
  "stops",
  "offboarding",
]);

// ── PLAYBOOK dispatch ──────────────────────────────────────────────────

async function setAtPlaybook(args: SetKnobArgs): Promise<void> {
  const { knobKey, scopeIds, value, reason } = args;
  if (!scopeIds.playbookId) {
    throw new Error(
      `setKnobAtLayer: PLAYBOOK scope requires \`scopeIds.playbookId\``,
    );
  }

  if (isBehaviorParameter(knobKey)) {
    if (typeof value !== "number" && value !== null) {
      throw new Error(
        `setKnobAtLayer: BEH-* knob "${knobKey}" requires number | null value (got ${typeof value})`,
      );
    }
    const r = await writeBehaviorTarget(
      scopeIds.playbookId,
      knobKey,
      value as number | null,
      { source: "MANUAL" },
    );
    if (!r.ok) {
      throw new Error(
        `setKnobAtLayer: PLAYBOOK BEH write failed for "${knobKey}" — ${r.reason}`,
      );
    }
    return;
  }

  if (isWelcomeMessage(knobKey)) {
    if (value !== null && typeof value !== "string") {
      throw new Error(
        `setKnobAtLayer: welcomeMessage requires string | null value`,
      );
    }
    await updatePlaybookConfig(
      scopeIds.playbookId,
      (cfg) => {
        if (value === null) {
          const next = { ...cfg };
          delete (next as Record<string, unknown>).welcomeMessage;
          return next;
        }
        return { ...cfg, welcomeMessage: value as string };
      },
      { reason: reason ?? "set-at-layer:welcomeMessage" },
    );
    return;
  }

  if (VOICE_KEYS.has(knobKey)) {
    await updatePlaybookConfig(
      scopeIds.playbookId,
      (cfg) => {
        const voice = {
          ...((cfg as Record<string, unknown>).voice as Record<string, unknown> ?? {}),
        };
        if (value === null) {
          delete voice[knobKey];
        } else {
          voice[knobKey] = value;
        }
        return { ...cfg, voice } as typeof cfg;
      },
      { reason: reason ?? `set-at-layer:voice:${knobKey}` },
    );
    return;
  }

  if (SESSION_FLOW_KEYS.has(knobKey)) {
    await updatePlaybookConfig(
      scopeIds.playbookId,
      (cfg) => {
        const sf = {
          ...((cfg as Record<string, unknown>).sessionFlow as Record<string, unknown> ?? {}),
        };
        if (value === null) {
          delete sf[knobKey];
        } else {
          sf[knobKey] = value;
        }
        return { ...cfg, sessionFlow: sf } as typeof cfg;
      },
      { reason: reason ?? `set-at-layer:sessionFlow:${knobKey}` },
    );
    return;
  }

  throw new Error(
    `setKnobAtLayer: unsupported PLAYBOOK-scope knob "${knobKey}" — write path not implemented`,
  );
}

// ── DOMAIN dispatch ────────────────────────────────────────────────────

async function setAtDomain(args: SetKnobArgs): Promise<void> {
  const { knobKey, scopeIds, value, reason } = args;
  if (!scopeIds.domainId) {
    throw new Error(
      `setKnobAtLayer: DOMAIN scope requires \`scopeIds.domainId\``,
    );
  }

  if (isWelcomeMessage(knobKey)) {
    if (value !== null && typeof value !== "string") {
      throw new Error(
        `setKnobAtLayer: DOMAIN welcomeMessage requires string | null value`,
      );
    }
    await updateDomainConfig(
      scopeIds.domainId,
      (cur) => ({ ...cur, onboardingWelcome: value as string | null }),
      { reason: reason ?? "set-at-layer:domain.onboardingWelcome" },
    );
    return;
  }

  if (isIdentitySpecId(knobKey)) {
    if (value !== null && typeof value !== "string") {
      throw new Error(
        `setKnobAtLayer: DOMAIN identitySpecId requires string | null value`,
      );
    }
    await updateDomainConfig(
      scopeIds.domainId,
      (cur) => ({ ...cur, onboardingIdentitySpecId: value as string | null }),
      { reason: reason ?? "set-at-layer:domain.onboardingIdentitySpecId" },
    );
    return;
  }

  throw new Error(
    `setKnobAtLayer: unsupported DOMAIN-scope knob "${knobKey}" — write path not implemented`,
  );
}

// ── CALLER dispatch ────────────────────────────────────────────────────

async function setAtCaller(args: SetKnobArgs): Promise<void> {
  const { knobKey, scopeIds, value } = args;
  if (!scopeIds.callerId) {
    throw new Error(
      `setKnobAtLayer: CALLER scope requires \`scopeIds.callerId\``,
    );
  }

  if (!isBehaviorParameter(knobKey)) {
    throw new Error(
      `setKnobAtLayer: CALLER scope today supports BEH-* parameters only (got "${knobKey}")`,
    );
  }
  if (typeof value !== "number" && value !== null) {
    throw new Error(
      `setKnobAtLayer: BEH-* knob "${knobKey}" requires number | null value`,
    );
  }
  const r = await writeCallerBehaviorTarget(
    scopeIds.callerId,
    knobKey,
    value as number | null,
    { source: "MANUAL" },
  );
  if (!r.ok) {
    throw new Error(
      `setKnobAtLayer: CALLER BEH write failed for "${knobKey}" — ${r.reason}`,
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Write a cascade-scope knob value at the requested layer. Always
 * delegates to the canonical write helper for the combination; never
 * calls `prisma.*` directly. Drops the cache for `knobKey` after a
 * successful write.
 *
 * @example
 * await setKnobAtLayer({
 *   knobKey: "BEH-WARMTH",
 *   layer: "CALLER",
 *   scopeIds: { callerId: "smoke-test-…" },
 *   value: 0.8,
 *   reason: "scope-picker:smoke-test",
 * });
 */
export async function setKnobAtLayer(args: SetKnobArgs): Promise<SetKnobResult> {
  switch (args.layer) {
    case "PLAYBOOK":
      await setAtPlaybook(args);
      break;
    case "DOMAIN":
      await setAtDomain(args);
      break;
    case "CALLER":
      await setAtCaller(args);
      break;
    case "SEGMENT":
    case "CALL":
      throw new Error(
        `setKnobAtLayer: ${args.layer} scope writes not implemented in Sprint 1 — Epic #1442 Sprint 2`,
      );
    case "SYSTEM":
      throw new Error(
        `setKnobAtLayer: SYSTEM scope writes are ADMIN-only and not implemented in Sprint 1`,
      );
  }

  invalidateKnob(args.knobKey);
  return { ok: true, layer: args.layer, knobKey: args.knobKey };
}
