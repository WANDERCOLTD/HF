/**
 * Epic #1984 S1 — block customer-driven writes to spec-readonly
 * `Parameter` fields (`definition`, `interpretationHigh`,
 * `interpretationLow`).
 *
 * S4 of #1946 (PR #1979) landed the declarative boundary
 * (`lib/cascade/spec-readonly-fields.ts::PARAMETER_SPEC_READONLY_FIELDS`)
 * and the discipline doc (`.claude/rules/spec-readonly-boundary.md`)
 * but explicitly deferred the **structural enforcement** to this
 * epic.
 *
 * ## What the rule checks
 *
 * Fires when an object-literal expression appearing as the `data`
 * value of a `prisma.parameter.{create,update,upsert}` call contains
 * any property whose key matches one of the spec-readonly fields.
 *
 * Allow-list: canonical seed paths and the registry generator. Tests
 * also pass.
 *
 * ## Why this matters
 *
 * Pre-S4 the composed prompt emitted `interpretationHigh` /
 * `interpretationLow` for only the top-5 behaviour targets (slice cap
 * at `lib/prompt/composition/transforms/instructions.ts:234`). S4's
 * `behavior_targets_semantics` directive carries the FULL list —
 * every parameter's interpretation is now visible to the LLM.
 *
 * That makes the interpretation text a **runtime IP boundary**. A
 * customer write of `interpretationHigh = "make the AI act crazy"`
 * on `BEH-WARMTH` would corrupt every other customer's composed
 * prompt on next recompose.
 *
 * ## Spec-readonly fields
 *
 * Mirrored from `lib/cascade/spec-readonly-fields.ts` and pinned by
 * `tests/lib/cascade/spec-readonly-fields-coverage.test.ts`. ANY
 * change to the canonical constant requires the same change here in
 * the same PR (the coverage test fails otherwise).
 *
 * @see lib/cascade/spec-readonly-fields.ts
 * @see .claude/rules/spec-readonly-boundary.md
 * @see docs/PARAMETER-TAXONOMY.md
 */

const SPEC_READONLY_FIELDS = new Set([
  "definition",
  "interpretationHigh",
  "interpretationLow",
  // #2174 S5 — defensive extension. Grading-rubric fields classified
  // HF-canonical by the #2174 epic audit (docs/SCORING-EDITABILITY.md).
  // Mirror of PARAMETER_SPEC_READONLY_FIELDS in
  // lib/cascade/spec-readonly-fields.ts. The coverage gate at
  // tests/lib/cascade/spec-readonly-fields-coverage.test.ts pins this
  // mirror against the canonical constant.
  "tiers",
  "tierScheme",
  "defaultTarget",
  "config",
]);

const ALLOWED_PATH_SUFFIXES = [
  // SUPERADMIN-gated operator UI mutation route. Per
  // .claude/rules/spec-readonly-boundary.md the discipline says spec
  // edits go through the canonical registry JSON + seed, not through
  // runtime mutation — but SUPERADMIN is HF-internal so the route
  // serves emergency-fix scenarios. Tracked as tech debt to migrate
  // off this surface entirely; allow-listed today.
  "app/api/parameters/[id]/route.ts",
  // ADMIN-gated sync route that imports parameter definitions from the
  // existing AnalysisSpec corpus. The `definition`/`interpretation*`
  // values come from `spec.parameters[]` blocks authored by HF in
  // spec.json files — i.e. a canonical HF authoring path that has
  // shifted into a route. Allow-listed.
  "app/api/admin/sync-parameters/route.ts",
  // Wizard projection — HF-canonical author for per-course Parameter
  // rows mined from course-ref content. The `config.bandThresholds`
  // and merge-config writes here originate from RUB sections the
  // operator authored in the course-ref doc the wizard parses; the
  // wizard executes HF code that classifies + persists them under
  // canonical id schemes. Per #2174 audit (docs/SCORING-EDITABILITY.md)
  // `Parameter.config` is DECISION-NEEDED (open shape, HF-only until
  // specific subfields are classified TUNABLE). Until that refinement
  // lands, the file-level allow-list acknowledges that wizard projection
  // is the blessed customer-driven authoring path for Parameter rows —
  // the boundary still blocks all OTHER customer writers. Tracked as
  // follow-on tech debt to refine the rule to allow specific config
  // sub-keys (e.g. bandThresholds) rather than the whole field.
  "lib/wizard/apply-projection.ts",
];

