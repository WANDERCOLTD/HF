/**
 * 2026-05-26 — Block AI tool schemas from declaring globally forbidden
 * fields in their input_schema.properties.
 *
 * The pattern: `ADMIN_TOOLS` in `apps/admin/lib/chat/admin-tools.ts` is
 * an array of `{ name, description, input_schema: { ... properties: {
 * <field>: { type: ... } } } }`. Each tool's `properties` keys ARE the
 * whitelist of fields the AI may write. If a sensitive field appears
 * here, the AI can write it — that's how `update_caller` shipped with
 * `role` and an operator's "change Brynn's role to admin" elevated the
 * caller to ADMIN in sandbox.
 *
 * This rule statically scans tool definitions for forbidden fields per
 * entity. The forbidden set is hard-coded here (mirrors
 * `lib/chat/ai-forbidden-fields.ts` — kept in sync by a meta-test that
 * imports the runtime registry).
 *
 * Why both a meta-test AND an ESLint rule:
 *   - ESLint fires at edit time in the IDE → instant feedback, fix
 *     before commit.
 *   - Meta-test catches the dynamic case (e.g. tool definitions
 *     assembled by a function) that AST scanning can't see.
 *
 * Companion: `eslint-rules/no-ai-fanout-all.mjs` (same family — both
 * lock down AI-write attack surface).
 */

/**
 * Mirror of `AI_FORBIDDEN_FIELDS` from
 * `apps/admin/lib/chat/ai-forbidden-fields.ts`. Kept here so the rule
 * is self-contained (ESLint runs before TypeScript imports resolve in
 * some configs). A meta-test asserts the two stay in sync.
 */
const FORBIDDEN_BY_ENTITY = {
  caller: ["role", "domainId", "userId", "deletedAt"],
  playbook: ["domainId", "status", "publishedAt", "deletedAt"],
  domain: ["ownerId", "billingTier", "deletedAt", "createdById"],
  spec: ["isLocked", "scope", "specRole", "deletedAt"],
  curriculum_module: ["slug", "curriculumId", "deletedAt"],
  learning_objective: ["ref", "moduleId", "deletedAt"],
};

function toolNameToEntityKey(toolName) {
  const m = toolName.match(/^(?:update|delete|create|set|add|remove|archive|restore)_(.+)$/);
  if (!m) return null;
  const entity = m[1];
  if (entity === "playbook_config" || entity === "playbook_meta") return "playbook";
  if (entity === "analysis_spec" || entity === "spec_config") return "spec";
  if (entity === "curriculum_metadata") return "curriculum_module";
  return entity;
}

function literalString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

/**
 * Given an ObjectExpression for one tool definition (an element of the
 * ADMIN_TOOLS array), find the (name, properties-object) pair we care
 * about. Returns null if the shape doesn't match.
 */
function extractToolNameAndPropsObject(toolObjectNode) {
  if (!toolObjectNode || toolObjectNode.type !== "ObjectExpression") return null;
  let toolName = null;
  let inputSchema = null;
  for (const prop of toolObjectNode.properties) {
    if (prop.type !== "Property" || prop.key?.type !== "Identifier") continue;
    if (prop.key.name === "name") toolName = literalString(prop.value);
    else if (prop.key.name === "input_schema") inputSchema = prop.value;
  }
  if (!toolName || !inputSchema || inputSchema.type !== "ObjectExpression") return null;

  // input_schema.properties — find the inner object
  let propertiesNode = null;
  for (const prop of inputSchema.properties) {
    if (prop.type !== "Property" || prop.key?.type !== "Identifier") continue;
    if (prop.key.name === "properties") {
      propertiesNode = prop.value;
      break;
    }
  }
  if (!propertiesNode || propertiesNode.type !== "ObjectExpression") return null;
  return { toolName, propertiesNode };
}

const noAiForbiddenFieldsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow AI tool input_schema.properties from declaring globally forbidden fields (role, domainId, ownerId, etc.). Privilege escalation, cross-tenant moves, and per-parent identity slugs are human-only.",
    },
    schema: [],
    messages: {
      forbiddenField:
        "AI tool '{{toolName}}' declares forbidden field '{{field}}' in input_schema.properties (entity: {{entity}}). This field is in AI_FORBIDDEN_FIELDS — privilege escalation, cross-tenant move, or per-parent identity that downstream invariants depend on. Remove it from the tool schema. If you genuinely need it AI-writable, update apps/admin/lib/chat/ai-forbidden-fields.ts + the matching ESLint rule with a comment explaining why — do NOT relax silently. See the 2026-05-26 update_caller→role incident.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    // Only fire on the tool catalogue file itself.
    if (!filename.includes("lib/chat/admin-tools.ts")) return {};

    return {
      // Match every ObjectExpression that looks like a tool definition.
      // The catalogue is a single export const ADMIN_TOOLS = [ { ... }, ... ]
      // so every direct child of that array is a candidate.
      ObjectExpression(node) {
        const extracted = extractToolNameAndPropsObject(node);
        if (!extracted) return;
        const { toolName, propertiesNode } = extracted;
        const entityKey = toolNameToEntityKey(toolName);
        if (!entityKey) return;
        const forbidden = FORBIDDEN_BY_ENTITY[entityKey];
        if (!forbidden) return;

        for (const prop of propertiesNode.properties) {
          if (prop.type !== "Property" || prop.key?.type !== "Identifier") continue;
          if (forbidden.includes(prop.key.name)) {
            context.report({
              node: prop.key,
              messageId: "forbiddenField",
              data: { toolName, field: prop.key.name, entity: entityKey },
            });
          }
        }
      },
    };
  },
};

export default noAiForbiddenFieldsRule;
