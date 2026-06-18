/**
 * #1926 (epic #1915 child) — block literal PII-keyed objects from
 * being passed as `metadata` to `AppLog` write paths.
 *
 * Two complementary checks:
 *
 *   1. `prisma.appLog.create({ data: { metadata: { email: ... } } })` —
 *      direct bare write with a literal PII-keyed object.
 *
 *   2. `log(subject, { metadata: { email: ... } })` /
 *      `logAI(stage, prompt, response, { ...PII keys, ... })` —
 *      caller-side leak into the chokepoint helper at `lib/logger.ts`.
 *
 * Forbidden literal keys (canonical PII set per the 2026-06-18 audit):
 *   - `email`
 *   - `phone`
 *   - `transcript`
 *   - `name`            (caller / user identifier)
 *   - `value`           (CallerMemory value)
 *   - `promptPreview`   (can include caller-quoted PII)
 *   - `responsePreview` (can include caller-quoted PII)
 *
 * Allow-list (compile-time):
 *   - `lib/logger.ts`        — canonical writer; receives arbitrary data
 *                              from callers but doesn't author literal keys
 *   - `tests/**`             — test fixtures may use any literal shape
 *   - `prisma/fixtures/**`   — seed fixtures
 *   - `scripts/**`           — one-off forensic / migration scripts
 *
 * Opt-in escape (per call site):
 *   - `// @piiRedacted` — comment on the previous or same line declares
 *     the author has redacted the literal before passing it
 *
 * Per `.claude/rules/data-retention.md` companion rule
 * `privacy-applog.md` (filed alongside this rule). Catalogued in
 * `docs/kb/guard-registry.md`.
 *
 * Class: invariant (write-side privacy chokepoint).
 *
 * @see docs/CHAIN-CONTRACTS.md §6a I-PR3 (data retention)
 * @see lib/logger.ts (the chokepoint writer)
 */

const FORBIDDEN_KEYS = new Set([
  "email",
  "phone",
  "transcript",
  "name",
  "value",
  "promptPreview",
  "responsePreview",
]);

const ALLOWED_PATH_SUFFIXES = [
  "lib/logger.ts",
  // metering helper writes its own `metadata` literal with internal
  // counters; no caller-supplied data flows through these keys.
  "lib/metering/meter-call.ts",
];

const ALLOWED_PATH_GLOBS = [
  // Tests can compose any literal shape — they're fixture data.
  /\/tests\//,
  /\/prisma\/fixtures\//,
  /\/scripts\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
];

const ESCAPE_COMMENT = "@piiRedacted";

function isAllowedPath(filename) {
  for (const suffix of ALLOWED_PATH_SUFFIXES) {
    if (filename.endsWith(suffix)) return true;
  }
  for (const re of ALLOWED_PATH_GLOBS) {
    if (re.test(filename)) return true;
  }
  return false;
}

function hasEscapeComment(sourceCode, node) {
  const comments = sourceCode.getCommentsBefore(node);
  for (const c of comments) {
    if (c.value.includes(ESCAPE_COMMENT)) return true;
  }
  return false;
}

/** Walk an ObjectExpression's keys, return the first forbidden key found. */
function findForbiddenKey(objExpr) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return null;
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property") continue;
    let keyName = null;
    if (prop.key.type === "Identifier") keyName = prop.key.name;
    else if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
      keyName = prop.key.value;
    }
    if (keyName && FORBIDDEN_KEYS.has(keyName)) return keyName;
  }
  return null;
}

/** Detect `obj.metadata` property where the value is a literal with PII keys. */
function checkMetadataLiteral(context, node, ancestorSiteLabel) {
  const filename = context.filename || context.getFilename?.() || "";
  if (isAllowedPath(filename)) return;
  if (hasEscapeComment(context.sourceCode, node)) return;

  if (!node || node.type !== "ObjectExpression") return;
  for (const prop of node.properties) {
    if (prop.type !== "Property") continue;
    if (prop.key.type !== "Identifier" || prop.key.name !== "metadata") continue;
    const forbidden = findForbiddenKey(prop.value);
    if (forbidden) {
      context.report({
        node: prop,
        messageId: "piiInMetadata",
        data: { key: forbidden, site: ancestorSiteLabel },
      });
    }
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block literal PII-keyed objects from being passed as `metadata` to AppLog write paths. See .claude/rules/data-retention.md.",
      url: "docs/kb/guard-registry.md#guard-no-pii-in-applog-metadata",
    },
    schema: [],
    messages: {
      piiInMetadata:
        "AppLog metadata contains literal PII key '{{ key }}' (site: {{ site }}). Forbidden keys: email, phone, transcript, name, value, promptPreview, responsePreview. Either redact before passing or annotate with `// @piiRedacted` if intentional.",
    },
  },
  create(context) {
    return {
      // prisma.appLog.create({ data: { metadata: { ... } } })
      CallExpression(node) {
        // Match `prisma.appLog.create({ data: ... })`
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "create" &&
          node.callee.object.type === "MemberExpression" &&
          node.callee.object.property.type === "Identifier" &&
          node.callee.object.property.name === "appLog"
        ) {
          const arg = node.arguments[0];
          if (arg && arg.type === "ObjectExpression") {
            for (const prop of arg.properties) {
              if (
                prop.type === "Property" &&
                prop.key.type === "Identifier" &&
                prop.key.name === "data"
              ) {
                checkMetadataLiteral(
                  context,
                  prop.value,
                  "prisma.appLog.create",
                );
              }
            }
          }
        }

        // log(...)/ logAI(...) calls — caller-side metadata
        if (
          node.callee.type === "Identifier" &&
          (node.callee.name === "log" || node.callee.name === "logAI")
        ) {
          for (const arg of node.arguments) {
            if (arg && arg.type === "ObjectExpression") {
              checkMetadataLiteral(context, arg, `${node.callee.name}()`);
            }
          }
        }
      },
    };
  },
};
