/**
 * Keys that historically auto-fanned out via `PromptTunerSidebar.PendingChange.recompose === true`.
 *
 * With the pending-changes tray (epic #854), the new default for Toggle 2
 * ("Recompose all N affected learners") is OFF. That's the correct safety
 * default for most edits — but for THESE specific keys, an educator's pre-
 * existing expectation is that the change applies to the whole cohort
 * immediately. Story #856 / amendment A6 pre-checks Toggle 2 ON when the
 * tray contains any entry whose key is in this set.
 *
 * Source of truth: this file. Story #857 (UI migration) reads from here
 * when wiring `PromptTunerSidebar` and `CourseDesignTab` into the tray.
 *
 * Adding a key here = pre-check Toggle 2 = stronger default fan-out.
 * Removing a key = OFF default = explicit opt-in.
 *
 * @see Epic #854, Story #856 amendment A6
 */

export const FANOUT_CLASS_PLAYBOOK_KEYS: ReadonlySet<string> = new Set([
  // Mastery threshold — pre-existing `recompose: true` in PromptTunerSidebar
  "tolerances.masteryThreshold",
  // Memory decay scale — same historical behaviour
  "tolerances.memoryDecayScale",
  // Retrieval cadence override — same
  "tolerances.retrievalCadenceOverride",
]);

/**
 * True when any tray entry's `key` (or `tolerancesConfigKey`) is in the
 * fanout-class set. The tray uses this to flip Toggle 2's default ON.
 */
export function shouldPreCheckFanout(keys: readonly string[]): boolean {
  for (const key of keys) {
    if (FANOUT_CLASS_PLAYBOOK_KEYS.has(key)) return true;
  }
  return false;
}
