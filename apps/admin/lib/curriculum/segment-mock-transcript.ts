/**
 * Mock Transcript Segmenter — splits a multi-part call transcript
 * (e.g. an IELTS Full Mock Exam) into per-sub-module segments so that
 * downstream MEASURE can produce per-part `CallScore` rows tagged with
 * the corresponding `CurriculumModule.id`.
 *
 * Activation gate: caller-side — only invoke this when
 * `Call.curriculumModuleId` resolves to a module with
 * `coversModules.length > 0`.
 *
 * Strategy: hybrid.
 *   1. Heuristic phase — detect tutor part-transition cues with an
 *      ordered, case-insensitive regex per slug. Cheap, deterministic,
 *      reliable for tutor scripts that consistently announce each part.
 *   2. AI fallback — when the heuristic resolves fewer than
 *      `coversModuleSlugs.length - 1` boundaries, ask the model to
 *      classify transitions. Called with `temperature: 0` so the result
 *      is deterministic for a given transcript text.
 *   3. Guard — the AI output is validated before any `CallScore` write
 *      consumes it: max segment count = `coversModuleSlugs.length`,
 *      every segment slug must be in the whitelist. On validation
 *      failure or zero boundaries, this function returns an empty
 *      array — the caller falls back to single-module bound scoring.
 *
 * The returned segments cover the whole transcript end-to-end (no
 * gaps). When only N-1 boundaries resolve (N expected), the function
 * still produces N segments by attributing every span between
 * boundaries to the slug whose cue marked the start of that span. The
 * pre-first-boundary prefix (typically the tutor opening / Part 1
 * setup) is attributed to the first slug.
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import type { AIEngine } from "@/lib/ai/client";
import type { PipelineLogger } from "@/lib/pipeline/logger";

export type TranscriptSegment = {
  /** Sub-module slug, e.g. "part1" — always a member of the input `coversModuleSlugs`. */
  slug: string;
  /** Transcript excerpt for this segment, including trailing whitespace. */
  text: string;
  /** Character offset in the full transcript where this segment starts. */
  startOffset: number;
  /** Character offset where this segment ends (exclusive). */
  endOffset: number;
  /** How this boundary was resolved — useful for telemetry + debugging. */
  method: "heuristic" | "ai" | "fallback";
};

/**
 * Per-slug ordered regex patterns. Each pattern targets phrases the
 * tutor reliably uses to introduce a part. Patterns are intentionally
 * conservative — false positives (treating a casual mention as a
 * boundary) corrupt downstream scoring, while false negatives just
 * trigger the AI fallback.
 *
 * Ordered: the matcher walks slugs left-to-right; the first match per
 * slug after the previous boundary becomes that slug's start. This
 * guards against "Part 2" appearing inside a Part 3 question.
 */
