/**
 * Seed IELTS prosody preconditions (#1512 — Slice 2 of #1510).
 *
 * Idempotent setup script for the two PROSODY pre-conditions that, when
 * missing, cause `lib/pipeline/prosody-runner.ts` to emit I-AL4 with
 * reason="no-tierPreset" or "no-provider":
 *
 *   1. `Playbook.config.tierPresetId = "ielts-speaking"` for any Playbook
 *      whose name matches the IELTS regex (case-insensitive) AND whose
 *      `tierPresetId` is not already set.
 *   2. `SpeechAssessmentProvider.isDefault = true` on a single row IF NO
 *      row currently has `isDefault = true`. Picks the first
 *      `enabled = true` row; falls back to the first row by `slug` ASC
 *      when no enabled row exists. Multiple defaults → log warning + leave
 *      alone (operator decision).
 *
 * Safety:
 *   - Default mode is dry-run (`--dry-run` is implicit). Pass `--execute`
 *     to actually mutate the database. Mirrors the cadence of
 *     `scripts/migrate-vapi-background-sound.ts` (#1438).
 *   - Every mutation is logged via `log.info` to AppLog (auditable trail).
 *   - Re-runs produce zero additional writes — every check compares
 *     current DB state before deciding to write.
 *
 * Usage (run on hf-dev → hf-staging → hf-prod after `/vm-cpp`):
 *
 *   npx tsx scripts/seed-ielts-prosody.ts             # dry-run (default)
 *   npx tsx scripts/seed-ielts-prosody.ts --execute   # apply
 *
 * Per `docs/CHAIN-CONTRACTS.md` §6, I-AL4 is an OBSERVABILITY-only
 * invariant — this script unblocks the IELTS scoring path so the WARN
 * row stops firing for that course family.
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ── Constants ─────────────────────────────────────────────

/** Regex that identifies IELTS playbooks by display name. Case-insensitive.
 *  Matches "IELTS", "IELTS Speaking", "IELTS Prep Lab", "ielts" etc. */
const IELTS_NAME_PATTERN = /ielts/i;

/** The canonical tier preset value for IELTS playbooks (matches
 *  `lib/pipeline/prosody-runner.ts::resolveProsodyMode`). */
const IELTS_TIER_PRESET_ID = "ielts-speaking";

// ── CLI flag parsing ──────────────────────────────────────

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has("--execute");
const MODE_LABEL = EXECUTE ? "EXECUTE" : "DRY-RUN";

// ── Lightweight structured log shim ───────────────────────
//
// The script runs as a one-off CLI tool (not inside Next.js), so importing
// `@/lib/logger` would pull in the app's full module graph and SystemSetting
// cache for no value. A plain console emit with a prefix is enough — the
// operator runs the script with output captured, and the AppLog audit trail
// is satisfied by the per-mutation `prisma.appLog.create` we write inline.

interface SeedLogPayload {
  [key: string]: unknown;
}

const log = {
  info(message: string, payload: SeedLogPayload = {}): void {
    console.log(`[seed-ielts-prosody:${MODE_LABEL}] ${message}`, payload);
  },
  warn(message: string, payload: SeedLogPayload = {}): void {
    console.warn(`[seed-ielts-prosody:${MODE_LABEL}] WARN: ${message}`, payload);
  },
};

// ── Public types (for the test harness) ───────────────────

export interface SeedReport {
  mode: "DRY-RUN" | "EXECUTE";
  playbookActions: PlaybookAction[];
  providerAction: ProviderAction;
}

export interface PlaybookAction {
  playbookId: string;
  playbookName: string;
  before: string | null;
  after: string;
  wrote: boolean;
  noopReason?: "already-set";
}

export type ProviderAction =
  | {
      kind: "set-default";
      providerId: string;
      providerSlug: string;
      wrote: boolean;
    }
  | { kind: "already-has-default"; providerId: string; providerSlug: string }
  | { kind: "multiple-defaults"; defaultsCount: number; providerSlugs: string[] }
  | { kind: "no-eligible-row" };

// ── Pure planner (no DB writes) ───────────────────────────

interface PlaybookRow {
  id: string;
  name: string;
  config: Prisma.JsonValue | null;
}

interface ProviderRow {
  id: string;
  slug: string;
  isDefault: boolean;
  enabled: boolean;
}

export function planPlaybookActions(rows: PlaybookRow[]): PlaybookAction[] {
  const actions: PlaybookAction[] = [];
  for (const row of rows) {
    if (!IELTS_NAME_PATTERN.test(row.name)) continue;
    const config = (row.config ?? {}) as Record<string, unknown>;
    const current = typeof config.tierPresetId === "string" ? config.tierPresetId : null;
    if (current === IELTS_TIER_PRESET_ID) {
      actions.push({
        playbookId: row.id,
        playbookName: row.name,
        before: current,
        after: IELTS_TIER_PRESET_ID,
        wrote: false,
        noopReason: "already-set",
      });
      continue;
    }
    actions.push({
      playbookId: row.id,
      playbookName: row.name,
      before: current,
      after: IELTS_TIER_PRESET_ID,
      wrote: false,
    });
  }
  return actions;
}

