#!/usr/bin/env tsx
/**
 * Session Flow drift report — compares the resolved Session Flow shape
 * (resolveSessionFlow) against what the legacy transforms read directly
 * from Playbook.config, for every active Playbook in the database.
 *
 * If any course's resolver output drifts from its legacy reads, the
 * dual-read window is unsafe to flip — the SESSION_FLOW_RESOLVER_ENABLED
 * flag would change observable behaviour.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/session-flow-drift.ts            # human report
 *   npx tsx apps/admin/scripts/session-flow-drift.ts --json     # machine report
 *
 * Exit codes:
 *   0 — no drift detected
 *   1 — drift detected (or DB error)
 *
 * Per epic #221 safety mechanism S1 (issue #226).
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type { PlaybookConfig, OnboardingFlowPhases } from "@/lib/types/json-fields";

interface DriftField {
  field: string;
  resolver: unknown;
  legacy: unknown;
}

interface DriftReport {
  playbookId: string;
  playbookName: string;
  domainSlug: string | null;
  fields: DriftField[];
}

interface FullReport {
  totalPlaybooks: number;
  driftedCount: number;
  cleanCount: number;
  drifted: DriftReport[];
}

const asJson = process.argv.includes("--json");

async function main() {
  // Load the INIT-001 onboarding spec once — used for the resolver's
  // INIT fallback. Same source the transforms use.
  const onboardingSpec = await prisma.analysisSpec.findUnique({
    where: { slug: config.specs.onboarding },
    select: { config: true },
  });

  const playbooks = await prisma.playbook.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      name: true,
      config: true,
      domain: {
        select: {
          slug: true,
          onboardingWelcome: true,
          onboardingFlowPhases: true,
        },
      },
    },
  });

  const drifted: DriftReport[] = [];

  for (const pb of playbooks) {
    const pbConfig = (pb.config ?? {}) as PlaybookConfig;
    const resolved = resolveSessionFlow({
      playbook: { name: pb.name, config: pbConfig },
      domain: pb.domain,
      onboardingSpec: (onboardingSpec ?? null) as { config: { firstCallFlow?: OnboardingFlowPhases } } | null,
    });

    const driftFields: DriftField[] = [];

    // Onboarding phases — legacy cascade per pedagogy.ts:
    //   playbook.onboardingFlowPhases || domain.onboardingFlowPhases || init001.firstCallFlow
    const legacyPhases =
      pbConfig.onboardingFlowPhases ??
      ((pb.domain?.onboardingFlowPhases as OnboardingFlowPhases | null | undefined) ?? null) ??
      (((onboardingSpec?.config as { firstCallFlow?: OnboardingFlowPhases } | null)?.firstCallFlow) ?? null) ??
      { phases: [] };
    if (JSON.stringify(legacyPhases) !== JSON.stringify(resolved.onboarding)) {
      driftFields.push({
        field: "onboarding.phases",
        resolver: resolved.onboarding,
        legacy: legacyPhases,
      });
    }

    // Welcome message — legacy: pbConfig.welcomeMessage || domain.onboardingWelcome
    // (Playbook model has no welcomeMessage column; lives only in config JSON.)
    const legacyWelcomeMsg =
      pbConfig.welcomeMessage ??
      pb.domain?.onboardingWelcome ??
      null;
    if (legacyWelcomeMsg !== resolved.welcomeMessage) {
      driftFields.push({
        field: "welcomeMessage",
        resolver: resolved.welcomeMessage,
        legacy: legacyWelcomeMsg,
      });
    }

    // Intake — three flags (NOT knowledgeCheck — see byte-equal note in
    // quickstart.ts: legacy uses ?? true, resolver uses canonical ?? false).
    // For drift detection we accept courses with welcome set explicitly.
    if (pbConfig.welcome) {
      const legacyGoals = pbConfig.welcome.goals?.enabled ?? true;
      const legacyAboutYou = pbConfig.welcome.aboutYou?.enabled ?? true;
      if (legacyGoals !== resolved.intake.goals.enabled) {
        driftFields.push({
          field: "intake.goals.enabled",
          resolver: resolved.intake.goals.enabled,
          legacy: legacyGoals,
        });
      }
      if (legacyAboutYou !== resolved.intake.aboutYou.enabled) {
        driftFields.push({
          field: "intake.aboutYou.enabled",
          resolver: resolved.intake.aboutYou.enabled,
          legacy: legacyAboutYou,
        });
      }
    }

    // NPS — legacy: nps.enabled used as gate. Drift = stop synthesized when nps disabled, or vice versa.
    const legacyNpsEnabled = pbConfig.nps?.enabled ?? true; // DEFAULT_NPS_CONFIG.enabled
    const resolvedHasNps = resolved.stops.some((s) => s.id === "nps");
    if (legacyNpsEnabled !== resolvedHasNps) {
      driftFields.push({
        field: "stops[nps].enabled",
        resolver: resolvedHasNps,
        legacy: legacyNpsEnabled,
      });
    }

    if (driftFields.length > 0) {
      drifted.push({
        playbookId: pb.id,
        playbookName: pb.name,
        domainSlug: pb.domain?.slug ?? null,
        fields: driftFields,
      });
    }
  }

  const report: FullReport = {
    totalPlaybooks: playbooks.length,
    driftedCount: drifted.length,
    cleanCount: playbooks.length - drifted.length,
    drifted,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Session Flow Drift Report ===\n`);
    console.log(`Total active playbooks: ${report.totalPlaybooks}`);
    console.log(`Clean (no drift):       ${report.cleanCount}`);
    console.log(`Drifted:                ${report.driftedCount}\n`);
    if (drifted.length === 0) {
      console.log("✓ Resolver and legacy reads agree on every active course.");
      console.log("  Safe to flip SESSION_FLOW_RESOLVER_ENABLED=true.\n");
    } else {
      console.log("⚠ The following courses produce different output between");
      console.log("  the resolver and the legacy cascade:\n");
      for (const d of drifted) {
        console.log(`  - [${d.domainSlug ?? "(no-domain)"}] ${d.playbookName} (${d.playbookId})`);
        for (const f of d.fields) {
          console.log(`      • ${f.field}`);
          console.log(`          resolver: ${JSON.stringify(f.resolver)}`);
          console.log(`          legacy:   ${JSON.stringify(f.legacy)}`);
        }
      }
      console.log(`\n✗ DO NOT flip SESSION_FLOW_RESOLVER_ENABLED=true until drift is resolved.\n`);
    }
  }

  await prisma.$disconnect();
  process.exit(drifted.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[session-flow-drift] error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
