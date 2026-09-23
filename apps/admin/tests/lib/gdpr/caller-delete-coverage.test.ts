/**
 * Caller-erasure delete-chain coverage — Lattice Coverage-pillar test.
 *
 * **What this test pins:**
 *  `lib/gdpr/delete-caller-data.ts::deleteCallerData` is the canonical
 *  caller-deletion chokepoint. It backs GDPR Art.17 erasure
 *  (`DELETE /api/callers/[callerId]`), the retention cleanup cron
 *  (`POST /api/admin/retention/cleanup`) and `POST /api/admin/bulk-delete`.
 *
 *  Postgres will refuse `caller.delete()` while ANY row still references
 *  the Caller through a FK whose `onDelete` is `Restrict` — or is left
 *  unspecified, which Prisma renders as `Restrict`. Every such relation
 *  MUST therefore be deleted by the helper before it deletes the Caller,
 *  or erasure throws P2003 and the caller can never be erased.
 *
 *  Relations declared `Cascade` or `SetNull` are handled by Postgres and
 *  are deliberately NOT required here.
 *
 * **Why this exists:**
 *  Epic #1338 added `Session.callerId` with `onDelete: Restrict` and the
 *  helper was never updated. Nothing caught it. Measured 2026-09-23 by
 *  running the real helper inside a rolled-back transaction:
 *
 *      hf_sandbox   160 callers,  44 un-erasable (28%)
 *      hf_staging   159 callers,  50 un-erasable (31%)
 *      RESULT: P2003 — constraint `Session_callerId_fkey`
 *
 *  A manual survey found `Session`. It missed `CohortGroup.ownerId`,
 *  which blocks erasure the same way. That is the case for a structural
 *  gate rather than a careful reviewer: the next model to add a
 *  Restrict FK to Caller now fails CI instead of silently breaking
 *  erasure months later.
 *
 * **How matching works:**
 *  schema.prisma is parsed for every `<field> Caller[?] @relation(...)`
 *  inside a model block. Each relation is classified by its `onDelete`.
 *  Blocking relations are looked up in the helper source as
 *  `.<modelCamelCase>.delete` (covers `delete` and `deleteMany`).
 *
 *  Matching is by MODEL, not FK field name — `CohortGroup` is reached
 *  via `ownerId`, not `callerId`.
 *
 * **How to fix a failure:**
 *  - "blocking relation not handled": add the delete to
 *    `deleteCallerData`, ordered before `caller.delete()`. If the rows
 *    must legally SURVIVE erasure (audit/retention), add an exempt entry
 *    stating what the helper does instead (e.g. anonymise) — an exempt
 *    entry is a claim that erasure still succeeds, so the relation must
 *    also stop being Restrict.
 *  - "ratchet drifted": close the gap, or bump consciously in the same
 *    commit that opened it.
 *
 *  See `.claude/rules/caller-delete-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = join(REPO_ADMIN, "prisma", "schema.prisma");
const HELPER_PATH = join(REPO_ADMIN, "lib", "gdpr", "delete-caller-data.ts");

/** `onDelete` values Postgres resolves without help from the chokepoint. */
const NON_BLOCKING_ON_DELETE = new Set(["Cascade", "SetNull"]);

interface ExemptEntry {
  /** >20 chars — say what the helper does INSTEAD, and why. */
  reason: string;
}

/**
 * Blocking relations the helper deliberately does not delete.
 *
 * Empty by design. An entry here asserts erasure still succeeds, which
 * means the relation must also have stopped being Restrict — otherwise
 * you have documented a bug rather than fixed one.
 */
const CALLER_DELETE_EXEMPT: Record<string, ExemptEntry> = {};

const EXPECTED_EXEMPT_COUNT = 0;
const EXPECTED_GAP_COUNT = 0;

/**
 * Sanity floor for the schema parse. If a schema.prisma refactor (or a
 * Prisma syntax change) breaks the regex, the parse silently returns
 * nothing and every assertion below passes vacuously. This floor turns
 * that into a failure.
 */
const MIN_EXPECTED_CALLER_RELATIONS = 15;

interface CallerRelation {
  model: string;
  fkField: string;
  onDelete: string;
  blocking: boolean;
}

