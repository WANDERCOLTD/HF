/**
 * #1444 — Post-response structural intercept for DATA + COURSE_MANAGE modes.
 *
 * THE PROBLEM
 *
 * On 2026-06-10, a DATA-mode chat fabricated two confidently-wrong claims
 * about a specific caller (Bertie Tallstaff): an enrollment ("a different
 * course than Big Five") and a voice fallback ("falls back to HERA"). Neither
 * was grounded in a `get_caller_detail` or `get_voice_config` tool call —
 * the model inferred them from the `courseSnapshot` page-context block and
 * the `getSystemOverview()` catalogue. The operator nearly acted on them.
 *
 * THE FIX (4 layers)
 *
 *   1. Snapshot block in `page-context.ts` now labels itself as the COURSE
 *      the operator is viewing, NOT any caller's enrollment.
 *   2. `getSystemOverview()` prepends a "this is the full course catalogue
 *      — not any caller's enrollment" annotation.
 *   3. `DATA_SYSTEM_PROMPT` carries a new "Learner-scoped facts grounding
 *      contract" section requiring a tool call before any learner-scoped
 *      claim. Mirrored into the seed JSON.
 *   4. **This file** — regex-suppress the residual case where the model
 *      asserts an ungrounded learner-scoped claim anyway. Sits at the
 *      response-flush boundary in the non-streaming DATA + COURSE_MANAGE
 *      tool-loop branch of `route.ts`.
 *
 * NOT YET WIRED INTO
 *
 *   - Streaming branches in `route.ts` (CALL / BUG / non-tool fallback).
 *     Streaming requires accumulating + buffering the chunk stream before
 *     emitting, which is a separate slice (#1444 follow-on).
 *   - WIZARD / CALL / TUNING / BUG / COURSE_REF modes — none of them
 *     present learner-scoped data the same way DATA + COURSE_MANAGE do.
 *
 * DESIGN NOTES
 *
 *   - Pure function. No I/O. No DB. Trivial to unit-test offline.
 *   - The grounding signal is `toolUsesInTurn` — the tool_use blocks
 *     the model emitted in the CURRENT non-streaming tool loop turn.
 *     Presence of `get_caller_detail` or `get_voice_config` is treated
 *     as sufficient grounding; the call body is not inspected (the tool
 *     would have refused on an invalid callerId anyway).
 *   - Regex patterns are conservative — false negatives are acceptable
 *     (the system prompt + snapshot label cover the common case);
 *     false positives are NOT (would block legitimate course-level
 *     statements). The voice pattern requires both a provider name AND
 *     a fallback-shaped verb co-located within 40 chars; the enrollment
 *     pattern requires both an enrollment verb AND a quoted/title-case
 *     course-name token within 60 chars.
 *   - When blocked, the replacement message is a refusal that nudges
 *     the user to ask for the tool call — same phrasing as the system
 *     prompt's "shall I call get_caller_detail?" template.
 */

export interface InterceptInput {
  /** The assistant's final text-only content (the message body the user would see). */
  assistantText: string;
  /**
   * Every `tool_use` block emitted during the current non-streaming tool
   * loop turn. Only the `name` field is read — input bodies are not
   * inspected (this is a structural check, not a content check).
   */
  toolUsesInTurn: Array<{ name: string }>;
}

export interface InterceptResult {
  /** True when the response was structurally suppressed and replaced. */
  blocked: boolean;
  /** The original assistant text — preserved for logging when blocked. */
  suppressedText?: string;
  /** The replacement text sent to the user when blocked. */
  replacementText?: string;
  /** Which regex fired — used in the log breadcrumb. */
  reason?: string;
}

/**
 * Tool names that count as "grounded a learner-scoped claim this turn".
 * Keep this set tight — every entry is a tool that returns caller-specific
 * data the model can legitimately quote.
 */
const GROUNDING_TOOL_NAMES = new Set<string>(["get_caller_detail", "get_voice_config"]);

/**
 * Replacement text sent to the user when a claim is suppressed. Phrased as
 * an offer-to-tool-call so the operator can confirm and retry; mirrors the
 * "shall I call get_caller_detail?" template in DATA_SYSTEM_PROMPT.
 */
const REPLACEMENT_TEXT = "I'd need to look that up — shall I call get_caller_detail?";

// Enrollment verbs that paired with a course-name token = an enrollment
// claim. "is on" is intentionally narrow — bare "on" matches every
// preposition under the sun.
const ENROLLMENT_VERB_RE = /\b(enrolled in|is taking|is on|signed up for)\b/i;

// Voice-provider names worth watching. Updated when the adapter catalogue
// gains a new provider.
const VOICE_PROVIDER_RE = /\b(deepgram|elevenlabs|eleven labs|azure|openai|aura|hera)\b/i;

