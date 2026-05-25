/**
 * #819 — block direct writes to `Playbook.config` outside the central
 * helper at `lib/playbook/update-playbook-config.ts`.
 *
 * Direct writes are unsafe because they skip the recompose-all fan-out
 * that keeps every active caller's `ComposedPrompt` in sync with the
 * new config (TUNER -> COMPOSE chain-contract, Link 3 sub-contract in
 * `docs/CHAIN-CONTRACTS.md`).
 *
 * The rule flags:
 *   prisma.playbook.update({ data: { config: ..., ... }, ... })
 *   prisma.playbook.upsert({ create: { config: ... }, update: { config: ... } })
 *
 * In ANY file other than the helper itself + seed scripts (which write
 * before any callers exist).
 *
 * Fix: import `updatePlaybookConfig` from `@/lib/playbook/update-playbook-config`
 * and pass a transformer. The helper diffs against `COMPOSE_AFFECTING_KEYS`,
 * writes, and fans out recompose to every ACTIVE roster entry.
 */

// File paths allowed to do direct writes — the helper itself + the
// migration / seed scripts where no callers exist yet.
const ALLOWED_PATH_SUFFIXES = [
  "lib/playbook/update-playbook-config.ts",
  // Seed + migration entry points — config is being established before
  // any caller can enrol.
  "prisma/seed.ts",
  "prisma/seed-clean.ts",
  "prisma/seed-full.ts",
  "prisma/seed-holographic-demo.ts",
  "prisma/seed-demo-fixtures.ts",
  "prisma/seed-ielts-course.ts",
  "lib/seed/find-or-create-seed-playbook.ts",
  // Bulk recompose-all endpoint operates AFTER its own fan-out semantics.
  "app/api/playbooks/[playbookId]/recompose-all/route.ts",
];

function isAllowedFile(filename) {
  if (!filename || filename === "<text>") return true; // ad-hoc evaluation
  return ALLOWED_PATH_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}

function isPrismaPlaybookCall(callee, methodNames) {
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    !methodNames.includes(callee.property.name)
  ) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier" ||
    inner.property.name !== "playbook"
  ) {
    return false;
  }
  return true;
}

function getDataObject(callArgs) {
  if (!callArgs || callArgs.length === 0) return null;
  const arg = callArgs[0];
  if (!arg || arg.type !== "ObjectExpression") return null;
  for (const prop of arg.properties) {
    if (
      prop.type === "Property" &&
      prop.key &&
      prop.key.type === "Identifier" &&
      prop.key.name === "data"
    ) {
      return prop.value && prop.value.type === "ObjectExpression"
        ? prop.value
        : null;
    }
  }
  return null;
}

function getUpdateAndCreateObjects(callArgs) {
  if (!callArgs || callArgs.length === 0) return [];
  const arg = callArgs[0];
  if (!arg || arg.type !== "ObjectExpression") return [];
  const out = [];
  for (const prop of arg.properties) {
    if (
      prop.type === "Property" &&
      prop.key &&
      prop.key.type === "Identifier" &&
      (prop.key.name === "update" || prop.key.name === "create") &&
      prop.value &&
      prop.value.type === "ObjectExpression"
    ) {
      out.push(prop.value);
    }
  }
  return out;
}

function objectHasKey(obj, keyName) {
  if (!obj) return false;
  for (const prop of obj.properties) {
    if (prop.type !== "Property" || !prop.key) continue;
    if (prop.key.type === "Identifier" && prop.key.name === keyName) return true;
    if (prop.key.type === "Literal" && prop.key.value === keyName) return true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct prisma.playbook.update({data:{config:...}}) outside lib/playbook/update-playbook-config.ts. See #819.",
    },
    schema: [],
    messages: {
      directConfigWrite:
        "Direct write to Playbook.config bypasses the recompose-all fan-out (TUNER -> COMPOSE chain-contract). Use `updatePlaybookConfig()` from `@/lib/playbook/update-playbook-config` with a transformer. See docs/CHAIN-CONTRACTS.md Link 3 sub-contract and #819.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (isAllowedFile(filename)) return {};

    return {
      CallExpression(node) {
        // `prisma.playbook.update({ data: { config: ... } })`
        if (isPrismaPlaybookCall(node.callee, ["update", "updateMany"])) {
          const data = getDataObject(node.arguments);
          if (data && objectHasKey(data, "config")) {
            context.report({ node, messageId: "directConfigWrite" });
            return;
          }
        }
        // `prisma.playbook.upsert({ create: { config: ... }, update: { config: ... } })`
        if (isPrismaPlaybookCall(node.callee, ["upsert"])) {
          const blocks = getUpdateAndCreateObjects(node.arguments);
          for (const block of blocks) {
            if (objectHasKey(block, "config")) {
              context.report({ node, messageId: "directConfigWrite" });
              return;
            }
          }
        }
      },
    };
  },
};
