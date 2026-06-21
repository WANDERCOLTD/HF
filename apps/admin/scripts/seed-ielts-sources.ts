#!/usr/bin/env tsx
/**
 * seed-ielts-sources.ts (D1 of #2206 — DEMO UNBLOCK)
 *
 * One-off idempotent script that seeds `ContentSource` rows for the
 * IELTS Speaking Practice course on hf_staging (and any other env
 * whose IELTS modules reference these slugs).
 *
 * BACKGROUND
 * ──────────
 * IELTS module config (`Playbook.config.modules[].settings.*Pool`)
 * carries `source:<slug>` references that the runtime resolver
 * (`lib/wizard/resolve-module-source-refs.ts` + the runtime path
 * `selectPinnedCardForModule`) walks to `ContentSource` lookups. The
 * BDD course-ref at `docs/external/ielts/ielts-speaking/Upload Docs/course-ref.md`
 * declares 8 unique source slugs across all module settings; 6 of
 * them have real markdown files on disk (Sources 1, 2, 3, 6, 7, 14).
 * Sources 4 (`cue-card-bank-baseline-v1`) and 5
 * (`mock-exam-scenario-pool-v1`) are described prosaically in the
 * doc as "separate pools" but never authored — Source 9-10 commentary
 * explicitly defers them ("mock-specific scenarios are deferred to a
 * future source-authoring pass") and the doc's runtime guidance is to
 * reuse the Part 2 cue card bank. That deferral is the source of the
 * live IELTS Sources 1-5 gap (the demo blocker).
 *
 * WHAT THIS SCRIPT DOES
 * ─────────────────────
 * Upserts 6 `ContentSource` rows for the slugs that ARE authored. Each
 * row carries:
 *   - `slug`         — canonical lookup key the YAML refs use
 *   - `name`         — operator-readable label (matches course-ref §)
 *   - `description`  — short summary
 *   - `documentType` — `QUESTION_BANK` for the three question banks,
 *                      `REFERENCE` for scaffolds + profile-fields
 *   - `trustLevel`   — `EXPERT_CURATED` (Boaz-authored)
 *
 * The body content of each source LIVES IN THE MARKDOWN FILE ON
 * DISK (the doc's `location:` field). This script does NOT inline
 * the content — that would duplicate the authoring surface. The
 * runtime resolver re-reads the file via the existing
 * `ContentSourceEntry.location` path (set by the wizard projection
 * pass) OR a follow-on PR can stamp `ContentSource.description` /
 * a future `body` column. For the demo, the *existence of the row
 * keyed on the canonical slug* is what unblocks the resolver.
 *
 * COMPANION SCRIPT
 * ────────────────
 * `migrate-ielts-module-source-refs.ts` (D2, sibling) updates the
 * IELTS Playbook config to repoint `baseline.cueCardPool` and
 * `mock.cueCardPool` from the never-authored
 * `cue-card-bank-baseline-v1` / `mock-exam-scenario-pool-v1` slugs
 * to the canonical `cue-card-bank-v1` — matching the BDD-sanctioned
 * deferral path. Run BOTH scripts to close the gap.
 *
 * OPERATOR DEPLOY PROCEDURE
 * ─────────────────────────
 * On hf-dev VM with DATABASE_URL pointing to the target env (hf_staging
 * for the demo tonight):
 *
 *   cd ~/HF/apps/admin
 *   npx tsx scripts/seed-ielts-sources.ts
 *   npx tsx scripts/migrate-ielts-module-source-refs.ts
 *
 * Both are idempotent — re-running is a no-op. Safe to run on any env;
 * touches only ContentSource rows whose slugs appear in this script.
 *
 * Issue #2206. Sibling: D2 (migrate-ielts-module-source-refs.ts).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SourceSeed {
  slug: string;
  name: string;
  description: string;
  documentType: "QUESTION_BANK" | "REFERENCE";
  /**
   * Repo-relative path to the markdown content this source represents.
   * Recorded as provenance; the runtime resolver reads the file via
   * `ContentSourceEntry.location` from the parsed course-ref index, not
   * via this script. Kept here so an operator auditing the seed can
   * verify each row maps to a real file.
   */
  location: string;
  /** Course-ref Source N number for cross-reference. */
  sourceN: string;
}

