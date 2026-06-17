/**
 * PROSODY pipeline stage runner (#1119).
 *
 * Sits between EXTRACT and AGGREGATE in the spec-driven pipeline. For
 * each Call:
 *
 *   1. Idempotency — if Call.voiceProsody already populated AND not
 *      force=true, return the existing envelope. Zero cost. Guards
 *      admin "rerun" clicks from re-paying the per-minute vendor cost.
 *   2. No-recording short-circuit — Call.stereoRecordingUrl === null →
 *      emit { mode: "unavailable", errorReason: "no_recording" }.
 *      Sim runs / text-only playbooks land here.
 *   3. Mode detection — read playbook.config.tierPresetId. Option A
 *      from the TL review: "ielts-speaking" → "ielts" mode, anything
 *      else → "general".
 *   4. Provider resolution — resolveSpeechAssessmentProviderForCall
 *      (caller/cohort/playbook/system cascade). If no provider
 *      configured → mode: "unavailable", errorReason:
 *      "no_provider_configured".
 *   5. Vendor call — fetch the audio from stereoRecordingUrl, send to
 *      adapter.scoreUploadedAudio(buffer, mimeType, mode), wrapped in
 *      a Promise.race against VoiceSystemSettings.vendorTimeoutMs.
 *      On timeout → mode: "unavailable", errorReason: "vendor_timeout".
 *      On HTTP error → mode: "unavailable", errorReason: "vendor_error".
 *   6. Persist + emit — write to Call.voiceProsody (forensic) AND
 *      return the envelope (live pipeline signal consumed by AGGREGATE).
 *   7. Telemetry — logVoiceEvent({ slug: 'prosody-{adapterKey}',
 *      operation, durationMs, ... }). `slug` is REQUIRED.
 *
 * Failure modes are NEVER thrown — the pipeline must continue regardless
 * of vendor problems. The contract envelope is the failure-signalling
 * mechanism (`mode: "unavailable"` + `errorReason`). AGGREGATE checks
 * the mode before doing any prosody-dependent writes.
 *
 * Producer-only. Writes ZERO CallScore rows, ZERO BehaviorParameter
 * deltas, ZERO CallerAttribute rows. AGGREGATE is the consumer that
 * translates envelope → downstream writes.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { logVoiceEvent } from "@/lib/voice/telemetry";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getSpeechAssessmentProvider } from "@/lib/speech-assessment/provider-factory";
import { resolveSpeechAssessmentProviderForCall } from "@/lib/voice/resolve-speech-assessment-provider";
import { recordIAL4ProsodySkip } from "@/lib/pipeline/adaptive-loop-invariants";
import {
  extractAudioSlice,
  AudioSliceError,
} from "@/lib/voice/audio-slice";
import type {
  ScoringMode,
  NormalisedScoreResult,
  SpeechAssessmentAdapter,
} from "@/lib/speech-assessment/types";
import type {
  PhaseBoundary,
  SessionMetadata,
} from "@/lib/types/json-fields";

import type {
  VoiceProsodyFeatures,
  VoiceProsodyMode,
  IeltsScores,
  GeneralSignals,
  ProsodyPhaseEnvelope,
} from "./prosody-types";

export interface RunProsodyOptions {
  callId: string;
  callerId: string | null;
  force?: boolean;
}

export interface RunProsodyResult {
  envelope: VoiceProsodyFeatures;
  skippedReason?: "existing_envelope";
  vendorCalled: boolean;
}

/**
 * Run the PROSODY stage for a single Call. Always succeeds — failures
 * are encoded in `envelope.mode = "unavailable"` so the pipeline can
 * continue. Throws only on programmer errors (e.g. missing Call row).
 */
