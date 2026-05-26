import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUnscopedSlugLookup from "./eslint-rules/no-unscoped-slug-lookup.mjs";
import noDirectPlaybookConfigWrite from "./eslint-rules/no-direct-playbook-config-write.mjs";
import noDirectDomainOnboardingWrite from "./eslint-rules/no-direct-domain-onboarding-write.mjs";
import noDirectSpecConfigWrite from "./eslint-rules/no-direct-spec-config-write.mjs";
import noAiFanoutAll from "./eslint-rules/no-ai-fanout-all.mjs";
import noAiForbiddenFields from "./eslint-rules/no-ai-forbidden-fields.mjs";

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
    // Generated Playwright artefacts — not source code, should never be linted
    "playwright-report/**",
    // Archived legacy code — read-only, not part of the build
    "_archived/**",
    "**/_archived/**",
  ]),
  // Catch hardcoded hex colors in inline styles - use CSS variables instead
  // e.g., background: "#fff" → background: "var(--surface-primary)"
  {
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXAttribute[name.name='style'] Property[key.name=/^(background|backgroundColor|color|borderColor|border)$/] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Avoid hardcoded hex colors in inline styles. Use CSS variables instead (e.g., var(--surface-primary), var(--text-primary)). See globals.css for available tokens.",
        },
      ],
    },
  },
  // #407 slug-scope guard — error severity, lives in its own custom-rule
  // plugin so it doesn't share `no-restricted-syntax` severity with the
  // hex-color warning above. Block CI on any unscoped slug/ref lookup
  // against per-parent-unique entities (CurriculumModule, LearningObjective).
  {
    plugins: {
      "hf-curriculum": {
        rules: {
          "no-unscoped-slug-lookup": noUnscopedSlugLookup,
        },
      },
      // #826 — block direct writes to Playbook.config outside the
      // central helper. Force every writer through updatePlaybookConfig
      // so the TUNER → COMPOSE chain-contract (Link 3) timestamp bump
      // cannot be skipped.
      "hf-playbook": {
        rules: {
          "no-direct-config-write": noDirectPlaybookConfigWrite,
        },
      },
      // #828 — block direct writes to Domain onboarding* fields
      // outside the central helper. Domain bumps fan out to ALL
      // playbooks-in-domain via the staleness check.
      "hf-domain": {
        rules: {
          "no-direct-onboarding-write": noDirectDomainOnboardingWrite,
        },
      },
      // #829 — block direct writes to compose-affecting AnalysisSpec
      // fields outside the central helper. Routes the bump to
      // SystemSetting (SYSTEM scope) or Domain (DOMAIN scope) per the
      // spec's scope field. CALLER scope is no-op.
      "hf-spec": {
        rules: {
          "no-direct-config-write": noDirectSpecConfigWrite,
        },
      },
      // #854 / Story #855 — block AI tool executors from requesting
      // cohort fan-out (`fanoutScope: 'all'`). Toggle 2 in the pending-
      // changes tray is a human-only switch; the AI-safety invariant
      // requires this enforcement be structural, not by convention.
      "hf-recompose": {
        rules: {
          "no-ai-fanout-all": noAiFanoutAll,
        },
      },
      // 2026-05-26 — block AI tool schemas from declaring globally
      // forbidden fields (role, domainId, ownerId, isLocked, slug…).
      // The pattern fires at edit time on apps/admin/lib/chat/admin-tools.ts
      // so any new tool that exposes a privileged field can't even reach
      // a PR. Companion: lib/chat/ai-forbidden-fields.ts (the runtime
      // registry) + tests/lib/admin-tools-no-forbidden-fields.test.ts
      // (the dynamic-pattern catch). Triggered by the update_caller→role
      // incident where the schema shipped with `role` in its enum.
      "hf-ai-tools": {
        rules: {
          "no-forbidden-fields": noAiForbiddenFields,
        },
      },
    },
    rules: {
      "hf-curriculum/no-unscoped-slug-lookup": "error",
      "hf-playbook/no-direct-config-write": "error",
      "hf-domain/no-direct-onboarding-write": "error",
      "hf-spec/no-direct-config-write": "error",
      "hf-recompose/no-ai-fanout-all": "error",
      "hf-ai-tools/no-forbidden-fields": "error",
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
      // react-hooks ratchet (#865 closeout):
      // - 4 rules at "error" (rules-of-hooks, static-components, purity,
      //   preserve-manual-memoization) — zero current violations after #876 + #894;
      //   future regressions block CI.
      // - Remaining rules stay "warn" — non-zero counts accepted as ratchet-locked
      //   forward-compat debt; `.ratchet.json` (lint_warnings) only allows the count
      //   to decrease over time. See #865 closeout for rationale.
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/static-components": "error",
      "react-hooks/purity": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "prefer-const": "warn",
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-assign-module-variable": "warn",
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  // Playwright e2e fixtures are not React. Playwright's `use(value)` is the
  // fixture-callback parameter, not React's `use` hook — the rules-of-hooks
  // parser misidentifies it because the identifier matches `use*`. Disable
  // the React Hooks rules for the e2e tree so the false positives go away
  // without touching the fixtures themselves. (#865 PR 2)
  {
    files: ["e2e/**/*.{ts,tsx}", "e2e/**/*.{js,jsx,mjs,cjs}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
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
