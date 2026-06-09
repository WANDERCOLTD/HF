/**
 * #1006 / #1008 — Block generic-noun fallbacks for missing module/LO names
 * inside prompt-composition transforms.
 *
 * The Maya IELTS hallucination (#1006) traced back to lines like:
 *
 *   `Spaced retrieval - recall question on ${moduleToReview?.name || "previous concept"}`
 *
 * inside `lib/prompt/composition/transforms/pedagogy.ts`. When
 * `moduleToReview` is null, the AI is instructed to ask a recall question
 * about "previous concept" — a phrase with no factual anchor. The model
 * fabricates plausible-sounding history to maintain conversational
 * coherence.
 *
 * This rule fires on template literals in compose-transform files when an
 * expression of the form `something(?.)<prop> (||/??) "literal"` is found,
 * where the property is `name`/`title`/`label`/`description`/`id`/`ref`
 * and the literal is a string. The fix is to drop the line via a
 * conditional spread when the data is missing, not to fill with a generic
 * noun. See chain-contracts.md Link 3 sub-contract "COMPOSE → LLM
 * (output invariants)" I-C4.
 *
 * Severity is `warn` initially so the rule can land before every legacy
 * site is migrated. Promoted to `error` once the audit counter
 * `composeGenericNounFallbackCount` reads 0 in dev/test/prod for ≥7 days.
 *
 * Companion: tests/lib/prompt/composition/compose-invariants.test.ts
 * (runtime pin against the Maya fixture), I-C4 in the chain-contracts
 * sub-contract row.
 */

const COMPOSE_PATH_FRAGMENT = "lib/prompt/composition/transforms/";

const NAMING_PROPERTIES = new Set([
  "name",
  "title",
  "label",
  "description",
  "id",
  "ref",
  "slug",
]);

function isComposeTransform(filename) {
  if (!filename) return false;
  return filename.includes(COMPOSE_PATH_FRAGMENT);
}

/**
 * Returns true when `node` is `something.<prop>` or `something?.<prop>`
 * with prop in NAMING_PROPERTIES.
 */
function isNamingAccess(node) {
  if (!node) return false;
  if (node.type !== "MemberExpression") return false;
  if (node.computed) return false;
  if (node.property?.type !== "Identifier") return false;
  return NAMING_PROPERTIES.has(node.property.name);
}

/**
 * Walks a TemplateLiteral's expressions for the fallback pattern
 *   <namingAccess> (|| | ??) <string literal>
 *
 * Reports each offending LogicalExpression.
 */
function checkTemplateLiteral(node, context) {
  for (const expr of node.expressions ?? []) {
    if (expr.type !== "LogicalExpression") continue;
    if (expr.operator !== "||" && expr.operator !== "??") continue;
    if (!isNamingAccess(expr.left)) continue;
    const right = expr.right;
    if (right?.type !== "Literal") continue;
    if (typeof right.value !== "string") continue;
    if (right.value.length === 0) continue;
    context.report({
      node: expr,
      messageId: "orphanFallback",
      data: { fallback: right.value },
    });
  }
}

const noOrphanInstructionFallbackRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow generic-noun fallbacks for missing module/LO names in prompt-composition transforms — drop the line via a conditional spread instead. See #1006 / #1008 chain-contracts.md I-C4.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-orphan-instruction-fallback",
    },
    schema: [],
    messages: {
      orphanFallback:
        'Generic-noun fallback "{{ fallback }}" inside a compose-transform template literal. When the underlying data is missing, drop the line via a conditional spread (e.g. `...(x ? [`step on ${x.name}`] : [])`) rather than emit a generic noun. Generic nouns invite the AI to fabricate context. See chain-contracts.md Link 3 → COMPOSE→LLM I-C4.',
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (!isComposeTransform(filename)) {
      return {};
    }
    return {
      TemplateLiteral(node) {
        checkTemplateLiteral(node, context);
      },
    };
  },
};

export default noOrphanInstructionFallbackRule;
