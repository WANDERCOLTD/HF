/**
 * Voice diagnostics — verbose tier (#1438).
 *
 * Three tiers in the voice path:
 *
 *   1. Audit       — always on. FailureLog rows + `log()` calls to AppLog.
 *                    Forensics layer, can't be disabled.
 *   2. Operator    — always on. Error responses with structured detail so
 *                    the modal shows WHY a dial failed (e.g. the actual
 *                    VAPI rejection string), not a coarse "Bad Request".
 *   3. Verbose     — OFF in prod by default. Pre-fetch assistant payload
 *                    dump, cascade provenance per field, VAPI round-trip
 *                    headers. High signal for "why did this dial pick
 *                    THAT model/voice/sound", expensive in log volume.
 *                    Toggle on per-revision via `VOICE_DIAG_VERBOSE=1`.
 *
 * The gate is a single env-var check so production has ~zero overhead
 * when off (one string compare per call site). Cost when on: structured
 * payload writes to AppLog plus stdout. Acceptable for incident windows.
 *
 * Flip on:
 *   - Cloud Run: deploy a revision with `VOICE_DIAG_VERBOSE=1` in env.
 *     `gcloud run services update hf-admin-dev --set-env-vars VOICE_DIAG_VERBOSE=1`
 *   - Local: `VOICE_DIAG_VERBOSE=1 npm run dev` in apps/admin.
 *
 * Flip off:
 *   - Cloud Run: `gcloud run services update <svc> --remove-env-vars VOICE_DIAG_VERBOSE`
 *   - Local: restart without the env var.
 *
 * Why an env-var (not a SystemSetting): the existing `log()` helper is
 * already DB-gated via `getSystemSetting("logging_enabled")`. The verbose
 * tier sits ABOVE that gate and is meant for short-lived incident probes
 * — env-var is the right shape because:
 *   (a) it's per-revision, not per-instance — flipping it doesn't risk
 *       half a fleet logging differently
 *   (b) it survives a process restart consistently
 *   (c) it's invisible in admin UIs (won't be left on by accident)
 *   (d) no DB round-trip in the hot path
 */

import { log } from "@/lib/logger";

export function voiceDiagVerbose(): boolean {
  return process.env.VOICE_DIAG_VERBOSE === "1";
}

/**
 * Emit a verbose diagnostic record. No-op when `VOICE_DIAG_VERBOSE !== "1"`.
 *
 * @param subject  Short, dot-delimited subject (e.g. "voice.outbound_dial.assistant_payload"). Used as the log namespace.
 * @param payload  Structured detail. Will be serialised by the logger; keep under ~10 KB per emit. Strip credentials/PII before passing.
 */
export function voiceDiagDump(subject: string, payload: Record<string, unknown>): void {
  if (!voiceDiagVerbose()) return;
  log("system", subject, { level: "debug", ...payload });
}