// Verbs / nouns that pair with a provider name to make a fabricated voice
// claim about a specific caller's TTS path. Narrowed from the original
// brief to fallback-shaped verbs only — including bare "voice" / "tts"
// / "provider" / "cascade" snags legitimate course-level cascade
// explanations ("the voice cascade for this course resolves to X") and
// catalogue-style answers ("we support deepgram, elevenlabs, ..."). The
// fabricated 2026-06-10 fingerprint that this catches is "falls back to
// HERA"; the catalogue + cascade-resolves phrasings are intentionally
// allowed through.
const VOICE_CONTEXT_RE = /\b(fallback|fall back|falls back|fell back|falling back|falls? through)\b/i;

/**
 * A "course-name token" — either a quoted phrase or a 2-4 word title-case
 * sequence. The title-case rule deliberately requires capital letters on
 * every word so it doesn't match phrases like "a different course than".
 */
const COURSE_NAME_TOKEN_RE = /(?:"[^"]{3,80}"|'[^']{3,80}'|\b(?:[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){1,3})\b)/;

/**
 * Detect an ungrounded learner-scoped claim in an assistant message.
 *
 * Returns `{ blocked: false }` immediately if the model called a grounding
 * tool this turn (the model demonstrably looked up the data). Otherwise
 * checks the assistant text against the enrollment + voice-provider
 * patterns; either one firing causes a structural suppression.
 */
export function detectUngroundedLearnerClaim(input: InterceptInput): InterceptResult {
  const text = (input.assistantText ?? "").trim();
  if (text.length === 0) return { blocked: false };

  // (1) Grounded? The presence of a grounding tool call in this turn is
  // sufficient — we don't inspect the call args because the tool itself
  // would have refused on an invalid callerId.
  const grounded = (input.toolUsesInTurn ?? []).some((tu) => GROUNDING_TOOL_NAMES.has(tu.name));
  if (grounded) return { blocked: false };

  // (2) Voice-provider claim. Look for a provider name and a fallback-shaped
  // verb within 40 chars of each other. Co-location filters out generic
  // "what providers do we support?" answers (which mention provider names
  // without a "fallback" verb).
  const voiceMatch = matchCoLocated(text, VOICE_PROVIDER_RE, VOICE_CONTEXT_RE, 40);
  if (voiceMatch) {
    return {
      blocked: true,
      suppressedText: text,
      replacementText: REPLACEMENT_TEXT,
      reason: `voice-provider claim ungrounded (provider="${voiceMatch.left}" verb="${voiceMatch.right}")`,
    };
  }

  // (3) Enrollment claim. Look for an enrollment verb and a course-name
  // token within 60 chars of each other. The course-name token is either
  // a quoted phrase or a title-case 2-4 word run; bare lowercase words
  // do not match (avoids snagging "is on this morning's call").
  const enrollMatch = matchCoLocated(text, ENROLLMENT_VERB_RE, COURSE_NAME_TOKEN_RE, 60);
  if (enrollMatch) {
    return {
      blocked: true,
      suppressedText: text,
      replacementText: REPLACEMENT_TEXT,
      reason: `enrollment claim ungrounded (verb="${enrollMatch.left}" token="${enrollMatch.right}")`,
    };
  }

  return { blocked: false };
}

/**
 * Returns the first co-occurrence of `left` and `right` within `maxDistance`
 * characters of each other (measured between the END of the first match and
 * the START of the second), or null when no such co-occurrence exists.
 *
 * Order-agnostic — `left` may appear before or after `right`.
 */
function matchCoLocated(
  text: string,
  leftRe: RegExp,
  rightRe: RegExp,
  maxDistance: number,
): { left: string; right: string } | null {
  // Run both regexes globally to enumerate every match position.
  const leftMatches = collectMatches(text, leftRe);
  if (leftMatches.length === 0) return null;
  const rightMatches = collectMatches(text, rightRe);
  if (rightMatches.length === 0) return null;

  for (const l of leftMatches) {
    for (const r of rightMatches) {
      // Don't pair a match with itself (e.g. when the same regex hit on
      // either side via lookahead — defensive even though we don't do that today).
      if (l.start === r.start && l.end === r.end) continue;
      const distance = l.end <= r.start ? r.start - l.end : l.start - r.end;
      if (distance >= 0 && distance <= maxDistance) {
        return { left: l.text, right: r.text };
      }
    }
  }
  return null;
}

interface MatchSpan {
  text: string;
  start: number;
  end: number;
}

function collectMatches(text: string, re: RegExp): MatchSpan[] {
  // Rebuild the regex with the global flag so .exec() walks through all
  // matches. Source + (flags minus g) preserved so caller can pass any
  // pre-compiled pattern.
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const g = new RegExp(re.source, flags);
  const out: MatchSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    // Safety: zero-width match would loop forever.
    if (m.index === g.lastIndex) g.lastIndex += 1;
  }
  return out;
}
