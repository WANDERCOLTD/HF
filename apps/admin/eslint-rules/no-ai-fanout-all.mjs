/**
 * #854 / Story #855 — Block AI tool executors from passing
 * `fanoutScope: 'all'` to the three config helpers.
 *
 * The asymmetric-default safety property of the pending-changes tray
 * (epic #854) requires that AI-initiated changes can only request a
 * single-caller recompose, never a cohort fan-out. Toggle 2 ("Recompose
 * all N affected learners") must remain a human-only switch.
 *
 * The helpers (`updatePlaybookConfig`, `updateDomainConfig`,
 * `updateAnalysisSpecConfig`) accept `fanoutScope: 'none' | 'caller' | 'all'`.
 * This rule flags `'all'` at call sites inside the AI tool executor files
 * listed below. Other call sites (human-driven API routes, UI components)
 * are allowed to pass `'all'`.
 *
 * Known false-negative: if the options object is pre-assembled into a
 * variable (`const opts = { fanoutScope: 'all' }; updatePlaybookConfig(id, t, opts)`),
 * the AST check returns false. Same limitation as the existing
 * `no-direct-*-config-write.mjs` rules. Document, don't try to solve.
 */

const WATCHED_HELPER_NAMES = new Set([
  "updatePlaybookConfig",
  "updateDomainConfig",
  "updateAnalysisSpecConfig",
]);

/**
 * Inverse allowlist — paths where AI tool calls live. The rule only fires
 * inside these files; everywhere else, `fanoutScope: 'all'` is permitted.
 *
 * If a new AI tool surface lands (e.g. a new chat route, a new palette
 * command bundle), add its path here. The list is the contract.
 */
const AI_TOOL_PATH_FRAGMENTS = [
  "lib/chat/wizard-tool-executor.ts",
  "lib/chat/conversational-wizard-tools.ts",
  "lib/chat/admin-tool-handlers.ts",
  "app/api/chat/route.ts",
];

function isAITool(filename) {
  if (!filename) return false;
  return AI_TOOL_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
}

function isWatchedHelperCall(callee) {
  if (callee?.type !== "Identifier") return false;
  return WATCHED_HELPER_NAMES.has(callee.name);
}

/**
 * Walks the 3rd arg (options object) looking for a literal
 * `fanoutScope: 'all'` property. Returns the offending property node when
 * found, or null otherwise. Non-literal values (variables, expressions)
 * are treated as "unknown" → not flagged (see false-negative caveat).
 */
function findFanoutAllProperty(callNode) {
  const optionsArg = callNode.arguments?.[2];
  if (optionsArg?.type !== "ObjectExpression") return null;
  for (const prop of optionsArg.properties) {
    if (prop.type !== "Property") continue;
    if (prop.key?.type !== "Identifier") continue;
    if (prop.key.name !== "fanoutScope") continue;
    if (prop.value?.type !== "Literal") continue;
    if (prop.value.value === "all") return prop;
  }
  return null;
}

const noAiFanoutAllRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow AI tool executors from passing `fanoutScope: 'all'` to recompose helpers — cohort fan-out is human-only. See epic #854.",
    },
    schema: [],
    messages: {
      aiFanoutAll:
        "AI tool executors must not request cohort fan-out (`fanoutScope: 'all'`). The pending-changes tray's safety property requires Toggle 2 to be a human-only switch. Use `'caller'` (in-context caller only) or `'none'` (timestamp-only). See epic #854.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (!isAITool(filename)) {
      // Rule does not apply outside AI tool executor files.
      return {};
    }
    return {
      CallExpression(node) {
        if (!isWatchedHelperCall(node.callee)) return;
        const offender = findFanoutAllProperty(node);
        if (!offender) return;
        context.report({ node: offender, messageId: "aiFanoutAll" });
      },
    };
  },
};

export default noAiFanoutAllRule;
