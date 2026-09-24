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
 * The allow-list is the chokepoint and its tests, nothing else. Ten
 * hand-rolled chains (six seed scripts, four live admin routes) were
 * consolidated onto `deleteCallersData` rather than being grandfathered in;
 * keep it that way. A site that genuinely cannot use the chokepoint needs a
 * documented entry here AND a reason in this header.
 *
 * @see lib/gdpr/delete-caller-data.ts
 * @see .claude/rules/caller-delete-coverage.md
 */

/** The chokepoint itself, plus its own tests. */
const ALLOWED_PATH_SUFFIXES = [
  "lib/gdpr/delete-caller-data.ts",
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
  for (const suffix of ALLOWED_PATH_SUFFIXES) {
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
