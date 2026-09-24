/**
 * #2183 — block course-specific string literals in spec dispatch / filter logic.
 *
 * The pipeline + measurement + dispatch layers must not couple their behaviour
 * to product-specific spec naming. Concrete examples:
 *
 *   // BAD — Prisma filter literal
 *   await prisma.analysisSpec.findMany({
 *     where: { id: { in: measureSpecIds }, slug: { startsWith: "IELTS-MEASURE-" } },
 *   });
 *
 *   // BAD — string-method dispatch literal
 *   if (spec.slug.startsWith("IELTS-MEASURE-")) { … }
 *
 *   // BAD — generic contains
 *   if (spec.name.includes("IELTS")) { … }
 *
 * If a non-IELTS course (TOEFL, CIO/CTO Speaking, KS2-SATs) ships its own
 * MEASURE specs, the auto-detection silently fails. The operator-stated
 * principle: NO HARDCODINGS. The architectural pattern documented in
 * `docs/CHAIN-CONTRACTS.md` is **spec-driven dispatch** — query by
 * `outputType` / `specRole` / opt-in config flag, not by slug substring.
 *
 * Heuristic — fires on string literals of shape `[A-Z]{3,}[-_]` (CAPS prefix
 * followed by hyphen or underscore) when the literal is the VALUE of a Prisma
 * filter clause (`startsWith` / `endsWith` / `contains`) OR an argument to a
 * String method of the same name. Restricted to spec-dispatch surfaces:
 * `app/api/calls/`, `app/api/pipeline/`, `app/api/score/`, `lib/pipeline/`,
 * `lib/measurement/`. Other surfaces (`lib/curriculum/` slug resolvers,
 * `lib/voice/` route handlers reading provider names) are exempt — they
 * legitimately handle product names as data.
 *
 * Allow-list (always skipped):
 *   - `lib/config.ts`            — env-overridable prefix constants live here
 *   - `prisma/seed-from-specs.ts`, `prisma/seed*.ts`, `prisma/migrations/**`
 *   - All `.test.ts` / `.test.tsx` / `.spec.ts` files
 *   - `_archived/**`
 *
 * Per-site escape: route the constant through `config.specs.<name>Prefix` (when
 * adding a new prefix knob), or refactor the dispatch to be course-agnostic
 * via `spec.outputType` / `spec.config.requiresBehaviorTargetParams` flags.
 *
 * Severity: error from day 1. The pipeline route's prior `slug: { startsWith:
 * "IELTS-MEASURE-" }` Prisma filter was already course-agnosticised by
 * #2155 / #2137 — replaced by `filterByBehaviorTargetParams` reading the
 * opt-in `requiresBehaviorTargetParams: true` config flag on the spec. The
 * one remaining incumbent literal (`specs-loader.ts:431`) belongs to a
 * narrowly-scoped per-Playbook kill-switch override (#2158); it is exempt
 * via a per-site escape comment, with the constant lifted to a named
 * helper so future course-specific overrides can be added by adding a
 * row to a map, not by hardcoding a new prefix at a new call-site.
 *
 * @see .claude/rules/no-course-specific-measure-query.md
 * @see docs/CHAIN-CONTRACTS.md (spec-driven dispatch pattern)
 */

// Course-prefix shape: require the [-_] tail. A bare-CAPS form
// (`"IELTS"`, `"WARMTH"`) is ambiguous — Parameter ids and aggregator
// keys also live in that shape — so we accept some misses on
// `contains: "IELTS"` rather than fire on parameter substrings like
// `contains: "WARMTH"`. The real partner-blocker class IS the prefix
// shape with the dispatch separator (the dispatch family marker).
//
// Matches: `IELTS-`, `IELTS-MEASURE-`, `TOEFL-`, `CEFR-`, `CIO_`,
//          `KS2-`, `MVP-BEH-`, `BEH-MVP_`.
// Does NOT match: `init-001` (lowercase), `IELTS` alone (no separator),
// `WARMTH`, `MVP-BEH` (no trailing separator — the separator is what
// flags "this is a dispatch family prefix" not "this is data").
const COURSE_PREFIX_WITH_SEPARATOR_RE = /^[A-Z]{3,}(?:[-_][A-Z0-9]+)*[-_]$/;

// Path fragments that opt-IN to the rule — only spec-dispatch surfaces.
const GUARDED_PATH_FRAGMENTS = [
  "/app/api/calls/",
  "/app/api/pipeline/",
  "/app/api/score/",
  "/lib/pipeline/",
  "/lib/measurement/",
];

// Always-skip path fragments.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/config.ts",
  "/prisma/seed",
  "/prisma/migrations/",
  "/prisma/_archived/seed",
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "/_archived/",
];

