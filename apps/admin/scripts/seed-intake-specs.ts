// #1140 Phase 2a — idempotent seed for IntakeSpec table.
//
// Seeds two demonstration specs so the /x/intake/specs list page has
// content on first load post-migration:
//
//   - CreateRecipe @ 1.0.0 (PUBLISHED) — mirrors the Phase 1 spike at
//     lib/wizard-v6/specs/create-recipe.crawcus.ts. 4-field reference
//     spec that proves the storage layer can hold a real CrawcusSpec.
//   - CreateCourse @ 0.1.0 (DRAFT) — placeholder for the V5 → V6 port
//     (Phase 3 work). Empty fields object; admin-editable once Phase 2b
//     (editor surface) ships.
//
// Both writes are idempotent via findFirst-then-upsert keyed on
// (key, version). Safe to re-run.
//
// L0 MetaSpec.crawcus.ts is NOT seeded here — blocked on tallyseal
// Ask 1 (field.json() with validator). See
// docs/feedback/tallyseal/hf-feedback-sprint-e-followups-20260606.md.
//
// Usage on hf-dev VM:
//   cd apps/admin && npx tsx scripts/seed-intake-specs.ts
//
// Hooked into db:seed via package.json scripts (Phase 2a follow-up
// commit if needed).

import { PrismaClient, type Prisma } from "@prisma/client";

const SEEDS: Array<{
  key: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  body: Prisma.InputJsonValue;
}> = [
  {
    key: "CreateRecipe",
    version: "1.0.0",
    status: "PUBLISHED",
    body: {
      key: "CreateRecipe",
      version: "1.0.0",
      // Mirrors lib/wizard-v6/specs/create-recipe.crawcus.ts shape.
      // Hand-flattened to JSON so the storage layer can round-trip
      // without needing the spec-emitter (tallyseal Sprint E #63).
      fields: {
        recipeName: { type: "string", required: true },
        servings: { type: "integer", required: true, min: 1 },
        cuisine: { type: "string", required: false },
        difficulty: {
          type: "enum",
          required: true,
          values: ["easy", "medium", "hard"],
        },
      },
      contracts: {
        invariants: [],
      },
      readiness: {
        kind: "all-required",
      },
    },
  },
  {
    key: "CreateCourse",
    version: "0.1.0",
    status: "DRAFT",
    body: {
      key: "CreateCourse",
      version: "0.1.0",
      // Empty placeholder. Phase 3 ports the 27-node V5 Build Course
      // graph (graph-nodes.ts) into this spec via the editor surface
      // (Phase 2b — blocked on tallyseal Ask 2).
      fields: {},
      contracts: {
        invariants: [],
      },
      readiness: {
        kind: "all-required",
      },
    },
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
          console.log(
            `[seed] ${seed.key}@${seed.version} — already PUBLISHED, skipping (immutable).`,
          );
          continue;
        }
        await prisma.intakeSpec.update({
          where: { id: existing.id },
          data: { body: seed.body, status: seed.status },
        });
        console.log(`[seed] ${seed.key}@${seed.version} — updated (${seed.status}).`);
        continue;
      }
      const created = await prisma.intakeSpec.create({
        data: {
          key: seed.key,
          version: seed.version,
          body: seed.body,
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
