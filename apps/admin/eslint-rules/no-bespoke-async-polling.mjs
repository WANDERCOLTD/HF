/**
 * no-bespoke-async-polling — Block bespoke setInterval / setTimeout retry
 * loops outside an allow-list. Closes anti-pattern AP-3 / Loop 3.
 *
 * The 2026-06-09 hardening drill shipped FIVE "wait for X" fixes, each
 * subtly broken in a different way, before the structural cleanup
 * (`feat(hardening): drill readiness probe DB`) replaced them all. The
 * pattern is recognisable:
 *
 *   while (Date.now() < deadline) {
 *     const result = await someCheck();
 *     if (result.ok) return result;
 *     await new Promise(r => setTimeout(r, 2000));
 *   }
 *
 * Bespoke code is brittle because every author re-derives:
 *   - deadline calculation (off-by-one on the first/last interval)
 *   - abort signalling (typically forgotten)
 *   - structured logging on timeout (typically a throw with no label)
 *   - exception vs timeout distinction (typically conflated)
 *
 * The canonical helper at `lib/async/wait-until-ready.ts` handles all four
 * AND emits a labelled `WaitUntilReadyTimeout` error that surfaces in
 * AppLog with the wait label.
 *
 * Severity: `warn`. NOT promoted to `error` in this PR — the migration of
 * the 12 existing call sites is a follow-up story. The current sites are
 * baselined on the count ratchet; this rule fires on NEW additions only
 * (existing sites stay quiet because they were grandfathered via the
 * ALLOWLIST_PATH_FRAGMENTS table below).
 *
 * Anchor: docs/kb/guard-registry.md#guard-no-bespoke-async-polling
 *         docs/decisions/2026-06-11-chase-prevention-methodology.md
 */

// Existing call sites — grandfathered. When migrating one to
// `waitUntilReady`, REMOVE its entry from this list. The rule's success
// metric is this list shrinking to zero. Track in
// guard-registry.md#guard-no-bespoke-async-polling.
const ALLOWLIST_PATH_FRAGMENTS = [
  "lib/rate-limit.ts",
  "lib/demo/useDemoPlayer.ts",
  "lib/pipeline/prosody-runner.ts",
  "lib/content-trust/extract-assertions.ts",
  "lib/content-trust/extract-images.ts",
  "lib/content-trust/save-questions.ts",
  "lib/content-trust/extractors/base-extractor.ts",
  "lib/knowledge/domain-sources.ts",
  "lib/jobs/auto-trigger.ts",
  "lib/domain/instant-curriculum.ts",
  "lib/ai/client.ts",
  "lib/metering/instrumented-ai.ts",
  // The helper itself uses setTimeout as the primitive — that's its job.
  "lib/async/wait-until-ready.ts",
];

// Paths under which the rule does NOT fire even outside the allowlist —
// test code is allowed to use bespoke timing primitives (it often needs
// to exercise edge cases the helper abstracts away).
const TEST_PATH_FRAGMENTS = [
  "/tests/",
  ".test.ts",
  ".test.tsx",
  "/e2e/",
  ".spec.ts",
  "/__tests__/",
];

function isAllowlisted(filename) {
  if (!filename) return true; // unknown source — don't error
  const norm = filename.replace(/\\/g, "/");
  for (const f of ALLOWLIST_PATH_FRAGMENTS) {
    if (norm.endsWith(f)) return true;
  }
  for (const f of TEST_PATH_FRAGMENTS) {
    if (norm.includes(f)) return true;
  }
  return false;
}

/**
 * Detect the polling shape: a `while`/`for`/`do-while` that contains
 * a CallExpression to `setTimeout` OR `setInterval` (or `new Promise(r =>
 * setTimeout(r, …))`) inside its body. We don't try to detect every
 * possible retry loop — we target the specific shape that maps to the
 * helper's contract.
 */
function findPollPrimitiveInside(node, context) {
  let found = null;
  const sourceCode = context.sourceCode ?? context.getSourceCode();

  function visit(child) {
    if (found) return;
    if (!child || typeof child !== "object" || !child.type) return;
    if (child.type === "CallExpression" && child.callee) {
      const name = child.callee.name;
      if (name === "setTimeout" || name === "setInterval") {
        found = child;
        return;
      }
    }
    // Recurse via the source code's visitor keys (eslint's tree shape).
    const keys = sourceCode.visitorKeys?.[child.type] ?? Object.keys(child);
    for (const key of keys) {
      const value = child[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (value && typeof value === "object") {
        visit(value);
      }
    }
  }
  visit(node.body);
  return found;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Block bespoke setInterval/setTimeout retry loops. Use lib/async/wait-until-ready.ts.",
      url: "https://github.com/paw2paw/HF/blob/main/docs/kb/guard-registry.md#guard-no-bespoke-async-polling",
    },
    schema: [],
    messages: {
      bespokePolling:
        "Bespoke async-readiness polling detected ({{primitive}} inside a {{loop}}). " +
        "Use `waitUntilReady` from `lib/async/wait-until-ready.ts` — it handles deadline, " +
        "abort signal, structured timeout error + label. Anchor: docs/kb/guard-registry.md#guard-no-bespoke-async-polling",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAllowlisted(filename)) return {};

    function checkLoop(node, loopName) {
      const hit = findPollPrimitiveInside(node, context);
      if (hit) {
        context.report({
          node: hit,
          messageId: "bespokePolling",
          data: {
            primitive: hit.callee.name,
            loop: loopName,
          },
        });
      }
    }

    return {
      WhileStatement(node) {
        checkLoop(node, "while");
      },
      DoWhileStatement(node) {
        checkLoop(node, "do-while");
      },
      ForStatement(node) {
        checkLoop(node, "for");
      },
    };
  },
};

export default rule;
