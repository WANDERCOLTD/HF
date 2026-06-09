/**
 * AnyVoice #1024 — block reintroduction of the 6 specific `vapi`-prefixed
 * Call columns renamed in #1020.
 *
 * The schema rename moved 6 columns from `Call.vapi*` to canonical
 * `Call.voice*`. The audit counter `vapiNamedColumnsOnCallModel` (#1016)
 * drives to 0 after that migration; this rule keeps it at 0 by failing
 * CI on any reference to the OLD column names. Closes the I-VP3
 * invariant in `docs/CHAIN-CONTRACTS.md` Link 3 sub-contract
 * (COMPOSE → VOICE PROVIDER).
 *
 * Why an explicit allowlist of forbidden NAMES (not a regex prefix):
 *
 *   The original draft of this rule used `/^vapi[A-Z]/` which
 *   correctly catches every renamed column — but ALSO catches
 *   legitimate code-side identifiers like `vapiInbound` (the
 *   URL-bound adapter ref in `app/api/vapi/*` routes), `vapiCall`
 *   (the historical-import VAPI payload var), `vapiProvider`
 *   (general references to the VapiProvider class). Those are
 *   Category B residuals — VAPI-specific by nature, correct
 *   in context. Narrowing to the exact 6 renamed COLUMNS removes
 *   the false-positive class without weakening the guarantee:
 *   any genuinely renamed column reference still fires; legitimate
 *   non-column VAPI-prefixed identifiers don't.
 *
 *   When a future schema rename adds another `vapi*` column to
 *   forbid (vanishingly unlikely post-#1020 since we don't add such
 *   columns anymore), append it to `FORBIDDEN_COLUMN_NAMES`.
 *
 * Allowed paths:
 *   - `_archived/**` — read-only legacy (already globally ignored)
 *   - `prisma/migrations/**` — pre-rename migration files reference
 *     the old names verbatim (DROP/RENAME SQL)
 */

const FORBIDDEN_COLUMN_NAMES = new Set([
  "vapiDurationSeconds",
  "vapiEndedReason",
  "vapiCostUsd",
  "vapiAnalysisSummary",
  "vapiStructuredData",
  "vapiSuccessEvaluation",
]);

const ALLOWED_PATH_FRAGMENTS = [
  "/prisma/migrations/",
  "/_archived/",
];

function isAllowedFile(filename) {
  if (!filename) return false;
  return ALLOWED_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the 6 pre-#1020 vapi-prefixed Call column names. Use voice* names. See docs/CHAIN-CONTRACTS.md I-VP3.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-vapi-column-ref",
    },
    schema: [],
    messages: {
      vapiColumn:
        "`{{ name }}` is the pre-#1020 column name. Use `voice{{ suffix }}` instead. The schema rename closed I-VP3; this rule keeps it closed.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? "";
    if (isAllowedFile(filename)) return {};

    function reportIfForbidden(node, name) {
      if (!name || !FORBIDDEN_COLUMN_NAMES.has(name)) return;
      // suffix = name without the "vapi" prefix, capitalised — used in
      // the message to suggest the canonical replacement
      const suffix = name.slice(4); // "vapi".length === 4
      context.report({
        node,
        messageId: "vapiColumn",
        data: { name, suffix },
      });
    }

    return {
      // Identifier visitor catches bare refs (`call.vapiDurationSeconds`)
      // AND identifier-typed property keys (`{ vapiDurationSeconds: 0 }`)
      // because object keys ARE Identifier nodes in the AST.
      Identifier(node) {
        reportIfForbidden(node, node.name);
      },
      // Property visitor only handles QUOTED keys (`{"vapiCostUsd": 0}`)
      // since identifier-typed keys are already covered by the visitor
      // above. Without this split, every literal property key would fire
      // twice and the rule's test expectations get noisy.
      Property(node) {
        if (node.key?.type === "Literal" && typeof node.key.value === "string") {
          reportIfForbidden(node.key, node.key.value);
        }
      },
    };
  },
};
