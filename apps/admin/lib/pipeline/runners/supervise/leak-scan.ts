/**
 * leak-scan.ts — #2151 (S5 of epic #2145).
 *
 * SUPERVISE-stage runtime complement to the build-time leak Coverage
 * gate at `apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts`
 * (PR #2144). Both gates read the SAME shared registry at
 * `docs/kb/generated/internal-label-registry.json`.
 *
 * ## What this runner does
 *
 * Given a callId + the live ComposedPrompt body + any PinnedCardContent
 * stamped on the session, scans the text for occurrences of internal-only
 * labels (criterion names, parameter slugs, scoring axes). On any match:
 *
 *   1. Writes ONE `CallScore` row via the canonical
 *      `lib/measurement/write-call-score.ts` chokepoint, keyed
 *      `parameterId = "BEH-INTERNAL-LEAK"`, `score = uniqueLeakCount`,
 *      `analysisSpecId = LEAK-SCAN-001`.
 *   2. Emits ONE `AppLog` row via `lib/logger.ts::log` with
 *      `subject: "supervise.internal_leak_detected"` and per-leak
 *      metadata (labels, sets, surfaces, sessionId, callerId).
 *
 * On the happy path (zero leaks): writes NOTHING. Honest empty state
 * per the no-hardcoded-score-backfill rule
 * (`~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md`)
 * — fake-zero CallScore rows corrupt downstream EMA.
 *
 * ## Why this gate exists
 *
 * PR #2144 (#1955-related) ships a build-time STATIC scan that catches
 * internal-only labels HARDCODED as string literals in learner-UI
 * source files. But the live #1955 leak was DATA-driven —
 * `IELTS_SKILL_LABELS["skill_lexical_resource_lr"] = "Lexical Resource"`
 * flowed through props from `select-pinned-card.ts` into
 * `PinnedCardContent.focusArea`. The literal never appeared in
 * SimChat.tsx; the runtime value did. The static gate is the wrong
 * shape for this class.
 *
 * This runtime gate closes the loop: even when a label reaches the
 * learner via templating, projection, or copy-paste from internal
 * data structures, the SUPERVISE-stage scan catches it after the
 * fact and surfaces the alarm to the operator.
 *
 * ## Architectural notes
 *
 * - **NON-BLOCKING**: failure of this runner MUST NOT abort the
 *   pipeline. Wrap the call site in try/catch and log.
 *
 * - **OPERATOR-ONLY OUTPUT**: the CallScore row carries
 *   `parameterId = "BEH-INTERNAL-LEAK"`, classified `operator-only` in
 *   the parameter registry (#2151 — explicit M2 loop-closure decision:
 *   SUPERVISE-alarm shape, no AGGREGATE/ADAPT/REWARD consumer; the
 *   alarm is read by humans via AppLog, not folded into the cascade).
 *
 * - **NO COMPOSE-TIME REMEDIATION**: this runner DETECTS and REPORTS
 *   only. It does NOT rewrite the prompt. Auto-remediation is
 *   intentionally deferred (see #2151 brief — out of scope).
 *
 * - **SHARED REGISTRY**: the leak labels come from
 *   `docs/kb/generated/internal-label-registry.json` so this gate
 *   stays in lockstep with the build-time gate. Adding a label there
 *   auto-extends both.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import { writeCallScore } from "@/lib/measurement/write-call-score";
import { log } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Shared registry — loaded once at module import. Same JSON the
// build-time gate at apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts
// reads.
// ────────────────────────────────────────────────────────────

export interface InternalLabelSet {
  /** Why these labels are internal-only. */
  description: string;
  /** The labels (as they appear in source — exact case + spacing). */
  labels: readonly string[];
}

interface SharedInternalLabelRegistryJson {
  version: number;
  registry: Record<string, InternalLabelSet>;
}

/**
 * Resolve the shared registry path. The JSON lives at the REPO ROOT
 * (NOT inside `apps/admin/`) at
 * `docs/kb/generated/internal-label-registry.json`. Resolution tries
 * (a) several `__dirname`-relative offsets (works at compile/test time
 * AND when the file lives in its source location), then (b) cwd-based
 * candidates (works in Next.js production bundles where __dirname
 * points into the .next chunk).
 */
const REGISTRY_REL = join("docs", "kb", "generated", "internal-label-registry.json");

