/**
 * #1333 + #1342 — block bare `prisma.call.create` AND `prisma.session.create`
 * outside the explicit allow-lists.
 *
 * Two related guards in one rule (they share the path-allow-list scaffolding):
 *
 *   1. `prisma.call.create` (#1333) — every Call row entering the pipeline
 *      MUST carry `playbookId`, `requestedModuleId`, `curriculumModuleId`
 *      at creation time. Two hand-rolled implementations of the
 *      placeholder-create (`outbound-dial/route.ts` vs `voice/calls/start/route.ts`)
 *      drifted — `outbound-dial` silently dropped all three FKs, producing
 *      Bertie's orphan Calls 2 + 3. The builder `createCallEnteringPipeline`
 *      is now the canonical entry point.
 *
 *   2. `prisma.session.create` (#1342) — every Session row MUST go through
 *      `createSession` so `CallerSequenceCounter` increments atomically,
 *      `voiceConfigSnapshot` populates, and the I-CT2 cascade resolves
 *      `usedPromptId`. Without this rule the cascade can drift the same
 *      way the FK triple did.
 *
 * Intentional friction — every new site must either route through the
 * builder or justify why it bypasses (and update the allow-list).
 *
 * @see lib/voice/create-call-entering-pipeline.ts
 * @see lib/voice/create-session.ts
 */

// Substrings checked against the linted file path (after normalising slashes).
// A file matches if ANY substring is a suffix of the path or contained in it.
const ALLOWED_CALL_PATH_SUFFIXES = [
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

const ALLOWED_SESSION_PATH_SUFFIXES = [
  "lib/voice/create-session.ts",
  "lib/voice/end-session.ts",
  "tests/lib/voice/create-session.test.ts",
  "tests/lib/voice/end-session.test.ts",
  // Slice 1 (#1340 / #1386) recovery writers — record GHOST/FAILED
  // Session rows for transcripts that never arrived. They predate the
  // Slice 3 builder by design (the reconciler in Slice 5 will route
  // through `createSession` + `endSession`); allow-listed here with a
  // documented bypass until that refactor lands.
  "lib/voice/poll-stale-calls.ts",
  "lib/voice/record-call-failure.ts",
];

// Shared path-allow-list patterns (matched via includes after normalisation).
const ALLOWED_PATH_CONTAINS = [
  "prisma/seed-",
  "prisma/_archived/seed-",
  // Tests routinely mock or hand-roll shapes; the rule's job is to
  // protect production write paths, not assertions. The dedicated
  // builder tests exercise the real `prisma.{call,session}.create` call.
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

function isAllowedForCallCreate(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const suffix of ALLOWED_CALL_PATH_SUFFIXES) {
    if (normalised.endsWith(suffix)) return true;
  }
  for (const substr of ALLOWED_PATH_CONTAINS) {
    if (normalised.includes(substr)) return true;
  }
  return false;
}

function isAllowedForSessionCreate(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const suffix of ALLOWED_SESSION_PATH_SUFFIXES) {
    if (normalised.endsWith(suffix)) return true;
  }
  for (const substr of ALLOWED_PATH_CONTAINS) {
    if (normalised.includes(substr)) return true;
  }
  return false;
}

// Match `prisma.<model>.create(...)` or `tx.<model>.create(...)` or any
// identifier.<model>.create(...). We only care about the `.<model>.create` tail.
function isModelCreate(callee, modelName) {
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
    inner.property.name !== modelName
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
        "Disallow bare `prisma.call.create` (#1333) and `prisma.session.create` (#1342) outside the explicit allow-lists. Use `createCallEnteringPipeline` / `createSession` so FK scope + atomic counter + voice snapshot land at creation time.",
    },
    schema: [],
    messages: {
      bareCallCreate:
        "Bare `prisma.call.create` (or `tx.call.create`) outside the #1333 allow-list. Route through `createCallEnteringPipeline` from `@/lib/voice/create-call-entering-pipeline` so the Call row carries `playbookId` / `requestedModuleId` / `curriculumModuleId` at creation time. If this is a deliberate bypass (harness, seed, batch import), add the path to the allow-list in `eslint-rules/no-bare-call-create.mjs` AND document why in the file header. See CHAIN-CONTRACTS.md §3 Link 3.",
      bareSessionCreate:
        "Bare `prisma.session.create` (or `tx.session.create`) outside the #1342 allow-list. Route through `createSession` from `@/lib/voice/create-session` so `CallerSequenceCounter` increments atomically (race-safe), `voiceConfigSnapshot` populates, the I-CT2 `usedPromptId` cascade resolves, and `skipStages` derives correctly. If this is a deliberate bypass (seed, archived migration), add the path to the allow-list AND document why. See CHAIN-CONTRACTS.md §3 Link 3b.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    const callAllowed = isAllowedForCallCreate(filename);
    const sessionAllowed = isAllowedForSessionCreate(filename);
    if (callAllowed && sessionAllowed) return {};
    return {
      CallExpression(node) {
        if (!callAllowed && isModelCreate(node.callee, "call")) {
          context.report({ node, messageId: "bareCallCreate" });
          return;
        }
        if (!sessionAllowed && isModelCreate(node.callee, "session")) {
          context.report({ node, messageId: "bareSessionCreate" });
          return;
        }
      },
    };
  },
};

export default noBareCallCreateRule;
