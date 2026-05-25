/**
 * #826 — Block direct writes to `Playbook.config` outside the central helper.
 *
 * Direct writes bypass the `composeInputsUpdatedAt` timestamp bump that
 * `lib/playbook/update-playbook-config.ts` performs. Without the bump, the
 * staleness check in `lib/compose/staleness.ts::isPromptStale` treats the
 * cached prompt as fresh — the educator's tuning change silently fails to
 * propagate to enrolled callers' next compose. This is the TUNER → COMPOSE
 * chain-contract failure mode (see `docs/CHAIN-CONTRACTS.md` §3 Link 3).
 *
 * The rule flags `prisma.playbook.update({ data: { config: ... } })` and
 * `tx.playbook.update({ data: { config: ... } })` (transaction client).
 * It allows writes to `Playbook.update` that DON'T touch `config` (e.g.
 * `data: { name: ... }` is fine — name isn't a compose input).
 *
 * Allowed files (the helper itself + seed/migration paths where no
 * callers can be enrolled yet, plus the recompose-all escape hatch):
 *
 *   - `lib/playbook/update-playbook-config.ts` — the helper itself
 *   - `prisma/seed.ts`, `prisma/seed-*.ts`, `prisma/migrations/**` — seed/migration paths
 *   - `scripts/**` — one-shot maintenance scripts
 *   - `app/api/playbooks/[playbookId]/recompose-all/route.ts` — manual fan-out escape hatch
 *
 * If you need to do a direct write for a NEW reason, document why in the
 * code comment and add the path to the allowlist below — don't add a
 * blanket `eslint-disable`. The allowlist is the contract.
 */

const ALLOWED_PATH_FRAGMENTS = [
  "lib/playbook/update-playbook-config.ts",
  "/prisma/seed",
  "/prisma/migrations/",
  "/scripts/",
  "/lib/seed/",
  "app/api/playbooks/[playbookId]/recompose-all/route.ts",
];

function isAllowedFile(filename) {
  if (!filename) return false;
  return ALLOWED_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
}

/**
 * Matches `prisma.playbook.update(...)` and `tx.playbook.update(...)`.
 * Returns true if the callee is the `.update` (or `.updateMany`) method
 * on a `.playbook` property of some object — we don't care which object.
 */
function isPlaybookUpdateCall(callee) {
  if (callee?.type !== "MemberExpression") return false;
  const method = callee.property;
  if (method?.type !== "Identifier") return false;
  if (method.name !== "update" && method.name !== "updateMany") return false;
  const obj = callee.object;
  if (obj?.type !== "MemberExpression") return false;
  if (obj.property?.type !== "Identifier" || obj.property.name !== "playbook") {
    return false;
  }
  return true;
}

/**
 * Checks if the first arg to the update call has `data: { config: ... }`.
 * Returns true if so. Walks the AST defensively — non-ObjectExpression
 * args (computed shapes) return false to avoid false-positive blocks.
 */
function callWritesConfig(node) {
  const arg = node.arguments?.[0];
  if (arg?.type !== "ObjectExpression") return false;
  const dataProp = arg.properties.find(
    (p) =>
      p.type === "Property" &&
      p.key.type === "Identifier" &&
      p.key.name === "data",
  );
  if (!dataProp) return false;
  if (dataProp.value.type !== "ObjectExpression") return false;
  const configProp = dataProp.value.properties.find(
    (p) =>
      p.type === "Property" &&
      p.key.type === "Identifier" &&
      p.key.name === "config",
  );
  return Boolean(configProp);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct writes to Playbook.config — use `updatePlaybookConfig` from `lib/playbook/update-playbook-config.ts`. See #826.",
    },
    schema: [],
    messages: {
      directConfigWrite:
        "Direct write to `Playbook.config` bypasses `composeInputsUpdatedAt` bump — downstream staleness check will treat cached prompts as fresh and the change silently fails to propagate. Use `updatePlaybookConfig(playbookId, transformer)` from `@/lib/playbook/update-playbook-config`. See `docs/CHAIN-CONTRACTS.md` §3 Link 3 and #826.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (isAllowedFile(filename)) {
      // Don't even register the visitor — saves a few CPU cycles on
      // the (large) helper file and seed scripts.
      return {};
    }
    return {
      CallExpression(node) {
        if (!isPlaybookUpdateCall(node.callee)) return;
        if (!callWritesConfig(node)) return;
        context.report({ node, messageId: "directConfigWrite" });
      },
    };
  },
};
