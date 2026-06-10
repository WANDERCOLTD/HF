/**
 * #1444 — Post-response structural intercept for DATA + COURSE_MANAGE +
 * `assistant.{chat|data|tasks|spec}` modes, plus a sibling file-path
 * fabrication check for the `chat.bug` mode.
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
 * The same-day audit found the failure class extends beyond enrollment +
 * voice:
 *
 *   - **Progress / mastery** — "Bertie is 60% through", "they've mastered X",
 *     "Bertie completed module 3" — same shape, different verbs.
 *   - **Goal-completion** — "Bertie achieved their goal of X" — same shape.
 *   - **Score** — "Bertie scored 0.7 on warmth", "currently at 0.5" — same
 *     shape; catalogue-style "BEH-WARMTH scored 0.7" (no caller token) is
 *     fine and must not block.
 *   - **`chat.bug` file paths** — bug-diagnosis mode can fabricate
 *     `apps/admin/...:N` citations that don't exist on disk. A trivial
 *     `fs.existsSync` check catches the most common failure.
 *   - **`assistant.{chat|data|...}` route** — the sibling AI route at
 *     `app/api/ai/assistant/route.ts` has the same risk class as `chat.data`
 *     but the original intercept wasn't wired into it.
 *
 * THE FIX (4 layers — original + this extension)
 *
 *   1. Snapshot block in `page-context.ts` labels itself as the COURSE
 *      the operator is viewing, NOT any caller's enrollment.
 *   2. `getSystemOverview()` prepends a "this is the full course catalogue
 *      — not any caller's enrollment" annotation.
 *   3. `DATA_SYSTEM_PROMPT` carries a "Learner-scoped facts grounding
 *      contract" section requiring a tool call before any learner-scoped
 *      claim. Mirrored into the seed JSON.
 *   4. **This file** — regex-suppress the residual case where the model
 *      asserts an ungrounded learner-scoped claim anyway, now covering
 *      enrollment + voice + progress + goal-completion + score claims;
 *      plus `detectFabricatedFilePaths` for `chat.bug`. Wired into the
 *      non-streaming DATA / COURSE_MANAGE tool-loop branch of `route.ts`,
 *      the BUG branch (buffered, single-emit), AND the non-streaming
 *      `assistant.*` route.
 *
 * NOT YET WIRED INTO
 *
 *   - Streaming branches in `route.ts` for CALL / non-tool fallback.
 *     Streaming requires accumulating + buffering the chunk stream before
 *     emitting; the BUG branch is the easy case (response is short and
 *     diagnosis-shaped, so buffering is cheap). The CALL streaming
 *     branches stay out of scope.
 *   - WIZARD / CALL / TUNING / COURSE_REF modes — none of them present
 *     learner-scoped data the same way DATA + COURSE_MANAGE do.
 *
 * DESIGN NOTES
 *
 *   - `detectUngroundedLearnerClaim` is a pure function. No I/O. No DB.
 *   - `detectFabricatedFilePaths` reads the filesystem via `fs.existsSync`
 *     — safe because it runs server-side only. The check is one-shot, no
 *     async; cheap relative to a network round-trip to the model.
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
 *   - **Caller-name token discipline** — the progress / score patterns
 *     require a caller-name token (capitalised first name OR pronoun
 *     `they/them/she/he/her/his`) to be present in the assistant text.
 *     This is what makes "BEH-WARMTH scored 0.7" (catalogue) NOT block
 *     while "Bertie scored 0.7" does. The token check is text-wide,
 *     not co-located — the false-positive risk is far lower than the
 *     fabricated-fact risk, and catching "they're done with X" requires
 *     a fairly loose scope.
 *   - When blocked, the replacement message is a refusal that nudges
 *     the user to ask for the tool call — same phrasing as the system
 *     prompt's "shall I call get_caller_detail?" template.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

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

// Progress / mastery / completion verbs that, paired with a caller-name
// token (capitalised first name OR a "they/them/she/he/her/his" pronoun
// in the same text), make a learner-scoped progress claim. Includes both
// the verb form ("mastered X") and the percent / "through" phrase that
// commonly follows a caller name. Catalogue / cohort talk ("the average
// learner finishes module 3") doesn't carry a caller-name token, so it
// passes through.
const PROGRESS_VERB_RE = /\b(progress|mastery|score|mastered|completed|complete|achieved|done with|finished|finished with|through(?:\s+\d+%?)?|\d+%\s+through|at module|on module)\b/i;

// Goal-completion verbs. The goal noun is structurally part of the
// pattern (the phrase "their/his/her/the goal" right after the verb) —
// so this regex is self-contained and doesn't need a co-location partner.
// Still gated on a caller-name token to avoid catalogue talk like
// "the goal of this course is X".
const GOAL_COMPLETION_RE = /\b(achieved|hit|met|reached|accomplished|completed|done with|finished|finished with)\s+(?:their|his|her|the)\s+goal\b/i;

// Score / rating claims with a numeric value. Catches "scored 0.7",
// "score of 0.5", "rating of 0.8", "at 0.6", "with 0.4". Gated on a
// caller-name token so "BEH-WARMTH scored 0.7" (catalogue / parameter
// talk — no caller token) does NOT block, but "Bertie scored 0.7" does.
const SCORE_CLAIM_RE = /\b(scored|score of|rating of|at|with)\s+(?:0\.\d+|\d+(?:\.\d+)?%?)\b/i;

// Caller-name token — either a single capitalised first name (one word,
// 3-20 chars, leading capital, rest lowercase letters) OR a learner-
// pronoun ("they/them/their/she/he/him/her/his"). Used as a gate on the
// progress / goal-completion / score patterns to filter out catalogue
// / cohort / abstract phrasing. NOT to be confused with
// COURSE_NAME_TOKEN_RE, which matches 2-4 word title-case sequences
// (course names).
//
// The single-word constraint is what makes "Bertie" match while
// "Big Five" does not — course names are always 2+ words in this codebase.
//
// Case-discipline: the name branch is case-sensitive (`[A-Z][a-z]+`,
// no /i flag) so "voice" / "is" / "they" don't false-match as names.
// The pronoun branch is explicit alternation listing both the lower-
// and upper-case starts so we don't need the /i flag at all.
const CALLER_NAME_OR_PRONOUN_RE = /\b(?:[A-Z][a-z]{2,19}|they|They|them|Them|their|Their|she|She|he|He|him|Him|her|Her|his|His)\b/g;

// Stoplist of common capitalised English words that look like names but
// aren't. The lowercase versions are checked against the matched-token
// `toLowerCase()` so we don't have to list both "Welcome" and "welcome".
// Pronouns are NOT in this list (they're a separate branch of the regex).
//
// Add to this list when a false positive lands — keep it tight.
const NON_NAME_CAPITALISED = new Set<string>([
  "hello", "welcome", "hi", "hey", "thanks", "thank", "sorry",
  "yes", "no", "sure", "okay", "ok", "great", "good", "alright",
  "voice", "module", "course", "playbook", "caller", "callers",
  "the", "this", "that", "these", "those",
  "average", "everyone", "anyone", "someone", "nobody",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
]);

/**
 * Test whether `text` contains a caller-name token (capitalised first
 * name OR learner pronoun), filtering out the common-English-word
 * false positives in NON_NAME_CAPITALISED.
 *
 * Used as a gate by the progress / goal-completion / score patterns.
 */
