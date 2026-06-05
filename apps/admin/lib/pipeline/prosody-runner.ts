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
import { logVoiceEvent } from "@/lib/voice/telemetry";
import { getVoiceSystemSettings } from "@/lib/voice/system-settings";
import { getSpeechAssessmentProvider } from "@/lib/speech-assessment/provider-factory";
import { resolveSpeechAssessmentProviderForCall } from "@/lib/voice/resolve-speech-assessment-provider";
import type {
  ScoringMode,
  NormalisedScoreResult,
  SpeechAssessmentAdapter,
} from "@/lib/speech-assessment/types";

import type {
  VoiceProsodyFeatures,
  VoiceProsodyMode,
  IeltsScores,
  GeneralSignals,
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
    const envelope: VoiceProsodyFeatures = {
      mode: "unavailable",
      errorReason: "no_recording",
    };
    await persistProsody(callId, envelope);
    return { envelope, vendorCalled: false };
  }

  // 3. Mode detection — read PlaybookConfig.tierPresetId (Option A)
  const mode = await detectProsodyMode(call.playbookId);

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

  try {
    const audio = await fetchAudioBuffer(call.stereoRecordingUrl);
    const scoringMode: ScoringMode =
      mode === "ielts" ? "ielts" : "general";
    const result = await Promise.race([
      adapter.scoreUploadedAudio(audio.buffer, audio.mimeType, scoringMode),
      timeoutAfter(vendorTimeoutMs),
    ]);
    vendorEnvelope = normaliseVendorResult(result, mode);
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === "PROSODY_VENDOR_TIMEOUT";
    vendorEnvelope = {
      mode: "unavailable",
      errorReason: isTimeout ? "vendor_timeout" : "vendor_error",
      rawVendor: err instanceof Error ? { error: err.message } : { error: String(err) },
    };
    vendorErrorMessage = err instanceof Error ? err.message : String(err);
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
  const cfg = pb.config as Record<string, unknown>;
  if (cfg.tierPresetId === "ielts-speaking") {
    return "ielts";
  }
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
