/**
 * session-focus-policy.ts — #2145 Phase A (Generic SessionFocus, S3).
 *
 * Generic runner for the new AnalysisSpec category `session-focus-policy`.
 * Reads a course's internal weakness signals (CallerTarget.currentScore
 * on a declared set of Skill parameters), picks the weakest, maps it
 * via spec-declared `selectionRules` to a LEARNER-FACING label, and
 * writes the label to `CallerAttribute(key = <writeKey>:<moduleSlug>)`
 * so the compose-time transform (`transforms/session-focus.ts`) can
 * read it on the NEXT call.
 *
 * ## Architectural notes
 *
 * - **COURSE-AGNOSTIC**: this runner takes a `SessionFocusPolicyConfig`
 *   from spec.config; it never branches on course-specific shapes or
 *   hardcoded label sets. Adding a new course means: declare the typed
 *   union (`<Course><Surface>FocusUnion` in `lib/types/json-fields.ts`),
 *   author a spec.json with `inputSkills` + `selectionRules`, register
 *   it in the LEARNER_SAFE_REGISTRY (epic #2145 follow-on Coverage).
 *
 * - **HONEST EMPTY STATE**: when no input parameter has a non-null
 *   `currentScore`, the runner writes NOTHING. The compose transform
 *   returns null on the next call and the [SESSION FOCUS] block is
 *   omitted. NO HARDCODED DEFAULT — per
 *   `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md`.
 *
 * - **outputType (#2154)**: session-focus-policy specs declare
 *   `outputType: "CALLER_ATTRIBUTE_NEXT"` — added to the
 *   `AnalysisOutputType` enum by #2154 (sibling of #2145 Phase A).
 *   The pipeline dispatch at `route.ts::stageExecutors.ADAPT` calls
 *   `runSessionFocusPolicySpecs()` to fan these specs to this runner.
 *   Distinct from ADAPT, which writes CallTarget / CallerTarget —
 *   CALLER_ATTRIBUTE_NEXT writes transient per-session emphasis labels
 *   via CallerAttribute (scope = spec slug). The earlier transient
 *   `config.category: "session-focus-policy"` discriminator from PR
 *   #2153 has been retired now that the outputType gates cleanly.
 *   The `isSessionFocusPolicyConfig` type-guard remains as a
 *   defence-in-depth validator on spec.config shape.
 *
 * - **No bare write helper today**: HF currently has no central
 *   CallerAttribute writer chokepoint (the aggregate-runner +
 *   adapt-runner each call `prisma.callerAttribute.upsert` directly).
 *   This runner mirrors that pattern. A follow-on PR can refactor all
 *   CallerAttribute writers into a single helper if epic #1967 M3
 *   surfaces the need.
 *
 * Read site for the written rows: `lib/prompt/composition/transforms/session-focus.ts`
 * — the compose-time reader that projects the stored label into the
 * tutor directive + PinnedCardContent.
 */

import { prisma } from "@/lib/prisma";
import { SESSION_FOCUS_KEY_PREFIX } from "@/lib/prompt/composition/transforms/session-focus";

/**
 * The spec's `config` shape. Authored once per course in spec.json;
 * read at runtime by this runner. No course-specific code lives in the
 * runner — every course-specific behaviour is data-driven from here.
 */
