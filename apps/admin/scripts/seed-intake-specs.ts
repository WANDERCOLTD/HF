// #1140 Phase 2a + #1194 Phase 2b — idempotent seed for IntakeSpec table.
//
// Seeds two demonstration specs so the /x/intake/specs list page has
// content on first load post-migration, AND the editor at
// /x/intake/specs/[id] has a canonical TS source to parse.
//
// Each seed declares:
//   - body: JSON cache projection of the spec (list page reads this without parse)
//   - source: TS source matching @tallyseal/spec-emitter parse() documented shape
//
// Both writes are idempotent via findByKeyVersion → upsert keyed on
// (key, version). Safe to re-run. Re-running an existing seeded row
// updates source + body in-place; PUBLISHED rows are left alone
// (the DB trigger intake_spec_published_immutable_trigger refuses
// mutation anyway).
//
// L0 MetaSpec.crawcus.ts is NOT seeded here — blocked on tallyseal
// Ask 1 (field.json() with validator). See
// docs/feedback/tallyseal/hf-feedback-sprint-e-followups-20260606.md.
//
// Usage on hf-dev VM:
//   cd apps/admin && npx tsx scripts/seed-intake-specs.ts

import { PrismaClient, type Prisma } from "@prisma/client";

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
    // Phase 2c will port all 27 V5 Build Course fields here via the
    // admin-editor UI. Phase 2b ships the wire-up against an empty
    // shell — the editor can add fields interactively from here.
    placeholder: field.string().optional(),
  },
  readiness: ({ has }) => has("placeholder"),
});
`;

const SEEDS: Array<{
  key: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  body: Prisma.InputJsonValue;
  source: string;
}> = [
  {
    key: "CreateRecipe",
    version: "1.0.0",
    status: "PUBLISHED",
    body: {
      key: "CreateRecipe",
      version: 1,
      projection: "Recipe",
      fields: {
        recipeName: { type: "string", required: true },
        servings: { type: "integer", required: true },
        cuisine: { type: "string", required: false },
        difficulty: { type: "enum", required: true, values: ["easy", "medium", "hard"] },
      },
      contracts: { invariants: [] },
      readiness: { kind: "all-required" },
    },
    source: CREATE_RECIPE_SOURCE,
  },
  {
    key: "CreateCourse",
    version: "0.1.0",
    status: "DRAFT",
    body: {
      key: "CreateCourse",
      version: 1,
      projection: "Course",
      fields: {
        placeholder: { type: "string", required: false },
      },
      contracts: { invariants: [] },
      readiness: { kind: "all-required" },
    },
    source: CREATE_COURSE_SOURCE,
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const seed of SEEDS) {
      const existing = await prisma.intakeSpec.findUnique({
        where: { key_version: { key: seed.key, version: seed.version } },
      });
      if (existing) {
        if (existing.status === "PUBLISHED") {
          // #1140 Phase 2c — PUBLISHED-source backfill.
          // The intake_spec_published_immutable_trigger blocks
          // body/key/version/status mutations on PUBLISHED rows but
          // intentionally NOT `source` (the column post-dated the
          // trigger — see migration 20260606131540_1194_intake_spec_source).
          // So an old PUBLISHED row with source = NULL is correctable
          // by a source-only update. Body stays frozen.
          if (existing.source === null) {
            await prisma.intakeSpec.update({
              where: { id: existing.id },
              data: { source: seed.source },
            });
            console.log(
              `[seed] ${seed.key}@${seed.version} — backfilled source on PUBLISHED row.`,
            );
            continue;
          }
          console.log(
            `[seed] ${seed.key}@${seed.version} — already PUBLISHED with source on record, skipping (immutable).`,
          );
          continue;
        }
        await prisma.intakeSpec.update({
          where: { id: existing.id },
          data: { body: seed.body, source: seed.source, status: seed.status },
        });
        console.log(
          `[seed] ${seed.key}@${seed.version} — updated body + source (${seed.status}).`,
        );
        continue;
      }
      const created = await prisma.intakeSpec.create({
        data: {
          key: seed.key,
          version: seed.version,
          body: seed.body,
          source: seed.source,
          status: seed.status,
          publishedAt: seed.status === "PUBLISHED" ? new Date() : null,
        },
      });
      console.log(
        `[seed] ${seed.key}@${seed.version} — created id=${created.id} status=${seed.status}.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
