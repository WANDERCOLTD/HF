/**
 * #407 / #411 — block unscoped slug lookups on per-parent-unique entities.
 *
 * Slugs like `CurriculumModule.slug` ("part1", "MOD-1") and refs like
 * `LearningObjective.ref` ("OUT-01") are unique within their parent
 * (curriculum / module), NOT globally. Unscoped `findFirst({where:{slug}})`
 * picks non-deterministically across the table and corrupts FKs — the
 * Opal / Freya / Tessa incident.
 *
 * This rule flags:
 *   prisma.curriculumModule.find*({ where: { slug, ... } })
 *     when `where` does NOT also include `curriculumId` or `curriculum`.
 *   prisma.learningObjective.find*({ where: { ref, ... } })
 *     when `where` does NOT also include `moduleId` or `module`.
 *
 * Fix: use `resolveModuleByLogicalId(curriculumId, slug)` from
 * `lib/curriculum/resolve-module.ts`, or include the scope key in `where`.
 */

const ENTITY_RULES = [
  {
    model: "curriculumModule",
    requiredScopeKeys: ["curriculumId", "curriculum"],
    matchKey: "slug",
    messageId: "unscopedCurriculumModule",
  },
  {
    model: "learningObjective",
    requiredScopeKeys: ["moduleId", "module"],
    matchKey: "ref",
    messageId: "unscopedLearningObjective",
  },
];

function getPrismaModel(callee) {
  // Match `prisma.<model>.find*(...)` and `tx.<model>.find*(...)`
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    !callee.property.name.startsWith("find")
  ) {
    return null;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier"
  ) {
    return null;
  }
  return inner.property.name;
}

function findWhereObject(callExprArgs) {
  if (!callExprArgs || callExprArgs.length === 0) return null;
  const arg = callExprArgs[0];
  if (!arg || arg.type !== "ObjectExpression") return null;
  for (const prop of arg.properties) {
    if (
      prop.type === "Property" &&
      prop.key &&
      ((prop.key.type === "Identifier" && prop.key.name === "where") ||
        (prop.key.type === "Literal" && prop.key.value === "where"))
    ) {
      return prop.value && prop.value.type === "ObjectExpression"
        ? prop.value
        : null;
    }
  }
  return null;
}

function whereHasKey(whereObj, keyNames) {
  if (!whereObj) return false;
  for (const prop of whereObj.properties) {
    if (prop.type !== "Property" || !prop.key) continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (name && keyNames.includes(name)) return true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow unscoped slug/ref lookups on per-parent-unique entities (CurriculumModule, LearningObjective). See #407.",
    },
    schema: [],
    messages: {
      unscopedCurriculumModule:
        "Unscoped CurriculumModule slug lookup. Use resolveModuleByLogicalId() from @/lib/curriculum/resolve-module, or include `curriculumId` (or a `curriculum:` relation filter) in the `where` clause. See #407.",
      unscopedLearningObjective:
        "Unscoped LearningObjective ref lookup. Include `moduleId` (or a `module:` relation filter) in the `where` clause. LO refs are per-module-unique, not global. See #407.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const model = getPrismaModel(node.callee);
        if (!model) return;
        const rule = ENTITY_RULES.find((r) => r.model === model);
        if (!rule) return;
        const whereObj = findWhereObject(node.arguments);
        if (!whereObj) return;
        const matchesKey = whereHasKey(whereObj, [rule.matchKey]);
        if (!matchesKey) return;
        const hasScope = whereHasKey(whereObj, rule.requiredScopeKeys);
        if (hasScope) return;
        context.report({ node, messageId: rule.messageId });
      },
    };
  },
};
