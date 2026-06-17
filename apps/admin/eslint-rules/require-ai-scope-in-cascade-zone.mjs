/**
 * #1868 follow-on — block scope-less AI calls inside the cascade-required
 * zone.
 *
 * Pairs with `lib/ai/config-loader.ts::getAIConfig(callPoint, scope?)`
 * and the `.claude/rules/ai-callpoint-cascade.md` contract: every site
 * that has `callId` / `playbookId` / `domainId` in hand MUST pass
 * `scope` to the AI call, otherwise the Playbook/Domain `aiOverrides`
 * cascade is silently bypassed (the failure mode the 2026-06-17
 * incident chain surfaced).
 *
 * Scope of the rule:
 *   - PATH-SCOPED — fires ONLY on files in the "cascade-required zone"
 *     (`app/api/calls/[callId]/pipeline/route.ts`, `app/api/chat/**`,
 *     `lib/voice/route-handlers.ts`, `lib/pipeline/**`). Files outside
 *     the zone are NOT touched — many admin tools, scripts, and content-
 *     trust extractors legitimately have no `callId` and shouldn't be
 *     forced through this rule.
 *   - PATTERN — `getConfiguredMeteredAICompletion(...)` /
 *     `getConfiguredMeteredAICompletionStream(...)` /
 *     `getConfiguredAICompletion(...)` /
 *     `getConfiguredAICompletionStream(...)`. The bare-`getAIConfig`
 *     call is also covered when its arg-list length === 1 (no scope).
 *
 * Escape hatch:
 *   - Add `// @ai-scope-omitted: <one-line reason>` on the line
 *     IMMEDIATELY before the call. The rule requires a non-empty reason
 *     after the colon — empty justifications are rejected.
 *
 * KB: https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-require-ai-scope-in-cascade-zone
 */

const CASCADE_REQUIRED_PATH_FRAGMENTS = [
  "app/api/calls/",
  "app/api/chat/",
  "app/api/voice/",
  "lib/voice/route-handlers.ts",
  "lib/pipeline/",
];

const AI_CALL_NAMES = new Set([
  "getConfiguredMeteredAICompletion",
  "getConfiguredMeteredAICompletionStream",
  "getConfiguredAICompletion",
  "getConfiguredAICompletionStream",
]);

const GET_AI_CONFIG_NAME = "getAIConfig";

const ALLOWED_PATH_CONTAINS = [
  "/tests/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "/scripts/",
  "/_archived/",
];

function isInCascadeRequiredZone(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const allowed of ALLOWED_PATH_CONTAINS) {
    if (normalised.includes(allowed)) return false;
  }
  return CASCADE_REQUIRED_PATH_FRAGMENTS.some((frag) => normalised.includes(frag));
}

function hasScopeOmissionSentinel(sourceCode, node) {
  if (typeof sourceCode?.getAllComments !== "function") return false;
  const comments = sourceCode.getAllComments();
  const nodeStartLine = node.loc?.start?.line;
  if (!nodeStartLine) return false;
  for (const c of comments) {
    if (c.loc?.end?.line === nodeStartLine - 1 || c.loc?.end?.line === nodeStartLine) {
      const text = (c.value || "").trim();
      const m = text.match(/^@ai-scope-omitted:\s*(.+)$/);
      if (m && m[1].trim().length > 0) return true;
    }
  }
  return false;
}

function objectHasScopeKey(arg) {
  if (!arg || arg.type !== "ObjectExpression") return false;
  return arg.properties.some(
    (p) =>
      p.type === "Property" &&
      ((p.key.type === "Identifier" && p.key.name === "scope") ||
        (p.key.type === "Literal" && p.key.value === "scope")),
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `scope: { callId | playbookId | domainId }` on AI completion calls inside the cascade-required zone (#1868).",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-require-ai-scope-in-cascade-zone",
    },
    schema: [],
    messages: {
      missingScope:
        "AI completion call inside the cascade-required zone must pass `scope: { callId | playbookId | domainId }` so Playbook/Domain `aiOverrides[callPoint]` resolve before the global fallback. Add `scope: { callId: call.id }` OR add `// @ai-scope-omitted: <reason>` on the line above. See `.claude/rules/ai-callpoint-cascade.md`.",
      missingScopeOnGetAIConfig:
        "`getAIConfig(callPoint)` inside the cascade-required zone must pass a `scope` argument so Playbook/Domain `aiOverrides[callPoint]` resolve before the global fallback. Add `getAIConfig(callPoint, { callId })` OR add `// @ai-scope-omitted: <reason>` on the line above. See `.claude/rules/ai-callpoint-cascade.md`.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (!isInCascadeRequiredZone(filename)) return {};
    const sourceCode = context.getSourceCode ? context.getSourceCode() : context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        const calleeName = callee.type === "Identifier" ? callee.name : null;
        if (!calleeName) return;

        // getConfiguredMeteredAICompletion / Stream / getConfiguredAICompletion / Stream
        if (AI_CALL_NAMES.has(calleeName)) {
          const firstArg = node.arguments[0];
          if (!firstArg || firstArg.type !== "ObjectExpression") return;
          if (objectHasScopeKey(firstArg)) return;
          if (hasScopeOmissionSentinel(sourceCode, node)) return;
          context.report({ node, messageId: "missingScope" });
          return;
        }

        // getAIConfig(callPoint) — only flag when there's exactly ONE arg
        // (no scope). The 2-arg form is the cascade path.
        if (calleeName === GET_AI_CONFIG_NAME) {
          if (node.arguments.length !== 1) return;
          if (hasScopeOmissionSentinel(sourceCode, node)) return;
          context.report({ node, messageId: "missingScopeOnGetAIConfig" });
        }
      },
    };
  },
};