export async function runProsodyStage(
  options: RunProsodyOptions,
): Promise<RunProsodyResult> {
  const { callId, callerId } = options;
  const force = options.force === true;

  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      id: true,
      stereoRecordingUrl: true,
      playbookId: true,
      voiceProsody: true,
      // #1870 — read Session.metadata.phaseBoundaries via the 1:1
      // Call.session relation (epic #1338). Null when no Session row is
      // linked (legacy Calls during the Slice 0 transition window).
      session: { select: { metadata: true } },
    },
  });
  if (!call) {
    throw new Error(`runProsodyStage: Call ${callId} not found`);
  }

  // 1. Idempotency — bail without vendor call if envelope already exists
  if (!force && call.voiceProsody) {
    return {
      envelope: call.voiceProsody as unknown as VoiceProsodyFeatures,
      skippedReason: "existing_envelope",
      vendorCalled: false,
    };
  }

  // 2. No-recording short-circuit
  if (!call.stereoRecordingUrl) {
    // I-AL4 — emit observability before short-circuit so operators see WHY
    // PROSODY didn't fire (e.g. sim calls hit this every time). Fire-and-forget;
    // helper swallows its own errors and never blocks the pipeline.
    // See docs/CHAIN-CONTRACTS.md §6 (I-AL4).
    await recordIAL4ProsodySkip({
      callId,
      callerId: callerId ?? undefined,
      reason: "no-stereoUrl",
    });
    const envelope: VoiceProsodyFeatures = {
      mode: "unavailable",
      errorReason: "no_recording",
    };
    await persistProsody(callId, envelope);
    return { envelope, vendorCalled: false };
  }

  // 3. Mode detection — read PlaybookConfig.tierPresetId (Option A).
  // When a Playbook is attached but tierPresetId is unset, emit I-AL4 with
  // reason="no-tierPreset" so operators can SEE that the IELTS-specific path
  // won't engage. The runner continues with general mode (no behavioural
  // change) — the seed script `scripts/seed-ielts-prosody.ts` is the
  // operator-facing remediation.
  const mode = await detectProsodyMode(call.playbookId);
  if (mode === "general" && call.playbookId) {
    const tierPresetSet = await playbookHasTierPreset(call.playbookId);
    if (!tierPresetSet) {
      await recordIAL4ProsodySkip({
        callId,
        callerId: callerId ?? undefined,
        reason: "no-tierPreset",
      });
    }
  }

  // 4. Provider resolution
  let providerSlug: string;
  let adapterKey: string;
  let adapter: SpeechAssessmentAdapter;
  try {
    const resolved = await resolveSpeechAssessmentProviderForCall(
      callId,
      callerId,
      call.playbookId,
    );
    providerSlug = resolved.slug;
    adapter = await getSpeechAssessmentProvider(providerSlug);
    adapterKey = adapter.slug;
  } catch {
    // I-AL4 — emit observability so operators see the cascade fell through
    // to "no SpeechAssessmentProvider with isDefault=true AND enabled=true".
    // The seed script `scripts/seed-ielts-prosody.ts` ensures one default
    // exists; this WARN surfaces drift if it's ever lost.
    await recordIAL4ProsodySkip({
      callId,
      callerId: callerId ?? undefined,
      reason: "no-provider",
    });
    const envelope: VoiceProsodyFeatures = {
      mode: "unavailable",
      errorReason: "no_provider_configured",
    };
    await persistProsody(callId, envelope);
    return { envelope, vendorCalled: false };
  }

  // 5. Vendor call with timeout
  const settings = await getVoiceSystemSettings();
  const vendorTimeoutMs = settings.vendorTimeoutMs;
  const startMs = Date.now();
  let vendorEnvelope: VoiceProsodyFeatures;
  let vendorErrorMessage: string | undefined;

  // 5a. Branch — segmented vs whole-call. Segmented requires:
  //   - >= 2 phase boundaries (a single boundary degenerates to whole-call)
  //   - boundaries.length <= maxSegmentsPerCall (cost cap, #1870 AC)
  //   - audio-slice host allow-list (currently storage.vapi.ai only)
  //   - Session relation populated (legacy Calls during #1338 Slice 0
  //     window have no Session — degenerates to whole-call)
  const boundaries = readPhaseBoundaries(call.session?.metadata);
  const cap = settings.maxSegmentsPerCall;
  const overCap = boundaries.length > cap;

  if (overCap) {
    log("system", "voice.prosody.segments_capped", {
      level: "warn",
      callId,
      phaseCount: boundaries.length,
      cap,
    });
  }

  const wantSegmented = boundaries.length >= 2 && !overCap;

  if (wantSegmented) {
    // Probe the host once via the slice helper's validation pathway —
    // a single failed call short-circuits the segmented branch and
    // falls back to whole-call (rather than aborting). Use a zero-byte
    // probe by passing fetchImpl that returns 416 immediately; cheaper
    // to just try the first slice and catch host_not_allowed.
    try {
      const segmented = await runSegmentedProsody({
        callId,
        callerId,
        recordingUrl: call.stereoRecordingUrl,
        adapter,
        mode,
        vendorTimeoutMs,
        boundaries,
      });
      vendorEnvelope = segmented.envelope;
      vendorErrorMessage = segmented.errorMessage;
    } catch (err) {
      // Catastrophic failure (host_not_allowed on the very first phase
      // — slice helper's URL validation rejected it). Fall back to
      // whole-call so the call still gets a forensic envelope.
      const reason =
        err instanceof AudioSliceError && err.code === "host_not_allowed"
          ? "segment_url_not_allowed"
          : "segment_setup_failed";
      log("system", `voice.prosody.${reason}`, {
        level: "warn",
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
      vendorEnvelope = await runWholeCallProsody({
        recordingUrl: call.stereoRecordingUrl,
        adapter,
        mode,
        vendorTimeoutMs,
      }).then((r) => {
        vendorErrorMessage = r.errorMessage;
        return r.envelope;
      });
    }
  } else {
    const whole = await runWholeCallProsody({
      recordingUrl: call.stereoRecordingUrl,
      adapter,
      mode,
      vendorTimeoutMs,
    });
    vendorEnvelope = whole.envelope;
    vendorErrorMessage = whole.errorMessage;
  }

  const durationMs = Date.now() - startMs;

  // 7. Telemetry — slug is REQUIRED
  logVoiceEvent({
    slug: `prosody-${adapterKey}`,
    operation: "prosody_scoring",
    durationMs,
    callId,
    callerId: callerId ?? undefined,
    metadata: {
      providerSlug,
      mode: vendorEnvelope.mode,
      errorReason: vendorEnvelope.errorReason,
      vendorTimeoutMs,
    },
    errorMessage: vendorErrorMessage,
  });

  // 6. Persist envelope (live signal = return value; column = forensic)
  await persistProsody(callId, vendorEnvelope);

  return {
    envelope: vendorEnvelope,
    vendorCalled: vendorEnvelope.mode !== "unavailable" ||
      vendorEnvelope.errorReason === "vendor_error" ||
      vendorEnvelope.errorReason === "vendor_timeout",
  };
}

/**
 * Detect IELTS vs general mode by reading PlaybookConfig.tierPresetId
 * (Option A — TL review). Unset / non-IELTS preset → "general".
 */
async function detectProsodyMode(
  playbookId: string | null,
): Promise<VoiceProsodyMode> {
  if (!playbookId) return "general";
  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  if (!pb?.config) return "general";
  return resolveProsodyMode(pb.config as Record<string, unknown>);
}

/**
 * Returns true when Playbook.config.tierPresetId is a non-empty string.
 * Used by the I-AL4 observability path to distinguish "operator hasn't picked
 * a tier" (WARN-worthy) from "operator chose general explicitly via
 * config.voice.prosodyMode" (NOT WARN-worthy — explicit choice).
 *
 * Defensive — swallows DB errors and returns true so we DON'T over-fire.
 */
async function playbookHasTierPreset(playbookId: string): Promise<boolean> {
  try {
    const pb = await prisma.playbook.findUnique({
      where: { id: playbookId },
      select: { config: true },
    });
    const config = (pb?.config ?? null) as Record<string, unknown> | null;
    if (!config) return false;
    // Explicit operator choice via voice.prosodyMode counts as a tier decision
    // — surfaces "I want general scoring on this course" without nagging.
    const voiceCfg = config.voice as Record<string, unknown> | null | undefined;
    const explicit = voiceCfg?.prosodyMode;
    if (explicit === "general" || explicit === "ielts") return true;
    const tier = config.tierPresetId;
    return typeof tier === "string" && tier.length > 0;
  } catch {
    return true;
  }
}

/**
 * Resolve prosody mode from a `Playbook.config` blob. Pure — exported for
 * the course-detail UI pill and the Cmd+K snapshot builder so all readers
 * use the same precedence (operator setting wins over tier-preset heuristic).
 *
 * Return type is narrower than `VoiceProsodyMode` — `"unavailable"` is a
 * runtime envelope state from the prosody runner, never a config value.
 *
 * Precedence:
 *   1. `config.voice.prosodyMode === "ielts" | "general"` — explicit
 *      operator choice via Settings or Cmd+K's update_voice_config tool.
 *      "auto" (or any other string) falls through to the heuristic.
 *   2. `config.tierPresetId === "ielts-speaking"` — legacy auto-detect for
 *      courses that pre-date the explicit field.
 *   3. Default → "general".
 */
export function resolveProsodyMode(
  config: Record<string, unknown> | null | undefined,
): "ielts" | "general" {
  if (!config) return "general";
  const voiceCfg = config.voice as Record<string, unknown> | null | undefined;
  const explicit = voiceCfg?.prosodyMode;
  if (explicit === "ielts" || explicit === "general") return explicit;
  if (config.tierPresetId === "ielts-speaking") return "ielts";
  return "general";
}

/**
 * Fetch the recording URL into a Buffer. Adapter is upload-only so HF
 * has to ferry the bytes. Returns the mime type the vendor expects too.
 *
 * NOTE: VAPI's stereo recording is typically WAV. If a future vendor
 * stores in a different format, sniff the response content-type.
 */
async function fetchAudioBuffer(
  recordingUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(recordingUrl);
  if (!res.ok) {
    throw new Error(
      `PROSODY_AUDIO_FETCH_FAILED: HTTP ${res.status} from ${recordingUrl}`,
    );
  }
  const mimeType = res.headers.get("content-type") ?? "audio/wav";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

/** Promise that rejects after `ms` with a distinctive marker so the catch
 *  block can tell timeout from vendor error. */
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("PROSODY_VENDOR_TIMEOUT")), ms);
  });
}