export function planProviderAction(rows: ProviderRow[]): ProviderAction {
  const defaults = rows.filter((r) => r.isDefault);
  if (defaults.length >= 2) {
    return {
      kind: "multiple-defaults",
      defaultsCount: defaults.length,
      providerSlugs: defaults.map((r) => r.slug),
    };
  }
  if (defaults.length === 1) {
    return {
      kind: "already-has-default",
      providerId: defaults[0].id,
      providerSlug: defaults[0].slug,
    };
  }
  // No default — pick first enabled, else first by slug ASC.
  const enabled = rows.filter((r) => r.enabled);
  const pickFrom = enabled.length > 0 ? enabled : rows;
  if (pickFrom.length === 0) return { kind: "no-eligible-row" };
  const sorted = [...pickFrom].sort((a, b) => a.slug.localeCompare(b.slug));
  const chosen = sorted[0];
  return {
    kind: "set-default",
    providerId: chosen.id,
    providerSlug: chosen.slug,
    wrote: false,
  };
}

// ── Main entry point ──────────────────────────────────────

async function main(): Promise<SeedReport> {
  log.info(
    "starting seed",
    EXECUTE
      ? { willWrite: true }
      : { willWrite: false, hint: "pass --execute to apply mutations" },
  );

  // Step 1 — IELTS playbooks
  const playbooks = await prisma.playbook.findMany({
    select: { id: true, name: true, config: true },
  });
  const plannedPlaybookActions = planPlaybookActions(playbooks);
  log.info("playbook plan", {
    totalScanned: playbooks.length,
    ieltsMatched: plannedPlaybookActions.length,
    needWrite: plannedPlaybookActions.filter((a) => !a.noopReason).length,
  });

  const playbookActions: PlaybookAction[] = [];
  for (const action of plannedPlaybookActions) {
    if (action.noopReason === "already-set") {
      log.info("playbook tierPresetId — already set, no-op", {
        playbookId: action.playbookId,
        playbookName: action.playbookName,
        tierPresetId: action.after,
      });
      playbookActions.push({ ...action, wrote: false });
      continue;
    }
    log.info("playbook tierPresetId — write planned", {
      playbookId: action.playbookId,
      playbookName: action.playbookName,
      before: action.before,
      after: action.after,
    });
    if (EXECUTE) {
      await applyPlaybookTier(action.playbookId);
      await writeAuditLog("playbook.tierPresetId.set", {
        playbookId: action.playbookId,
        playbookName: action.playbookName,
        before: action.before,
        after: action.after,
      });
      playbookActions.push({ ...action, wrote: true });
    } else {
      playbookActions.push({ ...action, wrote: false });
    }
  }

  // Step 2 — SpeechAssessmentProvider default
  const providers = await prisma.speechAssessmentProvider.findMany({
    select: { id: true, slug: true, isDefault: true, enabled: true },
  });
  const providerAction = planProviderAction(providers);

  switch (providerAction.kind) {
    case "already-has-default":
      log.info("provider — already has default, no-op", {
        providerId: providerAction.providerId,
        providerSlug: providerAction.providerSlug,
      });
      break;
    case "multiple-defaults":
      log.warn("provider — multiple isDefault=true rows detected; leaving alone (operator decision)", {
        defaultsCount: providerAction.defaultsCount,
        providerSlugs: providerAction.providerSlugs,
      });
      break;
    case "no-eligible-row":
      log.warn("provider — no SpeechAssessmentProvider rows in DB; nothing to mark default", {});
      break;
    case "set-default":
      log.info("provider — write planned", {
        providerId: providerAction.providerId,
        providerSlug: providerAction.providerSlug,
      });
      if (EXECUTE) {
        await applyProviderDefault(providerAction.providerId);
        await writeAuditLog("provider.isDefault.set", {
          providerId: providerAction.providerId,
          providerSlug: providerAction.providerSlug,
        });
      }
      break;
  }

  const report: SeedReport = {
    mode: EXECUTE ? "EXECUTE" : "DRY-RUN",
    playbookActions,
    providerAction:
      providerAction.kind === "set-default"
        ? { ...providerAction, wrote: EXECUTE }
        : providerAction,
  };

  log.info("seed complete", {
    mode: report.mode,
    playbookWrites: playbookActions.filter((a) => a.wrote).length,
    providerWrite: report.providerAction.kind === "set-default" && report.providerAction.wrote,
  });

  return report;
}

// ── DB write helpers ──────────────────────────────────────

async function applyPlaybookTier(playbookId: string): Promise<void> {
  const current = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  const merged = {
    ...((current?.config ?? {}) as Record<string, unknown>),
    tierPresetId: IELTS_TIER_PRESET_ID,
  };
  await prisma.playbook.update({
    where: { id: playbookId },
    data: { config: merged as Prisma.InputJsonValue },
  });
}

async function applyProviderDefault(providerId: string): Promise<void> {
  await prisma.speechAssessmentProvider.update({
    where: { id: providerId },
    data: { isDefault: true, enabled: true },
  });
}

async function writeAuditLog(
  subject: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.appLog.create({
      data: {
        type: "system",
        level: "info",
        stage: `script.seed-ielts-prosody.${subject}`,
        message: subject,
        metadata: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Best-effort audit — never block the seed run on logging.
    log.warn("audit log write failed (continuing)", {
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Entry-point gate ──────────────────────────────────────

// Only run when executed directly. Re-exported helpers stay importable for tests.
const isDirectRun =
  typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  main()
    .catch((err) => {
      console.error("[seed-ielts-prosody] FAILED:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main };
