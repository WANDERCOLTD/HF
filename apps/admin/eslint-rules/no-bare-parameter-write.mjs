/**
 * #2031 S1 — block bare `prisma.parameter.{create,update,upsert,delete,
 * createMany,updateMany,deleteMany}` outside the explicit allow-list.
 *
 * Every `Parameter` row written from an admin route MUST resolve its
 * `domainGroup` through the canonical helper
 * `lib/registry/canonical-domain-group.ts::resolveCanonicalDomainGroup`
 * (#1948 / #2029 / #2030). Silent off-taxonomy values (e.g. the legacy
 * `"general"` / `"lab"` / `"teaching"` fallbacks) corrupt the registry
 * vitest only at CI time — the offender already landed in live admin DB.
 *
 * This rule pins the producer chokepoint: bare writes from new admin
 * routes fail at edit time, not at runtime. The allow-list enumerates
 * every existing legitimate writer; new write sites either route
 * through the helper or join the list with documented rationale.
 *
 * Pairs with sibling write-side chokepoints:
 *   - `no-bare-call-create` (#1333 / #1342)
 *   - `no-bare-call-score-write` (#1539)
 *   - `no-bare-module-progress-update` (#1703)
 *   - `no-bare-strategy-key` (#1599)
 *
 * @see lib/registry/canonical-domain-group.ts
 * @see docs/decisions/2026-06-19-canonical-domain-group.md (TBD)
 */

const ALLOWED_PATH_SUFFIXES = [
  // Canonical admin CRUD routes — the 7 sites enumerated in epic #2031.
  // These are the legitimate operator-driven write paths. Any of them
  // adding a new domainGroup write MUST use `resolveCanonicalDomainGroup`.
  "app/api/parameters/route.ts",
  "app/api/parameters/[id]/route.ts",
  "app/api/parameters/[id]/enrich/route.ts",
  "app/api/admin/sync-parameters/route.ts",
  "app/api/lab/features/[id]/activate/route.ts",
  "app/api/ops/[opid]/parameters/[id]/route.ts",
  // Sibling ops sweep route — bulk create from ops UI. Same admin
  // surface, same trust boundary.
  "app/api/ops/[opid]/parameters/route.ts",
  "app/api/x/seed-system/route.ts",
  // Sibling admin seed / demo routes — explicit allow-list. These are
  // admin-debug bootstrap surfaces (parallel to demo-reset in the
  // no-bare-call-score-write rule). They write Parameter rows when
  // provisioning a fresh tenant; resolution-through-helper is a
  // follow-on.
  "app/api/x/create-domains/route.ts",
  "app/api/x/seed-domains/route.ts",
  // Wizard projection writer — writes only `config.bandThresholds`
  // (per-skill rubric tuning), never `domainGroup`. Customer-driven
  // path already guarded by `hf-spec/no-customer-write-to-canonical-
  // interpretation` (#1984) for the spec-readonly fields. Allow-listed
  // here so this rule doesn't double-fire.
  "lib/wizard/apply-projection.ts",
];

const ALLOWED_PATH_CONTAINS = [
  // Seed scripts — canonical authoring path. The registry JSON at
  // docs-archive/bdd-specs/behavior-parameters.registry.json is the
  // source of truth; seed-from-specs.ts writes Parameter rows from it.
  "prisma/seed",
  "prisma/_archived/",
  // One-off migration / fix / enrich scripts — drain-shape, not
  // production-runtime paths.
  "/scripts/",
  // The canonical helper itself — when its tests / sibling consumers
  // need to write a Parameter row in a fixture, they route through here.
  "lib/registry/",
  // Test files — fixture set-up.
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "/_archived/",
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

const WRITE_METHODS = new Set([
  "create",
  "update",
  "upsert",
  "delete",
  "createMany",
  "updateMany",
  "deleteMany",
]);

function isParameterWrite(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier"
  ) {
    return false;
  }
  if (!WRITE_METHODS.has(callee.property.name)) {
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

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bare `prisma.parameter.{create,update,upsert,delete,createMany,updateMany,deleteMany}` outside the allow-list (#2031). Route domainGroup-writing paths through `resolveCanonicalDomainGroup` from `@/lib/registry/canonical-domain-group` so off-taxonomy values are refused at write time, not detected at CI time.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-parameter-write",
    },
    schema: [],
    messages: {
      bareParameterWrite:
        "Bare `prisma.parameter.{create,update,upsert,delete,createMany,updateMany,deleteMany}` outside the #2031 allow-list. Route through `resolveCanonicalDomainGroup` from `@/lib/registry/canonical-domain-group` (#2029 / #2030 pattern) so off-taxonomy `domainGroup` writes are refused. If this is a deliberate bypass (drain script, archived migration, admin-debug seed), add the path to the allow-list in `eslint-rules/no-bare-parameter-write.mjs` AND document why.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (isParameterWrite(node.callee)) {
          context.report({ node, messageId: "bareParameterWrite" });
        }
      },
    };
  },
};

export default rule;
