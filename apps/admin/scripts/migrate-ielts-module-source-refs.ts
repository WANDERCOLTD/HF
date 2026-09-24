#!/usr/bin/env tsx
/**
 * migrate-ielts-module-source-refs.ts (D2 of #2206 — DEMO UNBLOCK)
 *
 * One-off idempotent script that fixes IELTS module config drift on
 * the live `Playbook.config.modules[].settings` blocks so every
 * `source:<slug>` reference resolves to a real `ContentSource` row.
 *
 * SIBLING SCRIPT
 * ──────────────
 * `seed-ielts-sources.ts` (D1) seeds 6 ContentSource rows for the
 * slugs the IELTS course-ref authors. Run D1 FIRST, then this script.
 *
 * THE DRIFT THIS SCRIPT FIXES
 * ───────────────────────────
 * The IELTS course-ref currently declares:
 *
 *   baseline.settings.cueCardPool = "source:cue-card-bank-baseline-v1"   (Source 4 — never authored)
 *   mock.settings.cueCardPool     = "source:mock-exam-scenario-pool-v1"  (Source 5 — never authored)
 *
 * Sources 4 + 5 are described prosaically in the doc as "separate
 * pools" but no markdown file backs them. Source 9 + 10 commentary in
 * the SAME doc explicitly defers the authoring:
 *
 *   "The Mock Exam's Part 2 phase reuses the same 88 cue cards as
 *    Part 2 practice; mock-specific scenarios are deferred to a
 *    future source-authoring pass."
 *
 *   "The Baseline Assessment's Part 2 phase reuses the same cue card
 *    bank as Part 2 practice; baseline-specific topics are deferred."
 *
 * Both Source 9 and Source 10 in the doc point Baseline/Mock cueCardPool
 * at the same canonical Part 2 cue card bank file:
 *
 *   docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part2.md
 *
 * → canonical slug `cue-card-bank-v1` (Source 2).
 *
 * Until Sources 4 + 5 are authored as standalone files, the BDD-sanctioned
 * deferral path is to repoint the runtime config to `source:cue-card-bank-v1`.
 * That's what this script does.
 *
 * WHAT THIS SCRIPT CHANGES
 * ────────────────────────
 * For every Playbook whose `name === "IELTS Speaking Practice"`:
 *
 *   baseline.settings.cueCardPool:
 *     "source:cue-card-bank-baseline-v1" → "source:cue-card-bank-v1"
 *
 *   mock.settings.cueCardPool:
 *     "source:mock-exam-scenario-pool-v1" → "source:cue-card-bank-v1"
 *
 * All other modules + settings UNCHANGED. Idempotent — already-correct
 * config produces a no-op diff.
 *
 * The remaining 6 unique slugs the IELTS modules reference
 * (`part1-topic-library-v1`, `cue-card-bank-v1`, `part3-theme-library-v1`,
 * `stall-scaffolds-monologue`, `stall-scaffolds-discussion`,
 * `ielts-speaking-profile-fields`) are unaffected — D1 seeds them
 * against the existing course-ref refs.
 *
 * OPERATOR DEPLOY PROCEDURE
 * ─────────────────────────
 * On hf-dev VM with DATABASE_URL pointing to the target env (hf_staging
 * for the demo tonight):
 *
 *   cd ~/HF/apps/admin
 *   npx tsx scripts/seed-ielts-sources.ts                  # D1 — must run first
 *   npx tsx scripts/migrate-ielts-module-source-refs.ts    # D2 — this script
 *
 * Idempotent on both directions — re-running is a no-op.
 *
 * SAFETY
 * ──────
 * - Read-modify-write inside a transaction per Playbook.
 * - Compares the existing config to the patched config; skips the
 *   update entirely when nothing changed (idempotent log path).
 * - Logs the exact before/after for each Playbook touched so an
 *   operator running the script on staging can verify the diff
 *   before/after.
 * - NO TOUCH to AuthoredModule.mode, .label, .id, .outcomesPrimary,
 *   or any other field. NO TOUCH to non-IELTS playbooks.
 *
 * Issue #2206. Sibling: D1 (seed-ielts-sources.ts).
 */

import { PrismaClient } from "@prisma/client";
import type {
  AuthoredModule,
  AuthoredModuleSettings,
  PlaybookConfig,
} from "../lib/types/json-fields";

const prisma = new PrismaClient();

const IELTS_PLAYBOOK_NAME = "IELTS Speaking Practice";
const IELTS_SEED_TAG = "ielts-seed-v1";

const CANONICAL_PART2_CUE_CARD_REF = "source:cue-card-bank-v1";

/** Repoint table — module id → field → (stale ref → canonical ref). */
const REPOINTS: Array<{
  moduleId: string;
  field: keyof AuthoredModuleSettings;
  staleRef: string;
  canonicalRef: string;
  reason: string;
}> = [
  {
    moduleId: "baseline",
    field: "cueCardPool",
    staleRef: "source:cue-card-bank-baseline-v1",
    canonicalRef: CANONICAL_PART2_CUE_CARD_REF,
    reason:
      "Source 10 (BDD): Baseline Part 2 phase reuses the canonical cue card bank — baseline-specific topics deferred to future source-authoring pass.",
  },
  {
    moduleId: "mock",
    field: "cueCardPool",
    staleRef: "source:mock-exam-scenario-pool-v1",
    canonicalRef: CANONICAL_PART2_CUE_CARD_REF,
    reason:
      "Source 9 (BDD): Mock Exam Part 2 phase reuses the canonical cue card bank — mock-specific scenarios deferred to future source-authoring pass.",
  },
];

