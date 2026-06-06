/**
 * #1140 Phase 2c — projectBodyFromEditable contract tests.
 *
 * Verifies that an EditableSpec parsed from canonical seed source
 * (CreateRecipe / CreateCourse) projects to a body cache shape that
 * preserves the surface metadata spec-store.ts::toSummary depends on
 * (fields-as-Record so Object.keys(body.fields).length works, plus
 * key/version/projection identity).
 *
 * Round-trip check: take seed source, parse via @tallyseal/spec-emitter,
 * project, assert the result has the right shape AND the right
 * fieldCount that the list page will read.
 */

import { describe, it, expect } from "vitest";
import { parse } from "@tallyseal/spec-emitter";
import { projectBodyFromEditable } from "@/lib/intake/crawcus-serde";

const CREATE_RECIPE_SOURCE = `import { defineCrawcusSpec, field } from '@tallyseal/core';

export const CreateRecipe = defineCrawcusSpec({
  key: "CreateRecipe",
  projection: "Recipe",
  version: 1,
  fields: {
    recipeName: field.string().required(),
    servings: field.integer().required(),
    cuisine: field.string().optional(),
    difficulty: field.enum(["easy", "medium", "hard"]).required(),
  },
  readiness: ({ has }) => has("recipeName", "servings", "difficulty"),
});
`;

const CREATE_COURSE_SOURCE = `import { defineCrawcusSpec, field } from '@tallyseal/core';

export const CreateCourse = defineCrawcusSpec({
  key: "CreateCourse",
  projection: "Course",
  version: 1,
  fields: {
    placeholder: field.string().optional(),
  },
  readiness: ({ has }) => has("placeholder"),
});
`;

describe("projectBodyFromEditable", () => {
  it("projects CreateRecipe source to a body with all 4 fields", () => {
    const editable = parse(CREATE_RECIPE_SOURCE);
    const body = projectBodyFromEditable(editable) as Record<string, unknown>;

    expect(body.key).toBe("CreateRecipe");
    expect(body.projection).toBe("Recipe");
    expect(body.version).toBe(1);

    const fields = body.fields as Record<string, unknown>;
    // The exact contract spec-store.ts::toSummary depends on:
    // Object.keys(body.fields).length === fieldCount.
    expect(Object.keys(fields).sort()).toEqual([
      "cuisine",
      "difficulty",
      "recipeName",
      "servings",
    ]);

    const recipeName = fields.recipeName as Record<string, unknown>;
    expect(recipeName.type).toBe("string");
    expect(recipeName.required).toBe(true);

    const cuisine = fields.cuisine as Record<string, unknown>;
    expect(cuisine.type).toBe("string");
    expect(cuisine.required).toBe(false);

    const difficulty = fields.difficulty as Record<string, unknown>;
    expect(difficulty.type).toBe("enum");
    expect(difficulty.required).toBe(true);
  });

  it("projects CreateCourse source to a body with the single placeholder field", () => {
    const editable = parse(CREATE_COURSE_SOURCE);
    const body = projectBodyFromEditable(editable) as Record<string, unknown>;

    expect(body.key).toBe("CreateCourse");
    expect(body.version).toBe(1);

    const fields = body.fields as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(["placeholder"]);

    const placeholder = fields.placeholder as Record<string, unknown>;
    expect(placeholder.type).toBe("string");
    expect(placeholder.required).toBe(false);
  });

  it("preserves the contracts/readiness skeleton expected by the body cache", () => {
    const editable = parse(CREATE_RECIPE_SOURCE);
    const body = projectBodyFromEditable(editable) as Record<string, unknown>;

    expect(body.contracts).toEqual({ invariants: [] });
    expect(body.readiness).toEqual({ kind: "all-required" });
  });

  it("survives the editor-save round-trip: parse → project → fieldCount matches added field", () => {
    // Simulate the editor adding a new field by editing the source
    // before saving. saveSpecAction then parses + projects on the
    // server; this test mirrors that path.
    const editedSource = CREATE_COURSE_SOURCE.replace(
      "placeholder: field.string().optional(),",
      "placeholder: field.string().optional(),\n    title: field.string().required(),",
    );
    const editable = parse(editedSource);
    const body = projectBodyFromEditable(editable) as Record<string, unknown>;
    const fields = body.fields as Record<string, unknown>;

    expect(Object.keys(fields).sort()).toEqual(["placeholder", "title"]);
  });
});
