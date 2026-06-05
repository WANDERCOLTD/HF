/**
 * #1078 — V6 wizard: catch prereq references to undeclared field keys.
 *
 * In `defineCrawcusSpec({ fields: { ... } })` blocks, the `dependsOn`
 * predicate frequently calls `ctx.has('fieldA', 'fieldB')` to express
 * a prereq DAG edge. The runtime tolerates a typo there — the edge
 * silently goes inert because `has('nonexistent')` always returns
 * false, so the dependent field never becomes available and the AI
 * just stops asking. The wizard appears to "skip" a field for no
 * obvious reason.
 *
 * This rule catches that at lint time. Inside a `defineCrawcusSpec({ ... })`
 * literal, for every `has('keyA', 'keyB', ...)` call we encounter, we
 * require every literal string argument to match a key in the spec's
 * `fields:` object. Bare property access — `ctx.value('servings')`,
 * `ctx.consentFor('purpose')` etc. — is not currently checked; those
 * have different failure modes and would over-fire on legitimate
 * dynamic strings.
 *
 * The conceptual name in the issue + ADR is `requires(fieldKey)`. The
 * vendored tallyseal version exposes the same concept as
 * `dependsOn({ when: ctx => ctx.has(...) })`. This rule treats `.has()`
 * as the canonical surface; if tallyseal ships a `requires()` sugar
 * later, extend the check to that too — the underlying invariant
 * (the referenced key must exist) is identical.
 *
 * Severity: error. Catches typos at PR time; no allowlist needed
 * because the rule only fires inside `defineCrawcusSpec` calls.
 */

/** Walk up parents to find the nearest enclosing `defineCrawcusSpec({...})` call. */
function findEnclosingDefineCrawcusSpec(node) {
  let cur = node.parent;
  while (cur) {
    if (
      cur.type === "CallExpression" &&
      cur.callee?.type === "Identifier" &&
      cur.callee.name === "defineCrawcusSpec"
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

/** Extract the keys declared in the spec's `fields:` object. */
function extractDeclaredFieldKeys(specCallNode) {
  const arg = specCallNode.arguments?.[0];
  if (arg?.type !== "ObjectExpression") return null;
  const fieldsProp = arg.properties.find(
    (p) =>
      p.type === "Property" &&
      p.key.type === "Identifier" &&
      p.key.name === "fields",
  );
  if (!fieldsProp) return null;
  if (fieldsProp.value.type !== "ObjectExpression") return null;
  const keys = new Set();
  for (const p of fieldsProp.value.properties) {
    if (p.type !== "Property") continue;
    if (p.key.type === "Identifier") keys.add(p.key.name);
    else if (p.key.type === "Literal" && typeof p.key.value === "string") {
      keys.add(p.key.value);
    }
  }
  return keys;
}

/**
 * Detects `<something>.has(...)` calls. We don't restrict the `<something>`
 * receiver because the predicate signature is `(ctx) => ...` and people
 * destructure (`{ has }`) or rename freely. The match is on the method
 * name; a stray non-context `.has()` (e.g. `Set.prototype.has`) inside
 * a spec literal is rare enough that the false positive cost is low,
 * and the lint message will name the spec key so the author can audit.
 */
function isHasCall(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return false;
  if (callee.property?.type !== "Identifier") return false;
  return callee.property.name === "has";
}

/** Also catch the destructured form: `({ has }) => has('foo')`. */
function isBareHasCall(node) {
  if (node.type !== "CallExpression") return false;
  return (
    node.callee?.type === "Identifier" && node.callee.name === "has"
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `has(...)` references to field keys that are not declared in the enclosing defineCrawcusSpec fields. See #1078.",
    },
    schema: [],
    messages: {
      undeclaredField:
        "`has('{{key}}')` references a field that is not declared in the enclosing defineCrawcusSpec `fields:` block. The dependsOn / readiness predicate will always be false and the field will silently never become available. Did you mean one of: {{available}}?",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isHasCall(node) && !isBareHasCall(node)) return;
        const spec = findEnclosingDefineCrawcusSpec(node);
        if (!spec) return;
        const declared = extractDeclaredFieldKeys(spec);
        if (!declared || declared.size === 0) return;

        for (const arg of node.arguments) {
          if (arg.type !== "Literal" || typeof arg.value !== "string") continue;
          if (declared.has(arg.value)) continue;
          context.report({
            node: arg,
            messageId: "undeclaredField",
            data: {
              key: arg.value,
              available: Array.from(declared).sort().join(", "),
            },
          });
        }
      },
    };
  },
};
