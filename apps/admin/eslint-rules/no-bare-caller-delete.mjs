/**
 * Block bare `prisma.caller.delete` / `deleteMany` outside the erasure
 * chokepoint.
 *
 * `lib/gdpr/delete-caller-data.ts::deleteCallerData` is the canonical path
 * for removing a Caller. It backs GDPR Art.17 erasure, the retention cleanup
 * cron, and bulk-delete, and it clears every FK that would otherwise block
 * the delete — including second-order edges into rows it removes itself.
 *
 * Hand-rolled delete chains drift. Epic #1338 added `Session.callerId`
 * with `onDelete: Restrict` and neither the chokepoint nor any of the five
 * seed scripts that duplicate its logic were updated. Erasure threw P2003
 * for 28% of hf_sandbox and 31% of hf_staging callers, and `seed-demo-course`
 * failed outright. Two further blocking edges (`Caller.cohortGroupId` and
 * `BehaviorTarget.callerIdentityId`) were found only once the chain was
 * enumerated rather than reviewed.
 *
 * The paired Coverage gate `tests/lib/gdpr/caller-delete-coverage.test.ts`
 * pins the CHOKEPOINT's completeness. It cannot see a NEW chain written
 * somewhere else — that is this rule's job.
 *
 * @see lib/gdpr/delete-caller-data.ts
 * @see .claude/rules/caller-delete-coverage.md
 */

/** The chokepoint itself, plus its own tests. */
const ALLOWED_PATH_SUFFIXES = [
  "lib/gdpr/delete-caller-data.ts",
];

/**
 * Pre-existing duplicate chains — DEBT, not blessed patterns.
 *
 * Each of these hand-rolls its own FK-safe delete order and every one of them
 * omits `Session` (bar `seed-demo-course.ts`, repaired in the PR that added
 * this rule) — so they all carry the P2003 bug the chokepoint had. Four are
 * live admin API routes, not seeds. They are allow-listed so the rule can land
 * at `error` without a ten-file refactor riding along, NOT because the pattern
 * is acceptable.
 *
 * Consolidating them onto `deleteCallerData` removes every entry below. Do
 * not add to this list — a new seed that needs to delete callers should call
 * the chokepoint.
 */
const ALLOWED_LEGACY_DUPLICATE_CHAINS = [
  // Seed scripts.
  "prisma/seed-demo-course.ts", // repaired 2026-09-23; still duplicates the chain
  "prisma/seed-educator-demo.ts",
  "prisma/seed-cleanup-auto.ts",
  "prisma/seed-holographic-demo.ts",
  "prisma/seed-golden.ts",
  "scripts/seed-synthetic-cohort.ts",
  // Live admin API routes. These are NOT seeds — they delete callers in
  // production and every one of them omits `Session`, so they carry the same
  // P2003 bug the chokepoint had. Tracked for consolidation; listed here only
  // so the rule can land at `error` and block a tenth site appearing.
  "app/api/admin/demo-reset-scoped/route.ts",
  "app/api/callers/merge/route.ts",
  "app/api/x/cleanup-callers/route.ts",
  "app/api/x/seed-transcripts/route.ts",
];

const ALLOWED_PATH_CONTAINS = [
  // Tests mock and hand-roll shapes; the rule protects production paths.
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  // Archived code never lints.
  "/_archived/",
];

function isAllowed(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const suffix of [...ALLOWED_PATH_SUFFIXES, ...ALLOWED_LEGACY_DUPLICATE_CHAINS]) {
    if (normalised.endsWith(suffix)) return true;
  }
  for (const substr of ALLOWED_PATH_CONTAINS) {
    if (normalised.includes(substr)) return true;
  }
  return false;
}

/** Matches `<anything>.caller.delete(...)` and `.caller.deleteMany(...)`. */
function isCallerDelete(callee) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    callee.property?.type !== "Identifier" ||
    (callee.property.name !== "delete" && callee.property.name !== "deleteMany")
  ) {
    return false;
  }
  const inner = callee.object;
  return (
    inner?.type === "MemberExpression" &&
    inner.property?.type === "Identifier" &&
    inner.property.name === "caller"
  );
}

const noBareCallerDeleteRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bare `prisma.caller.delete` / `deleteMany` outside `lib/gdpr/delete-caller-data.ts`. Hand-rolled delete chains drift from the schema and break GDPR erasure.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-caller-delete",
    },
    schema: [],
    messages: {
      bareCallerDelete:
        "Bare `prisma.caller.delete`/`deleteMany` outside the erasure chokepoint. Call `deleteCallerData(callerId, tx?)` from `@/lib/gdpr/delete-caller-data` — it clears every Restrict FK into Caller plus the second-order edges into rows it deletes itself, so erasure does not throw P2003. Hand-rolled chains silently drift when a new model adds a Restrict FK (this is exactly what epic #1338's `Session.callerId` did). If you genuinely must bypass, add the path to `eslint-rules/no-bare-caller-delete.mjs` AND say why in the file header. See .claude/rules/caller-delete-coverage.md and CHAIN-CONTRACTS.md §6a I-PR6.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (isCallerDelete(node.callee)) {
          context.report({ node, messageId: "bareCallerDelete" });
        }
      },
    };
  },
};

export default noBareCallerDeleteRule;