const ALLOWED_PATH_CONTAINS = [
  // Seeds (every variant) — canonical write path from the registry.
  "/prisma/seed",
  "/prisma/_archived/seed",
  // Historical migrations may have backfilled spec fields.
  "/prisma/migrations/",
  // HF-authored data scripts — one-off enrichment, backfill, fix
  // scripts. These run only when an HF engineer invokes them, never
  // customer-driven.
  "/scripts/",
  // HF admin tooling under /api/x/ — the canonical HF admin namespace
  // per CLAUDE.md (system setup, seed-domains, seed-system,
  // create-domains).
  "/app/api/x/",
  // HF-curated feature activation — `feature.metadata.rationale` is
  // authored by HF feature-set authors, not customer input.
  "/app/api/lab/features/",
  // Tests + fixtures.
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
];

function isAllowed(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const suffix of ALLOWED_PATH_SUFFIXES) {
    if (normalised.endsWith(suffix)) return true;
  }
  for (const substr of ALLOWED_PATH_CONTAINS) {
    if (normalised.includes(substr)) return true;
  }
  return false;
}

function isParameterWriteCallee(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier"
  ) {
    return false;
  }
  if (!["create", "update", "upsert"].includes(callee.property.name)) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier" ||
    inner.property.name !== "parameter"
  ) {
    return false;
  }
  return true;
}

function findDataProperty(objectExpression) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") {
    return null;
  }
  for (const prop of objectExpression.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const key = prop.key;
    let name = null;
    if (key.type === "Identifier") name = key.name;
    else if (key.type === "Literal" && typeof key.value === "string") name = key.value;
    if (name === "data") return prop.value;
  }
  return null;
}

function findUpsertCreateUpdate(objectExpression) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") {
    return [];
  }
  const out = [];
  for (const prop of objectExpression.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const key = prop.key;
    let name = null;
    if (key.type === "Identifier") name = key.name;
    else if (key.type === "Literal" && typeof key.value === "string") name = key.value;
    if (name === "create" || name === "update") {
      if (prop.value && prop.value.type === "ObjectExpression") {
        out.push(prop.value);
      }
    }
  }
  return out;
}

function reportSpecReadonlyPropsIn(context, objectExpression, methodName) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") return;
  for (const prop of objectExpression.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const key = prop.key;
    let name = null;
    if (key.type === "Identifier") name = key.name;
    else if (key.type === "Literal" && typeof key.value === "string") name = key.value;
    if (name && SPEC_READONLY_FIELDS.has(name)) {
      context.report({
        node: prop,
        messageId: "customerWriteToSpecField",
        data: { field: name, method: methodName },
      });
    }
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow writing spec-readonly Parameter fields (definition / interpretationHigh / interpretationLow / tiers / tierScheme / defaultTarget / config) from customer-driven code paths. Spec fields are HF-canonical IP — only seeds, the registry generator, and migrations may write them.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-customer-write-to-canonical-interpretation",
    },
    schema: [],
    messages: {
      customerWriteToSpecField:
        "Customer-driven write to spec-readonly Parameter.{{field}} via prisma.parameter.{{method}}. Spec fields (definition / interpretationHigh / interpretationLow / tiers / tierScheme / defaultTarget / config) are HF-canonical IP and must not flow from wizard / admin UI / sync routes — definition / interpretation* appear verbatim in the composed prompt's behavior_targets_semantics block (#1951 S4); tiers / tierScheme / defaultTarget / config carry the grading rubric the LLM judges against (#2174 epic). If this is a canonical authoring path (seed / generator / migration), add it to the allow-list in eslint-rules/no-customer-write-to-canonical-interpretation.mjs. Otherwise drop the field from the payload; the canonical seed assigns it. Customer tuning happens via the sibling BehaviorTarget.targetValue cascade.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (!isParameterWriteCallee(node.callee)) return;
        const args = node.arguments;
        if (!args || args.length === 0) return;
        const arg = args[0];
        if (!arg || arg.type !== "ObjectExpression") return;
        const methodName = node.callee.property.name;
        // create / update — single `data: {...}` block. upsert splits into
        // `create: {...}` + `update: {...}` and may also have `data`.
        const dataObj = findDataProperty(arg);
        if (dataObj) {
          reportSpecReadonlyPropsIn(context, dataObj, methodName);
        }
        if (methodName === "upsert") {
          for (const branch of findUpsertCreateUpdate(arg)) {
            reportSpecReadonlyPropsIn(context, branch, methodName);
          }
        }
      },
    };
  },
};

export default rule;
