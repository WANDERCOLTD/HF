import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noUnscopedSlugLookup from "./eslint-rules/no-unscoped-slug-lookup.mjs";
import noDeprecatedCurriculaRelation from "./eslint-rules/no-deprecated-curricula-relation.mjs";
import noDirectPlaybookConfigWrite from "./eslint-rules/no-direct-playbook-config-write.mjs";
import noDirectDomainOnboardingWrite from "./eslint-rules/no-direct-domain-onboarding-write.mjs";
import noDirectSpecConfigWrite from "./eslint-rules/no-direct-spec-config-write.mjs";
import noAiFanoutAll from "./eslint-rules/no-ai-fanout-all.mjs";
import noAiForbiddenFields from "./eslint-rules/no-ai-forbidden-fields.mjs";
import noOrphanInstructionFallback from "./eslint-rules/no-orphan-instruction-fallback.mjs";
import noHardcodedGreetingInComposition from "./eslint-rules/no-hardcoded-greeting-in-composition.mjs";
import noVapiColumnRef from "./eslint-rules/hf-voice/no-vapi-column-ref.mjs";
import noVapiToolDefinitionsConst from "./eslint-rules/hf-voice/no-vapi-tool-definitions-const.mjs";
import noUndeclaredFieldRequire from "./eslint-rules/no-undeclared-field-require.mjs";
import noModuleReadWithoutCourseStyleGuard from "./eslint-rules/no-module-read-without-course-style-guard.mjs";
import noBareCallCreate from "./eslint-rules/no-bare-call-create.mjs";
import noBareCallScoreWrite from "./eslint-rules/no-bare-call-score-write.mjs";
import noOpsImportFromApi from "./eslint-rules/no-ops-import-from-api.mjs";
import noSecretsInClient from "./eslint-rules/no-secrets-in-client.mjs";
import noHardcodedSpecSlug from "./eslint-rules/no-hardcoded-spec-slug.mjs";
import noBareStrategyKey from "./eslint-rules/no-bare-strategy-key.mjs";
import noUnscopedCallerIdRoute from "./eslint-rules/no-unscoped-caller-id-route.mjs";
import requireHtmlSafetyComment from "./eslint-rules/require-html-safety-comment.mjs";
import requireTieredRedactor from "./eslint-rules/require-tiered-redactor.mjs";

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
          // #1205 — block new reads of @deprecated Playbook.curricula direct
          // relation. Use Playbook.playbookCurricula (canonical join) instead.
          // Variants linked via the join table are silently missing from the
          // deprecated `.curricula` array.
          "no-deprecated-curricula-relation": noDeprecatedCurriculaRelation,
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
      // #1006 / #1008 — block generic-noun fallbacks for missing module/LO
      // names in prompt-composition transforms (Maya IELTS hallucination
      // class). Drop the line via conditional spread instead of emitting
      // "previous concept" / "next concept" / "first concept" etc. See
      // chain-contracts.md Link 3 → COMPOSE→LLM I-C4.
      "hf-compose": {
        rules: {
          "no-orphan-instruction-fallback": noOrphanInstructionFallback,
          // #1384 — block hardcoded learner-facing greetings in
          // prompt-composition transforms + voice assistant-config
          // builders. The greeting is course-tunable behaviour, not a
          // code constant. Companion: `.claude/rules/pipeline-and-prompt.md`.
          "no-hardcoded-greeting-in-composition": noHardcodedGreetingInComposition,
        },
      },
      // AnyVoice #1024 — block reintroduction of pre-rename vapi*
      // column refs and the removed VAPI_TOOL_DEFINITIONS TS const.
      // Both audit counters (vapiNamedColumnsOnCallModel,
      // vapiToolDefinitionsConstantPresent) read 0 after #1019/#1020;
      // these rules keep them at 0. See chain-contracts.md Link 3
      // sub-contract I-VP2 + I-VP3.
      "hf-voice": {
        rules: {
          "no-vapi-column-ref": noVapiColumnRef,
          "no-vapi-tool-definitions-const": noVapiToolDefinitionsConst,
        },
      },
      // #1078 — V6 wizard Phase 1 spike. Catches `has('typo')` against
      // an undeclared field inside `defineCrawcusSpec` — the runtime
      // would silently make the dependent field unreachable and the
      // wizard would appear to skip a step for no obvious reason.
      "hf-wizard-v6": {
        rules: {
          "no-undeclared-field-require": noUndeclaredFieldRequire,
        },
      },
      // #1252 / #1259 — default-deny module reads. Any
      // `prisma.callerModuleProgress.*` call outside an explicit
      // `courseStyle === "structured"` guard is an error. CONTINUOUS
      // courses have no module-progress semantic; reading anyway is
      // the bug class this epic kills. Allowlisted call-sites:
      //   - lib/enrollment/instantiate-module-progress.ts
      //   - app/api/calls/[callId]/pipeline/route.ts
      //   - lib/prompt/composition/transforms/modules.ts
      //   - lib/curriculum/track-progress.ts
      //   - scripts/**, tests/**, __tests__/**
      "hf-pipeline": {
        rules: {
          "no-module-read-without-course-style-guard":
            noModuleReadWithoutCourseStyleGuard,
        },
      },
      // #1333 + #1342 + #1344 — block bare `prisma.call.create` AND
      // `prisma.session.create` outside the explicit allow-lists. Every
      // Session row MUST go through `createSession` so the atomic
      // counter + voice snapshot + I-CT2 cascade all land at creation
      // time. The legacy `createCallEnteringPipeline` wrapper was
      // deleted in #1344 Slice 4 — the two routes that used it
      // (outbound-dial, start) now call `createSession({kind:VOICE_CALL})`
      // directly and create the Call child inline.
      // Defends the chain-contract pre-condition for Link 3
      // (CURRICULUM → CALL compose) and the Session-boundary invariants
      // in Link 3b.
      "hf-call": {
        rules: {
          "no-bare-call-create": noBareCallCreate,
        },
      },
      // #1539 — spec-lineage contract for CallScore writes. Every row
      // MUST carry `analysisSpecId` (the AnalysisSpec whose rubric
      // produced the score). Helper at `lib/measurement/write-call-score.ts`
      // requires the column in its TypeScript signature; the rule blocks
      // bare `prisma.callScore.{create,update,upsert}` from drift.
      "hf-measurement": {
        rules: {
          "no-bare-call-score-write": noBareCallScoreWrite,
        },
      },
      "hf-ops": {
        rules: {
          "no-ops-import-from-api": noOpsImportFromApi,
        },
      },
      // Audit HF-J (2026-06-11) — block plaintext credentials / secret-shaped
      // literals in `"use client"` files. They ship in the browser bundle
      // regardless of any runtime render gate (the HF-B login/page.tsx finding).
      "hf-security": {
        rules: {
          "no-secrets-in-client": noSecretsInClient,
          "no-unscoped-caller-id-route": noUnscopedCallerIdRoute,
          "require-html-safety-comment": requireHtmlSafetyComment,
        },
      },
      // Audit HF-I (2026-06-11) — block hardcoded spec-slug literals in runtime
      // code; slugs are env-overridable config (config.specs.*). Lands as `warn`
      // (residual low-severity literals); promote to `error` once swept.
      "hf-config": {
        rules: {
          "no-hardcoded-spec-slug": noHardcodedSpecSlug,
        },
      },
      // #1599 — Block bare string literals assigned to `progressStrategy`;
      // require `StrategyKey.<member>` from lib/goals/strategies/types.ts.
      // Same shape as hf-curriculum/no-unscoped-slug-lookup (#411) and
      // hf-call/no-bare-call-create (#1333).
      "hf-goals": {
        rules: {
          "no-bare-strategy-key": noBareStrategyKey,
        },
      },
      // Wave C5 of epic #1685 — opt-in @tieredVisibility tag enforces
      // that the route imports + invokes the
      // `lib/rbac/visibility.ts` + `lib/rbac/policies/*` pattern.
      // Hardens the whitelist-default-safe property of Wave C3b's
      // visibility-policy.
      "hf-rbac": {
        rules: {
          "require-tiered-redactor": requireTieredRedactor,
        },
      },
    },
    rules: {
      "hf-curriculum/no-unscoped-slug-lookup": "error",
      "hf-curriculum/no-deprecated-curricula-relation": "error",
      "hf-playbook/no-direct-config-write": "error",
      "hf-domain/no-direct-onboarding-write": "error",
      "hf-spec/no-direct-config-write": "error",
      "hf-recompose/no-ai-fanout-all": "error",
      "hf-ai-tools/no-forbidden-fields": "error",
      // Lands as `warn` so commits 4-6 land cleanly. Promoted to `error`
      // once `composeGenericNounFallbackCount` reads 0 in dev/test/prod for
      // ≥7 days (per the chain-contract severity-escalation path).
      "hf-compose/no-orphan-instruction-fallback": "warn",
      // #1384 / #1385 — hardcoded greeting guard. Promoted to `error`
      // in the same PR that removed the six known offences
      // (quickstart.ts:549,566 + build-assistant-config.ts:121,177 +
      // route-handlers.ts:1204,1250 — all rehomed under
      // `lib/prompt/composition/defaults/fallback-first-lines.ts`).
      // Any new literal greeting in `lib/prompt/composition/transforms/`,
      // `lib/voice/build-assistant-config.ts`, or `lib/voice/route-
      // handlers.ts` now fails CI.
      "hf-compose/no-hardcoded-greeting-in-composition": "error",
      "hf-voice/no-vapi-column-ref": "error",
      "hf-voice/no-vapi-tool-definitions-const": "error",
      "hf-wizard-v6/no-undeclared-field-require": "error",
      // #1252 / #1259 — lands as `warn` initially to avoid blocking
      // pre-existing call-sites discovered during epic landing.
      // Promoted to `error` once full sweep complete + audit counter
      // reads 0 for ≥7 days.
      "hf-pipeline/no-module-read-without-course-style-guard": "error",
      // #1333 + #1342 + #1344 — error severity from day 1. Allow-list
      // covers every existing legitimate `prisma.call.create` site and
      // the builder + test files for `prisma.session.create`; any new
      // site must either route through `createSession` (with a small
      // inline Call insert when needed) or add to the allow-list with a
      // documented bypass justification.
      "hf-call/no-bare-call-create": "error",
      // #1539 — error severity from day 1. Allow-list covers every
      // pre-existing legitimate write site (the chokepoint helper itself,
      // the drain script, the demo-reset / seed-transcripts admin
      // routes, and the manual ops re-grade route). Any new write site
      // must either route through `writeCallScore` or add to the
      // allow-list with documented bypass justification.
      "hf-measurement/no-bare-call-score-write": "error",

      // #1599 — error severity from day 1. The one pre-existing offence
      // (`scripts/fix-cio-cto-playbooks.ts:234` writing `"LO_MASTERY"`)
      // is repaired in the same PR. Any new write site that hand-rolls
      // a `progressStrategy: "<literal>"` outside the canonical
      // `StrategyKey` enum fails CI. Allow-list (in the rule itself):
      // `lib/goals/strategies/registry.ts` (the alias map) + test files.
      "hf-goals/no-bare-strategy-key": "error",

      // Wave C5 of epic #1685 — error severity from day 1.
      // Opt-in: routes self-declare with `@tieredVisibility` JSDoc tag.
      // No false-positives possible — the rule is dormant on untagged
      // files. The first wired route (Wave C3b) is
      // `app/api/callers/[callerId]/adaptations/route.ts`; new tier-sensitive
      // routes copy the tag pattern.
      "hf-rbac/require-tiered-redactor": "error",

      // #1395 / #1423 — Block app/api routes from importing the 5 lib/ops/*
      // files that instantiate their own PrismaClient (bypass the singleton).
      // Carves out app/api/ops/route.ts (the legitimate ops surface).
      "hf-ops/no-ops-import-from-api": "error",

      // Audit HF-J (2026-06-11) — error from day 1. The one known offence
      // (login/page.tsx DEMO_ACCOUNTS) is build-stripped from PROD and carries
      // a documented eslint-disable; any NEW secret literal in a client file
      // fails CI.
      "hf-security/no-secrets-in-client": "error",

      // Audit HF-M.2 (2026-06-12) — Block [callerId] route files that have an
      // HTTP handler but don't call studentAllowedToReadCaller() or
      // resolveCallerScopeForReading(). Locks in the HF-M IDOR sweep from
      // commit 0de21b02 so the next [callerId] route can't land without the
      // STUDENT-scope guard. Severity `error` from day 1 — all 26 existing
      // routes were patched in the same commit, so 0 violations at activation.
      // See docs/audit/HF-M-evidence-path-param-idor.md.
      "hf-security/no-unscoped-caller-id-route": "error",

      // Audit HF-O/HF-P (2026-06-12) — every `dangerouslySetInnerHTML` site
      // must carry either a `// SECURITY:` annotation documenting why the
      // input is trusted, OR import / call an in-scope sanitizer (DOMPurify,
      // escapeHtml, sanitize, …). Severity `error` from day 1 — the 4 existing
      // sites all satisfy the rule (HF-P stageIcon has the SECURITY comment;
      // HF-O DemoStepRenderer uses escapeHtml; the theme script + the
      // RunInspector inline style are server-built constants with the
      // annotation pattern). The fix-it for new sites is documented in the
      // rule's failure message. Prevents the next latent-XSS landing.
      "hf-security/require-html-safety-comment": "error",

      // Audit HF-I sweep (2026-06-11) — landed as DORMANT in 843bcf3a after the two
      // live bugs (GOAL-001 write → config.specs.goal; TUT-001 match →
      // config.specs.defaultArchetype) were fixed. Sweep promoted to ERROR after the
      // residual 29 sites were cleared: 16 false-positive sites moved to the
      // ALLOWLIST_PATH_FRAGMENTS in the rule (lib/demo/registry.ts, lib/registry/index.ts
      // (parameter ID registry — CP-004 is a Param, not a Spec), and the documented
      // sector-config.ts client mirror), 1 SettingsClient search keyword carries an
      // inline disable + rationale, and 13 runtime consumers across 7 files were
      // routed through 4 new config.specs.* getters (aggComprehension/Discussion/
      // Coaching/goalProgress). See docs/kb/guard-registry.md#guard-no-hardcoded-spec-slug.
      "hf-config/no-hardcoded-spec-slug": "error",
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
