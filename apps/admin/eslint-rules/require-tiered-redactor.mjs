/**
 * Wave C5 (epic #1685) — Tier-sensitive response routes MUST wire the
 * redactor pattern from `lib/rbac/visibility.ts` + `lib/rbac/policies/*`.
 *
 * **Opt-in:** routes opt into the check by adding `@tieredVisibility`
 * to a JSDoc comment in the file (typically the `@api` block at the
 * top of the route). Once tagged, the rule enforces:
 *
 *   1. The file imports `visibilityTierForRole` from `@/lib/rbac/visibility`.
 *   2. The file imports at least one `redact*ForTier` function from
 *      `@/lib/rbac/policies/*`.
 *   3. The handler body calls `visibilityTierForRole(...)` somewhere.
 *   4. The handler body calls a `redact*ForTier(...)` somewhere.
 *
 * The TypeScript types do the rest — the redactor's return shape is
 * structurally distinct from the raw response, so a developer who
 * imports the redactor but skips invoking it gets a type error on the
 * `NextResponse.json(raw)` call.
 *
 * **Why opt-in over implicit:** we can't reliably detect tier-sensitive
 * data from AST alone (a route may return sensitive data without ever
 * importing a "TieredResponse" marker type). Opt-in lets the route
 * author declare the property; the rule keeps them honest from that
 * point forward.
 *
 * **What this prevents:** a developer tags `@tieredVisibility` (or
 * inherits a tag from a file template) but forgets to invoke the
 * redactor — sensitive fields leak to lower-tier viewers. Without this
 * rule, the gap is only caught at PR review.
 *
 * Sibling to:
 *   - `.claude/rules/response-redaction.md` — the pattern doc
 *   - `lib/rbac/visibility.ts` — `visibilityTierForRole`
 *   - `lib/rbac/policies/<resource>.ts` — per-resource redactor
 *   - `tests/eslint-rules/require-tiered-redactor.test.ts` — RuleTester pins
 */

const TAG = "@tieredVisibility";
const VISIBILITY_IMPORT = "@/lib/rbac/visibility";
const POLICY_IMPORT_PREFIX = "@/lib/rbac/policies/";
const REDACTOR_NAME_RE = /^redact[A-Z][A-Za-z0-9]*ForTier$/;

// Skip files that legitimately mention `@tieredVisibility` as data (test
// fixtures, rule source itself, KB docs). Same allow-list convention as
// `no-bare-strategy-key.mjs`.
const ALLOWLIST_PATH_FRAGMENTS = [
  ".test.",
  ".spec.",
  "/__tests__/",
  "/tests/",
  "/eslint-rules/",
  "/docs/",
];

function isAllowlistedFile(filename) {
  if (!filename) return false;
  return ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

function fileHasTag(context) {
  const sourceCode =
    typeof context.getSourceCode === "function"
      ? context.getSourceCode()
      : context.sourceCode;
  if (!sourceCode || typeof sourceCode.getText !== "function") return false;
  const text = sourceCode.getText();
  return typeof text === "string" && text.includes(TAG);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Routes tagged @tieredVisibility must import + invoke visibilityTierForRole and a redact*ForTier function.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-require-tiered-redactor",
    },
    schema: [],
    messages: {
      missingVisibilityImport:
        "@tieredVisibility route must import { visibilityTierForRole } from '@/lib/rbac/visibility'.",
      missingPolicyImport:
        "@tieredVisibility route must import a redactor (e.g. `redactAdaptationsForTier`) from '@/lib/rbac/policies/*'.",
      missingVisibilityCall:
        "@tieredVisibility route must call visibilityTierForRole(...) to derive the tier before redacting.",
      missingRedactorCall:
        "@tieredVisibility route must invoke the imported redact*ForTier(...) before returning. See .claude/rules/response-redaction.md.",
    },
  },
  create(context) {
    // Visitors always returned so smokeRule's probeVisitors sees them
    // (the helper's mock context has no `getText`, so we can't check
    // the tag at create-time). The visitors themselves short-circuit on
    // files that don't carry the tag, keeping the rule dormant on
    // every untagged file.
    let hasVisibilityImport = false;
    let hasPolicyImport = false;
    const importedRedactorNames = new Set();
    let visibilityCalled = false;
    let redactorCalled = false;
    let active = null; // lazy-init in Program — depends on source text

    return {
      Program() {
        const filename = context.filename ?? context.getFilename?.();
        if (isAllowlistedFile(filename)) {
          active = false;
          return;
        }
        active = fileHasTag(context);
      },
      ImportDeclaration(node) {
        if (active === false) return;
        const src = node.source && node.source.value;
        if (typeof src !== "string") return;
        if (src === VISIBILITY_IMPORT) {
          for (const spec of node.specifiers || []) {
            if (
              spec.type === "ImportSpecifier" &&
              spec.imported &&
              spec.imported.name === "visibilityTierForRole"
            ) {
              hasVisibilityImport = true;
            }
          }
        } else if (src.startsWith(POLICY_IMPORT_PREFIX)) {
          for (const spec of node.specifiers || []) {
            if (
              spec.type === "ImportSpecifier" &&
              spec.imported &&
              REDACTOR_NAME_RE.test(spec.imported.name)
            ) {
              hasPolicyImport = true;
              const localName =
                spec.local && spec.local.name
                  ? spec.local.name
                  : spec.imported.name;
              importedRedactorNames.add(localName);
            }
          }
        }
      },
      CallExpression(node) {
        if (active === false) return;
        const callee = node.callee;
        if (!callee) return;
        if (callee.type === "Identifier") {
          if (callee.name === "visibilityTierForRole") {
            visibilityCalled = true;
          } else if (importedRedactorNames.has(callee.name)) {
            redactorCalled = true;
          }
        }
      },
      "Program:exit"(node) {
        if (active !== true) return;
        if (!hasVisibilityImport) {
          context.report({ node, messageId: "missingVisibilityImport" });
        }
        if (!hasPolicyImport) {
          context.report({ node, messageId: "missingPolicyImport" });
        }
        if (hasVisibilityImport && !visibilityCalled) {
          context.report({ node, messageId: "missingVisibilityCall" });
        }
        if (hasPolicyImport && !redactorCalled) {
          context.report({ node, messageId: "missingRedactorCall" });
        }
      },
    };
  },
};