function resolveRegistryPath(): string {
  const candidates: string[] = [];
  // __dirname-relative: source location is .../apps/admin/lib/pipeline/runners/supervise/
  // → repo root is 6 levels up. Compile-time tests use this branch.
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    candidates.push(join(dir, REGISTRY_REL));
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // cwd-relative: Next.js typically starts from `apps/admin/`.
  candidates.push(resolvePath(process.cwd(), "..", "..", REGISTRY_REL));
  candidates.push(resolvePath(process.cwd(), "..", REGISTRY_REL));
  candidates.push(resolvePath(process.cwd(), REGISTRY_REL));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to the most likely absolute path — caller's readFileSync
  // will throw a clear ENOENT if it doesn't exist.
  return candidates[0];
}

/**
 * Load the shared registry. Exposed for testability — the vitest
 * passes a fixture override; the production call uses the default
 * file path.
 */
export function loadInternalLabelRegistry(
  pathOverride?: string,
): Record<string, InternalLabelSet> {
  const p = pathOverride ?? resolveRegistryPath();
  const raw = readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as SharedInternalLabelRegistryJson;
  return parsed.registry ?? {};
}

// ────────────────────────────────────────────────────────────
// Pure detection — exported for unit-testability.
// ────────────────────────────────────────────────────────────

export interface ScannableSurface {
  /** Operator-traceable name of the surface (`composedPrompt` / `pinnedCard.focusArea` / etc.). */
  surface: string;
  /** The text body to scan. May be empty / null. */
  text: string | null | undefined;
}

export interface DetectedLeak {
  /** The internal-label set key (e.g. `"IELTS_CRITERIA"`). */
  setKey: string;
  /** The actual label that leaked. */
  label: string;
  /** Which scan surface the leak appeared in. */
  surface: string;
}

/**
 * Scan one or more surfaces for occurrences of any internal-only
 * label. Returns the list of unique (setKey, label, surface) triples.
 * Pure function — no I/O, no side effects.
 *
 * Matching is whole-substring case-sensitive: the label must appear
 * literally in the text. Comment-only occurrences in source files
 * don't fire (we're scanning runtime text, not source).
 */
export function detectLeaks(
  registry: Record<string, InternalLabelSet>,
  surfaces: ReadonlyArray<ScannableSurface>,
): DetectedLeak[] {
  const found: DetectedLeak[] = [];
  for (const surface of surfaces) {
    const text = surface.text;
    if (typeof text !== "string" || text.length === 0) continue;
    for (const [setKey, set] of Object.entries(registry)) {
      for (const label of set.labels) {
        if (label.length === 0) continue;
        if (text.includes(label)) {
          found.push({ setKey, label, surface: surface.surface });
        }
      }
    }
  }
  return found;
}

/**
 * Reduce a list of detected leaks to the unique (setKey, label) pairs
 * — collapses cross-surface duplicates. The CallScore.score is set
 * to this count.
 */
export function uniqueLeakCount(leaks: ReadonlyArray<DetectedLeak>): number {
  const seen = new Set<string>();
  for (const l of leaks) {
    seen.add(`${l.setKey}::${l.label}`);
  }
  return seen.size;
}

// ────────────────────────────────────────────────────────────
// Runner — side-effecting entry point called from the SUPERVISE
// dispatch in app/api/calls/[callId]/pipeline/route.ts.
// ────────────────────────────────────────────────────────────

export const LEAK_SCAN_SPEC_SLUG = "leak-scan-001";
export const LEAK_SCAN_PARAMETER_ID = "BEH-INTERNAL-LEAK";
export const LEAK_SCAN_APPLOG_SUBJECT = "supervise.internal_leak_detected";

export interface RunLeakScanArgs {
  callId: string;
  callerId: string | null;
  /** Module attribution for CallScore (null for unbound calls). */
  moduleId: string | null;
  /** The session id, surfaced into AppLog metadata for forensic traceability. */
  sessionId: string | null;
  /** The composed prompt body for this call (may be empty when not yet built). */
  composedPromptText: string | null | undefined;
  /** Optional pinned card content stamped on the session. */
  pinnedCard: {
    topic?: string;
    bullets?: string[];
    secondaryNote?: string;
    focusArea?: string;
  } | null | undefined;
  /** AnalysisSpec.id for the LEAK-SCAN-001 spec (required by writeCallScore). */
  analysisSpecId: string;
  /** Override hook for tests — production uses the canonical disk file. */
  registryPathOverride?: string;
}

