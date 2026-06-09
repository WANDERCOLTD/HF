/**
 * #828 — Block direct writes to Domain onboarding* / identitySpec fields
 * outside the central helper.
 *
 * Direct writes bypass `Domain.composeInputsUpdatedAt` bump, which means
 * downstream callers in this domain don't get marked stale and the
 * staleness check at COMPOSE time treats their cached prompts as fresh.
 * The change silently fails to propagate to enrolled callers' next call.
 *
 * Flags `prisma.domain.update({data:{onboardingFlowPhases|...:...}})` and
 * `tx.domain.update(...)` (transaction client). Allows writes that don't
 * touch any of the watched fields (e.g. `data: { name: ... }` is fine —
 * name isn't compose-affecting).
 *
 * Watched fields:
 *   - onboardingFlowPhases
 *   - onboardingDefaultTargets
 *   - onboardingWelcome
 *   - onboardingIdentitySpecId
 *
 * Allowed paths:
 *   - lib/domain/update-domain-config.ts  (the helper itself)
 *   - prisma/seed*.ts, prisma/migrations/, lib/seed/, scripts/
 */

const WATCHED_FIELDS = [
  "onboardingFlowPhases",
  "onboardingDefaultTargets",
  "onboardingWelcome",
  "onboardingIdentitySpecId",
];

const ALLOWED_PATH_FRAGMENTS = [
  "lib/domain/update-domain-config.ts",
  "/prisma/seed",
  "/prisma/migrations/",
  "/scripts/",
  "/lib/seed/",
];

function isAllowedFile(filename) {
  if (!filename) return false;
  return ALLOWED_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
}

function isDomainUpdateCall(callee) {
  if (callee?.type !== "MemberExpression") return false;
  const method = callee.property;
  if (method?.type !== "Identifier") return false;
  if (method.name !== "update" && method.name !== "updateMany") return false;
  const obj = callee.object;
  if (obj?.type !== "MemberExpression") return false;
  if (obj.property?.type !== "Identifier" || obj.property.name !== "domain") {
    return false;
  }
  return true;
}

function callWritesWatchedField(node) {
  const arg = node.arguments?.[0];
  if (arg?.type !== "ObjectExpression") return false;
  const dataProp = arg.properties.find(
    (p) =>
      p.type === "Property" &&
      p.key.type === "Identifier" &&
      p.key.name === "data",
  );
  if (!dataProp || dataProp.value.type !== "ObjectExpression") return false;
  for (const p of dataProp.value.properties) {
    if (p.type !== "Property" || p.key.type !== "Identifier") continue;
    if (WATCHED_FIELDS.includes(p.key.name)) return true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct writes to Domain onboarding* / identitySpec fields outside lib/domain/update-domain-config.ts. See #828.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-direct-domain-onboarding-write",
    },
    schema: [],
    messages: {
      directOnboardingWrite:
        "Direct write to Domain.onboarding* / onboardingIdentitySpecId bypasses `composeInputsUpdatedAt` bump — downstream callers in this domain won't be marked stale and the change silently fails to propagate. Use `updateDomainConfig(domainId, transformer)` from `@/lib/domain/update-domain-config`. See docs/CHAIN-CONTRACTS.md §3 Link 3 and #828.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (isAllowedFile(filename)) return {};
    return {
      CallExpression(node) {
        if (!isDomainUpdateCall(node.callee)) return;
        if (!callWritesWatchedField(node)) return;
        context.report({ node, messageId: "directOnboardingWrite" });
      },
    };
  },
};
