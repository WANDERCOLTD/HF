/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Today this fires:
 *
 *   1. The skill-tier deploy-readiness invariant (#1657). Read-only —
 *      surfaces an immediately visible ERROR log line if a deploy
 *      flipped SKILL_MEASURE_V1 to Generic without running
 *      `scripts/migrate-ielts-playbook-mapping.ts --execute`.
 *   2. The cue-scheduler tick runner (#1742 follow-on). Drains
 *      `CueScheduleEntry` every 100ms so server-initiated speech
 *      (`VoiceProvider.sayMessage`) fires at the scheduled time.
 *      Idempotent + HMR-safe.
 *
 * Skipped when `NEXT_RUNTIME !== "nodejs"` (edge runtime) and when
 * `NODE_ENV === "test"` (the tick runner is unit-tested via direct
 * `tick()` calls — no real timer spins up in vitest).
 *
 * Failures inside `register()` are swallowed to avoid blocking server
 * startup on a Prisma blip; the operator-facing preflight scripts are
 * the canonical gates.
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

  // #1742 follow-on — cue-scheduler tick runner. Skip in test
  // environments so vitest doesn't spawn a real timer; tests drive
  // `tick()` directly via the runner's exported entry point.
  if (process.env.NODE_ENV === "test") return;
  try {
    const { startCueSchedulerRunner } = await import(
      "@/lib/voice/cue-scheduler-runner"
    );
    startCueSchedulerRunner();
  } catch (err) {
    console.warn(
      "[voice][cue-scheduler-runner] startup failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
