// #1078 — Phase 1 spike spec port.
//
// CreateRecipe is the canonical CrawcusSpec "hello world" — sourced from
// `/Users/paulwander/projects/tallyseal/apps/playground/src/tallyseal/intents.ts`.
// We port it into HF so the V6 wizard playground has a stable, well-known
// shape to render and exercise the structural-guard plumbing against.
//
// Three fields with a prereq chain to prove the contract-driven evaluator
// picks next-field from the snapshot, not from prose:
//
//   title       → required, always available
//   servings    → required, depends on title being present (via `dependsOn`)
//   cookTime    → optional, depends on servings being present
//   notes       → optional, always available
//
// **Investigate-during-build note (PR comment, not blocking):**
// The issue spec (#1078) and the ADR refer to a `requires(fieldKey)` chip
// on the field builder. The vendored tallyseal package
// (`@tallyseal/crawcus-spec@0.11.0`) exposes the prereq DAG via
// `dependsOn({ when: ctx => bool })` instead — the `when` predicate is the
// implementation surface, `requires` is the conceptual name in the ADR
// prose. We use `dependsOn` here, which is the live API. If tallyseal
// adds a `field.requires('title')` sugar in a later release we'll
// migrate; the ESLint rule below treats them as a single concept.
//
// All `@tallyseal/*` imports go through the boundary facade per
// constraint 4 of the issue.

import {
  defineCrawcusSpec,
  defineContract,
  field,
  type CrawcusSpec,
  type IntentKey,
  type ProjectionName,
  type Locale,
  type ReadinessCtx,
} from "@/lib/intake/tallyseal";

export const CreateRecipe: CrawcusSpec = defineCrawcusSpec({
  key: "CreateRecipe" as IntentKey,
  projection: "Recipe" as ProjectionName,
  version: 1,
  classification: "standard",
  i18nDefault: "en" as Locale,

  fields: {
    title: field
      .string()
      .required()
      .label({ en: "Title" })
      .askHint({ en: "What's this recipe called?" }),

    // Prereq: servings can only be asked after title is captured.
    // This is the DAG edge that proves the evaluator picks next-field
    // from projected state, not from prose. CHAIN guard rejects any
    // out-of-order servings write when title is missing.
    servings: field
      .integer()
      .required()
      .label({ en: "Servings" })
      .askHint({ en: "How many people does it serve?" })
      .dependsOn({
        when: (ctx) => (ctx as ReadinessCtx).has("title"),
      })
      .validates((v) => typeof v === "number" && v > 0 && v <= 100),

    // Second prereq edge — `cookTime` is optional but only relevant
    // once both required fields have landed.
    cookTime: field
      .string()
      .optional()
      .label({ en: "Cook time" })
      .askHint({ en: "Roughly how long does it take?" })
      .dependsOn({
        when: (ctx) => (ctx as ReadinessCtx).has("title", "servings"),
      }),

    notes: field
      .string()
      .optional()
      .label({ en: "Notes" })
      .askHint({ en: "Any personal notes you want to keep?" }),
  },

  readiness: (ctx: unknown) => {
    const { has } = ctx as ReadinessCtx;
    return has("title", "servings");
  },

  contracts: {
    invariants: [
      defineContract({
        id: "recipe.servings-positive",
        description: { en: "Servings count must be > 0 and ≤ 100." },
        predicate: ({ value }) => {
          const s = value<number>("servings");
          return s === undefined || (s > 0 && s <= 100);
        },
      }),
    ],
    post: [
      defineContract({
        id: "recipe.commit-has-title-and-servings",
        description: {
          en: "After commit, both title and servings must be populated.",
        },
        predicate: ({ has }) => has("title", "servings"),
      }),
    ],
  },
});
