/**
 * Evidence pre-filter — Step 2 of the mode-kill epic (#566).
 *
 * Cheap deterministic check that runs BEFORE the scorer LLM:
 *   "Does the learner-side transcript contain any tokens that could
 *    plausibly evidence this parameter?"
 *
 * In Step 2 this is SHADOW ONLY — we log the decision but never skip the
 * scorer. Lets us validate keyword coverage against what the scorer LLM
 * judges (he/eq fields from Step 1) over a 24-hour window before Step 3
 * trusts the pre-filter to gate scoring.
 *
 * Keyword cascade (highest priority first):
 *   1. `Parameter.config.evidenceKeywords` — admin-curated string[]
 *   2. Auto-derived tokens from `Parameter.name + Parameter.definition`
 *      (lowercased, stopwords removed, dedup, cached in-process)
 *   3. Fallback — when neither is present, returns `{ skip: false,
 *      reason: "no-keywords-defined" }`. The pre-filter never skips on
 *      missing data; it defers to the LLM and surfaces the gap via the
 *      shadow log so we can backfill curated lists where it matters.
 *
 * The pre-filter NEVER decides anything in Step 2. It only reports.
 */

const STOPWORDS = new Set<string>([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for",
  "from", "has", "have", "he", "her", "him", "his", "how", "i", "in",
  "is", "it", "its", "of", "on", "or", "she", "so", "that", "the",
  "their", "them", "they", "this", "to", "was", "we", "were", "what",
  "when", "which", "who", "why", "will", "with", "you", "your", "if",
  "not", "no", "do", "does", "did", "any", "all", "some", "more",
  "one", "two", "three", "much", "many",
]);

/**
 * Compact representation of a Parameter for pre-filter purposes. The
 * shape is intentionally minimal so callers can build it from any
 * Prisma select they already have.
 */
export interface PrefilterParameter {
  parameterId: string;
  name?: string | null;
  definition?: string | null;
  /** `Parameter.config` JSON payload — may contain `evidenceKeywords`. */
  config?: unknown;
}

export interface PrefilterDecision {
  /** True when the pre-filter judges no scoreable evidence exists. */
  skip: boolean;
  /** Brief reason for the decision — surfaces in shadow logs. */
  reason: string;
  /** Word count from the learner-side ("User:") of the transcript. */
  learnerWordCount: number;
  /** Keywords that matched the learner-side text, capped at 8. */
  matchedKeywords: string[];
  /** Keyword source actually used — useful for debugging. */
  source: "admin-override" | "auto-derived" | "missing";
}

const _autoDerivedCache = new Map<string, string[]>();

/**
 * Returns the keyword list to test against the transcript. Cached per
 * parameterId for the lifetime of the process.
 */
export function getEvidenceKeywords(param: PrefilterParameter): {
  keywords: string[];
  source: PrefilterDecision["source"];
} {
  // 1. Admin override on Parameter.config.evidenceKeywords
  if (param.config && typeof param.config === "object" && !Array.isArray(param.config)) {
    const cfg = param.config as Record<string, unknown>;
    const override = cfg.evidenceKeywords;
    if (Array.isArray(override)) {
      const cleaned = override
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.toLowerCase());
      if (cleaned.length > 0) return { keywords: cleaned, source: "admin-override" };
    }
  }

  // 2. Auto-derived from name + definition
  const cached = _autoDerivedCache.get(param.parameterId);
  if (cached) return { keywords: cached, source: "auto-derived" };

  const fields: string[] = [];
  if (typeof param.name === "string") fields.push(param.name);
  if (typeof param.definition === "string") fields.push(param.definition);
  const combined = fields.join(" ").toLowerCase();
  const tokens = combined
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const dedup = [...new Set(tokens)];

  if (dedup.length > 0) {
    _autoDerivedCache.set(param.parameterId, dedup);
    return { keywords: dedup, source: "auto-derived" };
  }

  return { keywords: [], source: "missing" };
}

/**
 * Splits a transcript into the User-side text only. Pattern matches the
 * "User: ..." / "Assistant: ..." line shape produced by every Call writer
 * (sim-drive-call.ts, VAPI webhook, manual ingestion).
 */
