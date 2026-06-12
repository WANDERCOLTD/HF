/**
 * Block hardcoded spec-slug string literals in runtime code.
 *
 * Audit HF-I. Spec slugs (`INIT-001`, `TUT-001`, `GOAL-001`, `PIPELINE-001`, …) are
 * env-overridable config and live in `lib/config.ts` under `config.specs.*`. A literal
 * slug in runtime code silently stops matching the moment the corresponding
 * `*_SPEC_SLUG` env var is overridden — exactly the drift CLAUDE.md's "Configuration
 * over Code" mantra forbids. Live examples found in the audit:
 *   - `lib/goals/extract-goals.ts` wrote `sourceSpecSlug: "GOAL-001"` to the DB with no
 *     config backing (the only slug with none — fixed by adding `config.specs.goal`).
 *   - `lib/prompt/composition/transforms/pedagogy.ts` matched `slug.includes("TUT-001")`,
 *     which breaks under `DEFAULT_ARCHETYPE_SLUG` override.
 *
 * Fires on a string Literal matching `^[A-Z]{2,}(-[A-Z]+)*-\d{3}$` (the spec-slug shape)
 * inside `lib/**` and `app/**` runtime code. The canonical fix is `config.specs.<name>`.
 *
 * Greenlit (no fire):
 *   - `lib/config.ts` itself — the slugs LIVE there (the `optional(env, default)` defaults).
 *   - Tests, scripts, seed (`prisma/**`), and `docs-archive/**` — seed data + fixtures.
 *   - Comments / JSDoc — the parser doesn't visit them.
 *   - `config.specs.*` member expressions — those are identifiers, not literals.
 *
 * Severity: `warn` at landing (mirrors `no-orphan-instruction-fallback`'s staged path) —
 * the two live bugs are fixed in the same PR; the residual low-severity literals are swept
 * before promotion to `error`. Companion: `.claude/rules/pipeline-and-prompt.md`
 * ("Use `config.specs.*` — never hardcode spec slug strings").
 */

// Spec-slug shape: 2+ upper letters, optional extra UPPER segments, then -NNN.
// Matches INIT-001, TUT-001, GOAL-001, PIPELINE-001, CONTENT-EXTRACT-001.
const SLUG_RE = /^[A-Z]{2,}(?:-[A-Z]+)*-\d{3}$/;

// Path fragments where slug literals are legitimate (config defaults + non-runtime
// registries + documented client mirrors).
//
// Note on the "registries" in this list:
//   - lib/demo/registry.ts maps DEMO-* spec slugs → JSON imports. Same pattern as
//     lib/config.ts itself — the slugs LIVE here.
//   - lib/registry/index.ts is the Parameter ID registry. The rule's regex is
//     intentionally shape-only and would catch Parameter IDs (CP-004, B5-A) as well;
//     they are NOT AnalysisSpec slugs. The registry is the source of truth for them.
//   - lib/institution-types/sector-config.ts is an explicit client-side mirror of
//     config.specs.*Archetype (the file header documents this). Server code
//     consumes config.specs.*; the client mirror is necessary because lib/config.ts
//     reads process.env and cannot ship to the browser.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/config.ts",
  "/lib/demo/registry.ts",
  "/lib/registry/index.ts",
  "/lib/institution-types/sector-config.ts",
  "/prisma/",
  "/scripts/",
  "/tests/",
  "/__tests__/",
  ".test.",
  ".spec.",
  "/docs-archive/",
];

// Only guard runtime source trees.
const GUARDED_PATH_FRAGMENTS = ["/lib/", "/app/"];

function isGuardedFile(filename) {
  if (!filename) return false;
  if (ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p))) return false;
  return GUARDED_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

const messages = {
  hardcoded:
    "Hardcoded spec slug `{{slug}}` in runtime code. Spec slugs are env-overridable " +
    "config — reference `config.specs.*` (lib/config.ts) instead, or add a getter there " +
    "if one doesn't exist. A literal silently stops matching under a *_SPEC_SLUG override. " +
    "See `.claude/rules/pipeline-and-prompt.md` + audit HF-I.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block hardcoded spec-slug string literals in lib/ + app/ runtime code; use config.specs.*. See audit HF-I.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-hardcoded-spec-slug",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    const guarded = isGuardedFile(filename);
    return {
      Literal(node) {
        if (!guarded) return;
        if (typeof node.value !== "string") return;
        if (!SLUG_RE.test(node.value)) return;
        context.report({ node, messageId: "hardcoded", data: { slug: node.value } });
      },
    };
  },
};

export default rule;
