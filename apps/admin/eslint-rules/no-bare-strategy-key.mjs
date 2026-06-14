/**
 * Block bare string literals assigned to `progressStrategy` in runtime
 * code and seed scripts — #1599.
 *
 * History: pre-#1554 `scripts/fix-cio-cto-playbooks.ts:234` wrote
 * `progressStrategy: "LO_MASTERY"` (uppercase) into every per-LO LEARN
 * goal on the CIO/CTO Standard playbooks. The registered strategy key
 * is `lo_rollup`. The lookup silently fell through to `manual_only` —
 * every LEARN goal sat at 0% forever, only caught when live hf_sandbox
 * data showed the freeze. #1554 patched the live damage by adding
 * `lo_mastery → lo_rollup` to `STRATEGY_ALIASES`; #1599 ships THIS
 * rule + the `StrategyKey` const enum so a future surface can't
 * reintroduce a casing variant or a typo and silently freeze a cohort.
 *
 * Fires on any object literal Property whose key is `progressStrategy`
 * and whose value is a string Literal NOT in the canonical key set.
 * Non-string values (Identifier, MemberExpression, TemplateLiteral
 * without expressions, …) pass — those go through the type system.
 *
 * Greenlit (no fire):
 *   - `lib/goals/strategies/registry.ts` — the canonical alias map
 *     (`STRATEGY_ALIASES`) intentionally carries historical keys like
 *     `lo_mastery` as map keys.
 *   - Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`)
 *     — fixtures intentionally exercise edge-case casings + invalid
 *     keys to pin resolver behaviour.
 *
 * Severity: `error` from day 1. The only pre-existing offence
 * (`scripts/fix-cio-cto-playbooks.ts:234`) is repaired in the same PR.
 * Companion: `lib/goals/strategies/types.ts::StrategyKey`,
 * `.claude/rules/ai-to-db-guard.md` row "mastery-write canonical contract".
 *
 * Sync responsibility: when adding a new strategy to
 * `lib/goals/strategies/types.ts::StrategyKey`, ALSO update
 * `VALID_STRATEGY_KEYS` below in the same PR. The rule cannot import
 * the TS module at lint time.
 */

// Hardcoded mirror of `lib/goals/strategies/types.ts::StrategyKey`.
// MUST stay in sync — see header.
const VALID_STRATEGY_KEYS = new Set([
  "skill_ema",
  "lo_rollup",
  "assessment_readiness",
  "connect_warmth_avg",
  "manual_only",
]);

// Allow-list: legitimate sites for non-enum literals.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/goals/strategies/registry.ts",
  ".test.",
  ".spec.",
  "/__tests__/",
  "/tests/",
];

function isAllowlistedFile(filename) {
  if (!filename) return false;
  return ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

const messages = {
  bareLiteral:
    "Bare string literal `{{value}}` assigned to `progressStrategy`. " +
    "Use `StrategyKey.<member>` from `lib/goals/strategies/types.ts` " +
    "(e.g. `StrategyKey.lo_rollup`). " +
    "Bare literals can silently fall through to `manual_only` when " +
    "they don't match a registered key (the #1554 freeze fingerprint). " +
    "See `.claude/rules/ai-to-db-guard.md` mastery-write contract row.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block bare string literals assigned to `progressStrategy`; require `StrategyKey.<member>` from lib/goals/strategies/types.ts.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bare-strategy-key",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowlistedFile(filename)) {
      return {};
    }
    return {
      Property(node) {
        // Key is identifier-form (`progressStrategy: "..."`) or string-form
        // (`"progressStrategy": "..."`); accept both.
        const keyName =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? node.key.value
              : null;
        if (keyName !== "progressStrategy") return;
        if (!node.value || node.value.type !== "Literal") return;
        if (typeof node.value.value !== "string") return;
        if (VALID_STRATEGY_KEYS.has(node.value.value)) return;
        context.report({
          node: node.value,
          messageId: "bareLiteral",
          data: { value: node.value.value },
        });
      },
    };
  },
};

export default rule;
