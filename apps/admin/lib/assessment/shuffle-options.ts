/**
 * Deterministic MCQ option shuffle — #1067.
 *
 * XAMS XLSX export convention stores the correct answer as the first option
 * ("Answer 1") for every question; the source platform shuffles at delivery
 * time. HFF used to render options in storage order, leaking the correct
 * answer as "always A" (verified on hf_sandbox 2026-06-04: 250/250 MCQs
 * across 5 question banks had `correctAnswer` at label A).
 *
 * Shuffle at presentation time (prompt assembly + UI rendering). The shuffle
 * is deterministic per `seed` so retries reproduce the same order — i.e. a
 * learner who refreshes the page or replays a survey sees the same labels in
 * the same positions for the same question. Different learners get
 * different shuffles → cohort-wide ~25/25/25/25 distribution across the four
 * label positions.
 *
 * Implementation:
 *   - `seedFromStrings(...parts)` — stable 32-bit hash for a seed
 *   - `shuffleOptions(options, seed)` — Fisher-Yates driven by mulberry32 PRNG
 *
 * The mulberry32 PRNG is a 32-bit non-cryptographic generator with good
 * uniformity for small N — exactly the use case here (typically 4 options).
 */

/**
 * Stable 32-bit unsigned int hash over a concatenation of strings. Used to
 * seed mulberry32. Not cryptographic; just needs to be deterministic and
 * spread well across inputs. djb2 variant.
 */
export function seedFromStrings(...parts: readonly string[]): number {
  const joined = parts.join("|");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 33) ^ joined.charCodeAt(i);
    h >>>= 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — a fast 32-bit PRNG.
 *
 * Returns a function that emits floats in [0, 1). The state is captured in
 * the closure; calling the same factory with the same seed reproduces the
 * exact same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle, driven by a deterministic seed.
 *
 * Returns a new array; the input is not mutated. The shape of each option
 * (text, label, isCorrect, …) is preserved verbatim — the `isCorrect` flag
 * travels with each option through the shuffle so downstream consumers
 * (UI label renderer, AI evaluator) can still locate the correct answer
 * by reading `option.isCorrect`.
 *
 * @param options array of option objects (typically `{ label, text, isCorrect }`)
 * @param seed    32-bit unsigned integer (use `seedFromStrings(...)` to derive)
 * @returns shuffled copy of `options`
 */
export function shuffleOptions<T>(options: readonly T[], seed: number): T[] {
  const out = [...options];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Relabel a shuffled options array so position 0 is "A", 1 is "B", etc.
 *
 * Used by UI surfaces (e.g. pre-test survey) that present labels back to the
 * learner. After this call, the option in slot N carries `label = letterAt(N)`
 * and its original `isCorrect` flag, so:
 *   - the renderer shows "A. {text-of-correct} | B. … | …" when the correct
 *     answer happens to land in slot 0 after shuffle, or
 *   - "A. … | B. {text-of-correct} | …" when it lands in slot 1, etc.
 *
 * Callers that compute `correctAnswer` from `isCorrect` get the new label
 * automatically — there's no separate "correct position" to thread.
 */
export function relabelByPosition<T extends { label?: string }>(
  options: readonly T[],
): T[] {
  return options.map((opt, idx) => ({ ...opt, label: letterAt(idx) }));
}

function letterAt(i: number): string {
  // A, B, C, …, Z, AA, AB, … (only first 26 in practice; MCQs are rarely > 5).
  if (i < 26) return String.fromCharCode(65 + i);
  return letterAt(Math.floor(i / 26) - 1) + letterAt(i % 26);
}
