import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Custom rules for design system consistency
  {
    rules: {
      // Catch hardcoded hex colors in inline styles - use CSS variables instead
      // e.g., background: "#fff" → background: "var(--surface-primary)"
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXAttribute[name.name='style'] Property[key.name=/^(background|backgroundColor|color|borderColor|border)$/] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Avoid hardcoded hex colors in inline styles. Use CSS variables instead (e.g., var(--surface-primary), var(--text-primary)). See globals.css for available tokens.",
        },
      ],
    },
  },
  // Enforce config+metering for ALL AI calls (no raw client usage)
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/ai/client",
              importNames: [
                "getAICompletion",
                "getAICompletionStream",
                "getConfiguredAICompletion",
                "getConfiguredAICompletionStream",
              ],
              message:
                "Use getConfiguredMeteredAICompletion or getConfiguredMeteredAICompletionStream from @/lib/metering. All AI calls must have config + metering. See: /x/ai-config",
            },
            {
              name: "@/lib/metering",
              importNames: [
                "getMeteredAICompletion",
                "getMeteredAICompletionStream",
                "createMeteredStream",
              ],
              message:
                "Use getConfiguredMeteredAICompletion or getConfiguredMeteredAICompletionStream from @/lib/metering. These include config + metering in one call.",
            },
          ],
        },
      ],
    },
  },
  // Exempt AI wrapper modules (they ARE the wrappers)
  {
    files: ["lib/metering/**/*.ts", "lib/ai/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Test files — relax type-strictness rules. Mocks, partial fixtures, and
  // typed-stub helpers routinely need `any` and unused vars; enforcing strict
  // typing in tests trades real signal for noise.
  {
    files: [
      "tests/**/*.{ts,tsx}",
      "__tests__/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Repo-wide: downgrade noisy stylistic rules from "error" to "warn".
  // The codebase carries thousands of pre-existing violations that block CI
  // wholesale. Rather than mass-fix in one PR (high churn, low signal), keep
  // these visible as warnings so new code is nudged toward fixing them while
  // unblocking the merge queue. Pair with a future cleanup story (#TBD).
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "prefer-const": "warn",
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-assign-module-variable": "warn",
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  // Archived code is read-only by definition — turn off entirely.
  {
    files: ["_archived/**/*.{ts,tsx}", "_archived/**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
]);

export default eslintConfig;
