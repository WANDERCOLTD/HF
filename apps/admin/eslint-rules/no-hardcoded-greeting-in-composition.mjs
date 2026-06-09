/**
 * #1384 — Block hardcoded learner-facing greetings in prompt-composition
 * transforms and voice assistant-config builders.
 *
 * Live incident 2026-06-09: #1367's "fix" returned literal greeting
 * templates (`Hi ${name}! Let's get into "${module}".`,
 * `Welcome back ${name}!`) from inside `quickstart.ts::first_line()`
 * branches. Those literals intercepted BEFORE the configurable layers
 * (identity-spec opening, phase-derived opening, fallback templates)
 * fired — making the AI's greeting un-customisable from Course Design
 * and from the cascade. Two architectural rules were broken in one
 * 2-line PR:
 *
 *   - CLAUDE.md "Configuration over Code" (greeting style is a
 *     course-tunable behaviour, not a code constant)
 *   - chain-contracts.md Link 3 sub-contract "COMPOSE → LLM" (output
 *     invariants — literal AI utterances must reference a configurable
 *     source OR be explicitly marked as a system-default fallback)
 *
 * This rule fires when a Literal or TemplateLiteral starting with a
 * greeting word (`Hi`, `Hello`, `Hey`, `Welcome`, `Good morning/
 * afternoon/evening`) appears inside a transforms or voice
 * assistant-config file, in a position that will be returned to the AI
 * as a literal utterance (`first_line`, `firstLine`, `firstMessage`,
 * `voicePrompt`, or a direct ReturnStatement).
 *
 * Greenlit:
 *   - String literals inside JSDoc / comments (parser doesn't visit)
 *   - Greeting strings imported from a config / template module
 *     (the regex doesn't fire on identifiers)
 *   - Greeting strings under `lib/prompt/composition/defaults/` —
 *     that path holds the explicit system-default templates; greetings
 *     LIVE there by design
 *
 * Severity: `error`. Promoted in #1385 in the same commit that removed
 * the last offence — the "halt, do not accumulate" intent holds end-to-
 * end. The six known offences (quickstart.ts:549,566 +
 * build-assistant-config.ts:121,177 + route-handlers.ts:1204,1250) were
 * all dropped or rehomed under `lib/prompt/composition/defaults/
 * fallback-first-lines.ts` in the same PR.
 *
 * Companion: `.claude/rules/pipeline-and-prompt.md` documents the
 * "search for existing config before editing prompt-composition
 * transforms" discipline that the rule enforces mechanically.
 */

const GUARDED_PATH_FRAGMENTS = [
  "lib/prompt/composition/transforms/",
  "lib/voice/build-assistant-config.ts",
  "lib/voice/route-handlers.ts",
];

/** Paths where literal greeting strings ARE the contract — system-default
 *  template libraries that the configurable layers read FROM. */
const ALLOWLIST_PATH_FRAGMENTS = [
  "lib/prompt/composition/defaults/",
];

// Greeting word at the start, followed by whitespace / punctuation / end.
// End-of-string matters for template literals: the head before the first
// `${...}` interpolation can be JUST the greeting word (e.g. `Hi${name}!`
// has head `"Hi"`). Pre-fix this missed the locked-module case from #1367.
const GREETING_REGEX =
  /^\s*(hi|hello|hey|welcome|good\s+(morning|afternoon|evening))(\s|[,!.?]|$)/i;

const ASSIGNMENT_TARGETS = new Set([
  "first_line",
  "firstLine",
  "firstMessage",
  "voicePrompt",
  "openingLine",
  "greeting",
]);

function isGuardedFile(filename) {
  if (!filename) return false;
  if (ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p))) return false;
  return GUARDED_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

function isGreetingLiteral(node) {
  if (!node) return false;
  if (node.type === "Literal" && typeof node.value === "string") {
    return GREETING_REGEX.test(node.value);
  }
  if (node.type === "TemplateLiteral" && node.quasis.length > 0) {
    const head = node.quasis[0].value.cooked ?? node.quasis[0].value.raw ?? "";
    return GREETING_REGEX.test(head);
  }
  return false;
}

const messages = {
  hardcoded:
    "Hardcoded learner-facing greeting in a prompt-composition / assistant-config file. " +
    "Greeting style is course-tunable behaviour — read from `playbook.config.welcome.*` or " +
    "`firstCall.*`, or move the template into `lib/prompt/composition/defaults/`. " +
    "See `.claude/rules/pipeline-and-prompt.md` + #1384.",
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block hardcoded learner-facing greetings in prompt-composition transforms and voice assistant-config builders. See #1384.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-hardcoded-greeting-in-composition",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isGuardedFile(filename)) return {};

    function report(node) {
      context.report({ node, messageId: "hardcoded" });
    }

    return {
      ReturnStatement(node) {
        if (node.argument && isGreetingLiteral(node.argument)) {
          report(node.argument);
        }
      },
      VariableDeclarator(node) {
        if (
          node.id?.type === "Identifier" &&
          ASSIGNMENT_TARGETS.has(node.id.name) &&
          node.init &&
          isGreetingLiteral(node.init)
        ) {
          report(node.init);
        }
      },
      AssignmentExpression(node) {
        if (
          node.left?.type === "Identifier" &&
          ASSIGNMENT_TARGETS.has(node.left.name) &&
          isGreetingLiteral(node.right)
        ) {
          report(node.right);
        }
      },
      Property(node) {
        // Catches object literals like `{ firstLine: "Hi ..." }` and
        // `{ first_line: \`Welcome ...\` }` that get passed into adapter
        // builders. Both shorthand-key and named.
        const key = node.key;
        const keyName =
          key?.type === "Identifier"
            ? key.name
            : key?.type === "Literal" && typeof key.value === "string"
              ? key.value
              : null;
        if (!keyName || !ASSIGNMENT_TARGETS.has(keyName)) return;
        if (isGreetingLiteral(node.value)) {
          report(node.value);
        }
      },
    };
  },
};