function hasCallerNameToken(text: string): { match: string; index: number } | null {
  // Reset lastIndex defensively since the regex is /g.
  CALLER_NAME_OR_PRONOUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALLER_NAME_OR_PRONOUN_RE.exec(text)) !== null) {
    const token = m[0];
    if (!NON_NAME_CAPITALISED.has(token.toLowerCase())) {
      return { match: token, index: m.index };
    }
  }
  return null;
}

/**
 * Detect an ungrounded learner-scoped claim in an assistant message.
 *
 * Returns `{ blocked: false }` immediately if the model called a grounding
 * tool this turn (the model demonstrably looked up the data). Otherwise
 * runs six pattern checks in order:
 *
 *   1. Grounding short-circuit — `get_caller_detail` / `get_voice_config`.
 *   2. Voice-provider + fallback verb co-located (enrollment-original).
 *   3. Enrollment verb + course-name token co-located (enrollment-original).
 *   4. Goal-completion phrase (gated on caller-name token presence).
 *   5. Progress / mastery / completion verb (gated on caller-name token).
 *   6. Score claim (verb + numeric value, gated on caller-name token).
 *
 * Any firing pattern causes a structural suppression with a tool-call
 * nudge in the replacement text. Patterns 4-6 share the caller-name
 * gate so catalogue / cohort talk passes through; the gate is what
 * makes "Bertie scored 0.7" block while "BEH-WARMTH scored 0.7" does
 * not.
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

  // The remaining patterns (progress / goal-completion / score) ALL
  // gate on the presence of a caller-name token (capitalised first
  // name OR learner pronoun) somewhere in the assistant text. This is
  // what keeps catalogue / cohort / abstract talk ("the average
  // learner finishes module 3", "BEH-WARMTH scored 0.7") from
  // blocking while still catching the named-caller fabrication shape.
  //
  // The token check is text-wide, not co-located with the verb,
  // because the false-positive risk is far lower than the
  // fabricated-fact risk — and pronouns ("they're done with X")
  // routinely live a sentence away from the verb.
  const callerToken = hasCallerNameToken(text);
  if (!callerToken) return { blocked: false };

  // (4) Goal-completion claim. Run BEFORE the progress check because
  // the progress verbs ("achieved", "completed", "done with") are a
  // superset — "achieved their goal" should report as a goal-completion
  // claim, not a generic progress claim.
  const goalMatch = text.match(GOAL_COMPLETION_RE);
  if (goalMatch) {
    return {
      blocked: true,
      suppressedText: text,
      replacementText: REPLACEMENT_TEXT,
      reason: `goal-completion claim ungrounded (phrase="${goalMatch[0]}" token="${callerToken.match}")`,
    };
  }

  // (5) Progress / mastery / completion claim.
  const progressVerb = text.match(PROGRESS_VERB_RE);
  if (progressVerb) {
    return {
      blocked: true,
      suppressedText: text,
      replacementText: REPLACEMENT_TEXT,
      reason: `progress claim ungrounded (verb="${progressVerb[0]}" token="${callerToken.match}")`,
    };
  }

  // (6) Score claim with a numeric value.
  const scoreMatch = text.match(SCORE_CLAIM_RE);
  if (scoreMatch) {
    return {
      blocked: true,
      suppressedText: text,
      replacementText: REPLACEMENT_TEXT,
      reason: `score claim ungrounded (verb="${scoreMatch[0]}" token="${callerToken.match}")`,
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

// ─────────────────────────────────────────────────────────────────────────────
// FILE-PATH INTERCEPT — for `chat.bug` mode
// ─────────────────────────────────────────────────────────────────────────────

export interface FilePathInterceptInput {
  /** The assistant's bug-diagnosis response text. */
  assistantText: string;
  /**
   * Absolute path to the `apps/admin/` directory (the project root that
   * the AI's file citations are relative to). Passed in by the caller so
   * the intercept stays trivially unit-testable — no `process.cwd()`
   * dependency.
   */
  appAdminRoot: string;
}

