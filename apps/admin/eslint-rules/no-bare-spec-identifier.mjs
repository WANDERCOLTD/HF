/**
 * #2182 — Block bare spec-identifier string literals outside the explicit
 * allow-list. Spec identifiers (DataContract ids like `SKILL_MEASURE_V1`,
 * MEASURE sentinel ids like `PROSODY-SCORE-V1`) are env-overridable
 * config and live in `lib/config.ts` under `config.specs.*`. A literal
 * argument to `ContractRegistry.getContract(...)` OR a bareword
 * `[A-Z_]+_(V\d+|SPEC|ID)`-shaped const value in runtime code silently
 * stops matching the moment the corresponding env override flips.
 *
 * Sibling to `hf-config/no-hardcoded-spec-slug` (Audit HF-I) — that rule
 * catches the `XXX-NNN` AnalysisSpec slug shape. This one catches the
 * IDENTIFIER argument shape (any-shape string passed to a contract /
 * sentinel lookup) and the const-map shape (`PROSODY: "PROSODY-SCORE-V1"`).
 *
 * The 2026-06-21 hardcoding audit surfaced 3 incumbent offenders:
 *   - `lib/pipeline/aggregate-runner.ts:184` —
 *     `ContractRegistry.getContract("SKILL_MEASURE_V1")`
 *   - `lib/goals/track-progress.ts:132` — same shape
 *   - `lib/measurement/write-call-score.ts:174` —
 *     `PROSODY: "PROSODY-SCORE-V1"` in a const map
 * All three are repaired in the same PR — `error` from day 1, clean sweep.
 *
 * Fires on:
 *   1. String literal argument to `ContractRegistry.getContract(...)`.
 *   2. Const Property declarations whose value is a string Literal
 *      matching `^[A-Z][A-Z0-9_-]*[_-](V\d+|SPEC|ID)$` (e.g.
 *      `PROSODY-SCORE-V1`, `SKILL_MEASURE_V1`, `WELCOME_SPEC`,
 *      `INTAKE_ID`).
 *
 * Greenlit (no fire):
 *   - `lib/config.ts` — the identifiers LIVE there (the `optional(env,
 *     default)` defaults).
 *   - `lib/registry/**` — the registry source-of-truth + alias maps.
 *   - `prisma/seed*` and `prisma/migrations/` — seed data + historical
 *     migrations that intentionally reference contract ids at seed time.
 *   - `scripts/generate-registry.ts` — generator over canonical sources.
 *   - Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`) —
 *     fixtures intentionally exercise edge-case identifiers + the
 *     RuleTester string-form examples.
 *   - `docs/` and `docs-archive/` — markdown references to identifiers
 *     in PARAMETER-RENAME-MAP / CHAIN-CONTRACTS / etc.
 *   - `eslint-rules/` — this file's own examples (the rule cannot
 *     self-trigger on its docstring).
 *
 * Severity: `error` from day 1. The 3 incumbent offenders are repaired
 * in the same PR (#2182). Future surfaces either route through
 * `config.specs.*` (extend the accessor if needed) or — in the rare
 * legitimate case of a const-map of related identifiers — add the
 * file path to the allow-list with documented rationale.
 *
 * Sync responsibility: when adding a new contract-id / sentinel-id
 * accessor to `config.specs.*`, NO change needed here — the rule only
 * cares that runtime code reads VIA the accessor. The shape regex
 * catches future identifiers automatically.
 *
 * Pairs with:
 *   - `hf-config/no-hardcoded-spec-slug` (#HF-I) — sibling for slug shape
 *   - `hf-call/no-bare-call-create` (#1333) — same chokepoint pattern
 *   - `hf-goals/no-bare-strategy-key` (#1599) — same chokepoint pattern
 *   - `hf-registry/no-bare-parameter-write` (#2031) — same chokepoint pattern
 *
 * @see lib/config.ts
 * @see .claude/rules/no-bare-spec-identifier.md
 */

// Identifier-shape regex — narrowed to the contract/sentinel-id shape
// (versioned suffix). The story originally specified
// `(V\d+|SPEC|ID)` but `_SPEC` / `_ID` overlap broadly with feature
// flags (`HF_FLAG_*`), log codes (`MODULE_SETTINGS_NO_MODULE_ID`), and
// internal sentinels. The `_V<n>` / `-V<n>` suffix is the high-signal
// shape that matches every real contract / measure-sentinel id today:
// SKILL_MEASURE_V1, PROSODY-SCORE-V1, MOCK-MEASURE-V1, ADAPT-DELTA-V1,
// ENTITY_ACCESS_V1, CURRICULUM_PROGRESS_V1, EXAM_READINESS_V1.
// The `ContractRegistry.getContract(literal)` form (visitor #1 below)
// catches the IDENTIFIER argument shape regardless of suffix — that's
// the structural chokepoint. The shape detector is the defence-in-depth
// catch for const maps of related identifiers.
// Examples that match: SKILL_MEASURE_V1, PROSODY-SCORE-V1, ADAPT-DELTA-V1.
// Examples that DON'T match: INIT-001 (slug shape — guarded by sibling),
// HF_FLAG_SESSION_MODEL_V2 (feature flag — env-var convention), "lo_rollup"
// (lowercase), "SKILL_MEASURE" (no version suffix).
const SPEC_IDENTIFIER_RE = /^[A-Z][A-Z0-9_-]*[_-]V\d+$/;