/** Vendor → VoiceProsodyFeatures envelope. The adapter's
 *  NormalisedScoreResult already extracted IELTS sub-bands; we just
 *  remap field names + branch on mode. */
function normaliseVendorResult(
  result: NormalisedScoreResult,
  mode: VoiceProsodyMode,
): VoiceProsodyFeatures {
  if (mode === "ielts") {
    if (!result.ielts) {
      // Mode requested but vendor returned no IELTS payload → treat as
      // unavailable so AGGREGATE doesn't write half-empty CallScore rows.
      return {
        mode: "unavailable",
        errorReason: "vendor_error",
        rawVendor: result.raw,
      };
    }
    const ielts: IeltsScores = {
      overall: result.ielts.overall,
      pronunciation: result.ielts.pronunciation,
      fluencyCoherence: result.ielts.fluency,
      lexicalResource: result.ielts.vocabulary ?? 0,
      grammaticalRange: result.ielts.grammar ?? 0,
    };
    return {
      mode: "ielts",
      ieltsScores: ielts,
      rawVendor: result.raw,
    };
  }

  // General mode — vendor adapters don't yet return generic prosody
  // signals in a normalised shape (the SpeechAce / SpeechSuper paths
  // return IELTS even when called with `general` mode). For now, we
  // derive degenerate signals from the IELTS payload when present, and
  // emit zeros otherwise. A future story can extend the adapter
  // interface with a `getGeneralSignals()` method when a vendor really
  // exposes them.
  const generalSignals: GeneralSignals = {
    paceWpm: 0,
    hesitationRate: 0,
    meanEnergyDb: 0,
    pitchRangeHz: 0,
    confidenceProxy: result.ielts?.fluency
      ? Math.min(1, result.ielts.fluency / 9)
      : 0,
  };
  return {
    mode: "general",
    generalSignals,
    rawVendor: result.raw,
  };
}