/** Every `model X { ... }` block in the schema, as [name, body]. */
function modelBlocks(schema: string): Array<[string, string]> {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

/** Relations pointing INTO `target`, from every other model. */
function parseRelationsInto(schema: string, target: string): CallerRelation[] {
  const rel = new RegExp(`^\\s*\\w+\\s+${target}\\??\\s+@relation\\(([^)]*)\\)`, "gm");
  const out: CallerRelation[] = [];
  for (const [model, body] of modelBlocks(schema)) {
    if (model === target) continue;
    for (const [, args] of body.matchAll(rel)) {
      const onDelete = /onDelete:\s*(\w+)/.exec(args)?.[1] ?? "UNSPECIFIED";
      out.push({
        model,
        fkField: /fields:\s*\[(\w+)\]/.exec(args)?.[1] ?? "?",
        onDelete,
        blocking: !NON_BLOCKING_ON_DELETE.has(onDelete),
      });
    }
  }
  return out;
}

function parseCallerRelations(schema: string): CallerRelation[] {
  const modelBlock = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  const callerRel = /^\s*\w+\s+Caller\??\s+@relation\(([^)]*)\)/gm;

  const out: CallerRelation[] = [];
  for (const [, model, body] of schema.matchAll(modelBlock)) {
    if (model === "Caller") continue;
    for (const [, args] of body.matchAll(callerRel)) {
      const onDelete = /onDelete:\s*(\w+)/.exec(args)?.[1] ?? "UNSPECIFIED";
      out.push({
        model,
        fkField: /fields:\s*\[(\w+)\]/.exec(args)?.[1] ?? "?",
        onDelete,
        blocking: !NON_BLOCKING_ON_DELETE.has(onDelete),
      });
    }
  }
  return out;
}

/** `CallerIdentity` -> `callerIdentity` (the Prisma client accessor). */
const toAccessor = (model: string) => model[0].toLowerCase() + model.slice(1);

type Classification = "covered" | "exempt" | "gap";

interface CellResult extends CallerRelation {
  classification: Classification;
}

const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
const helperSrc = readFileSync(HELPER_PATH, "utf8");
const relations = parseCallerRelations(schemaSrc);

const results: CellResult[] = relations
  .filter((r) => r.blocking)
  .map((r) => {
    let classification: Classification;
    if (CALLER_DELETE_EXEMPT[r.model]) {
      classification = "exempt";
    } else {
      const handled = new RegExp(`\\.${toAccessor(r.model)}\\.delete`).test(helperSrc);
      classification = handled ? "covered" : "gap";
    }
    return { ...r, classification };
  });

const gaps = results.filter((r) => r.classification === "gap");
const exempt = results.filter((r) => r.classification === "exempt");

