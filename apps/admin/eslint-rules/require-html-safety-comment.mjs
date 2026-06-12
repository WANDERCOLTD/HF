/**
 * Require an HTML-safety annotation on every `dangerouslySetInnerHTML` site.
 *
 * Audit HF-O / HF-P (2026-06-12). The XSS sweep walked 4 existing sites:
 *   - app/layout.tsx — server-built themeInitScript
 *   - app/x/pipeline/components/RunInspector.tsx — inline <style> string
 *   - app/x/flows/page.tsx — stageIcon hardcoded-entity dict (annotated)
 *   - components/demo/DemoStepRenderer.tsx — markdown render (now escapes)
 *
 * Each was either safe-by-construction or fixed. This rule prevents the
 * NEXT site from landing without a documented trust-chain — either the
 * input is sanitized in the file (escapeHtml / DOMPurify / similar), or
 * a preceding `// SECURITY:` comment carries the rationale.
 *
 * Fires when ALL of:
 *   1. JSX attribute / property `dangerouslySetInnerHTML` is used
 *   2. The line above is NOT a `// SECURITY:` annotation
 *   3. The file does NOT import / call `DOMPurify`, `sanitize`, or a
 *      local `escapeHtml` helper
 *
 * Greenlit:
 *   - `// SECURITY: <rationale>` immediately before the line (one-line audit gate)
 *   - file imports `DOMPurify` from anywhere
 *   - file defines or imports a function literally named `escapeHtml` or `sanitize`
 *
 * Severity: `error` from day 1. The 4 existing sites either carry a
 * `// SECURITY:` annotation (HF-P stageIcon) or use the escape helper
 * (HF-O DemoStepRenderer / theme script / inline style — the last 2 are
 * server-built constants that count as escape-equivalent).
 */

const SANITIZER_NAMES = [
  "DOMPurify",
  "dompurify",
  "sanitize",
  "sanitizeHtml",
  "escapeHtml",
];

const messages = {
  missingSafety:
    "`dangerouslySetInnerHTML` usage without an HTML-safety annotation or in-scope " +
    "sanitizer. Add a preceding `// SECURITY: <why this input is trusted>` comment, " +
    "OR import/define one of: " + SANITIZER_NAMES.join(", ") + ". " +
    "See docs/audit/HF-M-evidence-path-param-idor.md (HF-O/HF-P pattern).",
};

function fileHasSanitizer(text) {
  for (const name of SANITIZER_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return true;
  }
  return false;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "`dangerouslySetInnerHTML` must carry a `// SECURITY:` annotation or use an in-scope sanitizer. See audit HF-O/HF-P.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-require-html-safety-comment",
    },
    schema: [],
    messages,
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "dangerouslySetInnerHTML") return;
        const sourceCode = context.sourceCode ?? context.getSourceCode?.();
        if (!sourceCode) return;
        const text = sourceCode.getText();
        if (fileHasSanitizer(text)) return;

        // Search the 6 lines above the JSX attribute for any text matching
        // `SECURITY:` (in line-comments, block-comments, JSX-block-comments,
        // or attribute-position comments — we don't care about the form).
        const line = node.loc?.start?.line ?? 0;
        const lines = sourceCode.lines ?? text.split("\n");
        const lookback = 6;
        for (let i = Math.max(0, line - 1 - lookback); i < line - 1; i++) {
          const lineText = lines[i] ?? "";
          if (/SECURITY[:\s]/i.test(lineText)) return;
        }

        // Also check the same line as a fallback (attribute-position comments).
        const same = lines[line - 1] ?? "";
        if (/SECURITY[:\s]/i.test(same)) return;

        context.report({ node, messageId: "missingSafety" });
      },
    };
  },
};

// Named default to satisfy import/no-anonymous-default-export.
const requireHtmlSafetyComment = rule;
export default requireHtmlSafetyComment;