async function persistProsody(
  callId: string,
  envelope: VoiceProsodyFeatures,
): Promise<void> {
  await prisma.call.update({
    where: { id: callId },
    data: {
      voiceProsody: envelope as unknown as object,
    },
  });
}

/**
 * Extract `phaseBoundaries` from `Session.metadata`. Defensive — accepts
 * the raw JSON column shape (Prisma returns `JsonValue | null`). Returns
 * an empty array when the metadata is missing, malformed, or empty so
 * the caller can branch on `length`.
 */
function readPhaseBoundaries(metadata: unknown): PhaseBoundary[] {
  if (!metadata || typeof metadata !== "object") return [];
  const md = metadata as SessionMetadata;
  const raw = md.phaseBoundaries;
  if (!Array.isArray(raw)) return [];
  // Filter shape-valid entries — defensive against a future writer
  // shipping partial rows. A boundary with `endSec === startSec` is the
  // OPEN-boundary convention (#1762 Story C) and is intentionally
  // skipped here because we can't slice an empty window.
  const out: PhaseBoundary[] = [];
  for (const row of raw) {
    if (
      row &&
      typeof row === "object" &&
      typeof (row as PhaseBoundary).phase === "string" &&
      typeof (row as PhaseBoundary).startSec === "number" &&
      typeof (row as PhaseBoundary).endSec === "number" &&
      Number.isFinite((row as PhaseBoundary).startSec) &&
      Number.isFinite((row as PhaseBoundary).endSec) &&
      (row as PhaseBoundary).endSec > (row as PhaseBoundary).startSec
    ) {
      out.push(row as PhaseBoundary);
    }
  }
  return out;
}