export function extractLearnerText(transcript: string | null | undefined): string {
  if (!transcript) return "";
  const lines = transcript.split(/\r?\n+/);
  const learnerLines: string[] = [];
  let currentRole: "user" | "assistant" | "other" = "other";
  for (const line of lines) {
    const userMatch = /^\s*User\s*:\s*(.*)$/i.exec(line);
    if (userMatch) {
      currentRole = "user";
      if (userMatch[1].trim()) learnerLines.push(userMatch[1]);
      continue;
    }
    const assistantMatch = /^\s*Assistant\s*:\s*(.*)$/i.exec(line);
    if (assistantMatch) {
      currentRole = "assistant";
      continue;
    }
    if (currentRole === "user" && line.trim()) {
      learnerLines.push(line.trim());
    }
  }
  return learnerLines.join("\n");
}

/**
 * Runs the pre-filter for one parameter against one transcript.
 * In Step 2 the `skip` flag is advisory — the scorer LLM still runs
 * on every parameter regardless of this decision.
 */
export function checkEvidence(
  transcript: string | null | undefined,
  param: PrefilterParameter,
  opts: { minLearnerWords?: number } = {},
): PrefilterDecision {
  const learnerText = extractLearnerText(transcript);
  const learnerWordCount = learnerText.split(/\s+/).filter(Boolean).length;
  const { keywords, source } = getEvidenceKeywords(param);

  if (source === "missing") {
    return {
      skip: false,
      reason: "no-keywords-defined",
      learnerWordCount,
      matchedKeywords: [],
      source,
    };
  }

  const minLearnerWords = opts.minLearnerWords ?? 10;
  if (learnerWordCount < minLearnerWords) {
    return {
      skip: true,
      reason: `learner-too-quiet (${learnerWordCount} < ${minLearnerWords} words)`,
      learnerWordCount,
      matchedKeywords: [],
      source,
    };
  }

  const haystack = learnerText.toLowerCase();
  const matchedKeywords: string[] = [];
  for (const kw of keywords) {
    if (matchedKeywords.length >= 8) break;
    if (haystack.includes(kw)) matchedKeywords.push(kw);
  }

  if (matchedKeywords.length === 0) {
    return {
      skip: true,
      reason: "no-keyword-match",
      learnerWordCount,
      matchedKeywords,
      source,
    };
  }

  return {
    skip: false,
    reason: `matched ${matchedKeywords.length}/${keywords.length}`,
    learnerWordCount,
    matchedKeywords,
    source,
  };
}

/**
 * Batched helper — runs the pre-filter against a list of parameters and
 * aggregates counts for the shadow telemetry log.
 */
export interface PrefilterBatchSummary {
  total: number;
  wouldSkip: number;
  wouldRun: number;
  byReason: Record<string, number>;
  bySource: Record<PrefilterDecision["source"], number>;
}

export function runEvidencePrefilterBatch(
  transcript: string | null | undefined,
  params: PrefilterParameter[],
  opts: { minLearnerWords?: number } = {},
): { decisions: Array<PrefilterDecision & { parameterId: string }>; summary: PrefilterBatchSummary } {
  const decisions: Array<PrefilterDecision & { parameterId: string }> = [];
  const summary: PrefilterBatchSummary = {
    total: params.length,
    wouldSkip: 0,
    wouldRun: 0,
    byReason: {},
    bySource: { "admin-override": 0, "auto-derived": 0, missing: 0 },
  };
  for (const p of params) {
    const d = checkEvidence(transcript, p, opts);
    decisions.push({ parameterId: p.parameterId, ...d });
    if (d.skip) summary.wouldSkip++;
    else summary.wouldRun++;
    summary.byReason[d.reason] = (summary.byReason[d.reason] ?? 0) + 1;
    summary.bySource[d.source]++;
  }
  return { decisions, summary };
}

/** Test-only: clear the auto-derived cache between vitest cases. */
export function __resetEvidenceKeywordCache(): void {
  _autoDerivedCache.clear();
}
