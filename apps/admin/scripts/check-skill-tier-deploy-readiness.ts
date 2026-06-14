/**
 * Operator-facing preflight check for #1657 deploy safety.
 *
 * Verifies that the SKILL_MEASURE_V1 contract + the per-Playbook
 * skillTierMapping rows are in a consistent state before the code is
 * deployed.
 *
 * Run before `/deploy` or `/vm-cpp` on each environment:
 *
 *   npx tsx apps/admin/scripts/check-skill-tier-deploy-readiness.ts
 *
 * Exit codes:
 *   0  — safe-pre-1657 (contract still IELTS) OR safe-post-1657
 *        (contract Generic + no unsafe IELTS playbooks). Deploy may
 *        proceed.
 *   2  — UNSAFE-MIGRATION-MISSED. Contract flipped to Generic but
 *        IELTS-signal playbooks still have null mapping. The deploy
 *        will silently degrade IELTS course scoring. Run
 *        `migrate-ielts-playbook-mapping.ts --execute` immediately.
 *   1  — unexpected error (DB unreachable, etc.).
 *
 * If you're running this AFTER a deploy and it returns 2: roll back or
 * run the migration script + redeploy.
 */

import {
  checkSkillTierDeployReadiness,
  logSkillTierDeployVerdict,
} from "../lib/banding/skill-tier-deploy-invariant";

async function main(): Promise<void> {
  const verdict = await checkSkillTierDeployReadiness();
  logSkillTierDeployVerdict(verdict);

  if (verdict.status === "UNSAFE-MIGRATION-MISSED") {
    console.error("");
    console.error("DEPLOY GATE FAILED. Run the following before retrying:");
    console.error("  npx tsx apps/admin/scripts/migrate-ielts-playbook-mapping.ts");
    console.error("  npx tsx apps/admin/scripts/migrate-ielts-playbook-mapping.ts --execute");
    process.exit(2);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[check-skill-tier-deploy-readiness] failed:", e);
  process.exit(1);
});