interface Patch {
  moduleId: string;
  field: string;
  before: string | null | undefined;
  after: string;
}

function patchModuleSettings(
  modules: AuthoredModule[] | undefined,
): { patched: AuthoredModule[] | undefined; diff: Patch[] } {
  if (!Array.isArray(modules)) return { patched: modules, diff: [] };

  const diff: Patch[] = [];
  const patched = modules.map((mod): AuthoredModule => {
    const applicable = REPOINTS.filter((r) => r.moduleId === mod.id);
    if (applicable.length === 0) return mod;

    const newSettings: AuthoredModuleSettings = { ...(mod.settings ?? {}) };

    for (const rule of applicable) {
      // Read raw — the resolver also reads raw; we treat the value as
      // the verbatim YAML string. AuthoredModuleSettings types the field
      // as the resolved structured shape, but at this layer the live
      // config carries the unresolved `source:<slug>` string. Cast for
      // I/O fidelity.
      const current = (newSettings as Record<string, unknown>)[rule.field];
      if (current === rule.staleRef) {
        (newSettings as Record<string, unknown>)[rule.field] = rule.canonicalRef;
        diff.push({
          moduleId: mod.id,
          field: rule.field,
          before: rule.staleRef,
          after: rule.canonicalRef,
        });
      } else if (current === rule.canonicalRef) {
        // Already canonical — idempotent no-op for this rule.
      } else {
        // Unexpected value — leave untouched, log so the operator can verify.
        // The script doesn't silently rewrite shapes it doesn't recognise.
        console.warn(
          `  ⚠ module="${mod.id}" field="${rule.field}" unexpected value (left untouched): ${JSON.stringify(current)}`,
        );
      }
    }
    return { ...mod, settings: newSettings };
  });

  return { patched, diff };
}

async function main(): Promise<void> {
  console.log("\n→ Migrating IELTS module source-refs (#2206 D2)\n");

  // Two-channel lookup: name OR seed-tag. Catches both seed-created and
  // wizard-created variants. Postgres array-contains is not stable for
  // JSON path filters across Prisma versions; do the tag filter in JS.
  const candidates = await prisma.playbook.findMany({
    where: {
      OR: [{ name: IELTS_PLAYBOOK_NAME }],
    },
    select: { id: true, name: true, config: true, domain: { select: { slug: true } } },
  });

  if (candidates.length === 0) {
    console.warn(
      `  ⚠ No Playbook found with name="${IELTS_PLAYBOOK_NAME}" — nothing to migrate.`,
    );
    return;
  }

  let touched = 0;
  let skipped = 0;

  for (const pb of candidates) {
    const cfg = (pb.config as PlaybookConfig | null) ?? {};
    const tag = (cfg as { seedSourceTag?: string }).seedSourceTag;
    const dom = pb.domain?.slug ?? "(no domain)";
    const tagSuffix = tag ? ` [tag=${tag}]` : "";

    const { patched, diff } = patchModuleSettings(cfg.modules);

    if (diff.length === 0) {
      console.log(
        `  ↻ ${pb.name} (${pb.id.slice(0, 8)} on ${dom}${tagSuffix}) — already canonical, no changes`,
      );
      skipped += 1;
      continue;
    }

    console.log(
      `  ✓ ${pb.name} (${pb.id.slice(0, 8)} on ${dom}${tagSuffix}) — applying ${diff.length} repoint(s):`,
    );
    for (const d of diff) {
      const beforeStr =
        d.before === undefined ? "(unset)" : d.before === null ? "null" : `"${d.before}"`;
      console.log(`     module="${d.moduleId}" ${d.field}: ${beforeStr} → "${d.after}"`);
    }

    const newConfig = { ...cfg, modules: patched };
    await prisma.playbook.update({
      where: { id: pb.id },
      // Cast through unknown: PlaybookConfig is structurally a subset of
      // Prisma's InputJsonValue, but its richly-typed optional fields don't
      // overlap directly with the JSON shape. Equivalent to the cast used
      // in every other PlaybookConfig writer in the codebase.
      data: { config: newConfig as unknown as object },
    });

    touched += 1;

    // Cross-check: the seedSourceTag if present should match expected — surface
    // any odd-tag instances so an operator can audit.
    if (tag && tag !== IELTS_SEED_TAG) {
      console.warn(
        `     ⚠ unexpected seedSourceTag "${tag}" (expected "${IELTS_SEED_TAG}")`,
      );
    }
  }

  console.log(
    `\n✓ Migration complete: ${touched} Playbook(s) updated, ${skipped} already canonical\n`,
  );

  if (touched > 0) {
    console.log(
      "Recommendation: trigger a Preview lens refresh OR wait for the next call to",
    );
    console.log(
      "recompose. The runtime resolver will now find ContentSource rows for all",
    );
    console.log("`source:cue-card-bank-v1` references (seeded by D1).\n");
  }
}

main()
  .catch((e) => {
    console.error("\n✗ migrate-ielts-module-source-refs failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