function isGuardedFile(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  if (ALLOWLIST_PATH_FRAGMENTS.some((p) => normalised.includes(p))) return false;
  return GUARDED_PATH_FRAGMENTS.some((p) => normalised.includes(p));
}

// Match Prisma-filter property keys whose value carries a substring constraint.
const FILTER_KEYS = new Set(["startsWith", "endsWith", "contains"]);

// Match the SAME names as String prototype methods — `s.startsWith("FOO-")`.
const STRING_METHODS = new Set(["startsWith", "endsWith", "includes"]);

const messages = {
  prismaFilter:
    "Course-specific Prisma filter literal `{{value}}` couples spec dispatch to product naming. " +
    "Query by `outputType` / `specRole` / a config opt-in flag instead (see CHAIN-CONTRACTS.md spec-driven " +
    "dispatch pattern). If a prefix is genuinely needed, lift it to `config.specs.<name>Prefix` so it's " +
    "env-overridable. See `.claude/rules/no-course-specific-measure-query.md`.",
  stringMethod:
    "Course-specific string-method literal `{{value}}` couples spec dispatch to product naming. " +
    "Refactor to a course-agnostic predicate (e.g. read `spec.config.requiresBehaviorTargetParams`) or " +
    "lift the prefix to `config.specs.<name>Prefix`. Per-site escape comment: " +
    "`// hf-pipeline-disable-next-line no-course-specific-measure-query: <reason>`. " +
    "See `.claude/rules/no-course-specific-measure-query.md`.",
};

const ESCAPE_PATTERN = /no-course-specific-measure-query/;

// Comments in ESLint attach to the nearest "statement-ish" ancestor,
// not to deeply nested expressions (Property values, CallExpression
// arguments). Walk up to the nearest statement-like boundary, then
// look for the escape comment there.
const STATEMENT_LIKE = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "ReturnStatement",
  "IfStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "BlockStatement",
  "Program",
]);

function findStatementAncestor(node) {
  let current = node.parent;
  while (current) {
    if (STATEMENT_LIKE.has(current.type)) return current;
    current = current.parent;
  }
  return node;
}

function hasEscapeOnPrecedingLine(sourceCode, node) {
  if (!sourceCode || !node) return false;
  if (typeof sourceCode.getCommentsBefore !== "function") return false;
  const anchor = findStatementAncestor(node);
  const commentsBefore = sourceCode.getCommentsBefore(anchor);
  for (const comment of commentsBefore) {
    if (ESCAPE_PATTERN.test(comment.value)) return true;
  }
  return false;
}

function isCoursePrefixLiteral(node) {
  if (!node || node.type !== "Literal") return false;
  if (typeof node.value !== "string") return false;
  return COURSE_PREFIX_WITH_SEPARATOR_RE.test(node.value);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block course-specific literals (e.g. 'IELTS-MEASURE-') in spec-dispatch Prisma filters and String-method calls. Use spec-driven dispatch (outputType / specRole / opt-in config) per CHAIN-CONTRACTS.md.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-course-specific-measure-query",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isGuardedFile(filename)) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    return {
      // Prisma-filter literal:
      //   { startsWith: "IELTS-MEASURE-" }
      //   { contains: "IELTS" }            ← allowBareCaps
      Property(node) {
        if (
          !node.key ||
          (node.key.type !== "Identifier" && node.key.type !== "Literal")
        ) {
          return;
        }
        const keyName = node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (!FILTER_KEYS.has(keyName)) return;
        if (!isCoursePrefixLiteral(node.value)) return;
        if (hasEscapeOnPrecedingLine(sourceCode, node)) return;
        context.report({
          node: node.value,
          messageId: "prismaFilter",
          data: { value: node.value.value },
        });
      },
      // String-method literal:
      //   spec.slug.startsWith("IELTS-MEASURE-")
      //   spec.name.includes("IELTS")          ← allowBareCaps
      CallExpression(node) {
        const callee = node.callee;
        if (
          !callee ||
          callee.type !== "MemberExpression" ||
          callee.property?.type !== "Identifier" ||
          !STRING_METHODS.has(callee.property.name)
        ) {
          return;
        }
        // Don't fire on the Prisma-filter case — that's covered by the Property
        // visitor above. The Prisma filter syntax is `{startsWith: "..."}` (a
        // Property), not `something.startsWith("...")` (a CallExpression).
        const arg0 = node.arguments?.[0];
        if (!isCoursePrefixLiteral(arg0)) return;
        if (hasEscapeOnPrecedingLine(sourceCode, node)) return;
        context.report({
          node: arg0,
          messageId: "stringMethod",
          data: { value: arg0.value },
        });
      },
    };
  },
};

export default rule;