export interface FilePathInterceptResult {
  blocked: boolean;
  /** Every `apps/admin/...` path the model cited that doesn't exist on disk. */
  fabricatedPaths: string[];
  /** Replacement text sent to the user when blocked. */
  replacementText?: string;
  /** The original assistant text — preserved for logging when blocked. */
  suppressedText?: string;
}

/**
 * Match `apps/admin/<path>(:<line>)?` citations. Path body is the
 * common extension set the codebase actually uses; the optional `:N`
 * tail is captured but stripped before the existence check (we don't
 * validate the line number itself — a bare missing file is a strong
 * enough signal). The path body is conservative: no spaces, no shell
 * meta-chars; this keeps the regex from gobbling adjacent prose.
 *
 * The trailing `(?![A-Za-z])` lookahead prevents extension drift —
 * `apps/admin/lib/foo.ts` shouldn't match if the actual text is
 * `apps/admin/lib/foo.tsBAR`. Trailing punctuation (`.`, `,`, `)`,
 * `;`) is allowed (the path stops cleanly at the digit / extension
 * end). `tsx` listed BEFORE `ts` so the alternation prefers the
 * longer match — otherwise `apps/admin/foo.tsx` would match as
 * `apps/admin/foo.ts` with a dangling `x`.
 */
const FILE_PATH_RE = /apps\/admin\/[A-Za-z0-9_./\-]+\.(?:tsx|jsx|prisma|json|yaml|yml|ts|js|md|sh)(?::\d+)?(?![A-Za-z])/g;

