/**
 * #1703 (epic #1700 Theme 9) — block bare `prisma.callerModuleProgress.update`
 * and `prisma.callerModuleProgress.upsert` outside the explicit allow-list.
 *
 * Force-routes NEW code that wants to mutate `CallerModuleProgress` through
 * the chokepoint helper `markModuleIncomplete` (or the canonical mastery
 * writer in `lib/curriculum/track-progress.ts`).
 *
 * Pre-fix: when `incompleteAttempts` writes drift across multiple sites,
 * the waiver policy splits between them — concurrent endSession webhooks
 * could both observe `incompleteAttempts = 0` and never trigger the waiver.
 * The chokepoint forces atomic-increment semantics in one place.
 *
 * Pattern mirrors `no-bare-call-create.mjs` (#1333) and
 * `no-bare-call-score-write.mjs` (#1539). Error severity from day 1.
 *
 * Allow-list (paths that already write to CallerModuleProgress for
 * non-incomplete reasons — mastery updates, enrollment writes, admin
 * resets, backfill scripts):
 *
 *   - lib/curriculum/track-progress.ts          (canonical mastery writer)
 *   - lib/curriculum/mark-module-incomplete.ts  (this PR's helper)
 *   - app/api/calls/[callId]/pipeline/route.ts  (pipeline progress writes)
 *   - app/api/admin/demo-reset-scoped/route.ts  (admin reset — deleteMany not blocked)
 *   - app/api/admin/demo-reset-content/route.ts (same)
 *   - app/api/callers/[callerId]/reset/route.ts (same)
 *   - scripts/backfill-950-stuck-module-status.ts (one-off backfill)
 *   - scripts/cleanup-placeholder-lo-scores.ts    (cleanup script)
 *
 * .createMany (enrollment-time instantiator) is intentionally NOT blocked
 * — only .update and .upsert.
 *
 * @see lib/curriculum/mark-module-incomplete.ts
 * @see docs/kb/guard-registry.md#guard-no-bare-module-progress-update
 */

const ALLOWED_PATH_SUFFIXES = [
  "lib/curriculum/track-progress.ts",
  "lib/curriculum/mark-module-incomplete.ts",
  "app/api/calls/[callId]/pipeline/route.ts",
  "app/api/admin/demo-reset-scoped/route.ts",
  "app/api/admin/demo-reset-content/route.ts",
  "app/api/callers/[callerId]/reset/route.ts",
  "scripts/backfill-950-stuck-module-status.ts",
  "scripts/cleanup-placeholder-lo-scores.ts",
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

const MUTATING_VERBS = new Set(["update", "upsert"]);

// Match `<expr>.callerModuleProgress.<update|upsert>(...)` — typically
// `prisma.callerModuleProgress.update(...)` or `tx.callerModuleProgress.upsert(...)`.
function isBlockedMutation(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    !MUTATING_VERBS.has(callee.property.name)
  ) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier" ||
    inner.property.name !== "callerModuleProgress"
  ) {
    return false;
  }
  return true;
}

const noBareModuleProgressUpdateRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bare `prisma.callerModuleProgress.update`/`.upsert` outside the explicit allow-list. Route through `markModuleIncomplete` from `@/lib/curriculum/mark-module-incomplete` for incomplete-attempt writes, or `track-progress.ts` for mastery writes.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-module-progress-update",
    },
    schema: [],
    messages: {
      bareModuleProgressUpdate:
        "Bare `prisma.callerModuleProgress.{update,upsert}` outside the #1703 allow-list. Route through `markModuleIncomplete` from `@/lib/curriculum/mark-module-incomplete` for incomplete-attempt writes (atomic increment + waiver policy), or use `track-progress.ts` for mastery writes. If this is a deliberate bypass (admin reset, backfill, etc.), add the path to the allow-list in `eslint-rules/no-bare-module-progress-update.mjs` AND document why.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (isBlockedMutation(node.callee)) {
          context.report({ node, messageId: "bareModuleProgressUpdate" });
        }
      },
    };
  },
};

export default noBareModuleProgressUpdateRule;
