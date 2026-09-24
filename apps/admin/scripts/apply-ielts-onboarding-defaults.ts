/**
 * One-off: apply the IELTS onboarding cascade defaults to the live
 * Playbook on hf_sandbox / hf_staging.
 *
 * The seed file at `prisma/seed-ielts-course.ts` carries these values for a
 * fresh seed (the `welcomeMessage` + `onboardingClosingLine` keys land
 * inside the IELTS Playbook's `config` blob on first create). But existing
 * playbooks aren't updated by re-running the seed because
 * `findOrCreateSeedPlaybook` only writes `config` on the create branch.
 *
 * This script is the catch-up: it merges the two keys into the IELTS
 * Playbook's existing `config` JSON, idempotently. Safe to re-run.
 *
 * Usage (on hf-dev VM):
 *   npx tsx scripts/apply-ielts-onboarding-defaults.ts
 *
 * Cascade-classification:
 *   - `welcomeMessage` is `cascade-resolvable` (Playbook → Domain via
 *     `resolveWelcomeMessage`).
 *   - `onboardingClosingLine` is `course-only` (no Domain/System layer
 *     today). Operator can later promote to Domain by adding a Domain
 *     column; the helper at `lib/learner/resolve-onboarding-welcome.ts`
 *     reads only the Playbook value.
 */

import { prisma } from "@/lib/prisma";

const PLAYBOOK_NAME = "IELTS Speaking Practice";
const WELCOME_MESSAGE = "Welcome to your I E L T S coaching session";
const ONBOARDING_CLOSING_LINE = "Click start when you are ready";

async function main() {
  // Tag-first lookup mirrors `findOrCreateSeedPlaybook` in
  // `apps/admin/prisma/seeds/find-or-create-playbook.ts` — find by
  // `config.seedSourceTag` first, then fall back to name match.
  const candidates = await prisma.playbook.findMany({
    where: { name: PLAYBOOK_NAME },
    select: { id: true, name: true, config: true, domain: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    console.error(`[ielts-onboarding-defaults] No playbook named "${PLAYBOOK_NAME}" — nothing to update.`);
    process.exit(1);
  }

  for (const pb of candidates) {
    const cfg = (pb.config ?? {}) as Record<string, unknown>;
    const before = {
      welcomeMessage: cfg.welcomeMessage ?? null,
      onboardingClosingLine: cfg.onboardingClosingLine ?? null,
    };

    const merged = {
      ...cfg,
      welcomeMessage: WELCOME_MESSAGE,
      onboardingClosingLine: ONBOARDING_CLOSING_LINE,
    };

    await prisma.playbook.update({
      where: { id: pb.id },
      data: { config: merged },
    });

    console.log(
      `[ielts-onboarding-defaults] Updated playbook ${pb.id} (${pb.domain?.name ?? "?"} / ${pb.name})`,
    );
    console.log(`  welcomeMessage:        ${JSON.stringify(before.welcomeMessage)} → ${JSON.stringify(WELCOME_MESSAGE)}`);
    console.log(`  onboardingClosingLine: ${JSON.stringify(before.onboardingClosingLine)} → ${JSON.stringify(ONBOARDING_CLOSING_LINE)}`);
  }

  console.log(`[ielts-onboarding-defaults] Done. ${candidates.length} playbook(s) updated.`);
}

main()
  .catch((err) => {
    console.error("[ielts-onboarding-defaults] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
