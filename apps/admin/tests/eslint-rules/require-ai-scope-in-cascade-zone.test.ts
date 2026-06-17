/**
 * Pins `require-ai-scope-in-cascade-zone` (#1868 follow-on).
 *
 *   - smokeRule: structural pieces present (meta.docs.url to KB,
 *     messages, create returns visitors).
 *   - RuleTester: behavioural — fires on scope-less AI calls inside the
 *     cascade zone; ignores files outside the zone; respects the
 *     `// @ai-scope-omitted: <reason>` sentinel.
 */
import { describe, it } from "vitest";
// @ts-expect-error — eslint exports work but lack rule-tester types in our setup
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/require-ai-scope-in-cascade-zone.mjs";
import { smokeRule } from "./_helpers.js";

describe("require-ai-scope-in-cascade-zone (#1868)", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("require-ai-scope-in-cascade-zone", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("require-ai-scope-in-cascade-zone", rule as never, {
  valid: [
    // ── In zone, scope present ──
    {
      name: "in-zone scope present (callId)",
      filename: "/repo/apps/admin/app/api/calls/[callId]/pipeline/route.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "pipeline.measure", scope: { callId: call.id }, messages: [] });`,
    },
    {
      name: "in-zone scope present (playbookId)",
      filename: "/repo/apps/admin/lib/pipeline/adapt-runner.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "pipeline.adapt", scope: { playbookId: x }, messages: [] });`,
    },
    // ── Sentinel comment escape ──
    {
      name: "in-zone sentinel comment escapes",
      filename: "/repo/apps/admin/lib/pipeline/extract-runner.ts",
      code: `// @ai-scope-omitted: admin tool with no Playbook context\ngetConfiguredMeteredAICompletion({ callPoint: "pipeline.extract", messages: [] });`,
    },
    // ── Out of zone — rule dormant ──
    {
      name: "out-of-zone (lib/chat/admin-tools) — rule dormant",
      filename: "/repo/apps/admin/lib/chat/admin-tools.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "admin.query", messages: [] });`,
    },
    {
      name: "out-of-zone (scripts) — rule dormant",
      filename: "/repo/apps/admin/scripts/sim-drive-call.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "test-harness.system", messages: [] });`,
    },
    // ── Test files are exempt even in zone ──
    {
      name: "in-zone test file is exempt",
      filename: "/repo/apps/admin/tests/api/calls/pipeline.test.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "pipeline.measure", messages: [] });`,
    },
    // ── getAIConfig with 2-arg form (cascade) is OK ──
    {
      name: "in-zone getAIConfig(callPoint, scope) is OK",
      filename: "/repo/apps/admin/lib/pipeline/score-runner.ts",
      code: `getAIConfig("pipeline.score_agent", { callId });`,
    },
  ],
  invalid: [
    {
      name: "in-zone scope-less getConfiguredMeteredAICompletion",
      filename: "/repo/apps/admin/app/api/calls/[callId]/pipeline/route.ts",
      code: `getConfiguredMeteredAICompletion({ callPoint: "pipeline.measure", messages: [] });`,
      errors: [{ messageId: "missingScope" }],
    },
    {
      name: "in-zone scope-less getConfiguredMeteredAICompletionStream",
      filename: "/repo/apps/admin/app/api/chat/route.ts",
      code: `getConfiguredMeteredAICompletionStream({ callPoint: "chat.completion", messages: [] });`,
      errors: [{ messageId: "missingScope" }],
    },
    {
      name: "in-zone bare getAIConfig(callPoint) without scope",
      filename: "/repo/apps/admin/lib/pipeline/adapt-runner.ts",
      code: `getAIConfig("pipeline.adapt");`,
      errors: [{ messageId: "missingScopeOnGetAIConfig" }],
    },
    {
      name: "in-zone sentinel-with-empty-reason is still invalid",
      filename: "/repo/apps/admin/lib/pipeline/score-runner.ts",
      // Sentinel must have a non-empty reason after the colon.
      code: `// @ai-scope-omitted:\ngetConfiguredMeteredAICompletion({ callPoint: "pipeline.measure", messages: [] });`,
      errors: [{ messageId: "missingScope" }],
    },
  ],
});
