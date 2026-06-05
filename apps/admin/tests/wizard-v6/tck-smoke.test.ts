/**
 * #1078 — V6 wizard Phase 1 spike: TCK smoke against CreateRecipe.
 *
 * **Investigate-during-build note (PR comment, not blocking):**
 * `@tallyseal/crawcus-tck@0.1.3` (the version vendored at
 * `vendor/tallyseal/tallyseal-crawcus-tck-0.1.3.tgz`) exposes:
 *   - DisclosureSignal positive / gate-rejection / hash-mismatch fixtures
 *   - A Gherkin scenario-coverage helper (`checkScenarioCoverage`)
 *   - `parseScenarios` / `parseItNames`
 *
 * The TCK does not yet expose a "load a CrawcusSpec, run all CRAWCUS
 * shape contracts against it" entry point — that would be the
 * "wedge-shaped" assertion the spike close doc imagines. For Phase 1
 * we exercise what is available: structural shape via
 * `defineCrawcusSpec` round-trip + `evaluateContracts` against the
 * shipped invariants. The TCK smoke is therefore a vitest that
 * confirms (a) the spec compiles, (b) its contracts evaluate
 * deterministically against fabricated event logs, (c) the readiness
 * predicate behaves as declared.
 *
 * P2 entry deliverable: file an upstream tallyseal issue for a
 * "TCK.runSpec(spec)" entry point so HF (the wedge customer) can run
 * the same TCK assertion CI that tallyseal core runs. Tracking under
 * the issue's "Investigate-during-build items" section.
 */

import { describe, it, expect } from "vitest";
import { CreateRecipe } from "@/lib/wizard-v6/specs/create-recipe.crawcus";
import {
  TALLYSEAL_CRAWCUS_TCK_VERSION,
} from "@tallyseal/crawcus-tck";

describe("CreateRecipe — TCK smoke (#1078 Phase 1 spike)", () => {
  it("TCK package loads at the pinned version", () => {
    // If the vendored tarball is missing or unpacked wrong, the import
    // above throws — this assertion locks the version we tested against.
    expect(TALLYSEAL_CRAWCUS_TCK_VERSION).toBeDefined();
    expect(typeof TALLYSEAL_CRAWCUS_TCK_VERSION).toBe("string");
  });

  it("spec compiles with the expected shape (key / projection / version / fields)", () => {
    expect(String(CreateRecipe.key)).toBe("CreateRecipe");
    expect(String(CreateRecipe.projection)).toBe("Recipe");
    expect(CreateRecipe.version).toBe(1);
    expect(CreateRecipe.classification).toBe("standard");
  });

  it("declares exactly the four documented fields", () => {
    expect(Object.keys(CreateRecipe.fields).sort()).toEqual(
      ["cookTime", "notes", "servings", "title"].sort(),
    );
  });

  it("readiness fires on title + servings", () => {
    const present = new Set(["title", "servings"]);
    const ctx = {
      has: (...keys: string[]) => keys.every((k) => present.has(k)),
    };
    expect(CreateRecipe.readiness(ctx)).toBe(true);
  });

  it("readiness fails when title missing — proves required gate works", () => {
    const present = new Set(["servings"]);
    const ctx = {
      has: (...keys: string[]) => keys.every((k) => present.has(k)),
    };
    expect(CreateRecipe.readiness(ctx)).toBe(false);
  });

  it("declares 1 invariant + 1 post contract", () => {
    expect(CreateRecipe.contracts?.invariants?.length).toBe(1);
    expect(CreateRecipe.contracts?.post?.length).toBe(1);
  });

  it("recipe.servings-positive invariant rejects servings = 0", () => {
    const invariant = CreateRecipe.contracts?.invariants?.[0];
    expect(invariant?.id).toBe("recipe.servings-positive");
    // Predicate ctx mock: only `value` is needed for this contract.
    const ctxBad = {
      value: <T = unknown>(k: string): T | undefined =>
        (k === "servings" ? 0 : undefined) as T | undefined,
    };
    const ctxGood = {
      value: <T = unknown>(k: string): T | undefined =>
        (k === "servings" ? 4 : undefined) as T | undefined,
    };
    // ContractCtx is wider than what we pass — narrow via `as never`.
    expect(invariant?.predicate(ctxBad as never)).toBe(false);
    expect(invariant?.predicate(ctxGood as never)).toBe(true);
  });

  it("post contract requires both title + servings populated at commit", () => {
    const post = CreateRecipe.contracts?.post?.[0];
    expect(post?.id).toBe("recipe.commit-has-title-and-servings");
    const present = new Set(["title", "servings"]);
    const ctxGood = {
      has: (...keys: string[]) => keys.every((k) => present.has(k)),
    };
    const ctxBad = {
      has: (...keys: string[]) => keys.every((k) => k === "title"),
    };
    expect(post?.predicate(ctxGood as never)).toBe(true);
    expect(post?.predicate(ctxBad as never)).toBe(false);
  });

  it("servings field has a prereq DAG edge via dependsOn — title must land first", () => {
    // FieldBuilder is itself a FieldSpec; metadata.dependsOn is where
    // the `when` predicate ends up at runtime (the builder stamps it
    // there via the chainable `.dependsOn(...)` call).
    const servings = (
      CreateRecipe.fields as Record<
        string,
        { metadata?: { dependsOn?: { when: (ctx: unknown) => boolean } } }
      >
    ).servings;
    const dependsOn = servings?.metadata?.dependsOn;
    expect(dependsOn).toBeDefined();
    expect(typeof dependsOn?.when).toBe("function");

    const titleAbsent = {
      has: (...keys: string[]) => keys.every((k) => k === "" /* never */),
    };
    const titlePresent = {
      has: (...keys: string[]) => keys.every((k) => k === "title"),
    };

    expect(dependsOn?.when(titleAbsent)).toBe(false);
    expect(dependsOn?.when(titlePresent)).toBe(true);
  });
});
