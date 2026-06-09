/**
 * #1333 — block bare `prisma.call.create` outside the explicit allow-list.
 *
 * Every Call row entering the pipeline MUST carry `playbookId`,
 * `requestedModuleId`, and `curriculumModuleId` at creation time. Two
 * hand-rolled implementations of the placeholder-create operation
 * (`outbound-dial/route.ts` and `voice/calls/start/route.ts`) drifted —
 * `outbound-dial` silently dropped all three FKs, producing orphan Calls
 * (Bertie Tallstaff `ae3362f0-3e66-4e49-96f1-d83e10bce321` Calls 2 + 3 on
 * hf_sandbox 2026-06-08). Downstream COMPOSE then wrote scopeless
 * `ComposedPrompt` rows and the sim UI couldn't load the next prompt.
 *
 * The builder `lib/voice/create-call-entering-pipeline.ts` is now the
 * canonical entry point. This rule blocks any new bare `prisma.call.create`
 * (or `tx.call.create`) outside the explicit allow-list. Intentional
 * friction — every new site must either route through the builder or
 * justify why it bypasses (and update the allow-list).
 *
 * Allow-list (verbatim, from the issue spec):
 *   lib/voice/create-call-entering-pipeline.ts   — the builder itself
 *   tests/lib/voice/create-call-entering-pipeline.test.ts — unit tests
 *   app/api/callers/[callerId]/calls/route.ts   — sim path, already has full FK chain
 *   lib/test-harness/sim-runner.ts               — harness, null tolerated by design
 *   app/api/test-harness/onboarding-call/route.ts — harness, no enrollment yet
 *   lib/ops/transcripts-process.ts               — offline batch import
 *   app/api/transcripts/import/route.ts          — historical import
 *   scripts/sim-drive-call.ts                    — CLI, has own FK scoping
 *   lib/voice/route-handlers.ts                  — persistEndOfCall (Stage C)
 *   prisma/seed-*.ts                             — seed data
 *   prisma/_archived/seed-*.ts                   — archived seeds
 */

// Substrings checked against the linted file path (after normalising slashes).
// A file matches if ANY substring is a suffix of the path or contained in it.
const ALLOWED_PATH_SUFFIXES = [
  "lib/voice/create-call-entering-pipeline.ts",
  "tests/lib/voice/create-call-entering-pipeline.test.ts",
  "app/api/callers/[callerId]/calls/route.ts",
  "lib/test-harness/sim-runner.ts",
  "app/api/test-harness/onboarding-call/route.ts",
  "lib/ops/transcripts-process.ts",
  "app/api/transcripts/import/route.ts",
  "scripts/sim-drive-call.ts",
  "lib/voice/route-handlers.ts",
];

// Allow-list patterns (matched via simple includes after path normalisation).
const ALLOWED_PATH_CONTAINS = [
  "prisma/seed-",
  "prisma/_archived/seed-",
  // Tests routinely mock or hand-roll Call shapes; the rule's job is to
  // protect production write paths, not assertions. The dedicated
  // `tests/lib/voice/create-call-entering-pipeline.test.ts` exercises
  // the builder directly via the real `prisma.call.create` call.
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  // Scripts (proof-*, sim-drive-call, etc.) — operator tools, not pipeline-entry.
  "/scripts/",
  // Archived code never lints.
  "/_archived/",
];

function isAllowedPath(filename) {
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

// Match `prisma.call.create(...)` or `tx.call.create(...)` or any
// identifier.call.create(...). We only care about the `.call.create` tail.
function isCallCreate(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "create"
  ) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier" ||
    inner.property.name !== "call"
  ) {
    return false;
  }
  return true;
}

const noBareCallCreateRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bare `prisma.call.create` outside the explicit allow-list. Use `createCallEnteringPipeline` from `@/lib/voice/create-call-entering-pipeline` so playbookId / requestedModuleId / curriculumModuleId always populate. See #1333.",
    },
    schema: [],
    messages: {
      bareCallCreate:
        "Bare `prisma.call.create` (or `tx.call.create`) outside the #1333 allow-list. Route through `createCallEnteringPipeline` from `@/lib/voice/create-call-entering-pipeline` so the Call row carries `playbookId` / `requestedModuleId` / `curriculumModuleId` at creation time. If this is a deliberate bypass (harness, seed, batch import), add the path to the allow-list in `eslint-rules/no-bare-call-create.mjs` AND document why in the file header. See CHAIN-CONTRACTS.md §3 Link 3.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowedPath(filename)) return {};
    return {
      CallExpression(node) {
        if (!isCallCreate(node.callee)) return;
        context.report({ node, messageId: "bareCallCreate" });
      },
    };
  },
};

export default noBareCallCreateRule;
