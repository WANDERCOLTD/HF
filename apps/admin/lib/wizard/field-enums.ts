/**
 * Wizard Field Enums — the SINGLE source of truth for option-typed
 * wizard field values (#316).
 *
 * Before this file existed, the same enum lived in three places:
 *   1. `wizard-tool-executor.ts` — `UPDATE_SETUP_FIELD_ENUMS` (added in #315)
 *   2. `v5-system-prompt.ts` — prose in the FALLBACK_VALUES section
 *   3. `conversational-system-prompt.ts` — prose in the FALLBACK_VALUES section
 *
 * Drift between those three caused the silent-failure bug today: v5's
 * prompt didn't even mention `progressionMode`, while the graph required
 * it; the AI mis-routed values; the validator (which was its own copy of
 * the enum) caught only some of it.
 *
 * From now on:
 *   - `OPTIONS_VALUES` is the registry by `OptionsKey` (the wizard's
 *     option-set identifier in `graph-schema.ts`).
 *   - `FIELD_ENUMS` is a derived flat map keyed by the field's data-bag
 *     key (e.g. `interactionPattern`, `progressionMode`). Built at module
 *     load by walking `WIZARD_GRAPH_NODES` — when a new options-typed node
 *     is added with a registered `optionsKey`, `FIELD_ENUMS` auto-derives.
 *   - `getEnumDescription(optionsKey)` produces the markdown bullet list
 *     used in system prompts. Prompt-build code calls this instead of
 *     hand-authoring the prose.
 *
 * Adding a new option-typed field:
 *   1. Add the option-set name to `OptionsKey` in `graph-schema.ts`.
 *   2. Add the value list + description to `OPTIONS_VALUES` here.
 *   3. Add the node to `WIZARD_GRAPH_NODES` with `optionsKey` set.
 *   4. (No further work in the validator or prompts — they consume from
 *      `FIELD_ENUMS` / `getEnumDescription` automatically.)
 */

import type { OptionsKey } from "./graph-schema";
import { WIZARD_GRAPH_NODES } from "./graph-nodes";

export interface EnumValueDoc {
  value: string;
  description: string;
}

/**
 * Per-OptionsKey value registry. Each entry is the canonical list of
 * accepted values plus a one-line description for the system prompt.
 *
 * Some option sets are intentionally absent here:
 *   - `subjectsCatalog`  — dynamic, generated per-institution at runtime
 *   - `institutionTypes` — sourced from the InstitutionType DB table
 *   - `sessionCounts`    — numeric range, not a strict enum
 *   - `durations`        — numeric range, not a strict enum
 *
 * Fields whose `optionsKey` doesn't appear here pass validation through;
 * they're either dynamic, numeric, or covered by other guards.
 */
export const OPTIONS_VALUES: Partial<Record<OptionsKey, readonly EnumValueDoc[]>> = {
  interactionPatterns: [
    { value: "socratic", description: "Question-based discovery, guides through questioning" },
    { value: "directive", description: "Structured, step-by-step instruction" },
    { value: "advisory", description: "Coaching style, offers guidance" },
    { value: "coaching", description: "Reflective dialogue, metacognition" },
    { value: "companion", description: "Supportive peer" },
    { value: "facilitation", description: "Discussion facilitation" },
    { value: "reflective", description: "Self-reflection and learning-from-experience" },
    { value: "open", description: "Flexible, adapts to need" },
    { value: "conversational-guide", description: "Warm, curious guide for 1:1 conversations — no teaching, no coaching" },
  ],
  progressionModes: [
    { value: "ai-led", description: "Scheduler picks each call based on learner progress. Default for adaptive courses." },
    { value: "learner-picks", description: "Learner sees a module menu before each session. Requires a Module Catalogue table in the Course Reference markdown." },
  ],
  teachingModes: [
    { value: "recall", description: "Memorisation and retrieval practice." },
    { value: "comprehension", description: "Understanding-led teaching (default)." },
    { value: "practice", description: "Applied practice with feedback." },
    { value: "syllabus", description: "Structured syllabus coverage." },
  ],
  planEmphases: [
    { value: "breadth", description: "Cover many topics, less depth per topic." },
    { value: "balanced", description: "Even coverage and depth (default)." },
    { value: "depth", description: "Fewer topics, deeper coverage per topic." },
  ],
  assessmentStyles: [
    { value: "formal", description: "Structured pre/post tests with rubric scoring." },
    { value: "light", description: "Casual checks during conversation." },
    { value: "none", description: "No formal assessment." },
  ],
};

/**
 * Derived flat map: data-bag-field-key → permitted string values.
 *
 * Built at module load by joining `WIZARD_GRAPH_NODES` (which knows each
 * field's `optionsKey`) with `OPTIONS_VALUES` (which holds the values).
 * If a graph node has no `optionsKey`, or its optionsKey isn't registered
 * in `OPTIONS_VALUES`, the field is omitted from this map and validation
 * passes through.
 */
export const FIELD_ENUMS: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, readonly string[]> = {};
  for (const node of WIZARD_GRAPH_NODES) {
    if (!node.optionsKey) continue;
    const values = OPTIONS_VALUES[node.optionsKey];
    if (!values) continue;
    map[node.key] = values.map((v) => v.value);
  }
  return Object.freeze(map);
})();

/**
 * Render an option set as a markdown bullet list. Used by the wizard
 * system-prompt generator so the prose enum table is built from the same
 * registry the validator consumes.
 *
 * Returns null when the optionsKey isn't registered (caller should fall
 * back to whatever it was rendering before, or skip).
 */
export function getEnumDescription(optionsKey: OptionsKey): string | null {
  const values = OPTIONS_VALUES[optionsKey];
  if (!values) return null;
  return values.map((v) => `- ${v.value} — ${v.description}`).join("\n");
}
