/**
 * #1539 — block bare `prisma.callScore.create | update | upsert` outside
 * the explicit allow-list. Every `CallScore` row written from the
 * production pipeline MUST carry `analysisSpecId` (the AnalysisSpec
 * whose rubric produced the score). The chokepoint helper
 * `writeCallScore` requires the column in its TypeScript signature AND
 * asserts non-empty at runtime; this rule stops a future edit from
 * smuggling a bare write past the helper.
 *
 * Pairs with `eslint-rules/no-bare-call-create.mjs` (#1333 / #1342).
 *
 * @see lib/measurement/write-call-score.ts
 * @see docs/decisions/2026-06-12-spec-driven-batched-measurement.md
 */

const ALLOWED_PATH_SUFFIXES = [
  // The canonical chokepoint — IS the helper.
  "lib/measurement/write-call-score.ts",
  // The drain script lands writes against historical NULL rows; it
  // attributes by parameter -> active MEASURE spec or marks
  // LEGACY_UNSPECCED_PRE_1539. Explicitly allow-listed.
  "scripts/backfill-call-score-analysis-spec.ts",
  // Demo / scoped reset routes hand-roll write shapes for fixture
  // tear-down. They're not part of the production pipeline; if they
  // start producing learner-visible scores, route them through the
  // helper.
  "app/api/admin/demo-reset-scoped/route.ts",
  "app/api/x/seed-transcripts/route.ts",
  // Manual ops endpoint — operators re-grade individual calls via
  // ops/run-spec; routes through measureAgent + BehaviorMeasurement
  // (not CallScore). The legacy callScore write site here is allow-
  // listed pending the deeper ops-route refactor.
  "app/api/calls/[callId]/ops/[opId]/route.ts",
];

const ALLOWED_PATH_CONTAINS = [
  "prisma/seed-",
  "prisma/_archived/seed-",
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "/scripts/",
  "/_archived/",
  // Personality ops + verifier scripts touch CallScore as part of
  // their analyse-then-write cycle but pre-date the helper. Either
  // refactor them onto the helper OR keep them here when adopting.
  "/lib/ops/",
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

function isCallScoreWrite(callee) {
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
    inner.property.name !== "callScore"
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
        "Disallow bare `prisma.callScore.{create,update,upsert}` outside the allow-list (#1539). Use `writeCallScore` from `@/lib/measurement/write-call-score` so every CallScore row stamps `analysisSpecId`.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-call-score-write",
    },
    schema: [],
    messages: {
      bareCallScoreWrite:
        "Bare `prisma.callScore.{create,update,upsert}` outside the #1539 allow-list. Route through `writeCallScore` from `@/lib/measurement/write-call-score` so the `analysisSpecId` stamp is structural. If this is a deliberate bypass (drain script, archived migration, manual ops), add the path to the allow-list in `eslint-rules/no-bare-call-score-write.mjs` AND document why in the helper's call-site comment.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (isCallScoreWrite(node.callee)) {
          context.report({ node, messageId: "bareCallScoreWrite" });
        }
      },
    };
  },
};

export default rule;