describe("Caller erasure delete-chain coverage (Lattice Coverage)", () => {
  it("schema parse found a plausible number of Caller relations", () => {
    expect(
      relations.length,
      `Parsed only ${relations.length} Caller relations from schema.prisma — ` +
        `below the ${MIN_EXPECTED_CALLER_RELATIONS} floor. The regex has probably ` +
        `broken against a schema change; fix the parser before trusting this gate.`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_CALLER_RELATIONS);
    expect(results.length).toBeGreaterThan(0);
  });

  it("the canonical helper still deletes the Caller row itself", () => {
    expect(
      /\.caller\.delete\(/.test(helperSrc),
      "delete-caller-data.ts no longer calls caller.delete() — either the " +
        "chokepoint moved (update HELPER_PATH) or erasure silently stopped " +
        "deleting the Caller.",
    ).toBe(true);
  });

  it("every blocking Caller relation is handled before caller.delete()", () => {
    const detail = gaps
      .map((g) => `  ${g.model}.${g.fkField} (onDelete: ${g.onDelete})`)
      .join("\n");
    expect(
      gaps.length,
      `${gaps.length} relation(s) block caller erasure with no delete in ` +
        `lib/gdpr/delete-caller-data.ts. Postgres will reject caller.delete() ` +
        `with P2003 for any caller holding these rows:\n${detail}\n\n` +
        `Add a deleteMany for each before the caller.delete() call.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    expect(exempt.length).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [model, entry] of Object.entries(CALLER_DELETE_EXEMPT)) {
      expect(entry.reason.length, `${model} exempt reason too short`).toBeGreaterThan(20);
    }
  });

  it("no exempt entry references a relation that is no longer blocking", () => {
    const blockingModels = new Set(relations.filter((r) => r.blocking).map((r) => r.model));
    for (const model of Object.keys(CALLER_DELETE_EXEMPT)) {
      expect(
        blockingModels.has(model),
        `${model} is exempt but is no longer a blocking Caller relation — stale row, remove it.`,
      ).toBe(true);
    }
  });

  it("no exempt entry is contradicted by an actual delete in the helper", () => {
    for (const model of Object.keys(CALLER_DELETE_EXEMPT)) {
      expect(
        new RegExp(`\\.${toAccessor(model)}\\.delete`).test(helperSrc),
        `${model} is exempt but the helper DOES delete it — remove the exempt row.`,
      ).toBe(false);
    }
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const covered = results.filter((r) => r.classification === "covered").length;
    const cascade = relations.filter((r) => !r.blocking).length;
    console.log(
      `[caller-delete-coverage] ${relations.length} Caller relations — ` +
        `${cascade} Cascade/SetNull (Postgres-handled), ` +
        `${results.length} blocking → ${covered} covered, ` +
        `${exempt.length} exempt, ${gaps.length} gap`,
    );
    expect(covered + exempt.length + gaps.length).toBe(results.length);
  });
});

/**
 * Second-order coverage.
 *
 * The block above proves the helper clears everything pointing at `Caller`.
 * But the helper also deletes OTHER rows — owned `CohortGroup`s, for
 * instance — and those have their own inbound FKs. A Restrict FK into one of
 * them blocks erasure just as hard, and the first-order scan structurally
 * cannot see it because it only walks edges into `Caller`.
 *
 * This is not hypothetical. `Caller.cohortGroupId` (the deprecated
 * single-membership scalar, Restrict by default) points at `CohortGroup`.
 * When the helper began deleting owned cohorts, erasing a cohort owner would
 * throw P2003 on behalf of OTHER callers still referencing that cohort — 20
 * such callers existed on both hf_sandbox and hf_staging. The first-order
 * gate showed 0 gaps throughout.
 *
 * A blocking inbound FK is considered handled when the helper either deletes
 * the referencing model outright, or severs the reference by setting the FK
 * field to null.
 */

const MODEL_NAMES = modelBlocks(schemaSrc).map(([name]) => name);

/** Models the helper deletes, inferred from `.<accessor>.delete` in its source. */
const deletedModels = MODEL_NAMES.filter((m) =>
  new RegExp(`\\.${toAccessor(m)}\\.delete`).test(helperSrc),
);

interface SecondOrderCell extends CallerRelation {
  target: string;
  classification: Classification;
}

const secondOrder: SecondOrderCell[] = deletedModels
  // Edges into Caller are the first-order block's job.
  .filter((target) => target !== "Caller")
  .flatMap((target) =>
    parseRelationsInto(schemaSrc, target)
      .filter((r) => r.blocking)
      .map((r) => {
        const deletesReferrer = deletedModels.includes(r.model);
        const seversRef = new RegExp(`${r.fkField}:\\s*null`).test(helperSrc);
        return {
          ...r,
          target,
          classification: (deletesReferrer || seversRef ? "covered" : "gap") as Classification,
        };
      }),
  );

const secondOrderGaps = secondOrder.filter((c) => c.classification === "gap");

describe("Caller erasure — second-order FK coverage (Lattice Coverage)", () => {
  it("the helper deletes more than just the Caller row", () => {
    expect(deletedModels.length).toBeGreaterThan(5);
    expect(deletedModels).toContain("Caller");
  });

  it("every blocking FK into a helper-deleted model is deleted or severed", () => {
    const detail = secondOrderGaps
      .map((g) => `  ${g.model}.${g.fkField} -> ${g.target} (onDelete: ${g.onDelete})`)
      .join("\n");
    expect(
      secondOrderGaps.length,
      `${secondOrderGaps.length} FK(s) block deletion of a row the erasure helper ` +
        `itself removes. Postgres will reject that delete with P2003 — possibly on ` +
        `behalf of a DIFFERENT caller who still references the row:\n${detail}\n\n` +
        `Either delete the referencing rows, or sever the reference with ` +
        `updateMany({ data: { <fkField>: null } }) before the delete.`,
    ).toBe(0);
  });

  it("second-order scan sanity (operator-facing log)", () => {
    console.log(
      `[caller-delete-coverage] second-order — helper deletes ${deletedModels.length} models; ` +
        `${secondOrder.length} blocking inbound FK(s) across them; ${secondOrderGaps.length} gap`,
    );
    expect(secondOrder.length).toBeGreaterThan(0);
  });
});