// Feature-flag prefix exclusion — env-var convention, not a spec id.
// HF_FLAG_*, HF_IELTS_*, NEXT_PUBLIC_* are conventionally process.env
// keys, not DataContract / AnalysisSpec identifiers.
const FEATURE_FLAG_PREFIXES = ["HF_FLAG_", "HF_IELTS_", "NEXT_PUBLIC_"];

// Allow-list path fragments. Any file containing one of these in its path
// will skip the rule entirely.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/config.ts",
  "/lib/registry/",
  "/prisma/seed",
  "/prisma/_archived/",
  "/prisma/migrations/",
  "/prisma/fixtures/",
  "/scripts/generate-registry",
  "/scripts/", // drain / one-off scripts may reference contract ids
  "/eslint-rules/", // the rule's docstring examples live here
  "/docs/",
  "/docs-archive/",
  "/tests/",
  "/__tests__/",
  ".test.",
  ".spec.",
  "/_archived/",
];

function isAllowlistedFile(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  return ALLOWLIST_PATH_FRAGMENTS.some((p) => normalised.includes(p));
}

// Detect `ContractRegistry.getContract(...)` call shape.
function isContractRegistryGetContractCall(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "getContract"
  ) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "Identifier" ||
    inner.name !== "ContractRegistry"
  ) {
    return false;
  }
  return true;
}

const messages = {
  bareContractGet:
    "Bare string literal `{{value}}` passed to `ContractRegistry.getContract(...)`. " +
    "Spec / contract identifiers are env-overridable config — reference " +
    "`config.specs.*` (lib/config.ts) instead, or add a getter there if " +
    "one doesn't exist. A literal silently stops resolving under a " +
    "*_CONTRACT_ID / *_SPEC_ID env override. " +
    "See `.claude/rules/no-bare-spec-identifier.md`.",
  bareIdentifierShape:
    "Bare string literal `{{value}}` has spec-identifier shape " +
    "([A-Z_-]+_(V<n>|SPEC|ID)). These identifiers live in " +
    "`config.specs.*` (lib/config.ts) — reference the getter, or add a " +
    "getter there if one doesn't exist. A literal silently stops resolving " +
    "under env override. " +
    "See `.claude/rules/no-bare-spec-identifier.md`.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block bare spec-identifier string literals; require config.specs.* reads. Covers ContractRegistry.getContract argument shape AND [A-Z_-]+_(V\\d+|SPEC|ID) const-map shape.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-spec-identifier",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowlistedFile(filename)) {
      return {};
    }
    return {
      // (1) ContractRegistry.getContract("LITERAL")
      CallExpression(node) {
        if (!isContractRegistryGetContractCall(node.callee)) return;
        const arg = node.arguments?.[0];
        if (!arg || arg.type !== "Literal") return;
        if (typeof arg.value !== "string") return;
        context.report({
          node: arg,
          messageId: "bareContractGet",
          data: { value: arg.value },
        });
      },
      // (2) Property values matching the shape regex (catches const-map shape:
      //     PROSODY: "PROSODY-SCORE-V1").
      Property(node) {
        if (!node.value || node.value.type !== "Literal") return;
        if (typeof node.value.value !== "string") return;
        const v = node.value.value;
        if (!SPEC_IDENTIFIER_RE.test(v)) return;
        if (FEATURE_FLAG_PREFIXES.some((p) => v.startsWith(p))) return;
        context.report({
          node: node.value,
          messageId: "bareIdentifierShape",
          data: { value: v },
        });
      },
      // (3) Variable initialiser of the shape (catches `const FOO = "SKILL_MEASURE_V1"`).
      VariableDeclarator(node) {
        if (!node.init || node.init.type !== "Literal") return;
        if (typeof node.init.value !== "string") return;
        const v = node.init.value;
        if (!SPEC_IDENTIFIER_RE.test(v)) return;
        if (FEATURE_FLAG_PREFIXES.some((p) => v.startsWith(p))) return;
        context.report({
          node: node.init,
          messageId: "bareIdentifierShape",
          data: { value: v },
        });
      },
    };
  },
};

export default rule;