/**
 * Detect file paths in `assistantText` that look like real code citations
 * (`apps/admin/.../<file>.<ext>:<line>?`) but don't exist on disk.
 *
 * Wired into the `chat.bug` branch of `app/api/chat/route.ts`. Bug-
 * diagnosis is the one mode where the model is asked to talk about code,
 * and the 2026-06-10 audit found this is where fabricated paths land
 * most often. `chat.data` / `chat.course_manage` rarely cite files —
 * the intercept is best applied where the failure mode actually fires.
 *
 * Pure-ish: uses `fs.existsSync` (sync, no I/O queue), no DB.
 */
export function detectFabricatedFilePaths(input: FilePathInterceptInput): FilePathInterceptResult {
  const text = (input.assistantText ?? "").trim();
  if (text.length === 0) return { blocked: false, fabricatedPaths: [] };

  // Defensive: appAdminRoot must be an absolute path, else we can't
  // resolve citations safely. Bail open (don't block) on misconfig
  // rather than producing false positives.
  if (!input.appAdminRoot || !isAbsolute(input.appAdminRoot)) {
    return { blocked: false, fabricatedPaths: [] };
  }

  const matches = text.match(FILE_PATH_RE) ?? [];
  if (matches.length === 0) return { blocked: false, fabricatedPaths: [] };

  // Dedupe by string (case-sensitive — file systems on macOS/Linux differ;
  // we treat the model's exact citation as the unit of verification).
  const unique = Array.from(new Set(matches));

  const fabricated: string[] = [];
  for (const rawCitation of unique) {
    // Strip optional `:N` line-number tail and any leading `apps/admin/`.
    const noLine = rawCitation.replace(/:\d+$/, "");
    const relativeToAppAdmin = noLine.replace(/^apps\/admin\//, "");
    // normalize() collapses `..` segments etc.; if any `..` survives,
    // the path tries to escape the root → treat as fabricated (defence-
    // in-depth, not the primary concern here).
    const resolved = normalize(join(input.appAdminRoot, relativeToAppAdmin));
    if (!resolved.startsWith(input.appAdminRoot)) {
      fabricated.push(rawCitation);
      continue;
    }
    if (!existsSync(resolved)) {
      fabricated.push(rawCitation);
    }
  }

  if (fabricated.length === 0) return { blocked: false, fabricatedPaths: [] };

  // Replacement message is a refusal that names the missing paths so the
  // operator can see what was wrong; keeps the original text in
  // `suppressedText` for log breadcrumbs.
  const replacementText =
    `I referenced files that may not exist (${fabricated.join(", ")}). ` +
    `Let me look at the actual code before answering.`;
  return {
    blocked: true,
    fabricatedPaths: fabricated,
    replacementText,
    suppressedText: text,
  };
}