interface RunWholeCallProsodyArgs {
  recordingUrl: string;
  adapter: SpeechAssessmentAdapter;
  mode: VoiceProsodyMode;
  vendorTimeoutMs: number;
}

interface VendorAttemptResult {
  envelope: VoiceProsodyFeatures;
  errorMessage?: string;
}

/**
 * Whole-call vendor invocation — today's behaviour, factored out to a
 * helper so the segmented branch can reuse the catch-and-encode pattern
 * verbatim. Byte-identical to the pre-#1870 inline block.
 */
async function runWholeCallProsody(
  args: RunWholeCallProsodyArgs,
): Promise<VendorAttemptResult> {
  try {
    const audio = await fetchAudioBuffer(args.recordingUrl);
    const scoringMode: ScoringMode =
      args.mode === "ielts" ? "ielts" : "general";
    const result = await Promise.race([
      args.adapter.scoreUploadedAudio(audio.buffer, audio.mimeType, scoringMode),
      timeoutAfter(args.vendorTimeoutMs),
    ]);
    return { envelope: normaliseVendorResult(result, args.mode) };
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === "PROSODY_VENDOR_TIMEOUT";
    return {
      envelope: {
        mode: "unavailable",
        errorReason: isTimeout ? "vendor_timeout" : "vendor_error",
        rawVendor:
          err instanceof Error ? { error: err.message } : { error: String(err) },
      },
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

interface RunSegmentedProsodyArgs {
  callId: string;
  callerId: string | null;
  recordingUrl: string;
  adapter: SpeechAssessmentAdapter;
  mode: VoiceProsodyMode;
  vendorTimeoutMs: number;
  boundaries: PhaseBoundary[];
}

/**
 * Segmented vendor invocation — one adapter call per phase boundary.
 *
 * Idempotency note: the runner-level idempotency (Step 1, existing
 * envelope short-circuit) covers the WHOLE call. Per-phase idempotency
 * is a future hardening; for now a force-rerun goes phase-by-phase
 * (re-billing every phase). This matches the AC: "cache key
 * `(callId, phaseKey)` … full-call re-run still goes phase-by-phase".
 *
 * Per-phase failures are CONTAINED — one adapter exception writes a
 * `{mode: "unavailable", errorReason}` slot for that phase but does NOT
 * abort the sibling phases. The top-level aggregate uses only the
 * successful phases.
 */
async function runSegmentedProsody(
  args: RunSegmentedProsodyArgs,
): Promise<VendorAttemptResult> {
  log("system", "voice.prosody.segmented_start", {
    level: "info",
    callId: args.callId,
    phaseCount: args.boundaries.length,
  });

  const bySegment: Record<string, ProsodyPhaseEnvelope> = {};
  let lastErrorMessage: string | undefined;
  let firstSetupError: unknown = null;

  for (const boundary of args.boundaries) {
    // #1872 — namespace prefix on segmentKey writes to avoid collision
    // with the text-side Theme 6 Mock segmenter ("part1" / "part2" /
    // "part3"). Operator-chosen phase names ("p1" / "p2_prep" / etc.)
    // are wrapped here; the AGGREGATE consumer mirrors the prefix when
    // writing CallScore rows.
    const phaseKey = `phase:${boundary.phase}`;

    let phaseEnvelope: ProsodyPhaseEnvelope;
    try {
      const slice = await extractAudioSlice({
        audioUrl: args.recordingUrl,
        startSec: boundary.startSec,
        endSec: boundary.endSec,
      });
      const sliceBuffer = Buffer.from(slice.buffer ?? new Uint8Array(0));
      const scoringMode: ScoringMode =
        args.mode === "ielts" ? "ielts" : "general";
      const result = await Promise.race([
        args.adapter.scoreUploadedAudio(
          sliceBuffer,
          slice.contentType,
          scoringMode,
        ),
        timeoutAfter(args.vendorTimeoutMs),
      ]);
      const whole = normaliseVendorResult(result, args.mode);
      if (whole.mode === "ielts" && whole.ieltsScores) {
        phaseEnvelope = { mode: "ielts", ieltsScores: whole.ieltsScores };
      } else if (whole.mode === "general" && whole.generalSignals) {
        phaseEnvelope = { mode: "general", generalSignals: whole.generalSignals };
      } else {
        phaseEnvelope = {
          mode: "unavailable",
          errorReason: whole.errorReason ?? "vendor_error",
        };
      }
      log("system", "voice.prosody.segmented_phase_scored", {
        level: "info",
        callId: args.callId,
        phaseKey,
        criterionCount:
          phaseEnvelope.mode === "ielts"
            ? 4
            : phaseEnvelope.mode === "general"
            ? 2
            : 0,
      });
    } catch (err) {
      // AudioSliceError host_not_allowed on the FIRST phase indicates
      // a configuration failure — propagate so the caller falls back
      // to whole-call. Same for any setup-class error that hits all
      // phases.
      if (
        Object.keys(bySegment).length === 0 &&
        err instanceof AudioSliceError &&
        err.code === "host_not_allowed"
      ) {
        firstSetupError = err;
        break;
      }
      const isTimeout =
        err instanceof Error && err.message === "PROSODY_VENDOR_TIMEOUT";
      const errorReason = isTimeout ? "vendor_timeout" : "vendor_error";
      phaseEnvelope = { mode: "unavailable", errorReason };
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      log("system", "voice.prosody.segmented_phase_failed", {
        level: "warn",
        callId: args.callId,
        phaseKey,
        errorReason,
        error: lastErrorMessage,
      });
    }
    bySegment[phaseKey] = phaseEnvelope;
  }

  if (firstSetupError) {
    throw firstSetupError;
  }

  // Aggregate top-level fields from the successful phases. Readers that
  // only inspect top-level `ieltsScores` / `generalSignals` keep working
  // — they see the MEAN across successful phases (AC: "top-level fields
  // remain populated for backwards-compat").
  const envelope = aggregateBySegment(bySegment, args.mode);
  return { envelope, errorMessage: lastErrorMessage };
}

/**
 * Aggregate per-phase envelopes into the top-level fields. Skips
 * "unavailable" phases. Returns the parent envelope shape (top-level
 * fields + `bySegment`).
 *
 * IELTS mode: MEAN per sub-band across successful IELTS phases.
 * General mode: MEAN per field, skipping zeros (the existing vendor
 *   stub returns 0 for all four signals until adapters expose general
 *   prosody — comment lives at `prosody-runner.ts::normaliseVendorResult`
 *   general branch). When every successful phase reports 0 for a
 *   field, the field stays 0 — fine, matches the stub semantics.
 */
function aggregateBySegment(
  bySegment: Record<string, ProsodyPhaseEnvelope>,
  mode: VoiceProsodyMode,
): VoiceProsodyFeatures {
  const phases = Object.values(bySegment);
  const successful = phases.filter(
    (p): p is Exclude<ProsodyPhaseEnvelope, { mode: "unavailable" }> =>
      p.mode !== "unavailable",
  );

  // Every phase failed → top-level "unavailable"; preserve bySegment
  // for forensics.
  if (successful.length === 0) {
    return {
      mode: "unavailable",
      errorReason: "vendor_error",
      bySegment,
    };
  }

  if (mode === "ielts") {
    const ieltsPhases = successful.filter(
      (p): p is { mode: "ielts"; ieltsScores: IeltsScores } => p.mode === "ielts",
    );
    if (ieltsPhases.length === 0) {
      return {
        mode: "unavailable",
        errorReason: "vendor_error",
        bySegment,
      };
    }
    const ieltsScores: IeltsScores = {
      overall: mean(ieltsPhases.map((p) => p.ieltsScores.overall)),
      pronunciation: mean(ieltsPhases.map((p) => p.ieltsScores.pronunciation)),
      fluencyCoherence: mean(ieltsPhases.map((p) => p.ieltsScores.fluencyCoherence)),
      lexicalResource: mean(ieltsPhases.map((p) => p.ieltsScores.lexicalResource)),
      grammaticalRange: mean(ieltsPhases.map((p) => p.ieltsScores.grammaticalRange)),
    };
    return { mode: "ielts", ieltsScores, bySegment };
  }

  const generalPhases = successful.filter(
    (p): p is { mode: "general"; generalSignals: GeneralSignals } =>
      p.mode === "general",
  );
  if (generalPhases.length === 0) {
    return {
      mode: "unavailable",
      errorReason: "vendor_error",
      bySegment,
    };
  }
  // Per-field stub-aware mean — skip 0 values (the existing vendor stub
  // sentinel at `normaliseVendorResult` general branch). If every
  // contributing phase is 0, the result stays 0; semantics match the
  // whole-call stub.
  const generalSignals: GeneralSignals = {
    paceWpm: meanSkipZero(generalPhases.map((p) => p.generalSignals.paceWpm)),
    hesitationRate: meanSkipZero(
      generalPhases.map((p) => p.generalSignals.hesitationRate),
    ),
    meanEnergyDb: meanSkipZero(
      generalPhases.map((p) => p.generalSignals.meanEnergyDb),
    ),
    pitchRangeHz: meanSkipZero(
      generalPhases.map((p) => p.generalSignals.pitchRangeHz),
    ),
    confidenceProxy: mean(
      generalPhases.map((p) => p.generalSignals.confidenceProxy),
    ),
  };
  return { mode: "general", generalSignals, bySegment };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function meanSkipZero(values: number[]): number {
  const nonZero = values.filter((v) => Number.isFinite(v) && v !== 0);
  if (nonZero.length === 0) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}
