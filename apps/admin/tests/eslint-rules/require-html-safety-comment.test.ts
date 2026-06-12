// HF-O/HF-P — pin the rule that every dangerouslySetInnerHTML site MUST
// carry a `// SECURITY:` annotation or use an in-scope sanitizer.

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/require-html-safety-comment.mjs";
import { smokeRule } from "./_helpers.js";

describe("require-html-safety-comment", () => {
  it("has the structural pieces (meta.docs.url to KB, messages, create)", () => {
    smokeRule("require-html-safety-comment", rule as never);
  });
});

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("require-html-safety-comment", rule as never, {
  valid: [
    // SECURITY: comment immediately above → ok
    {
      code: `
        function X() {
          return (
            // SECURITY: server-built constant, no external input flows here.
            <div dangerouslySetInnerHTML={{ __html: SERVER_CONSTANT }} />
          );
        }
      `,
    },
    // escapeHtml imported / called → ok
    {
      code: `
        import { escapeHtml } from "@/lib/html";
        function X() {
          const safe = escapeHtml(input);
          return <div dangerouslySetInnerHTML={{ __html: safe }} />;
        }
      `,
    },
    // DOMPurify imported → ok
    {
      code: `
        import DOMPurify from "dompurify";
        function X() {
          return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(x) }} />;
        }
      `,
    },
    // No dangerouslySetInnerHTML → rule is silent
    {
      code: `<div>hello</div>;`,
    },
  ],
  invalid: [
    // No annotation, no sanitizer → fires
    {
      code: `<div dangerouslySetInnerHTML={{ __html: input }} />;`,
      errors: [{ messageId: "missingSafety" }],
    },
    // Annotation present but says something else → fires
    {
      code: `
        // Just a regular comment about layout.
        <div dangerouslySetInnerHTML={{ __html: input }} />;
      `,
      errors: [{ messageId: "missingSafety" }],
    },
  ],
});
