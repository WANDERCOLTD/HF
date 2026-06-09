/**
 * #829 — Block direct writes to compose-affecting AnalysisSpec fields
 * outside the central helper.
 *
 * Direct writes bypass the scope-aware timestamp bump
 * (SystemSetting "compose_inputs_updated_at" for SYSTEM-scope specs,
 * Domain.composeInputsUpdatedAt for DOMAIN-scope specs), which means
 * the staleness check at COMPOSE time treats cached prompts as fresh
 * and the change silently fails to propagate to enrolled callers'
 * next call.
 *
 * Flags `prisma.analysisSpec.update({data:{config|promptTemplate|...:...}})`
 * and `tx.analysisSpec.update(...)` (transaction client). Allows writes
 * that don't touch any of the watched fields (e.g. `data: { isDirty: true }`
 * is fine — isDirty is compile-state, not compose-affecting).
 *
 * Watched fields:
 *   - config
 *   - promptTemplate
 *   - isActive
 *   - scope
 *   - specRole
 *   - extendsAgent
 *
 * Allowed paths:
 *   - lib/analysis-spec/update-analysis-spec-config.ts  (the helper itself)
 *   - prisma/seed*.ts, prisma/migrations/, prisma/_archived/, lib/seed/, scripts/
 *   - app/api/analysis-specs/[specId]/recompile/route.ts  (compile metadata)
 *   - app/api/analysis-specs/[specId]/triggers/route.ts   (trigger metadata)
 *   - app/api/domains/[domainId]/extraction-config/route.ts (extraction config — not COMPOSE-affecting at runtime)
 *   - app/api/lab/upload/route.ts                         (pre-enrolment lab upload)
 *   - app/api/lab/features/[id]/activate/route.ts         (lab feature activation)
 *   - app/api/x/create-domains/route.ts                   (domain creation, pre-enrolment)
 *   - app/api/onboarding/personas/[slug]/route.ts         (onboarding persona seed)
 *   - lib/content-trust/sync-instructions-to-spec.ts      (content sync, instrumental)
 *   - lib/jobs/curriculum-enricher.ts                     (background enrichment job)
 */

const WATCHED_FIELDS = [
  "config",
  "promptTemplate",
  "isActive",
  "scope",
  "specRole",
  "extendsAgent",
];

const ALLOWED_PATH_FRAGMENTS = [
  "lib/analysis-spec/update-analysis-spec-config.ts",
  "/prisma/seed",
  "/prisma/migrations/",
  "/prisma/_archived/",
  "/prisma/fix-",
  "/scripts/",
  "/lib/seed/",
  "/api/analysis-specs/[specId]/recompile/",
  "/api/analysis-specs/[specId]/triggers/",
  "/api/domains/[domainId]/extraction-config/",
  "/api/lab/upload/",
  "/api/lab/features/",
  "/api/x/create-domains/",
  "/api/onboarding/personas/",
  "/lib/content-trust/sync-instructions-to-spec.ts",
  "/lib/jobs/curriculum-enricher.ts",
];

function isAllowedFile(filename) {
  if (!filename) return false;
  return ALLOWED_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
}

function isAnalysisSpecUpdateCall(callee) {
  if (callee?.type !== "MemberExpression") return false;
  const method = callee.property;
  if (method?.type !== "Identifier") return false;
  if (method.name !== "update" && method.name !== "updateMany") return false;
  const obj = callee.object;
  if (obj?.type !== "MemberExpression") return false;
  if (
    obj.property?.type !== "Identifier" ||
    obj.property.name !== "analysisSpec"
  ) {
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
        "Disallow direct writes to compose-affecting AnalysisSpec fields outside lib/analysis-spec/update-analysis-spec-config.ts. See #829.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-direct-spec-config-write",
    },
    schema: [],
    messages: {
      directSpecConfigWrite:
        "Direct write to AnalysisSpec compose-affecting fields (config/promptTemplate/isActive/scope/specRole/extendsAgent) bypasses scope-aware timestamp bump — downstream callers won't be marked stale and the change silently fails to propagate. Use `updateAnalysisSpecConfig(specId, transformer, { domainId? })` from `@/lib/analysis-spec/update-analysis-spec-config`. See docs/CHAIN-CONTRACTS.md §3 Link 3 and #829.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (isAllowedFile(filename)) return {};
    return {
      CallExpression(node) {
        if (!isAnalysisSpecUpdateCall(node.callee)) return;
        if (!callWritesWatchedField(node)) return;
        context.report({ node, messageId: "directSpecConfigWrite" });
      },
    };
  },
};
