/**
 * Composition coverage — producer ↔ consumer pairing test.
 *
 * Lattice pillar: Coverage (5th pillar). Sibling to
 * `tests/lib/journey/registry-schema-coverage.test.ts` (which guards
 * the Journey Inspector registry vs. its target surface). This file
 * guards the PROMPT BUILDER: every output key a transform produces
 * with a `directive` field MUST have a consumer push in
 * `renderPromptSummary.ts`, or the LLM never sees the directive.
 *
 * Backstory: PR #1768 (Theme 10 profile capture, 2026-06-16) silently
 * deleted 5 unrelated renderer consumer blocks during a bad merge:
 *
 *   - instructions.module_question_target.directive (#1732)
 *   - instructions.module_cue_card.directive       (#1733)
 *   - offboarding.moduleClosingLine                 (#1734)
 *   - instructions.module_orientation_line.directive (#1735)
 *   - priorCallFeedback.summary + scoreboard         (#1749)
 *
 * Each producer kept emitting its key; the renderer stopped reading
 * them. Every IELTS Mock learner ran without the cue-card directive,
 * the question-count directive, the closing line, the first-time
 * orientation, AND the score-delta narrator — for ~24 hours of live
 * traffic — before the regression was spotted. This test is the
 * structural guard so the next bad merge fails at PR time, not in
 * production.
 *
 * Implementation: static manifest of producer → renderer-needle pairs.
 * The test:
 *   1. Reads `transforms/instructions.ts` + `transforms/offboarding.ts`
 *      + (any other transform we manifest) source text.
 *   2. Asserts each producer key is mentioned (output assignment line
 *      shape `<key>:` or `<key>?:` or `"<key>"`).
 *   3. Reads `renderPromptSummary.ts` source text.
 *   4. Asserts the renderer references the same key as a consumer
 *      (one of: `llmPrompt.instructions?.<key>`, `llmPrompt.<key>`,
 *      or a bare `<key>?.` chain).
 *
 * Source-text grep is intentional — proper AST walking would be more
 * robust but the source files are stable enough that string-shape
 * checks catch the regression class without the maintenance burden.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Source-text resolution. Vitest runs with cwd = `apps/admin`, so the
 * `apps/admin/` prefix in PAIRS' producerFile fields is stripped before
 * the join. Same shape works from `/Users/.../HF` if a CI tool changes
 * cwd in the future — the prefix-strip is idempotent.
 */
