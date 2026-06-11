/**
 * Block plaintext credentials / secrets in client components.
 *
 * Live finding 2026-06-11 (audit HF-B / HF-J): `app/login/page.tsx` declared a
 * module-scope `DEMO_ACCOUNTS` array with plaintext passwords ("hff", "hff2026")
 * plus an inline "hff2026" hint, in a `"use client"` file. Those literals ship in
 * the PRODUCTION JS bundle regardless of the runtime `isNonProd` render gate — if
 * the accounts exist in a prod DB, that is credential disclosure.
 *
 * Anything a client component holds as a string literal is shipped to the browser.
 * Secrets must come from a server route or be build-time stripped — never live as a
 * literal in client source.
 *
 * This rule fires, ONLY in files carrying the `"use client"` directive, when:
 *   (1) a credential-shaped key (`password`, `secret`, `apiKey`, `privateKey`,
 *       `clientSecret`, `accessToken`, `refreshToken`, …) is assigned a non-empty
 *       string Literal — whether as an object Property, a VariableDeclarator, or an
 *       AssignmentExpression; OR
 *   (2) ANY string literal matches a high-confidence secret shape (OpenAI `sk-…`,
 *       Anthropic key, AWS `AKIA…`, GitHub `ghp_…`, a JWT, a long hex/base64 blob).
 *
 * Greenlit (no fire):
 *   - Server files (no `"use client"` directive) — they don't ship to the browser.
 *   - `process.env.*` / identifier / template-with-interpolation values — not literals.
 *   - Empty strings.
 *   - Documented exceptions via `// eslint-disable-next-line hf-security/no-secrets-in-client`
 *     with a rationale (e.g. demo creds that are build-stripped from the PROD bundle).
 *
 * Severity: `error`. Companion: `.claude/rules/ai-to-db-guard.md` (sibling secrets
 * discipline) + `docs/kb/guard-registry.md`.
 */

const CREDENTIAL_KEY_RE =
  /^(password|passwd|pwd|secret|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?secret|encryption[_-]?key|signing[_-]?key)$/i;

// High-confidence secret value shapes. Deliberately tight to stay high-signal.
const SECRET_VALUE_RES = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/, // OpenAI / generic sk- keys
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, // Anthropic
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{36}\b/, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, // GitHub fine-grained PAT
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
];

const messages = {
  credentialKey:
    "Plaintext credential in a client component — `{{key}}` is assigned a string literal " +
    "that ships in the browser bundle. Move it to a server route or build-time-strip it " +
    "(NEXT_PUBLIC_* gate). If intentional (e.g. build-stripped demo creds), add an " +
    "`// eslint-disable-next-line hf-security/no-secrets-in-client -- <reason>`. See guard-registry.md.",
  secretValue:
    "Secret-shaped literal in a client component — this ships to the browser. Read it from " +
    "a server route; never hold an API key / token literal in client source. See guard-registry.md.",
};

function fileIsClientComponent(sourceCode) {
  const body = sourceCode?.ast?.body;
  if (!Array.isArray(body)) return false;
  // Directive prologue: leading string-literal ExpressionStatements.
  for (const stmt of body) {
    if (stmt.type !== "ExpressionStatement") break;
    const dir =
      stmt.directive ??
      (stmt.expression?.type === "Literal" && typeof stmt.expression.value === "string"
        ? stmt.expression.value
        : null);
    if (dir == null) break;
    if (dir === "use client") return true;
  }
  return false;
}

function literalStringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string" && node.value.length > 0) {
    return node.value;
  }
  return null;
}

function keyNameOf(node) {
  const key = node?.key ?? node?.id ?? node?.left;
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block plaintext credentials / secret-shaped literals in client components (they ship in the browser bundle). See audit HF-J.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-secrets-in-client",
    },
    schema: [],
    messages,
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    // Lazily resolve "is this a client component?" so create() ALWAYS returns its
    // visitor set (the rule-test smoke check calls create() with a bare context and
    // asserts at least one visitor). The per-node guard makes the rule a no-op in
    // server files at lint time.
    let isClient = null;
    const inClientFile = () => {
      if (isClient === null) isClient = fileIsClientComponent(sourceCode);
      return isClient;
    };

    function checkSecretShapedValue(node) {
      if (!inClientFile()) return;
      const val = literalStringValue(node);
      if (val == null) return;
      if (SECRET_VALUE_RES.some((re) => re.test(val))) {
        context.report({ node, messageId: "secretValue" });
      }
    }

    function checkCredentialAssignment(keyNode, valueNode) {
      if (!inClientFile()) return;
      const key = keyNameOf(keyNode);
      if (!key || !CREDENTIAL_KEY_RE.test(key)) return;
      if (literalStringValue(valueNode) == null) return;
      context.report({ node: valueNode, messageId: "credentialKey", data: { key } });
    }

    return {
      Literal: checkSecretShapedValue,
      Property(node) {
        checkCredentialAssignment(node, node.value);
      },
      VariableDeclarator(node) {
        if (node.init) checkCredentialAssignment(node, node.init);
      },
      AssignmentExpression(node) {
        checkCredentialAssignment(node, node.right);
      },
    };
  },
};
