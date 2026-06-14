/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Today this fires the skill-tier deploy-readiness invariant (#1657) so a
 * deploy that flipped the SKILL_MEASURE_V1 contract to Generic WITHOUT
 * also running `scripts/migrate-ielts-playbook-mapping.ts --execute`
 * produces an immediately visible ERROR log line — operator can spot it
 * in Cloud Run logs before learners see degraded scoring.
 *
 * The invariant is read-only — it never mutates state.
 *
 * Failures inside `register()` are swallowed to avoid blocking server
 * startup on a Prisma blip; the operator-facing preflight script
 * (`scripts/check-skill-tier-deploy-readiness.ts`) is the canonical
 * gate.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { checkSkillTierDeployReadiness, logSkillTierDeployVerdict } =
      await import("@/lib/banding/skill-tier-deploy-invariant");
    const verdict = await checkSkillTierDeployReadiness();
    logSkillTierDeployVerdict(verdict);
  } catch (err) {
    console.warn(
      "[skill-tier][deploy-invariant] startup check failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