function readSource(relativePath: string): string {
  const trimmed = relativePath.replace(/^apps\/admin\//, "");
  return readFileSync(join(process.cwd(), trimmed), "utf8");
}

/**
 * Producer ↔ consumer pairs.
 *
 * - `key`: the field on the transform's output object (e.g. `module_cue_card`).
 * - `producerFile`: where the transform lives.
 * - `consumerNeedle`: a substring renderPromptSummary.ts MUST contain.
 *   Looser than `<key>.directive` because some consumers index via
 *   `?.directive`, some via `.summary`, etc.
 * - `since`: PR number that first introduced the pair (for regression
 *   provenance).
 */
const PAIRS: Array<{
  key: string;
  producerFile: string;
  /**
   * Optional override — when the producer file is a loader (not a
   * transform), the section key isn't declared in this source. Pass an
   * alternative substring the file MUST contain (typically a field of
   * the loader's return shape).
   */
  producerNeedle?: string;
  consumerNeedle: string;
  since: string;
}> = [
  {
    key: "module_question_target",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_question_target",
    since: "#1732",
  },
  {
    key: "module_cue_card",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_cue_card",
    since: "#1733",
  },
  {
    key: "moduleClosingLine",
    producerFile: "apps/admin/lib/prompt/composition/transforms/offboarding.ts",
    consumerNeedle: "llmPrompt.offboarding?.moduleClosingLine",
    since: "#1734",
  },
  {
    key: "module_orientation_line",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_orientation_line",
    since: "#1735",
  },
  {
    key: "module_topic_pool",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_topic_pool",
    since: "#1932",
  },
  {
    key: "priorCallFeedback",
    // Loader file — not a transform. Producer-side needle is the loader's
    // output field (`summary`) rather than the section key (which is
    // assigned by the section spec, not in this source).
    producerFile: "apps/admin/lib/prompt/composition/loaders/priorCallFeedback.ts",
    producerNeedle: "summary",
    consumerNeedle: "llmPrompt.priorCallFeedback",
    since: "#1749",
  },
  {
    key: "behavior_targets_semantics",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.behavior_targets_semantics",
    since: "#1951",
  },
  {
    key: "baseline_assessment_depth",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.baseline_assessment_depth",
    since: "#2051",
  },
  {
    key: "module_quiz_directive",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_quiz_directive",
    since: "#2011",
  },
  {
    key: "module_mock_exam_directive",
    producerFile: "apps/admin/lib/prompt/composition/transforms/instructions.ts",
    consumerNeedle: "llmPrompt.instructions?.module_mock_exam_directive",
    since: "#2013",
  },
];

const RENDERER_PATH = "apps/admin/lib/prompt/composition/renderPromptSummary.ts";

describe("Composition coverage — producer ↔ consumer pairing", () => {
  const rendererSource = readSource(RENDERER_PATH);

  it.each(PAIRS)(
    "$key ($since) — producer in $producerFile is paired with a consumer in renderPromptSummary.ts",
    ({ key, producerFile, producerNeedle, consumerNeedle, since }) => {
      const producerSource = readSource(producerFile);

      // Producer side: when a custom needle was supplied (loaders),
      // use it as a substring. Otherwise look for the key as an output
      // assignment or structurally relevant declaration:
      //   `<key>:` (object literal entry)
      //   `<key>?:` (interface field)
      //   `"<key>"` (string key in a record)
      const producerOk = producerNeedle
        ? producerSource.includes(producerNeedle)
        : new RegExp(`(^|[^a-zA-Z_])${key}(\\??:|"\\s*:)`, "m").test(
            producerSource,
          );
      expect(
        producerOk,
        `${since} producer key "${key}" missing from ${producerFile} (looked for ${
          producerNeedle ? `substring "${producerNeedle}"` : `output-key declaration`
        })`,
      ).toBe(true);

      // Consumer side: renderer must reference the key via the canonical
      // dotted path we declared. A simple substring check is enough —
      // anyone who renames the access path also has to update this test,
      // which is intentional (forces a paired update).
      const consumerOk = rendererSource.includes(consumerNeedle);
      expect(
        consumerOk,
        `${since} consumer push for "${key}" missing — renderPromptSummary.ts must reference "${consumerNeedle}". The LLM never sees the directive without this push. See docs/decisions/2026-06-17-composition-coverage.md (or just restore the block that was dropped).`,
      ).toBe(true);
    },
  );

  it("does not regress: at least 5 producer↔consumer pairs are tracked", () => {
    // Smoke pin: if someone deletes the PAIRS entries to silence a
    // failure, this catches the deletion.
    expect(PAIRS.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * Wide sweep — scans every `transforms/*.ts` source for object
   * literals carrying `directive: <string-ish>` fields. Every match
   * MUST sit inside a file that also carries the
   * `@renderer-consumed-at` sentinel comment AND have an explicit row
   * in the PAIRS manifest above. Catches NEW directives added later
   * without a paired consumer push or PAIRS entry.
   *
   * Stronger than the ESLint rule (which fires per-file at edit time
   * and only requires the sentinel) — this fires in CI and additionally
   * requires every directive-bearing key to be enumerated.
   */
  it("wide sweep — every `directive:` field in transforms/*.ts has a tracked pair", () => {
    const transformsDir = join(process.cwd(), "lib/prompt/composition/transforms");
    const { readdirSync } = require("fs");
    const files = readdirSync(transformsDir).filter((f: string) => f.endsWith(".ts"));
    const directivePattern = /directive\s*:\s*[`"']/m;
    const sentinelPattern = /@renderer-consumed-at\s+lib\/prompt\/composition\/renderPromptSummary\.ts/;
    const trackedKeys = new Set(PAIRS.map((p) => p.key));

    const offences: string[] = [];
    for (const f of files) {
      const relPath = `lib/prompt/composition/transforms/${f}`;
      const src = readSource(relPath);
      if (!directivePattern.test(src)) continue;
      if (!sentinelPattern.test(src)) {
        offences.push(`${relPath}: contains a \`directive:\` field but no @renderer-consumed-at sentinel`);
        continue;
      }
      // For every `<key>: { … directive: … }` object entry we can detect,
      // require the key be in PAIRS. Best-effort regex — grabs the
      // identifier that precedes a brace-then-directive block.
      const objectDirectiveRe =
        /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{[\s\S]{0,400}?directive\s*:/gm;
      let m: RegExpExecArray | null;
      while ((m = objectDirectiveRe.exec(src)) !== null) {
        const ident = m[1];
        // Skip common false-positives — these are interface declarations
        // or destructure shapes, not output assignments.
        if (
          ident === "interface" ||
          ident === "type" ||
          ident === "return" ||
          ident === "Returns" ||
          ident === "Returned" ||
          ident === "shape"
        ) {
          continue;
        }
        if (!trackedKeys.has(ident)) {
          offences.push(
            `${relPath}: \`${ident}\` produces a directive but is NOT in PAIRS — add a row above OR rename the field.`,
          );
        }
      }
    }

    expect(
      offences,
      `Untracked directive producers found:\n  - ${offences.join("\n  - ")}`,
    ).toEqual([]);
  });
});