export interface SessionFocusPolicyConfig {
  /**
   * Discriminator — kept as a defence-in-depth config-shape sentinel
   * (the `outputType: "CALLER_ATTRIBUTE_NEXT"` enum value added by
   * #2154 is now the structural dispatch gate). Required.
   */
  category: "session-focus-policy";
  /**
   * Parameter IDs to read from CallerTarget. The runner picks the one
   * with the lowest `currentScore` (skipping nulls).
   *
   * Example (IELTS-P3-FOCUS-001):
   * `["skill_fluency_and_coherence_fc", "skill_lexical_resource_lr", ...]`
   */
  inputSkills: string[];
  /**
   * Name of the learner-facing TypeScript union this policy projects
   * to (e.g. `"Part3TechniqueFocus"`). Documentation-only at runtime
   * — used for traceability in logs and to cross-check against
   * LEARNER_SAFE_REGISTRY in Coverage tests.
   */
  outputUnion: string;
  /**
   * The mapping: when the weakest scored parameter is `whenWeakest`,
   * write `thenLabel` to the CallerAttribute. `thenLabel` MUST be a
   * member of the union named in `outputUnion`.
   *
   * Order is significant only for documentation — the runner finds
   * the rule whose `whenWeakest` matches the chosen parameter id.
   * Authoring a duplicate `whenWeakest` produces undefined behaviour;
   * Coverage tests on the spec JSON should pin uniqueness.
   */
  selectionRules: Array<{
    whenWeakest: string;
    thenLabel: string;
  }>;
  /**
   * The CallerAttribute key prefix shape. The runner appends the
   * locked module's slug to produce the full key.
   *
   * Example: `"session_focus:next_part3"` → writes
   * `CallerAttribute(key = "session_focus:next_part3", ...)`.
   *
   * Today this field is documentation-only — the runner always writes
   * to `${SESSION_FOCUS_KEY_PREFIX}{moduleSlug}` so the compose-time
   * reader can find it. A future spec MAY override the prefix; the
   * reader would then need a matching declaration. Defer until use
   * case appears.
   */
  writeKey: string;
  /**
   * Optional module-shape gate. When present, the runner ONLY fires
   * for modules whose slug matches the pattern (case-insensitive
   * substring match). Useful for IELTS Part-3-only policies that
   * shouldn't write a focus key when the locked module is Part 1.
   */
  moduleScope?: {
    slugPattern?: string;
  };
}

/**
 * Runner output — for the pipeline-route logger + tests.
 */
export interface RunSessionFocusPolicyResult {
  specSlug: string;
  /** The locked module's slug at runtime — null when no module locked. */
  moduleSlug: string | null;
  /** The parameter the runner selected as weakest — null when no scored rows. */
  weakestParameterId: string | null;
  /** The label written, or null when nothing was written. */
  writtenLabel: string | null;
  /**
   * The CallerAttribute key written (or that would have been written
   * if a value existed).
   */
  writeKey: string | null;
  /**
   * Status — `wrote` / `skipped:<reason>`. Operator-facing for
   * the pipeline log.
   */
  status:
    | "wrote"
    | "skipped:no-locked-module"
    | "skipped:module-scope-gate"
    | "skipped:no-scored-inputs"
    | "skipped:no-rule-for-weakest"
    | "skipped:invalid-config";
}

/**
 * Pure function — given the input-skill rows + selection rules, pick
 * the weakest scored parameter and its mapped label. Exported for
 * unit-testability.
 */
export function pickWeakestAndMap(
  callerTargets: ReadonlyArray<{
    parameterId: string;
    currentScore: number | null;
  }>,
  config: SessionFocusPolicyConfig,
): { weakestParameterId: string; label: string } | null {
  const inputSet = new Set(config.inputSkills);
  let best: { parameterId: string; score: number } | null = null;
  for (const row of callerTargets) {
    if (!inputSet.has(row.parameterId)) continue;
    const score = row.currentScore;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (best === null || score < best.score) {
      best = { parameterId: row.parameterId, score };
    }
  }
  if (best === null) return null;
  const rule = config.selectionRules.find(
    (r) => r.whenWeakest === best!.parameterId,
  );
  if (!rule) return null;
  return { weakestParameterId: best.parameterId, label: rule.thenLabel };
}

/**
 * Returns true when the given module slug satisfies the spec's
 * optional `moduleScope.slugPattern`. Pure function. When no pattern
 * is declared, returns true (no gate).
 */