const SOURCES: SourceSeed[] = [
  // Source 1
  {
    slug: "part1-topic-library-v1",
    name: "IELTS Speaking — Part 1 topic set library",
    description:
      "Bank of Part 1 topics (5–8 questions each) covering the four most common clusters (Home, Work/Study, Hobbies, Hometown) and secondary topics (Food, Travel, Technology, Weather, Routines). Each topic set is tagged for difficulty (basic / intermediate / advanced). Outcomes served: OUT-01, OUT-02, OUT-05, OUT-06, OUT-07.",
    documentType: "QUESTION_BANK",
    location:
      "docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part1.md",
    sourceN: "Source 1",
  },
  // Source 2
  {
    slug: "cue-card-bank-v1",
    name: "IELTS Speaking — Part 2 cue card bank",
    description:
      "Bank of Part 2 cue cards in the standard IELTS structure (single-sentence topic + three or four bullets + closing prompt). Cards tagged for difficulty and likely tense distribution. Outcomes served: OUT-04, OUT-08, OUT-09, OUT-10, OUT-11, OUT-12, OUT-18, OUT-22, OUT-23.",
    documentType: "QUESTION_BANK",
    location:
      "docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part2.md",
    sourceN: "Source 2",
  },
  // Source 3
  {
    slug: "part3-theme-library-v1",
    name: "IELTS Speaking — Part 3 theme library",
    description:
      "Bank of Part 3 themes (4–6 abstract follow-up questions each) across the seven Part 3 question types, designed to escalate concrete → abstract within a drill. Each theme tagged with the question types it covers. Outcomes served: OUT-03, OUT-13, OUT-14, OUT-15, OUT-16, OUT-17, OUT-19, OUT-20, OUT-21.",
    documentType: "QUESTION_BANK",
    location:
      "docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-question-bank-part3.md",
    sourceN: "Source 3",
  },
  // Source 6
  {
    slug: "stall-scaffolds-monologue",
    name: "IELTS Speaking — Part 2 stall scaffolds (monologue)",
    description:
      "Pool of non-disruptive stall-recovery prompts for Part 2 and the Part 2 long turn within Baseline and Mock Exam. Each scaffold tagged with stall shape (early-stall / deep-stall / bullet-stuck / blank-out / explicit-stop). Examiner-mode rules: ≤12 words, never re-frames the question or supplies cue card content.",
    documentType: "REFERENCE",
    location:
      "docs/external/ielts/ielts-speaking/stall-scaffolds-monologue.md",
    sourceN: "Source 6",
  },
  // Source 7
  {
    slug: "stall-scaffolds-discussion",
    name: "IELTS Speaking — Part 3 stall scaffolds (discussion)",
    description:
      "Pool of reframe-not-resolve prompts for Part 3 (and the Part 3 phase of Baseline/Mock). Each scaffold tagged with stall shape (early-stall / deep-stall / i-dont-know / opinion-gap / abstraction-freeze / vocabulary-search / blank-out). Single-question stall pattern; tutor never supplies the answer.",
    documentType: "REFERENCE",
    location:
      "docs/external/ielts/ielts-speaking/stall-scaffolds-discussion.md",
    sourceN: "Source 7",
  },
  // Source 14
  {
    slug: "ielts-speaking-profile-fields",
    name: "IELTS Speaking — profile fields (Baseline warm-up)",
    description:
      "Conversational profile fields woven into the Baseline warm-up. Each field carries a verbatim tutor prompt + coercion type (text / number / band). Extracted at end-of-session by `lib/pipeline/extract-profile-fields.ts` → `CallerAttribute` under `profile:*` namespace. Replaces the inline shortlist [reason, targetBand, timeline, selfLevel] which the runtime filter dropped pre-P3g.",
    documentType: "REFERENCE",
    location:
      "docs/external/ielts/ielts-speaking/Upload Docs/ielts-speaking-profile-fields.md",
    sourceN: "Source 14",
  },
];

async function main(): Promise<void> {
  console.log("\n→ Seeding IELTS ContentSource rows (#2206 D1)\n");

  let created = 0;
  let updated = 0;

  for (const src of SOURCES) {
    // Upsert by unique slug — idempotent.
    const before = await prisma.contentSource.findUnique({
      where: { slug: src.slug },
      select: { id: true },
    });

    await prisma.contentSource.upsert({
      where: { slug: src.slug },
      create: {
        slug: src.slug,
        name: src.name,
        description: src.description,
        documentType: src.documentType,
        trustLevel: "EXPERT_CURATED",
        isActive: true,
      },
      // Don't clobber operator edits to name/description — only refresh on
      // a future schema-evolving pass. Update is a no-op today.
      update: {},
    });

    if (before) {
      updated += 1;
      console.log(
        `  ↻ exists  ${src.slug.padEnd(36)} (${src.sourceN} — ${src.documentType})`,
      );
    } else {
      created += 1;
      console.log(
        `  ✓ created ${src.slug.padEnd(36)} (${src.sourceN} — ${src.documentType})`,
      );
    }
  }

  console.log(
    `\n✓ ContentSource seed complete: ${created} created, ${updated} already existed\n`,
  );
  console.log("Next step: run migrate-ielts-module-source-refs.ts to repoint");
  console.log("baseline.cueCardPool + mock.cueCardPool from the never-authored");
  console.log(
    "`cue-card-bank-baseline-v1` / `mock-exam-scenario-pool-v1` slugs to the",
  );
  console.log("canonical `cue-card-bank-v1` (Source 9/10 BDD-sanctioned reuse).\n");
}

main()
  .catch((e) => {
    console.error("\n✗ seed-ielts-sources failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
