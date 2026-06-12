/**
 * Tests for `eslint-rules/no-ai-fanout-all.mjs` (#854 / #878).
 *
 * Pins:
 *   - rule fires inside each of the 4 guarded AI-tool surfaces
 *   - rule survives the wizard-tool-executor monolith → per-tool-file split
 *     (matches both `lib/chat/wizard-tool-executor.ts` AND
 *     `lib/chat/wizard-tool-executor/tools/create_course.ts`)
 *   - rule does NOT fire in unrelated files (human-driven API routes,
 *     UI components) — those are allowed to pass `fanoutScope: 'all'`
 *   - rule fires on all 3 watched helpers (updatePlaybookConfig,
 *     updateDomainConfig, updateAnalysisSpecConfig)
 *   - rule allows the safe scopes (`'caller'`, `'none'`)
 *   - known false-negative caveat: pre-assembled options var is NOT
 *     flagged (documented limitation, mirrored from sibling
 *     no-direct-*-config-write rules)
 */

import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-ai-fanout-all.mjs";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Synthetic paths matching each guarded path fragment.
const WIZARD_MONOLITH = "/repo/lib/chat/wizard-tool-executor.ts";
const WIZARD_PER_TOOL =
  "/repo/lib/chat/wizard-tool-executor/tools/create_course.ts";
const WIZARD_INDEX = "/repo/lib/chat/wizard-tool-executor/index.ts";
const CONVERSATIONAL_TOOLS = "/repo/lib/chat/conversational-wizard-tools.ts";
const ADMIN_HANDLERS_MONOLITH = "/repo/lib/chat/admin-tool-handlers.ts";
const ADMIN_HANDLERS_PER_ENTITY =
  "/repo/lib/chat/admin-tool-handlers/playbook.ts";
const CHAT_ROUTE = "/repo/app/api/chat/route.ts";

// Unrelated paths — rule must NOT fire here.
const HUMAN_API_ROUTE = "/repo/app/api/playbooks/[id]/config/route.ts";
const UI_COMPONENT = "/repo/components/RecomposeButton.tsx";

const callAll = (helper: string) =>
  `${helper}("pb-1", { x: 1 }, { fanoutScope: 'all' });`;
const callCaller = (helper: string) =>
  `${helper}("pb-1", { x: 1 }, { fanoutScope: 'caller' });`;
const callNone = (helper: string) =>
  `${helper}("pb-1", { x: 1 }, { fanoutScope: 'none' });`;

tester.run("no-ai-fanout-all", rule as never, {
  valid: [
    // ────────────────────────────────────────────────────────────────────
    // Allowed scopes inside guarded paths
    // ────────────────────────────────────────────────────────────────────
    { filename: WIZARD_MONOLITH, code: callCaller("updatePlaybookConfig") },
    { filename: WIZARD_MONOLITH, code: callNone("updatePlaybookConfig") },
    { filename: ADMIN_HANDLERS_MONOLITH, code: callCaller("updateDomainConfig") },
    { filename: CHAT_ROUTE, code: callNone("updateAnalysisSpecConfig") },

    // ────────────────────────────────────────────────────────────────────
    // Rule does NOT fire outside guarded paths — humans may fan out
    // ────────────────────────────────────────────────────────────────────
    { filename: HUMAN_API_ROUTE, code: callAll("updatePlaybookConfig") },
    { filename: UI_COMPONENT, code: callAll("updateDomainConfig") },

    // ────────────────────────────────────────────────────────────────────
    // Documented false-negative — pre-assembled options var is NOT flagged.
    // Pinned so future-us doesn't accidentally "fix" it without the AST
    // work the sibling rules also share.
    // ────────────────────────────────────────────────────────────────────
    {
      filename: WIZARD_MONOLITH,
      code: `
        const opts = { fanoutScope: 'all' };
        updatePlaybookConfig("pb-1", { x: 1 }, opts);
      `,
    },

    // Non-watched helper calls — rule ignores them.
    {
      filename: WIZARD_MONOLITH,
      code: "someOtherHelper('pb-1', { x: 1 }, { fanoutScope: 'all' });",
    },
  ],
  invalid: [
    // ────────────────────────────────────────────────────────────────────
    // Guard scope #1 — wizard monolith (pre-refactor shape)
    // ────────────────────────────────────────────────────────────────────
    {
      filename: WIZARD_MONOLITH,
      code: callAll("updatePlaybookConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },
    {
      filename: WIZARD_MONOLITH,
      code: callAll("updateDomainConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },
    {
      filename: WIZARD_MONOLITH,
      code: callAll("updateAnalysisSpecConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #1 — wizard POST-REFACTOR shape (the load-bearing case
    // for this PR). Per-tool file + index file under the directory must
    // BOTH still trip the rule.
    // ────────────────────────────────────────────────────────────────────
    {
      filename: WIZARD_PER_TOOL,
      code: callAll("updatePlaybookConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },
    {
      filename: WIZARD_INDEX,
      code: callAll("updateDomainConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #2 — conversational-wizard-tools (sibling AI surface)
    // ────────────────────────────────────────────────────────────────────
    {
      filename: CONVERSATIONAL_TOOLS,
      code: callAll("updatePlaybookConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #3 — admin-tool-handlers (also queued for refactor;
    // pin both monolith + future per-entity-file shapes)
    // ────────────────────────────────────────────────────────────────────
    {
      filename: ADMIN_HANDLERS_MONOLITH,
      code: callAll("updatePlaybookConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },
    {
      filename: ADMIN_HANDLERS_PER_ENTITY,
      code: callAll("updatePlaybookConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },

    // ────────────────────────────────────────────────────────────────────
    // Guard scope #4 — chat route
    // ────────────────────────────────────────────────────────────────────
    {
      filename: CHAT_ROUTE,
      code: callAll("updateAnalysisSpecConfig"),
      errors: [{ messageId: "aiFanoutAll" }],
    },
  ],
});
