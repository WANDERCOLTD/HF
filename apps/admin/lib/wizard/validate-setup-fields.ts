/**
 * Validate `update_setup` field names against the canonical wizard graph keys.
 *
 * Why this exists: the wizard data bag is loosely typed (Record<string, unknown>),
 * and the chat AI repeatedly hallucinates field names from the human-readable
 * label rather than the canonical `key` — e.g. writing `moduleProgression` or
 * `interactionPattern` when the field is `progressionMode`. The wizard then
 * silently records the value under the wrong key, the graph evaluator can't
 * see it, and the next required-fields gate (`create_course`) blocks with a
 * misleading "missing: Module progression" error.
 *
 * This validator catches the class of bugs at the boundary:
 *   1. Auto-correct known AI confusions (label-mistaken-for-key collisions).
 *   2. Reject genuinely unknown keys with a helpful suggestion.
 *   3. Allow underscore-prefixed internal keys (UI flags, session metadata).
 */

import { ALL_NODES } from "./graph-nodes";

// Canonical key set from the wizard graph. Drives the whitelist.
const GRAPH_KEYS = new Set<string>(ALL_NODES.map((n) => n.key));

// Internal / resolved fields that aren't graph nodes but are legitimately set
// during the wizard flow (uploaded source IDs, course-ref ingest output, etc.).
// Keep this list curated. Add to it only when the wizard genuinely needs a
// new bag-only field — never to silence an AI hallucination.
const INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "assessmentTargets",
  "uploadSourceIds",
  "packSubjectIds",
  "lastUploadClassifications",
  "courseRefEnabled",
  "courseRefDigest",
  "courseContext",
  "personalityPreset",
  "personalityDescription",
  "welcomeSkipped",
  "draftDomainId",
  "draftSubjectId",
  "domainId",
  "playbookId",
]);

/**
 * Field-name corrections for common AI hallucinations. The chat AI reads
 * the human-readable `label` and reverse-engineers a key, often producing
 * a near-match that doesn't exist. When we see one, silently rewrite it.
 *
 * Only add entries here once they've been observed in production logs — the
 * map is a magnet for accidental scope creep otherwise.
 */
const FIELD_NAME_CORRECTIONS: Record<string, string> = {
  moduleProgression: "progressionMode", // label "Module progression" ↔ key "progressionMode"
};

/**
 * Value-shape hints for fields the AI confuses by VALUE rather than NAME.
 * Specifically: when the AI writes `interactionPattern: "ai-led"` it should
 * be `progressionMode: "ai-led"` — the value range identifies the right
 * field, not the key the AI chose.
 */
const PROGRESSION_VALUES = new Set(["ai-led", "learner-picks"]);

export interface ValidateSetupFieldsResult {
  /** Sanitized fields ready to write to the data bag. */
  validated: Record<string, unknown>;
  /** Auto-corrections applied silently. */
  corrections: { from: string; to: string; reason: string }[];
  /** Genuinely unknown keys that should be rejected with is_error. */
  errors: { key: string; suggestion: string | null }[];
}

/**
 * Levenshtein-style suggestion: pick the closest known key by simple
 * character overlap. Cheap and good enough for "did you mean…?".
 */
function suggestKey(unknown: string): string | null {
  const candidates = [...GRAPH_KEYS, ...INTERNAL_KEYS];
  let best: { key: string; score: number } | null = null;
  const lowerUnknown = unknown.toLowerCase();
  for (const k of candidates) {
    const lowerK = k.toLowerCase();
    // Substring match → strong signal
    if (lowerK.includes(lowerUnknown) || lowerUnknown.includes(lowerK)) {
      const score = Math.min(lowerK.length, lowerUnknown.length);
      if (!best || score > best.score) best = { key: k, score };
    }
  }
  return best?.key ?? null;
}

export function validateSetupFields(
  fields: Record<string, unknown>,
): ValidateSetupFieldsResult {
  const validated: Record<string, unknown> = {};
  const corrections: ValidateSetupFieldsResult["corrections"] = [];
  const errors: ValidateSetupFieldsResult["errors"] = [];

  for (const [origKey, value] of Object.entries(fields)) {
    // 1. Underscore-prefixed internal keys pass through without validation.
    if (origKey.startsWith("_")) {
      validated[origKey] = value;
      continue;
    }

    // 2. Canonical key — accept directly.
    if (GRAPH_KEYS.has(origKey) || INTERNAL_KEYS.has(origKey)) {
      // 2a. Value-based hint: the value identifies the right field even if
      //     the AI wrote a wrong-but-canonical key. Specifically for the
      //     ai-led / learner-picks confusion with interactionPattern.
      if (
        origKey === "interactionPattern" &&
        typeof value === "string" &&
        PROGRESSION_VALUES.has(value)
      ) {
        corrections.push({
          from: origKey,
          to: "progressionMode",
          reason: `value "${value}" is a progressionMode value, not an interactionPattern value — auto-redirected`,
        });
        validated.progressionMode = value;
        continue;
      }
      validated[origKey] = value;
      continue;
    }

    // 3. Known-confusion correction.
    if (origKey in FIELD_NAME_CORRECTIONS) {
      const correctKey = FIELD_NAME_CORRECTIONS[origKey];
      corrections.push({
        from: origKey,
        to: correctKey,
        reason: `"${origKey}" is a common AI hallucination of the label; canonical key is "${correctKey}"`,
      });
      validated[correctKey] = value;
      continue;
    }

    // 4. Unknown key — record an error with a suggestion.
    errors.push({ key: origKey, suggestion: suggestKey(origKey) });
  }

  return { validated, corrections, errors };
}
