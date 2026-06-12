/**
 * Block route files under app/api/**\/[callerId]/ that have an HTTP handler
 * but no STUDENT-scope guard.
 *
 * Audit HF-M (2026-06-12). The path-param IDOR class let any STUDENT supply
 * a foreign callerId in the URL and read another learner's PII via routes
 * like /api/callers/[callerId]/snapshot. The 26-handler sweep in 0de21b02
 * applied `studentAllowedToReadCaller(session, callerId)` uniformly; this
 * rule prevents the NEXT [callerId] route from landing without the guard.
 *
 * Fires when ALL of:
 *   1. file path matches `/app/api/...[callerId]...route.ts` (Next.js dynamic segment)
 *   2. the file contains `export (async )?function (GET|POST|PATCH|DELETE|PUT)`
 *   3. the file does NOT call `studentAllowedToReadCaller(` OR
 *      `resolveCallerScopeForReading(` (the two existing #977/HF-M guards)
 *
 * Does not fire when the file is OPERATOR-only at the auth gate — adding the
 * guard there is defence-in-depth no-op (STUDENT can't reach), but the rule
 * is intentionally STRICT: every [callerId] handler MUST mention one of the
 * two helpers. The cost is one `// eslint-disable-next-line` + rationale on
 * OPERATOR-only routes; the benefit is structural impossibility of the next
 * HF-M.
 *
 * See:
 *   - docs/audit/HF-M-evidence-path-param-idor.md — full sweep + follow-on trackers.
 *   - lib/learner-scope.ts — the two helper implementations.
 *   - .claude/rules/ai-to-db-guard.md row 14 — the #977 sibling guard.
 */

const ROUTE_PATH_PATTERN = /\/app\/api\/.+\/\[callerId\][^/]*(?:\/|$)/;

function isCallerIdRoute(filename) {
  if (!filename) return false;
  return ROUTE_PATH_PATTERN.test(filename) && /\/route\.(ts|tsx|js|jsx)$/.test(filename);
}

const HANDLER_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\s*\(/;
const GUARD_RE = /\b(?:studentAllowedToReadCaller|resolveCallerScopeForReading)\s*\(/;

const messages = {
  missingGuard:
    "[callerId] route `{{file}}` has an HTTP handler but does not call " +
    "studentAllowedToReadCaller() or resolveCallerScopeForReading(). " +
    "Without a STUDENT-scope guard, a STUDENT can read any caller's PII by " +
    "supplying a foreign callerId in the URL path (HF-M IDOR class). " +
    "Add `if (!studentAllowedToReadCaller(authResult.session, callerId)) { " +
    "return callerScopeMismatchResponse(); }` after the auth check, OR " +
    "(for OPERATOR-only routes) carry an inline eslint-disable with rationale. " +
    "See docs/audit/HF-M-evidence-path-param-idor.md.",
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block [callerId] route files that have an HTTP handler but no STUDENT-scope guard. See audit HF-M.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-unscoped-caller-id-route",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isCallerIdRoute(filename)) return {};

    return {
      "Program:exit"(node) {
        const sourceCode = context.sourceCode ?? context.getSourceCode?.();
        const text = sourceCode?.getText?.(node) ?? "";
        if (!HANDLER_RE.test(text)) return;
        if (GUARD_RE.test(text)) return;
        // Fire once at file-top so the message anchors at line 1.
        context.report({
          node,
          messageId: "missingGuard",
          data: { file: filename.split("/apps/admin/")[1] ?? filename },
        });
      },
    };
  },
};

export default rule;