// Patterns deliberately omit the trailing `\b` because some cue
// phrases end in punctuation (`say:`, `card:`) where the regex engine
// would fail to find a word boundary between `:` and the following
// whitespace.
const HEURISTIC_PATTERNS: Record<string, RegExp[]> = {
  part1: [
    /\b(let'?s\s+(?:start|begin)\s+with\s+part\s*1|part\s*1\s*\.\s*[A-Z]|now\s+(?:in|for)\s+part\s*1|i'?ll?\s+ask\s+you\s+some\s+(?:general|familiar)\s+questions)/i,
  ],
  part2: [
    /\b(now\s+(?:let'?s\s+)?(?:move\s+(?:on\s+)?to|move\s+into|turn\s+to|go\s+to)\s+part\s*2|let'?s\s+(?:start|begin)\s+part\s*2|here'?s?\s+your\s+(?:cue\s+card|topic\s+card)|i'?ll?\s+(?:now\s+)?(?:give|hand)\s+you\s+(?:a|your)\s+(?:cue|topic)\s+card|you'?ll?\s+have\s+(?:one\s+minute|1\s+minute)\s+to\s+prepare|describe\s+a\s+[a-z]+\s+(?:you|that)|you\s+should\s+say)/i,
  ],
  part3: [
    /\b(now\s+(?:let'?s\s+)?(?:move\s+(?:on\s+)?to|move\s+into|turn\s+to|go\s+to)\s+part\s*3|let'?s\s+(?:start|begin)\s+part\s*3|i'?d?\s+like\s+to\s+(?:discuss|talk\s+about)\s+(?:some\s+)?(?:more\s+)?(?:general|abstract|broader)|let'?s\s+(?:now\s+)?(?:discuss|talk\s+about)\s+(?:this|the\s+topic)\s+more\s+(?:broadly|generally|abstractly)|now\s+we'?ll?\s+discuss|now\s+(?:i'?d?\s+like\s+to\s+)?(?:explore|consider)\s+(?:some\s+)?broader)/i,
  ],
};

/**
 * Find the start offset for each slug using ordered regex. Returns a
 * map of slug → offset (or undefined if not found). Boundaries are
 * found in slug order; once a boundary at offset X is found, the next
 * slug's search starts after X to prevent backtracking across parts.
 */
function findHeuristicBoundaries(
  transcript: string,
  coversModuleSlugs: string[],
): Map<string, number> {
  const boundaries = new Map<string, number>();
  let searchFrom = 0;

  for (const slug of coversModuleSlugs) {
    const patterns = HEURISTIC_PATTERNS[slug];
    if (!patterns || patterns.length === 0) continue;

    for (const pattern of patterns) {
      // Run regex starting from `searchFrom` so later slugs only match
      // text that comes after earlier ones.
      const slice = transcript.slice(searchFrom);
      const match = slice.match(pattern);
      if (match && typeof match.index === "number") {
        const absoluteOffset = searchFrom + match.index;
        boundaries.set(slug, absoluteOffset);
        searchFrom = absoluteOffset + match[0].length;
        break;
      }
    }
  }

  return boundaries;
}

/**
 * Build segments from a complete boundary map. The pre-first-boundary
 * prefix is attached to the first slug (this preserves opening tutor
 * turns that set up Part 1). Each segment runs from its slug's
 * boundary to the next slug's boundary, or to end-of-transcript for
 * the last slug.
 */
function buildSegmentsFromBoundaries(
  transcript: string,
  coversModuleSlugs: string[],
  boundaries: Map<string, number>,
  method: TranscriptSegment["method"],
): TranscriptSegment[] {
  const orderedHits = coversModuleSlugs
    .map((slug) => ({ slug, offset: boundaries.get(slug) }))
    .filter((h): h is { slug: string; offset: number } => typeof h.offset === "number")
    .sort((a, b) => a.offset - b.offset);

  if (orderedHits.length === 0) return [];

  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < orderedHits.length; i++) {
    const { slug, offset } = orderedHits[i];
    const start = i === 0 ? 0 : offset; // first segment absorbs the prefix
    const end = i + 1 < orderedHits.length ? orderedHits[i + 1].offset : transcript.length;
    if (end <= start) continue;
    segments.push({
      slug,
      text: transcript.slice(start, end),
      startOffset: start,
      endOffset: end,
      method,
    });
  }

  return segments;
}

interface AISegmentResponse {
  segments?: Array<{ slug?: unknown; startsAt?: unknown }>;
}

/**
 * Validate the AI response: every entry must have a string slug in the
 * whitelist and a numeric `startsAt` within the transcript bounds. The
 * function returns a boundary map (slug → offset). Returns an empty
 * map on any validation failure — the caller treats that as "give up,
 * fall back to bound module".
 */
function validateAndExtractBoundaries(
  raw: unknown,
  transcript: string,
  coversModuleSlugs: string[],
): Map<string, number> {
  if (!raw || typeof raw !== "object") return new Map();
  const obj = raw as AISegmentResponse;
  if (!Array.isArray(obj.segments)) return new Map();

  // Hard cap segment count — even if the model returns more slugs than
  // we asked for, we never accept extras.
  const capped = obj.segments.slice(0, coversModuleSlugs.length);
  const allowedSlugs = new Set(coversModuleSlugs);
  const boundaries = new Map<string, number>();

  for (const entry of capped) {
    if (typeof entry.slug !== "string") return new Map();
    if (!allowedSlugs.has(entry.slug)) return new Map();
    if (typeof entry.startsAt !== "number") return new Map();
    if (entry.startsAt < 0 || entry.startsAt >= transcript.length) return new Map();
    if (boundaries.has(entry.slug)) return new Map(); // dup slug → reject
    boundaries.set(entry.slug, Math.floor(entry.startsAt));
  }

  return boundaries;
}

async function detectBoundariesViaAI(
  transcript: string,
  coversModuleSlugs: string[],
  engine: AIEngine,
  log: PipelineLogger,
): Promise<Map<string, number>> {
  const userPrompt = [
    `Transcript (character offsets are 0-indexed):`,
    transcript,
    ``,
    `Identify the character offset where each of these parts begins in the transcript:`,
    coversModuleSlugs.map((s) => `- ${s}`).join("\n"),
    ``,
    `Return STRICT JSON in this exact shape with no commentary or markdown:`,
    `{"segments": [{"slug": "<slug>", "startsAt": <number>}]}`,
    ``,
    `Rules:`,
    `- One entry per slug. If a part is not present in the transcript, omit it.`,
    `- "startsAt" is the character offset of the first character of that part's first turn.`,
    `- Slugs MUST be one of: ${coversModuleSlugs.join(", ")}.`,
    `- Do not return any other slug names.`,
  ].join("\n");

  // @ai-call curriculum.segment-mock — Locate part boundaries in a multi-part transcript | config: /x/ai-config
  try {
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "curriculum.segment-mock",
        messages: [
          {
            role: "system",
            content:
              "You are a transcript segmenter for IELTS Speaking Mock Exam calls. " +
              "Identify the exact character offset where each named part begins. " +
              "Return JSON only — no prose, no markdown fences.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        timeoutMs: 30000,
      },
      { sourceOp: "curriculum:segment-mock" },
    );

    const responseText = result.content.trim();
    const jsonStr = responseText.startsWith("{")
      ? responseText
      : responseText.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    const boundaries = validateAndExtractBoundaries(parsed, transcript, coversModuleSlugs);
    if (boundaries.size === 0) {
      log.warn("segment-mock-transcript: AI returned no valid boundaries", {
        coversModuleSlugs,
        rawLength: responseText.length,
      });
    }
    return boundaries;
  } catch (err: any) {
    log.warn("segment-mock-transcript: AI boundary detection failed", {
      error: err?.message ?? "unknown",
      coversModuleSlugs,
    });
    return new Map();
  }
}

export interface SegmentMockTranscriptOptions {
  transcript: string;
  /** Ordered slug list — first slug owns the transcript prefix. */
  coversModuleSlugs: string[];
  engine: AIEngine;
  log: PipelineLogger;
}

/**
 * Segment a Mock transcript into per-sub-module pieces. See file
 * header for strategy. Returns `[]` when segmentation fails or
 * produces zero usable boundaries — callers MUST treat that as "no
 * segmentation, score against bound module only".
 */
export async function segmentMockTranscript(
  options: SegmentMockTranscriptOptions,
): Promise<TranscriptSegment[]> {
  const { transcript, coversModuleSlugs, engine, log } = options;

  if (coversModuleSlugs.length === 0) return [];
  if (transcript.trim().length === 0) return [];

  // Phase 1 — heuristic. Skip AI only when ALL N slugs were found via
  // regex; if even one is missing, ask the AI to fill the gap. This
  // preserves the common case (clean transcripts → no AI cost) while
  // recovering from a single missing cue.
  const heuristicBoundaries = findHeuristicBoundaries(transcript, coversModuleSlugs);

  if (heuristicBoundaries.size === coversModuleSlugs.length) {
    const segments = buildSegmentsFromBoundaries(
      transcript,
      coversModuleSlugs,
      heuristicBoundaries,
      "heuristic",
    );
    log.info("segment-mock-transcript: heuristic", {
      slugs: coversModuleSlugs,
      resolved: segments.map((s) => s.slug),
    });
    return segments;
  }

  // Phase 2 — AI fallback (deterministic via temperature=0)
  log.info("segment-mock-transcript: heuristic incomplete, calling AI fallback", {
    heuristicFound: heuristicBoundaries.size,
    expected: coversModuleSlugs.length,
  });
  const aiBoundaries = await detectBoundariesViaAI(transcript, coversModuleSlugs, engine, log);

  if (aiBoundaries.size === 0) {
    // Neither heuristic nor AI produced anything usable — caller falls
    // back to bound-module scoring.
    log.warn("segment-mock-transcript: no boundaries detected, falling back", {
      slugs: coversModuleSlugs,
    });
    return [];
  }

  // Merge: prefer AI offsets, but fall back to heuristic where AI
  // missed a slug. This rescues the common case "AI got Part 2 but
  // missed Part 1; heuristic found Part 1 cleanly".
  const merged = new Map(aiBoundaries);
  for (const [slug, offset] of heuristicBoundaries.entries()) {
    if (!merged.has(slug)) merged.set(slug, offset);
  }

  const segments = buildSegmentsFromBoundaries(transcript, coversModuleSlugs, merged, "ai");
  log.info("segment-mock-transcript: ai fallback", {
    slugs: coversModuleSlugs,
    resolved: segments.map((s) => s.slug),
  });
  return segments;
}

// Test-only export — internal helpers exposed for unit coverage. Do
// NOT import from production code paths.
export const __internals = {
  findHeuristicBoundaries,
  buildSegmentsFromBoundaries,
  validateAndExtractBoundaries,
  HEURISTIC_PATTERNS,
};
