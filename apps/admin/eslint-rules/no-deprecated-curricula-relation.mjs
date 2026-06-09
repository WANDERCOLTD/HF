/**
 * #1205 / #1034 — block new reads of the @deprecated `Playbook.curricula`
 * direct relation. The canonical many-to-many is `Playbook.playbookCurricula`
 * (join table with `role: 'primary' | 'linked'`); variant Playbooks linked
 * via the join do NOT appear in the direct `curricula` array, so any reader
 * using the direct relation silently returns null/empty for variants.
 *
 * Two patterns are flagged:
 *
 * 1. Prisma query shape:
 *      prisma.playbook.find* / update* / etc ({
 *        select|include: { curricula: ... }
 *      })
 *    Also matches nested Playbook in larger queries:
 *      prisma.callerPlaybook.findFirst({
 *        include: { playbook: { select: { curricula: ... } } }
 *      })
 *
 * 2. Runtime member access:
 *      anything.playbook.curricula        // e.g. enrollment.playbook.curricula
 *      anything.playbook.curricula[0]
 *      anything.playbook.curricula?.[0]
 *      anything.playbook.curricula.find(...)
 *
 * The check is intentionally tight: `Subject.curricula` and
 * `ContentSource.curricula` are different relations and remain valid.
 *
 * Fix: use `Playbook.playbookCurricula` (canonical join). The primary row is
 *   playbook.playbookCurricula.find(pc => pc.role === 'primary')?.curriculum
 * For variant fan-out use `resolvePlaybookIdForCurriculum(curriculumId)`.
 *
 * See `docs/CONTRACTS-PLAYBOOK-CURRICULUM.md` §4 + §8.2.
 */

const MESSAGE_ID_QUERY = "deprecatedCurriculaInSelect";
const MESSAGE_ID_ACCESS = "deprecatedCurriculaAccess";

/**
 * Walk an ObjectExpression's properties and call `cb` for any property whose
 * key is `select` or `include` and whose value is an ObjectExpression.
 */
function forEachSelectOrInclude(objExpr, cb) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return;
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property" || !prop.key) continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if ((name === "select" || name === "include") && prop.value?.type === "ObjectExpression") {
      cb(prop.value);
    }
  }
}

/**
 * Does this ObjectExpression contain a top-level `curricula:` property?
 */
function hasCurriculaProp(objExpr) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return false;
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property" || !prop.key) continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (name === "curricula") return true;
  }
  return false;
}

/**
 * Find a nested `playbook` property inside select/include, then walk its
 * sub-select/sub-include looking for `curricula:`.
 */
function findCurriculaInPlaybookSubSelect(objExpr, context) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return;
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property" || !prop.key) continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (name !== "playbook" || prop.value?.type !== "ObjectExpression") continue;
    forEachSelectOrInclude(prop.value, (inner) => {
      if (hasCurriculaProp(inner)) {
        context.report({
          node: inner,
          messageId: MESSAGE_ID_QUERY,
        });
      }
      // Recurse one more level (e.g. select: { playbook: { select: { ... } } })
      // — handles deeper nesting via the same walk on each select/include block.
      findCurriculaInPlaybookSubSelect(inner, context);
    });
  }
}

function isPrismaPlaybookCall(callee) {
  // prisma.playbook.findX(...)   OR   tx.playbook.findX(...)
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier"
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

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow reads of the @deprecated Playbook.curricula direct relation; use Playbook.playbookCurricula (canonical join). See #1205.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-deprecated-curricula-relation",
    },
    schema: [],
    messages: {
      [MESSAGE_ID_QUERY]:
        "Reading Playbook.curricula (the @deprecated direct relation, #1034). Variant Playbooks linked via the join table are silently missing from this array. Use `playbookCurricula: { where: { role: 'primary' }, select: { curriculum: { ... } } }` instead. See docs/CONTRACTS-PLAYBOOK-CURRICULUM.md §4.",
      [MESSAGE_ID_ACCESS]:
        "Accessing `.playbook.curricula` (the @deprecated direct relation, #1034). Use `.playbook.playbookCurricula[0]?.curriculum` (or `.find(pc => pc.role === 'primary')?.curriculum`). See docs/CONTRACTS-PLAYBOOK-CURRICULUM.md §8.2.",
    },
  },
  create(context) {
    return {
      // Pattern 1: prisma.playbook.find*({ select|include: { curricula: ... } })
      CallExpression(node) {
        if (!isPrismaPlaybookCall(node.callee)) {
          // Pattern 1b: nested Playbook subselect in any prisma call
          const args = node.arguments;
          if (args && args.length > 0 && args[0]?.type === "ObjectExpression") {
            forEachSelectOrInclude(args[0], (inner) => {
              findCurriculaInPlaybookSubSelect(inner, context);
            });
          }
          return;
        }
        // Direct prisma.playbook.find* — check top-level select/include for curricula
        const args = node.arguments;
        if (!args || args.length === 0) return;
        const arg = args[0];
        if (!arg || arg.type !== "ObjectExpression") return;
        forEachSelectOrInclude(arg, (inner) => {
          if (hasCurriculaProp(inner)) {
            context.report({
              node: inner,
              messageId: MESSAGE_ID_QUERY,
            });
          }
        });
      },

      // Pattern 2: anything.playbook.curricula  (MemberExpression chain)
      MemberExpression(node) {
        // Match the .curricula property at the tail.
        if (
          !node.property ||
          node.property.type !== "Identifier" ||
          node.property.name !== "curricula"
        ) {
          return;
        }
        // The object on which `.curricula` is accessed must itself end in `.playbook`.
        const obj = node.object;
        if (
          !obj ||
          obj.type !== "MemberExpression" ||
          !obj.property ||
          obj.property.type !== "Identifier" ||
          obj.property.name !== "playbook"
        ) {
          return;
        }
        context.report({
          node,
          messageId: MESSAGE_ID_ACCESS,
        });
      },
    };
  },
};
