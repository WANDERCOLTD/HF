/**
 * Time-stamped transcript derivation for #1762 (audio-snippet per-segment
 * analysis). VAPI's end-of-call webhook already persists per-turn
 * timestamps in `Call.voiceProviderRaw.artifact.messages[]` — this helper
 * lifts them into a portable shape that Stories C/D/E (cue boundaries,
 * audio slicing, PROSODY_AUDIO stage) can consume without each one
 * re-parsing the raw VAPI blob.
 *
 * No schema migration — derive-on-read from the existing JSON column.
 * If a future provider lacks turn timestamps we fall back to a flat
 * single-span shape rather than null so callers can branch on `turns.length`.
 *
 * Role mapping mirrors `parseVapiCustomerTranscript` in
 * `providers/vapi/index.ts:833`: `bot`/`assistant` → `"assistant"`,
 * everything else → `"learner"`. `system` and `tool` messages are dropped.
 */
export type TurnRole = "assistant" | "learner";

export interface DetailedTurn {
  role: TurnRole;
  text: string;
  startSec: number;
  endSec: number;
}

export interface DetailedTranscript {
  turns: DetailedTurn[];
  /** End of the last turn in seconds. Zero when no turns survive filtering. */
  totalDurationSec: number;
}

interface VapiArtifactMessage {
  role?: unknown;
  message?: unknown;
  secondsFromStart?: unknown;
  duration?: unknown;
}

function mapRole(raw: unknown): TurnRole {
  return raw === "bot" || raw === "assistant" ? "assistant" : "learner";
}

/**
 * Extract per-turn timestamped transcript from a VAPI end-of-call raw blob
 * (typically read from `Call.voiceProviderRaw`).
 *
 * Returns `null` when the input isn't a VAPI-shaped object. Returns an
 * empty-turns transcript when the shape is right but no scoreable turns
 * survive filtering — callers branch on `turns.length`.
 */
export function deriveDetailedTranscriptFromVapi(
  voiceProviderRaw: unknown,
): DetailedTranscript | null {
  if (!voiceProviderRaw || typeof voiceProviderRaw !== "object" || Array.isArray(voiceProviderRaw)) {
    return null;
  }
  const raw = voiceProviderRaw as Record<string, unknown>;
  const artifact = raw.artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }
  const messages = (artifact as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;

  const turns: DetailedTurn[] = [];
  for (const candidate of messages) {
    if (!candidate || typeof candidate !== "object") continue;
    const m = candidate as VapiArtifactMessage;
    if (m.role === "system" || m.role === "tool") continue;
    if (typeof m.message !== "string" || m.message.length === 0) continue;
    if (typeof m.secondsFromStart !== "number" || !Number.isFinite(m.secondsFromStart)) continue;

    const startSec = m.secondsFromStart;
    const durationMs =
      typeof m.duration === "number" && Number.isFinite(m.duration) && m.duration >= 0
        ? m.duration
        : 0;
    const endSec = startSec + durationMs / 1000;
    turns.push({ role: mapRole(m.role), text: m.message, startSec, endSec });
  }

  // VAPI emits messages in receipt order which is normally chronological,
  // but a late `conversation-update` can re-order a tail message. Sort by
  // start time so downstream slicers + segmenters see monotonic spans.
  turns.sort((a, b) => a.startSec - b.startSec);

  const totalDurationSec = turns.length > 0 ? turns[turns.length - 1].endSec : 0;
  return { turns, totalDurationSec };
}

/**
 * Filter turns to a half-open `[fromSec, toSec)` window. Used by Story D's
 * audio-slicer to find which learner turns fall inside a phase boundary.
 *
 * Inclusion rule: a turn is included when its midpoint lies in the window.
 * This avoids a turn straddling a boundary being counted twice when two
 * adjacent windows touch (e.g. `[0,10)` + `[10,20)`).
 */
export function turnsInWindow(
  transcript: DetailedTranscript,
  fromSec: number,
  toSec: number,
): DetailedTurn[] {
  if (toSec <= fromSec) return [];
  return transcript.turns.filter((t) => {
    const mid = (t.startSec + t.endSec) / 2;
    return mid >= fromSec && mid < toSec;
  });
}
