/**
 * AnyVoice #1024 — block reintroduction of the `VAPI_TOOL_DEFINITIONS`
 * TypeScript constant.
 *
 * #1019 moved the tool definitions into the `TOOLS-001` AnalysisSpec.
 * Loading happens at runtime via `lib/voice/load-tool-definitions.ts`.
 * The audit counter `vapiToolDefinitionsConstantPresent` (#1016) drives
 * to 0 after the spec migration; this rule keeps it at 0 by failing CI
 * on any future re-introduction of a hardcoded TS const. Closes the
 * I-VP2 invariant in `docs/CHAIN-CONTRACTS.md` Link 3 sub-contract.
 *
 * What this rule flags:
 *   - VariableDeclarator where `id.name === "VAPI_TOOL_DEFINITIONS"`
 *     (covers `const VAPI_TOOL_DEFINITIONS = [...]` AND
 *      `export const VAPI_TOOL_DEFINITIONS = [...]`)
 *
 * Allowed paths:
 *   - `_archived/**` — already globally ignored
 *
 * The TOOLS-001 spec lives in `docs-archive/bdd-specs/`; that's a JSON
 * file, not a TS const, so this rule doesn't catch it.
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the `VAPI_TOOL_DEFINITIONS` TypeScript constant. Load tool definitions from TOOLS-001 spec via `lib/voice/load-tool-definitions.ts`. See #1019.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-vapi-tool-definitions-const",
    },
    schema: [],
    messages: {
      hardcodedConstant:
        "`VAPI_TOOL_DEFINITIONS` is forbidden — tool definitions must be loaded from the TOOLS-001 AnalysisSpec via `loadToolDefinitions()` in `lib/voice/load-tool-definitions.ts` (#1019). Hardcoding the array reintroduces the I-VP2 violation that #1019 closed.",
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && node.id.name === "VAPI_TOOL_DEFINITIONS") {
          context.report({ node: node.id, messageId: "hardcodedConstant" });
        }
      },
    };
  },
};
