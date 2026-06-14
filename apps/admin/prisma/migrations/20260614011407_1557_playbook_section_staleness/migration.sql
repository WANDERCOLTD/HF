-- #1557 (Story 2 of EPIC #1555) — Section-grain staleness primitives.
--
-- Sibling table — one row per (playbookId, sectionKey). Decoupled from
-- `Playbook.composeInputsUpdatedAt` (separate clocks). Bumped by
-- `lib/compose/section-staleness.ts::bumpSectionHash` when a compose-affecting
-- write changes a key in that section.
--
-- Storage decision (TL Q1): sibling table chosen over a Json column on
-- `Playbook` or `ComposedPrompt.inputs` so concurrent saves can hold a
-- row-level lock per section, and the `staleSince` queryable column avoids
-- diffing Json on every read.
--
-- Additive only — no NOT-NULL backfill on existing tables. `ON DELETE CASCADE`
-- against `Playbook` keeps the table clean when a Playbook is removed.
-- `@@unique([playbookId, sectionKey])` enforces single-row-per-section.
CREATE TABLE "PlaybookSectionStaleness" (
  "id"          TEXT NOT NULL,
  "playbookId"  TEXT NOT NULL,
  "sectionKey"  TEXT NOT NULL,
  "sectionHash" TEXT NOT NULL,
  "staleSince"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybookSectionStaleness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaybookSectionStaleness_playbookId_sectionKey_key"
  ON "PlaybookSectionStaleness" ("playbookId", "sectionKey");

CREATE INDEX "PlaybookSectionStaleness_playbookId_idx"
  ON "PlaybookSectionStaleness" ("playbookId");

CREATE INDEX "PlaybookSectionStaleness_staleSince_idx"
  ON "PlaybookSectionStaleness" ("staleSince");

ALTER TABLE "PlaybookSectionStaleness"
  ADD CONSTRAINT "PlaybookSectionStaleness_playbookId_fkey"
  FOREIGN KEY ("playbookId") REFERENCES "Playbook" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
