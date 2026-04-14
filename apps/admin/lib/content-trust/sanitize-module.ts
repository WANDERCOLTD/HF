/**
 * Guards for AI-generated curriculum module fields.
 *
 * The curriculum LLM occasionally leaks JSON structural keys ("skill_group",
 * "modules", "learningOutcomes") into the `title` field of a module. Without
 * a guard the leaked key ships straight to the DB and learners see a module
 * called "skill_group". This file centralises the blocklist so every writer
 * (extract-curriculum, sync-modules, regenerate-curriculum) behaves the same.
 */

const STRUCTURAL_KEYS = new Set([
  "skill_group",
  "skillgroup",
  "modules",
  "module",
  "learningoutcomes",
  "learning_outcomes",
  "learningobjectives",
  "learning_objectives",
  "assessmentcriteria",
  "assessment_criteria",
  "keyterms",
  "key_terms",
  "description",
  "title",
  "name",
  "sortorder",
  "sort_order",
  "id",
  "slug",
]);

/**
 * Sanitise an AI-provided module title. Returns `fallback` when the title is
 * missing, blank, or matches a known JSON structural key (indicating the LLM
 * leaked a field name into the value slot). Logs a warning so the leak is
 * visible in server logs.
 */
export function sanitizeModuleTitle(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (STRUCTURAL_KEYS.has(trimmed.toLowerCase())) {
    console.warn(
      `[sanitize-module] AI leaked structural key as module title: "${trimmed}" — using fallback "${fallback}"`,
    );
    return fallback;
  }
  return trimmed;
}
