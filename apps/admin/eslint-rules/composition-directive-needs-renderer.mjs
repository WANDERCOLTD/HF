/**
 * #1768 retrospective — block producer-only directive fields in
 * prompt-composition transforms.
 *
 * Live incident 2026-06-17: PR #1768 (Theme 10 profile capture)
 * silently deleted 5 unrelated renderer consumer blocks during a bad
 * merge resolution. Every IELTS Mock learner ran without:
 *
 *   - instructions.module_question_target.directive (#1732)
 *   - instructions.module_cue_card.directive       (#1733)
 *   - offboarding.moduleClosingLine                 (#1734)
 *   - instructions.module_orientation_line.directive (#1735)
 *   - priorCallFeedback.summary + scoreboard         (#1749)
 *
 * The transforms kept producing the data; the renderer dropped the
 * push. Same class of bug as `.claude/rules/lattice-survey.md`
 * "producer-only Lattice entry" but at the transform-vs-renderer
 * layer instead of the registry-vs-transform layer.
 *
 * This rule fires when a `transforms/*.ts` file contains an object
 * literal with a `directive: <string>` property — the canonical
 * shape for an LLM-bound instruction — UNLESS the file ALSO carries
 * a sentinel comment of the form:
 *
 *   // @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 *
 * The sentinel is the author's acknowledgement that the directive
 * has a paired consumer push. The composition-coverage vitest at
 * `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 * verifies the actual pair exists; THIS rule surfaces the
 * requirement at edit time so the regression class can't slip into
 * a PR diff unnoticed.
 *
 * Severity: `error`. The acknowledgement comment is one line per
 * transform file and only needs to be added once; the cost of
 * adding it is far smaller than the cost of shipping a producer-only
 * directive to production.
 *
 * Allow-listed paths:
 *   - `transforms/instructions.ts` (current home of the 4 G8 directives;
 *     sentinel landed in the 2026-06-17 restore PR)
 *   - `transforms/offboarding.ts` (moduleClosingLine)
 *   - Any transform that adds a new directive must add the sentinel.
 *
 * Companion: `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 *            `docs/CHAIN-CONTRACTS.md` (Producer↔Consumer Pairing section)
 */

const GUARDED_PATH_FRAGMENT = "lib/prompt/composition/transforms/";

const SENTINEL_REGEX =
  /@renderer-consumed-at\s+lib\/prompt\/composition\/renderPromptSummary\.ts/;

function isGuardedFile(filename) {
  if (!filename) return false;
  const norm = filename.replace(/\\/g, "/");
  return norm.includes(GUARDED_PATH_FRAGMENT);
}

/** Detect an object property `directive: <string-ish>` whose key is
 *  the literal identifier or string `directive` and whose value is
 *  either a string Literal or a TemplateLiteral.
 */
function isDirectiveProperty(node) {
  if (!node || node.type !== "Property") return false;
  if (node.computed) return false;
  const key = node.key;
  const keyName =
    (key.type === "Identifier" && key.name) ||
    (key.type === "Literal" && typeof key.value === "string" && key.value);
  if (keyName !== "directive") return false;
  const value = node.value;
  if (!value) return false;
  return value.type === "Literal" || value.type === "TemplateLiteral";
}

const messages = {
  noSentinel:
    "Transform output contains a `directive: \"…\"` field but the file is missing the renderer-pairing sentinel. " +
    "Add a comment on a top-level line: `// @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts` " +
    "and ensure the renderer actually pushes the directive. " +
    "See `.claude/rules/lattice-survey.md` (producer↔consumer pairing) + #1768 retrospective.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a sentinel comment in transforms/*.ts files that emit a `directive: \"…\"` field. Forces author acknowledgement that the renderer consumes it.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-composition-directive-needs-renderer",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!isGuardedFile(filename)) return {};

    const sourceCode = context.sourceCode ?? context.getSourceCode();
    // Smoke probes pass a stub sourceCode without `getAllComments` —
    // be defensive so the smoke test can verify visitor shape without
    // crashing.
    const allComments =
      typeof sourceCode?.getAllComments === "function"
        ? sourceCode.getAllComments()
        : [];
    const hasSentinel = allComments.some(
      (c) =>
        (c.type === "Line" || c.type === "Block") &&
        SENTINEL_REGEX.test(c.value),
    );
    if (hasSentinel) return {};

    // Per-file: record the first offending directive property. Report
    // only once at Program:exit so a file with N directives doesn't
    // generate N copies of the same "add the sentinel" instruction —
    // the fix is file-level, the message should be too.
    let firstOffence = null;

    return {
      Property(node) {
        if (firstOffence) return;
        if (isDirectiveProperty(node)) firstOffence = node;
      },
      "Program:exit"() {
        if (firstOffence) {
          context.report({
            node: firstOffence,
            messageId: "noSentinel",
          });
        }
      },
    };
  },
};

export default rule;
