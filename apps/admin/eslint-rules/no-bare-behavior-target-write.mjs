/**
 * #2031 S2 — block bare `prisma.behaviorTarget.{create,update,upsert,delete,
 * createMany,updateMany,deleteMany}` outside the explicit allow-list.
 *
 * BehaviorTarget rows drive the per-knob cascade
 * (SYSTEM → DOMAIN → PLAYBOOK → CALLER) and feed every composed prompt
 * via the BEH-* effective-value resolvers. A hand-rolled write site
 * misses one or more of:
 *
 *   - parameterId whitelist (BEHAVIOR + isAdjustable from the
 *     Parameter table — an AI-returned string would happily land an
 *     off-taxonomy row)
 *   - numeric clamp to [0, 1] (the rest of the cascade assumes the
 *     invariant — an out-of-range value silently corrupts composed
 *     prompt rendering downstream)
 *   - `BehaviorTargetSource` stamp (forensics — distinguishing
 *     LEARNED / MANUAL / TUNING_CHAT / SEED writes)
 *   - `invalidateKnob(parameterId)` cascade-cache drop (#1454 Slice 2)
 *
 * The 2026-06-19 audit (Track D of epic #2031) found ONE silent
 * back-door at `app/api/calls/[callId]/ops/[opId]/route.ts:880` — the
 * ADAPT op was `prisma.behaviorTarget.updateMany`ing SYSTEM-scope rows
 * with neither clamp nor whitelist nor cache invalidation. PR #2031 S2
 * refactored that path through the canonical helper at
 * `lib/ops/update-system-targets.ts` and adds this rule to prevent
 * the next back-door.
 *
 * This rule pins the producer chokepoint: bare writes from new
 * runtime code fail at edit time, not at runtime. The allow-list
 * enumerates every legitimate writer; new sites either route through
 * a canonical helper (`writeBehaviorTarget` for PLAYBOOK / CALLER,
 * `updateSystemBehaviorTargetForAdapt` for SYSTEM/ADAPT) or join the
 * list with documented rationale.
 *
 * Pairs with sibling write-side chokepoints:
 *   - `no-bare-parameter-write` (#2031 S1 — sibling row in
 *      `Parameter` table)
 *   - `no-bare-call-create` (#1333 / #1342)
 *   - `no-bare-call-score-write` (#1539)
 *   - `no-bare-module-progress-update` (#1703)
 *
 * @see lib/ops/update-system-targets.ts
 * @see lib/agent-tuner/write-target.ts
 */

const ALLOWED_PATH_SUFFIXES = [
  // CANONICAL writers — the helpers + admin routes the rest of the
  // codebase routes through.
  "lib/ops/update-system-targets.ts",
  "lib/agent-tuner/write-target.ts",
  "app/api/playbooks/[playbookId]/new-version/route.ts",
  "app/api/playbooks/[playbookId]/compile-targets/route.ts",
  // IMPLICIT CANONICAL — helpers / projection paths that mutate
  // `tx.behaviorTarget` inside their own transactions. These are
  // structurally invoked by the canonical surfaces above plus the
  // wizard `apply-projection` write path.
  "lib/wizard/apply-projection.ts",
  "lib/ops/update-targets.ts",
  "lib/domain/agent-tuning.ts",
  // DESTRUCTIVE-OK — admin seed / reset routes. These bulk-delete +
  // re-create SYSTEM / PLAYBOOK / CALLER rows when bootstrapping a
  // fresh tenant or running seed-from-specs. Allow-listed because the
  // canonical-helper round-trip would defeat their bulk semantics.
  "app/api/x/seed-system/route.ts",
  "app/api/x/create-domains/route.ts",
  "app/api/x/seed-domains/route.ts",
  "app/api/x/seed-transcripts/route.ts",
];

const ALLOWED_PATH_CONTAINS = [
  // Seed scripts — canonical authoring path. The registry JSON
  // under docs-archive/bdd-specs/ + presets drive these.
  "prisma/seed",
  "prisma/_archived/",
  // One-off migration / fix / backfill scripts — drain-shape, not
  // production-runtime paths.
  "/scripts/",
  // Archived legacy code — read-only, not part of the build (also
  // excluded by eslint.config.mjs `globalIgnores` but kept here for
  // belt-and-braces parity with the sibling rule).
  "_archived/",
  // Test files — fixture set-up.
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

const WRITE_METHODS = new Set([
  "create",
  "update",
  "upsert",
  "delete",
  "createMany",
  "updateMany",
  "deleteMany",
]);

function isBehaviorTargetWrite(callee) {
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
    inner.property.name !== "behaviorTarget"
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
        "Disallow bare `prisma.behaviorTarget.{create,update,upsert,delete,createMany,updateMany,deleteMany}` outside the allow-list (#2031 S2). ADAPT-stage SYSTEM-scope writes route through `updateSystemBehaviorTargetForAdapt` (`lib/ops/update-system-targets.ts`); customer-driven PLAYBOOK / CALLER writes route through `writeBehaviorTarget` (`lib/agent-tuner/write-target.ts`). Both clamp to [0, 1], validate the parameterId whitelist, stamp `BehaviorTargetSource`, and drop the cascade cache. A hand-rolled write skips at least one.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-behavior-target-write",
    },
    schema: [],
    messages: {
      bareBehaviorTargetWrite:
        "Bare `prisma.behaviorTarget.{create,update,upsert,delete,createMany,updateMany,deleteMany}` outside the #2031 S2 allow-list. Route through `updateSystemBehaviorTargetForAdapt` from `@/lib/ops/update-system-targets` (ADAPT / SYSTEM scope) OR `writeBehaviorTarget` / `writeCallerBehaviorTarget` from `@/lib/agent-tuner/write-target` (PLAYBOOK / CALLER scope). Both helpers enforce the parameterId whitelist, [0, 1] clamp, `BehaviorTargetSource` stamp, and `invalidateKnob` cascade-cache drop. If this is a deliberate bypass (admin seed/reset, drain script, archived migration), add the path to the allow-list in `eslint-rules/no-bare-behavior-target-write.mjs` AND document why.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowed(filename)) return {};
    return {
      CallExpression(node) {
        if (isBehaviorTargetWrite(node.callee)) {
          context.report({ node, messageId: "bareBehaviorTargetWrite" });
        }
      },
    };
  },
};

export default rule;