export function moduleSlugMatchesScope(
  moduleSlug: string,
  config: SessionFocusPolicyConfig,
): boolean {
  const pattern = config.moduleScope?.slugPattern;
  if (!pattern) return true;
  return moduleSlug.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Run a single session-focus-policy spec for one caller.
 *
 * Reads CallerTarget.currentScore for the spec's inputSkills, picks
 * the weakest, maps via selectionRules, writes ONE CallerAttribute
 * row keyed `${SESSION_FOCUS_KEY_PREFIX}{moduleSlug}`.
 *
 * Honest empty state — writes nothing when no input scores exist.
 */
export async function runSessionFocusPolicy(args: {
  callerId: string;
  specSlug: string;
  config: SessionFocusPolicyConfig;
  /** The locked module for the upcoming session — passed by the caller. */
  lockedModule: { slug?: string | null; id?: string | null } | null;
}): Promise<RunSessionFocusPolicyResult> {
  const { callerId, specSlug, config, lockedModule } = args;

  // Config sanity
  if (
    !config ||
    config.category !== "session-focus-policy" ||
    !Array.isArray(config.inputSkills) ||
    config.inputSkills.length === 0 ||
    !Array.isArray(config.selectionRules) ||
    config.selectionRules.length === 0
  ) {
    return {
      specSlug,
      moduleSlug: null,
      weakestParameterId: null,
      writtenLabel: null,
      writeKey: null,
      status: "skipped:invalid-config",
    };
  }

  const moduleSlug = lockedModule?.slug ?? lockedModule?.id ?? null;
  if (!moduleSlug) {
    return {
      specSlug,
      moduleSlug: null,
      weakestParameterId: null,
      writtenLabel: null,
      writeKey: null,
      status: "skipped:no-locked-module",
    };
  }

  if (!moduleSlugMatchesScope(moduleSlug, config)) {
    return {
      specSlug,
      moduleSlug,
      weakestParameterId: null,
      writtenLabel: null,
      writeKey: null,
      status: "skipped:module-scope-gate",
    };
  }

  // Read CallerTarget rows for the declared input skills.
  const callerTargets = await prisma.callerTarget.findMany({
    where: {
      callerId,
      parameterId: { in: config.inputSkills },
    },
    select: {
      parameterId: true,
      currentScore: true,
    },
  });

  const picked = pickWeakestAndMap(callerTargets, config);
  if (!picked) {
    // Could be: no rows scored yet, OR no rule matches the picked
    // weakest parameter. The honest-empty-state contract — write
    // nothing, surface the skip in the result.
    const hasAnyScore = callerTargets.some(
      (r) =>
        typeof r.currentScore === "number" && Number.isFinite(r.currentScore),
    );
    return {
      specSlug,
      moduleSlug,
      weakestParameterId: null,
      writtenLabel: null,
      writeKey: null,
      status: hasAnyScore
        ? "skipped:no-rule-for-weakest"
        : "skipped:no-scored-inputs",
    };
  }

  const writeKey = `${SESSION_FOCUS_KEY_PREFIX}${moduleSlug}`;

  // Mirror the canonical CallerAttribute upsert shape (same shape the
  // aggregate-runner uses — keyed `(callerId, key, scope)`). Scope =
  // the spec slug so the write provenance is traceable + parallel
  // session-focus-policy specs (one per course) coexist cleanly.
  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: {
        callerId,
        key: writeKey,
        scope: specSlug,
      },
    },
    update: {
      stringValue: picked.label,
      valueType: "STRING",
      sourceSpecSlug: specSlug,
    },
    create: {
      callerId,
      key: writeKey,
      scope: specSlug,
      valueType: "STRING",
      stringValue: picked.label,
      sourceSpecSlug: specSlug,
    },
  });

  return {
    specSlug,
    moduleSlug,
    weakestParameterId: picked.weakestParameterId,
    writtenLabel: picked.label,
    writeKey,
    status: "wrote",
  };
}

/**
 * Discriminator helper — returns true when an AnalysisSpec's config
 * declares the session-focus-policy category. Used by the pipeline
 * dispatch to fan session-focus-policy specs to this runner instead
 * of the generic ADAPT runner.
 *
 * Pure type-guard.
 */
export function isSessionFocusPolicyConfig(
  config: unknown,
): config is SessionFocusPolicyConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  return (
    c.category === "session-focus-policy" &&
    Array.isArray(c.inputSkills) &&
    Array.isArray(c.selectionRules)
  );
}