export interface RunLeakScanResult {
  /** Number of unique (setKey, label) leaks detected. */
  uniqueLeakCount: number;
  /** Full per-(setKey, label, surface) detail. */
  leaks: DetectedLeak[];
  /** True when a CallScore row was written (i.e. leak count > 0). */
  callScoreWritten: boolean;
  /** True when the AppLog alarm subject was emitted (= callScoreWritten). */
  appLogEmitted: boolean;
  /** Operator-traceable status for the pipeline log. */
  status: "clean" | "leaks-reported" | "skipped:empty-registry";
}

/**
 * Run the leak scan for one Call. Honest-empty-state: writes nothing
 * when the registry is empty OR when no leaks are detected.
 *
 * Non-throwing on its own logic (parsing the registry is wrapped by
 * the caller's try/catch at the SUPERVISE dispatch site).
 */
export async function runLeakScan(
  args: RunLeakScanArgs,
): Promise<RunLeakScanResult> {
  const registry = loadInternalLabelRegistry(args.registryPathOverride);

  // Sum total label count — when 0, skip without side effects.
  const totalLabels = Object.values(registry).reduce(
    (s, set) => s + set.labels.length,
    0,
  );
  if (totalLabels === 0) {
    return {
      uniqueLeakCount: 0,
      leaks: [],
      callScoreWritten: false,
      appLogEmitted: false,
      status: "skipped:empty-registry",
    };
  }

  // Build the scannable surfaces. PinnedCardContent splits into one
  // entry per text-bearing field so AppLog metadata can attribute the
  // leak to the exact field (focusArea / topic / etc.).
  const surfaces: ScannableSurface[] = [
    { surface: "composedPrompt", text: args.composedPromptText },
  ];
  const pc = args.pinnedCard;
  if (pc) {
    if (typeof pc.topic === "string") {
      surfaces.push({ surface: "pinnedCard.topic", text: pc.topic });
    }
    if (typeof pc.focusArea === "string") {
      surfaces.push({ surface: "pinnedCard.focusArea", text: pc.focusArea });
    }
    if (typeof pc.secondaryNote === "string") {
      surfaces.push({
        surface: "pinnedCard.secondaryNote",
        text: pc.secondaryNote,
      });
    }
    if (Array.isArray(pc.bullets)) {
      for (let i = 0; i < pc.bullets.length; i++) {
        const b = pc.bullets[i];
        if (typeof b === "string") {
          surfaces.push({ surface: `pinnedCard.bullets[${i}]`, text: b });
        }
      }
    }
  }

  const leaks = detectLeaks(registry, surfaces);
  const count = uniqueLeakCount(leaks);

  if (count === 0) {
    // Happy path — honest empty state. NO CallScore row. NO AppLog.
    return {
      uniqueLeakCount: 0,
      leaks: [],
      callScoreWritten: false,
      appLogEmitted: false,
      status: "clean",
    };
  }

  // Leak path — write ONE CallScore + emit ONE AppLog.
  await writeCallScore({
    callId: args.callId,
    callerId: args.callerId,
    parameterId: LEAK_SCAN_PARAMETER_ID,
    analysisSpecId: args.analysisSpecId,
    moduleId: args.moduleId,
    // Score = raw unique-leak count. NOT normalised to 0-1; the
    // operator reads the count + per-leak metadata from AppLog.
    score: count,
    // Confidence is a structural 1.0 — the regex either matched or
    // didn't. There's no probabilistic judgement.
    confidence: 1.0,
    evidence: leaks.map((l) => `${l.setKey}:"${l.label}"@${l.surface}`),
    reasoning: null,
    scoredBy: "leak-scan-v1",
    hasLearnerEvidence: false,
    evidenceQuality: null,
  });

  log("system", "supervise.leak-scan", {
    level: "warn",
    message: `Internal-label leak detected: ${count} unique leak(s) in ${surfaces.length} surface(s)`,
    subject: LEAK_SCAN_APPLOG_SUBJECT,
    callId: args.callId,
    callerId: args.callerId,
    sessionId: args.sessionId,
    moduleId: args.moduleId,
    uniqueLeakCount: count,
    leaks: leaks.map((l) => ({
      setKey: l.setKey,
      label: l.label,
      surface: l.surface,
    })),
  });

  return {
    uniqueLeakCount: count,
    leaks,
    callScoreWritten: true,
    appLogEmitted: true,
    status: "leaks-reported",
  };
}
